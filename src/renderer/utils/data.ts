/* eslint-disable @typescript-eslint/no-dynamic-delete */
import {
  saveListPositionInfo as saveListPositionInfoFromData,
  getListPositionInfo as getListPositionInfoFromData,
  saveListPrevSelectId as saveListPrevSelectIdFromData,
  getListPrevSelectId as getListPrevSelectIdFromData,
  saveListUpdateInfo as saveListUpdateInfoFromData,
  getListUpdateInfo as getListUpdateInfoFromData,
  saveSearchSetting as saveSearchSettingFromData,
  getSearchSetting as getSearchSettingFromData,
  saveSongListSetting as saveSongListSettingFromData,
  getSongListSetting as getSongListSettingFromData,
  saveLeaderboardSetting as saveLeaderboardSettingFromData,
  getLeaderboardSetting as getLeaderboardSettingFromData,
  saveViewPrevState as saveViewPrevStateFromData,
} from '@renderer/utils/ipc'
import { throttle } from '@common/utils'
import { DEFAULT_SETTING, LEGACY_LOVE_LIST_ID, LIST_IDS } from '@common/constants'
import { dateFormat } from './index'
import { setUpdateTime } from '@renderer/store/list/action'
import music from '@renderer/utils/musicSdk'

let listPosition: Rain.List.ListPositionInfo
let listPrevSelectId: string
let listUpdateInfo: Rain.List.ListUpdateInfo

let searchSetting: typeof DEFAULT_SETTING['search']
let songListSetting: typeof DEFAULT_SETTING['songList']
let leaderboardSetting: typeof DEFAULT_SETTING['leaderboard']

const saveListPositionThrottle = throttle(() => {
  saveListPositionInfoFromData(listPosition)
}, 1000)
const saveSearchSettingThrottle = throttle(() => {
  saveSearchSettingFromData(searchSetting)
}, 1000)
const saveSongListSettingThrottle = throttle(() => {
  saveSongListSettingFromData(songListSetting)
}, 1000)
const saveLeaderboardSettingThrottle = throttle(() => {
  saveLeaderboardSettingFromData(leaderboardSetting)
}, 1000)
const saveViewPrevStateThrottle = throttle((state) => {
  saveViewPrevStateFromData(state)
}, 1000)

const initPosition = async() => {
  // eslint-disable-next-line require-atomic-updates
  listPosition ??= await getListPositionInfoFromData() ?? {}
}
export const getListPosition = async(id: string): Promise<number> => {
  await initPosition()
  return listPosition[id] ?? 0
}
export const setListPosition = async(id: string, position?: number) => {
  await initPosition()
  listPosition[id] = position ?? 0
  saveListPositionThrottle()
}
export const removeListPosition = async(id: string) => {
  await initPosition()
  if (listPosition[id] == null) return
  delete listPosition[id]
  saveListPositionThrottle()
}
export const overwriteListPosition = async(ids: string[]) => {
  await initPosition()
  const removedIds = []
  for (const id of Object.keys(listPosition)) {
    if (ids.includes(id)) continue
    removedIds.push(id)
  }
  for (const id of removedIds) delete listPosition[id]
  saveListPositionThrottle()
}

const saveListPrevSelectIdThrottle = throttle(() => {
  saveListPrevSelectIdFromData(listPrevSelectId)
}, 200)
export const getListPrevSelectId = async() => {
  // eslint-disable-next-line require-atomic-updates
  listPrevSelectId ??= await getListPrevSelectIdFromData() ?? LIST_IDS.DEFAULT
  // 内置「我的收藏」已删除：老用户配置里残留的选中记录回落到试听列表，
  // 避免升级后进入一个并不存在的列表
  if (listPrevSelectId === LEGACY_LOVE_LIST_ID) listPrevSelectId = LIST_IDS.DEFAULT
  return listPrevSelectId ?? LIST_IDS.DEFAULT
}
export const saveListPrevSelectId = (id: string) => {
  listPrevSelectId = id
  saveListPrevSelectIdThrottle()
}

const saveListUpdateInfo = throttle(() => {
  saveListUpdateInfoFromData(listUpdateInfo)
}, 1000)

const initListUpdateInfo = async() => {
  if (listUpdateInfo == null) {
    // eslint-disable-next-line require-atomic-updates
    listUpdateInfo = await getListUpdateInfoFromData() ?? {}
    for (const [id, info] of Object.entries(listUpdateInfo)) {
      setUpdateTime(id, info.updateTime ? dateFormat(info.updateTime) : '')
    }
  }
}
export const getListUpdateInfo = async() => {
  await initListUpdateInfo()
  return listUpdateInfo
}
export const setListUpdateInfo = async(info: Rain.List.ListUpdateInfo) => {
  await initListUpdateInfo()
  listUpdateInfo = info
  saveListUpdateInfo()
}
export const setListAutoUpdate = async(id: string, enable: boolean) => {
  await initListUpdateInfo()
  const targetInfo = listUpdateInfo[id] ?? { updateTime: 0, isAutoUpdate: false }
  targetInfo.isAutoUpdate = enable
  listUpdateInfo[id] = targetInfo
  saveListUpdateInfo()
}
export const setListUpdateTime = async(id: string, time: number) => {
  await initListUpdateInfo()
  const targetInfo = listUpdateInfo[id] ?? { updateTime: 0, isAutoUpdate: false }
  targetInfo.updateTime = time
  listUpdateInfo[id] = targetInfo
  saveListUpdateInfo()
}
// export const setListUpdateInfo = (id, { updateTime, isAutoUpdate }) => {
//   listUpdateInfo[id] = { updateTime, isAutoUpdate }
//   saveListUpdateInfo()
// }
export const removeListUpdateInfo = async(id: string) => {
  await initListUpdateInfo()
  if (listUpdateInfo[id] == null) return
  delete listUpdateInfo[id]
  saveListUpdateInfo()
}
export const overwriteListUpdateInfo = async(ids: string[]) => {
  await initListUpdateInfo()
  const removedIds = []
  for (const id of Object.keys(listUpdateInfo)) {
    if (ids.includes(id)) continue
    removedIds.push(id)
  }
  for (const id of removedIds) delete listUpdateInfo[id]
  saveListUpdateInfo()
}


// 内置音源 id 列表（tx / kg / wy），来源即 musicSdk.sources，顺序也由它决定
const onlineSourceIds = music.sources.map(s => String(s.id))

/**
 * 归一化持久化在配置里的音源 id。
 * 酷我(kw) / 咪咕(mg) / 百度(bd) / 虾米(xm) 音源与「聚合搜索」(all) 已删除，
 * 老用户配置里可能仍留有这些值，读取时一律回落到默认音源（tx），
 * 避免界面进入一个并不存在的音源。
 */
export const normalizeSource = (source: string | undefined | null): string => {
  if (source != null && onlineSourceIds.includes(source)) return source
  return DEFAULT_SETTING.search.source
}

export const getSearchSetting = async() => {
  // eslint-disable-next-line require-atomic-updates
  searchSetting ??= await getSearchSettingFromData()
  searchSetting.source = normalizeSource(searchSetting.source)
  searchSetting.temp_source = normalizeSource(searchSetting.temp_source)
  return { ...searchSetting }
}
export const setSearchSetting = async(setting: Partial<typeof DEFAULT_SETTING['search']>) => {
  if (!searchSetting) await getSearchSetting()
  let requiredSave = false
  if (setting.source && searchSetting.source != setting.source) requiredSave = true
  if (setting.type && searchSetting.type != setting.type) requiredSave = true
  if (setting.temp_source && searchSetting.temp_source != setting.temp_source) requiredSave = true

  if (!requiredSave) return
  searchSetting = Object.assign(searchSetting, setting)
  saveSearchSettingThrottle()
}

export const getSongListSetting = async() => {
  // eslint-disable-next-line require-atomic-updates
  songListSetting ??= await getSongListSettingFromData()
  songListSetting.source = normalizeSource(songListSetting.source)
  return { ...songListSetting }
}
export const setSongListSetting = async(setting: Partial<typeof DEFAULT_SETTING['songList']>) => {
  if (!songListSetting) await getSongListSetting()
  songListSetting = Object.assign(songListSetting, setting)
  saveSongListSettingThrottle()
}

export const getLeaderboardSetting = async() => {
  // eslint-disable-next-line require-atomic-updates
  leaderboardSetting ??= await getLeaderboardSettingFromData()
  const source = normalizeSource(leaderboardSetting.source)
  // 音源被替换时，老的榜单 id 属于已删除的音源，需要一起回落
  if (source != leaderboardSetting.source) leaderboardSetting.boardId = DEFAULT_SETTING.leaderboard.boardId
  leaderboardSetting.source = source
  return { ...leaderboardSetting }
}
export const setLeaderboardSetting = async(setting: Partial<typeof DEFAULT_SETTING['leaderboard']>) => {
  if (!leaderboardSetting) await getLeaderboardSetting()
  leaderboardSetting = Object.assign(leaderboardSetting, setting)
  saveLeaderboardSettingThrottle()
}

export const saveViewPrevState = (state: typeof DEFAULT_SETTING['viewPrevState']) => {
  saveViewPrevStateThrottle(state)
}
