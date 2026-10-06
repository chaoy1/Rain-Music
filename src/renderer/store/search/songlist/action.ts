import { markRawList } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

import type { ListInfoItem } from './state'
import { listInfos, maxPages } from './state'

interface SearchResult {
  list: ListInfoItem[]
  limit: number
  total: number
  source: Rain.OnlineSource
}


const setList = (datas: SearchResult, page: number, text: string): ListInfoItem[] => {
  // console.log(datas.source, datas.list)
  let listInfo = listInfos[datas.source]!
  listInfo.list = markRawList(datas.list)
  if (page == 1 || (datas.total && datas.list.length)) listInfo.total = datas.total
  else listInfo.total = datas.limit * page
  listInfo.page = page
  listInfo.limit = datas.limit
  if (text && !datas.list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  return listInfo.list
}

export const resetListInfo = (sourceId: Rain.OnlineSource): [] => {
  let listInfo = listInfos[sourceId]
  if (!listInfo) return []
  listInfo.page = 1
  listInfo.limit = 20
  listInfo.total = 0
  listInfo.list = []
  listInfo.key = null
  listInfo.noItemLabel = ''
  listInfo.tagId = ''
  listInfo.sortId = ''
  return []
}

/**
 * 搜索在线歌单。「聚合搜索」已移除，始终只搜索传入的单个音源。
 */
export const search = async(text: string, page: number, sourceId: Rain.OnlineSource): Promise<ListInfoItem[]> => {
  const listInfo = listInfos[sourceId]
  if (!text) return resetListInfo(sourceId)
  if (!listInfo) return []
  const key = `${page}__${sourceId}__${text}`
  if (listInfo.key == key && listInfo.list.length) return listInfo.list
  listInfo.noItemLabel = window.i18n.t('list__loading')
  listInfo.key = key
  return music[sourceId].songList.search(text, page, listInfo.limit).then((data: SearchResult) => {
    if (key != listInfo.key) return []
    maxPages[sourceId] = Math.ceil(data.total / data.limit)
    return setList(data, page, text)
  }).catch((error: any) => {
    resetListInfo(sourceId)
    listInfo.noItemLabel = window.i18n.t('list__load_failed')
    console.log(error)
    throw error
  })
}
