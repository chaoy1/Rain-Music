<template lang="pug">
dt#backup {{ $t('setting__backup') }}
dd
  h3#backup_all {{ $t('setting__backup_all') }}
  div
    base-btn.btn.gap-left(min @click="handleImportAllData") {{ $t('setting__backup_all_import') }}
    base-btn.btn.gap-left(min @click="handleExportAllData") {{ $t('setting__backup_all_export') }}
  details.settings-more(data-settings-more="backup")
    summary {{ $t('setting__more_backup') }}
    h3#backup_part {{ $t('setting__backup_part') }}
    div
      base-btn.btn.gap-left(min @click="handleImportPlayList") {{ $t('setting__backup_part_import_list') }}
      base-btn.btn.gap-left(min @click="handleExportPlayList") {{ $t('setting__backup_part_export_list') }}
      base-btn.btn.gap-left(min @click="handleImportSetting") {{ $t('setting__backup_part_import_setting') }}
      base-btn.btn.gap-left(min @click="handleExportSetting") {{ $t('setting__backup_part_export_setting') }}
</template>

<script>
import { toRaw } from '@common/utils/vueTools'
// import { mergeSetting } from '@common/utils'
// import { base as eventBaseName } from '@renderer/event/names'
// import { defaultList, userLists } from '@renderer/core/share/list'
import {
  toNewMusicInfo,
  // toOldMusicInfo,
  filterMusicList,
  fixNewMusicInfoQuality,
} from '@renderer/utils'
import {
  showSelectDialog,
  openSaveDir,
  getHotKeyConfig,
  hotKeyApplyConfig,
} from '@renderer/utils/ipc'
// import { currentStting } from '../setting'
import { dialog } from '@renderer/plugins/Dialog'
import useImportTip from '@renderer/utils/compositions/useImportTip'
import { useI18n } from '@renderer/plugins/i18n'
import { getListMusics, overwriteListFull, overwriteListMusics } from '@renderer/store/list/action'
import { LEGACY_LOVE_LIST_ID, LIST_IDS } from '@common/constants'
import { defaultList, userLists } from '@renderer/store/list/state'
import { appSetting, updateSetting } from '@renderer/store/setting'
import migrateSetting from '@common/utils/migrateSetting'


export default {
  name: 'SettingBackup',
  setup() {
    const t = useI18n()
    // const setting = useRefGetter('setting')
    // const settingVersion = useRefGetter('settingVersion')
    // const setSettingVersion = useCommit('setSettingVersion')
    // const setList = useCommit('list', 'setList')
    const showImportTip = useImportTip()
    const showBackupError = error => {
      void dialog({ message: `${t('setting__backup')}: ${error.message}` })
    }

    /**
     * 导出用列表数据：只包含用户自行创建的歌单
     * 「试听列表」是播放试听用的集合，不属于用户歌单，不参与导出
     * （内置「我的收藏」列表已删除，同样不再导出）
     */
    const getAllLists = async() => {
      const lists = []

      for await (const list of userLists) {
        lists.push(await getListMusics(list.id).then(musics => ({ ...toRaw(list), list: toRaw(musics) })))
      }

      return lists
    }

    /**
     * 导入用基准数据：当前全部列表（含试听列表）及其歌曲
     * 备份里没有的列表保持原样，与原有「按 id 覆盖、其余保留」的导入语义一致
     */
    const getCurrentListData = async() => {
      const userList = []
      for (const list of userLists) {
        userList.push({
          ...toRaw(list),
          list: toRaw(await getListMusics(list.id)),
        })
      }
      return {
        defaultList: toRaw(await getListMusics(defaultList.id)),
        userList,
      }
    }

    /**
     * 按列表 id 导入列表数据（不再按位置取）
     * - id 为 LIST_IDS.DEFAULT（试听列表）：新版备份已不再包含它，但旧备份里的这一项仍导入到试听列表，避免旧备份丢失数据
     * - id 为已删除的「我的收藏」（LEGACY_LOVE_LIST_ID）：直接忽略，不还原也不改写成自建歌单
     * - 其余（含没有 id 的旧备份条目）一律视为自建歌单：id 已存在则覆盖其歌曲，不存在则新建列表；
     *   条目缺少 id 时生成一个自建歌单 id，保证不会因为缺少 id 而丢弃数据
     * @param lists 备份文件中的列表数据
     * @param convertMusicList 音乐信息转换函数（新旧备份格式不同）
     */
    const importListData = async(lists, convertMusicList) => {
      const listData = await getCurrentListData()
      for (const [index, list] of lists.entries()) {
        try {
          // 内置「我的收藏」已删除：旧备份里的收藏条目直接忽略
          if (list.id === LEGACY_LOVE_LIST_ID) continue
          const listMusics = convertMusicList(list.list)
          switch (list.id) {
            case LIST_IDS.DEFAULT:
              listData.defaultList = listMusics
              break
            default: {
              const id = list.id || `userlist_${Date.now()}_${index}`
              const targetList = listData.userList.find(l => l.id == id)
              if (targetList) {
                targetList.list = listMusics
              } else {
                listData.userList.push({
                  name: list.name,
                  id,
                  list: listMusics,
                  source: list.source,
                  sourceListId: list.sourceListId,
                  locationUpdateTime: list.locationUpdateTime ?? null,
                })
              }
            }
          }
        } catch (err) {
          console.log(err)
        }
      }
      await overwriteListFull(listData)
    }
    const importOldListData = async(lists) => {
      await importListData(lists, list => filterMusicList(list.map(m => toNewMusicInfo(m))))
    }
    const importNewListData = async(lists) => {
      await importListData(lists, list => filterMusicList(list).map(m => fixNewMusicInfoQuality(m)))
    }

    /**
     * 导入快捷键配置，并由主进程重新注册全局快捷键
     * 注册失败的快捷键（通常是被系统或其它程序占用）会弹窗提示用户
     * @param hotKeyConfig 快捷键配置，旧备份没有该字段，允许缺省
     */
    const importHotKeyData = async(hotKeyConfig) => {
      if (!hotKeyConfig?.local || !hotKeyConfig?.global) return
      let failList = []
      try {
        failList = await hotKeyApplyConfig(hotKeyConfig) ?? []
      } catch (error) {
        showBackupError(error)
        return
      }
      if (!failList.length) return
      const listText = failList
        .map(({ name, action, key }) => `${t(`setting__hot_key_${name || action}`)}: ${key}`)
        .join('\n')
      void dialog({
        message: t('setting__backup_hot_key_register_failed', { list: listText }),
        confirmButtonText: t('ok'),
      })
    }

    /**
     * @param setting 设置数据
     * @param hotKeyConfig 快捷键配置，旧备份没有该字段，允许缺省
     */
    const importOldSettingData = async(setting, hotKeyConfig) => {
      console.log(setting)
      setting = migrateSetting(setting)
      setting['common.isAgreePact'] = false
      updateSetting(setting)
      await importHotKeyData(hotKeyConfig)
    }
    const importNewSettingData = async(setting, hotKeyConfig) => {
      setting = migrateSetting(setting)
      setting['common.isAgreePact'] = false
      updateSetting(setting)
      await importHotKeyData(hotKeyConfig)
    }


    const importAllData = async(path) => {
      let allData
      try {
        allData = await window.rain.worker.main.readRainConfigFile(path)
      } catch (error) {
        showBackupError(error)
        return
      }

      switch (allData.type) {
        case 'allData':
          // 兼容0.6.2及以前版本的列表数据
          if (allData.defaultList) await overwriteListMusics({ listId: LIST_IDS.DEFAULT, musicInfos: filterMusicList(allData.defaultList.list.map(m => toNewMusicInfo(m))) })
          else await importOldListData(allData.playList)
          await importOldSettingData(allData.setting, allData.hotKey)
          break
        case 'allData_v2':
          await importNewListData(allData.playList)
          await importNewSettingData(allData.setting, allData.hotKey)
          break
        default: { showImportTip(allData.type) }
      }
    }
    const handleImportAllData = () => {
      void showSelectDialog({
        title: t('setting__backup_all_import_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Setting', extensions: ['json', 'rainmc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(result => {
        if (result.canceled) return
        void dialog.confirm({
          message: t('setting__backup_part_import_list_confirm'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        }).then(confirm => {
          if (!confirm) return
          void importAllData(result.filePaths[0])
        })
      })
    }

    const exportAllData = async(path) => {
      let allData = {
        type: 'allData_v2',
        setting: { ...appSetting },
        // 新增：快捷键配置（旧备份没有该字段，导入时按缺省处理）
        hotKey: await getHotKeyConfig(),
        playList: await getAllLists(),
      }
      await window.rain.worker.main.saveRainConfigFile(path, allData)
    }
    const handleExportAllData = () => {
      void openSaveDir({
        title: t('setting__backup_all_export_desc'),
        defaultPath: 'rain_datas_v2.rainmc',
      }).then(async result => {
        if (result.canceled) return
        return exportAllData(result.filePath)
      }).catch(showBackupError)
    }

    const exportSetting = async(path) => {
      const data = {
        type: 'setting_v2',
        data: { ...appSetting },
        // 新增：快捷键配置（旧备份没有该字段，导入时按缺省处理）
        hotKey: await getHotKeyConfig(),
      }
      await window.rain.worker.main.saveRainConfigFile(path, data)
    }
    const handleExportSetting = () => {
      void openSaveDir({
        title: t('setting__backup_part_export_setting_desc'),
        defaultPath: 'rain_setting_v2.rainmc',
      }).then(async result => {
        if (result.canceled) return
        return exportSetting(result.filePath)
      }).catch(showBackupError)
    }

    const importSetting = async(path) => {
      let settingData
      try {
        settingData = await window.rain.worker.main.readRainConfigFile(path)
      } catch (error) {
        showBackupError(error)
        return
      }

      switch (settingData.type) {
        case 'setting':
          await importOldSettingData(settingData.data, settingData.hotKey)
          break
        case 'setting_v2':
          await importNewSettingData(settingData.data, settingData.hotKey)
          break
        default: { showImportTip(settingData.type) }
      }
    }
    const handleImportSetting = () => {
      void showSelectDialog({
        title: t('setting__backup_part_import_setting_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Setting', extensions: ['json', 'rainmc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(result => {
        if (result.canceled) return
        void importSetting(result.filePaths[0])
      })
    }

    const exportPlayList = async(path) => {
      const data = {
        type: 'playList_v2',
        data: await getAllLists(),
      }
      await window.rain.worker.main.saveRainConfigFile(path, data)
    }
    const handleExportPlayList = () => {
      void openSaveDir({
        title: t('setting__backup_part_export_list_desc'),
        defaultPath: 'rain_list.rainmc',
      }).then(async result => {
        if (result.canceled) return
        return exportPlayList(result.filePath)
      }).catch(showBackupError)
    }

    const importPlayList = async(path) => {
      let listData
      try {
        listData = await window.rain.worker.main.readRainConfigFile(path)
      } catch (error) {
        showBackupError(error)
        return
      }
      console.log(listData.type)

      switch (listData.type) {
        case 'defautlList': // 兼容0.6.2及以前版本的列表数据
          await overwriteListMusics({ listId: LIST_IDS.DEFAULT, musicInfos: filterMusicList(listData.data.list.map(m => toNewMusicInfo(m))) })
          break
        case 'playList':
          await importOldListData(listData.data)
          break
        case 'playList_v2':
          await importNewListData(listData.data)
          break
        default: { showImportTip(listData.type) }
      }
    }
    const handleImportPlayList = () => {
      void showSelectDialog({
        title: t('setting__backup_part_import_list_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Play List', extensions: ['json', 'rainmc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(result => {
        if (result.canceled) return
        void dialog.confirm({
          message: t('setting__backup_part_import_list_confirm'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        }).then(confirm => {
          if (!confirm) return
          void importPlayList(result.filePaths[0])
        })
      })
    }

    // window.eventHub.on(eventBaseName.set_config, handleUpdateSetting)

    // onBeforeUnmount(() => {
    //   window.eventHub.off(eventBaseName.set_config, handleUpdateSetting)
    // })

    return {
      // currentStting,
      handleExportPlayList,
      handleImportPlayList,
      handleExportSetting,
      handleImportSetting,
      handleExportAllData,
      handleImportAllData,
    }
  },
}
</script>

<style lang="less" module>
.savePath {
  font-size: 12px;
}
</style>
