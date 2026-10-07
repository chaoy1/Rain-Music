import { joinPath } from '@common/utils/nodejs'
import { log } from '@common/utils'
import { filterMusicList, toNewMusicInfo } from '@common/utils/tools'
import { APP_EVENT_NAMES, STORE_NAMES } from '@common/constants'
import { electronConfigFiles } from '@main/platform/storage/adapter'

/**
 * Rain Music Android 移植 · 阶段 2 / 线 B
 *
 * 这个文件是 **v2.0.0 之前旧 Electron 数据目录的一次性迁移**，
 * 全部文件操作已改走 `IFileAdapter`（`src/common/storage/types.ts`）。
 *
 * 为什么这里直接用 `electronConfigFiles` 而不是走 `@main/platform/storage/adapter` 的默认导出：
 * 迁移的**输入**是 `global.rainOldDataPath`（`src/main/utils/dataPath.ts:41` 记录的
 * `app.getPath('userData')`），这个概念在 Android 上不存在（Capacitor 侧没有旧 Electron 数据目录）。
 * 也就是说这段代码**天生就是桌面专有**的；把它接到 Android 适配器上只会得到一个永远返回 null 的空实现。
 * 用 `electronConfigFiles` 明确表达"这里是桌面路径"，比藏一个平台分支更诚实。
 */
const files = electronConfigFiles

/**
 * 读取旧数据目录里的配置文件。
 *
 * 等价于原实现（`fs.promises.readFile` + `JSON.parse` + `checkPath`），
 * 现在收敛到 `IFileAdapter.readJsonOrNull()`：
 * 不存在 → `null`；解析失败 → 记日志后 `null`。
 */
export const parseDataFile = async<T>(name: string): Promise<T | null> => {
  return files.readJsonOrNull<T>(joinPath(global.rainOldDataPath, name))
}

interface OldUserListInfo {
  name: string
  id: string
  source?: Rain.OnlineSource
  sourceListId?: string
  locationUpdateTime?: number
  list: any[]
}

/**
 * 迁移 v2.0.0 之前的 list data
 * @returns
 */
export const migrateDBData = async() => {
  // 旧数据里的 loveList（我的收藏）已随该列表一起废弃：这里刻意不再读取，
  // 让老用户的收藏数据不会被迁移进新库（用户要求连同数据删除，不做迁移）。
  let playList = await parseDataFile<{ defaultList?: { list: any[] }, tempList?: { list: any[] }, userList?: OldUserListInfo[] }>('playList.json')
  let listDataAll: Rain.List.ListDataFull = {
    defaultList: [],
    userList: [],
    tempList: [],
  }
  let isRequiredSave = false
  if (playList) {
    if (playList.defaultList) listDataAll.defaultList = filterMusicList(playList.defaultList.list.map(m => toNewMusicInfo(m)))
    if (playList.tempList) listDataAll.tempList = filterMusicList(playList.tempList.list.map(m => toNewMusicInfo(m)))
    if (playList.userList) {
      listDataAll.userList = playList.userList.map(l => {
        return {
          ...l,
          locationUpdateTime: l.locationUpdateTime ?? null,
          list: filterMusicList(l.list.map(m => toNewMusicInfo(m))),
        }
      })
    }
    isRequiredSave = true
  } else {
    const config = await parseDataFile<{ list?: { defaultList?: any[] } }>('config.json')
    if (config?.list) {
      const list = config.list
      if (list.defaultList) listDataAll.defaultList = filterMusicList(list.defaultList.map(m => toNewMusicInfo(m)))
      isRequiredSave = true
    }
  }
  if (isRequiredSave) await global.rain.worker.dbService.listDataOverwrite(listDataAll)

  const lyricData = await parseDataFile<Record<string, Rain.Music.LyricInfo>>('lyrics_edited.json')
  if (lyricData) {
    for await (const [id, info] of Object.entries(lyricData)) {
      await global.rain.worker.dbService.editedLyricAdd(id, info)
    }
  }
}

/**
 * 迁移文件：目标不存在且源存在时复制一次。
 *
 * 等价于原实现（两次 `checkPath` + `copyFile` + 两次 `.catch(log.error)`）。
 */
const migrateFile = async(name: string, targetName: string) => {
  await files.copyIfMissing(
    joinPath(global.rainOldDataPath, name),
    joinPath(global.rainDataPath, targetName),
  )
}

/**
 * 迁移 v2.0.0 之前的 data.json
 * @returns
 */
export const migrateDataJson = async() => {
  const targetPath = joinPath(global.rainDataPath, 'data.json')
  if (await files.exists(targetPath)) return
  const oldDataFile = await parseDataFile<{
    searchHistoryList?: string[]
    playInfo?: any
    listPrevSelectId?: any
    listPosition?: any
    listUpdateInfo?: any
  }>('data.json')
  if (!oldDataFile) return
  const newData: any = {}
  if (oldDataFile.searchHistoryList) newData.searchHistoryList = oldDataFile.searchHistoryList
  if (oldDataFile.playInfo) newData.playInfo = oldDataFile.playInfo
  if (oldDataFile.listPrevSelectId) newData.listPrevSelectId = oldDataFile.listPrevSelectId
  if (oldDataFile.listPosition) newData.listScrollPosition = oldDataFile.listPosition
  if (oldDataFile.listUpdateInfo) newData.listUpdateInfo = oldDataFile.listUpdateInfo

  // 原实现（`migrate.ts:112-114`）用 `.catch(err => log.error(err))` 吞掉写失败；
  // 适配器把错误抛出来，这里照旧吞掉，行为不变。
  await files.writeText(targetPath, JSON.stringify(newData)).catch(err => {
    log.error(err)
  })
}


const hotKeyNameMap = {
  mainWindow: APP_EVENT_NAMES.winMainName,
  winLyric: APP_EVENT_NAMES.winLyricName,
} as const
const updateHotKeyTypeName = (config: Rain.HotKeyConfig) => {
  for (const keyConfig of Object.values(config.keys)) {
    if (hotKeyNameMap[keyConfig.type as keyof typeof hotKeyNameMap]) keyConfig.type = hotKeyNameMap[keyConfig.type as keyof typeof hotKeyNameMap]
  }
}
/**
 * 迁移 v2.0.0 之前的 hotkey
 * @returns
 */
export const migrateHotKey = async() => {
  const oldConfig = await parseDataFile<Rain.HotKeyConfigAll>('hotKey.json')
  if (oldConfig) {
    let localConfig: Rain.HotKeyConfig
    let globalConfig: Rain.HotKeyConfig
    updateHotKeyTypeName(oldConfig.local)
    updateHotKeyTypeName(oldConfig.global)

    localConfig = oldConfig.local
    globalConfig = oldConfig.global

    // 移除v1.0.1及之前设置的全局声音媒体快捷键接管
    if (globalConfig.keys.VolumeUp) {
      delete globalConfig.keys.VolumeUp
      delete globalConfig.keys.VolumeDown
      delete globalConfig.keys.VolumeMute
    }
    return {
      local: localConfig,
      global: globalConfig,
    }
  }
  return null
}

/**
 * 迁移 v2.0.0 之前的user api
 * @returns
 */
export const migrateUserApi = async() => migrateFile('userApi.json', STORE_NAMES.USER_API + '.json')
