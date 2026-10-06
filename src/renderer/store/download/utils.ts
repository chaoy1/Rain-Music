import { appSetting } from '@renderer/store/setting'
import { defaultList, userLists } from '@renderer/store/list/listManage'
import { filterFileName } from '@common/utils/common'
import { clipFileNameLength } from '@common/utils/tools'
import { joinPath } from '@common/utils/nodejs'
import { SAVE_PATH_GROUP_BY_LIST_NAME } from '@common/constants'

export const buildSavePath = (musicInfo: Rain.Download.ListItem) => {
  let savePath = appSetting['download.savePath']
  // 按列表名分组保存已固定为「启用」（download.isSavePathGroupByListName -> true）
  if (SAVE_PATH_GROUP_BY_LIST_NAME) {
    let dirName: string | undefined
    const listId = musicInfo.metadata.listId
    switch (listId) {
      case defaultList.id:
        dirName = window.i18n.t(defaultList.name)
        break
      default:
        dirName = userLists.find(list => list.id === listId)?.name
        break
    }
    if (dirName) dirName = filterFileName(dirName)
    savePath = joinPath(savePath, clipFileNameLength(dirName ?? window.i18n.t(defaultList.name)))
  }
  return savePath
}
