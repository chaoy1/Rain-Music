import { toRaw } from '@common/utils/vueTools'
import { openSaveDir, showSelectDialog } from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import { filterFileName, toNewMusicInfo, fixNewMusicInfoQuality, filterMusicList } from '@renderer/utils'
import { getListMusics, updateUserList, addListMusics, overwriteListMusics, createUserList } from '@renderer/store/list/action'
import { defaultList, userLists } from '@renderer/store/list/state'
import useImportTip from '@renderer/utils/compositions/useImportTip'
import { dialog } from '@renderer/plugins/Dialog'
import { LEGACY_LOVE_LIST_ID } from '@common/constants'


export default () => {
  const t = useI18n()
  const showImportTip = useImportTip()

  const handleExportList = (listInfo: Rain.List.MyListInfo) => {
    if (!listInfo) return
    void openSaveDir({
      title: t('lists__export_part_desc'),
      defaultPath: `rain_list_part_${filterFileName(listInfo.name)}.rainmc`,
    }).then(async result => {
      if (result.canceled || !result.filePath) return
      void window.rain.worker.main.saveRainConfigFile(result.filePath, {
        type: 'playListPart_v2',
        data: { ...toRaw(listInfo), list: toRaw(await getListMusics(listInfo.id)) },
      })
    })
  }
  const handleImportList = (listInfo: Rain.List.MyListInfo, index: number) => {
    void showSelectDialog({
      title: t('lists__import_part_desc'),
      properties: ['openFile'],
      filters: [
        { name: 'Play List Part', extensions: ['json', 'rainmc'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }).then(async result => {
      if (result.canceled) return
      const filePath = result.filePaths[0]
      if (!filePath) return
      let configData: any
      try {
        configData = await window.rain.worker.main.readRainConfigFile(filePath)
      } catch (error) {
        return
      }
      let listData: Rain.ConfigFile.MyListInfoPart['data']
      switch (configData.type) {
        case 'playListPart':
          listData = configData.data
          listData.list = filterMusicList(listData.list.map(m => toNewMusicInfo(m)))
          break
        case 'playListPart_v2':
          listData = configData.data
          listData.list = filterMusicList(listData.list).map(m => fixNewMusicInfoQuality(m))
          break
        default:
          showImportTip(configData.type)
          return
      }

      // 内置「我的收藏」列表已删除：旧列表文件里的收藏条目直接忽略，不还原成自建歌单
      if (listData.id === LEGACY_LOVE_LIST_ID) return

      const targetList = [defaultList, ...userLists].find(l => l.id == listData.id)
      if (targetList) {
        const confirm = await dialog.confirm({
          message: t('lists__import_part_confirm', { importName: listData.name, localName: targetList.name }),
          cancelButtonText: t('lists__import_part_button_cancel'),
          confirmButtonText: t('lists__import_part_button_confirm'),
        })
        if (confirm) {
          listData.name = targetList.name
          switch (listData.id) {
            case defaultList.id:
              break
            default:
              void updateUserList([
                {
                  name: listData.name,
                  id: listData.id,
                  source: (listData as Rain.List.UserListInfo).source,
                  sourceListId: (listData as Rain.List.UserListInfo).sourceListId,
                  locationUpdateTime: (targetList as Rain.List.UserListInfo).locationUpdateTime,
                },
              ])
              break
          }
          void overwriteListMusics({
            listId: listData.id,
            musicInfos: listData.list.map(m => fixNewMusicInfoQuality(m)),
          })
          return
        }
        listData.id += `__${Date.now()}`
      }
      void createUserList({
        position: index,
        name: listData.name,
        id: listData.id,
        source: (listData as Rain.List.UserListInfo).source,
        sourceListId: (listData as Rain.List.UserListInfo).sourceListId,
      })
      void addListMusics(listData.id, listData.list.map(m => fixNewMusicInfoQuality(m)))
    })
  }

  return {
    handleExportList,
    handleImportList,
  }
}
