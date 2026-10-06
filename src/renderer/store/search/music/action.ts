import { markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'

import { maxPages, listInfos } from './state'

interface SearchResult {
  list: Rain.Music.MusicInfo[]
  allPage: number
  limit: number
  total: number
  source: Rain.OnlineSource
}


const setList = (datas: SearchResult, page: number, text: string): Rain.Music.MusicInfo[] => {
  // console.log(datas.source, datas.list)
  let listInfo = listInfos[datas.source]!
  listInfo.list = deduplicationList(datas.list.map(s => markRaw(toNewMusicInfo(s))))
  if (page == 1 || (datas.total && datas.list.length)) listInfo.total = datas.total
  else listInfo.total = datas.limit * page
  listInfo.maxPage = datas.allPage
  listInfo.page = page
  listInfo.limit = datas.limit
  if (text && !datas.list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  return listInfo.list
}

export const resetListInfo = (sourceId: Rain.OnlineSource): [] => {
  let listInfo = listInfos[sourceId]
  if (!listInfo) return []
  listInfo.list = []
  listInfo.page = 0
  listInfo.maxPage = 0
  listInfo.total = 0
  listInfo.noItemLabel = ''
  return []
}

/**
 * 搜索在线歌曲。「聚合搜索」已移除，始终只搜索传入的单个音源。
 */
export const search = async(text: string, page: number, sourceId: Rain.OnlineSource): Promise<Rain.Music.MusicInfo[]> => {
  const listInfo = listInfos[sourceId]
  if (!text) return resetListInfo(sourceId)
  if (!listInfo) return []
  const key = `${page}__${text}`
  if (listInfo.key == key && listInfo.list.length) return listInfo.list
  listInfo.noItemLabel = window.i18n.t('list__loading')
  listInfo.key = key
  return music[sourceId].musicSearch.search(text, page, listInfo.limit).then((data: SearchResult) => {
    if (key != listInfo.key) return []
    maxPages[sourceId] = data.allPage
    return setList(data, page, text)
  }).catch((error: any) => {
    resetListInfo(sourceId)
    listInfo.noItemLabel = window.i18n.t('list__load_failed')
    console.log(error)
    throw error
  })
}
