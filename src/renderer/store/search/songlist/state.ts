import { reactive, markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

// import { deduplicationList } from '@common/utils/renderer'

import { type ListInfo } from '@renderer/store/songList/state'

export type { ListInfoItem } from '@renderer/store/songList/state'

// 音源顺序由 musicSdk.sources 决定：QQ音乐(tx) → 酷狗音乐(kg) → 网易云音乐(wy)
export const sources: Rain.OnlineSource[] = markRaw([])

export type SearchListInfo = Omit<ListInfo, 'source'>


type ListInfos = Partial<Record<Rain.OnlineSource, SearchListInfo>>


export const listInfos: ListInfos = markRaw<ListInfos>({})
export const maxPages: Partial<Record<Rain.OnlineSource, number>> = {}
for (const source of music.sources) {
  if (!music[source.id as Rain.OnlineSource]?.songList?.search) continue
  sources.push(source.id as Rain.OnlineSource)
  listInfos[source.id as Rain.OnlineSource] = reactive<SearchListInfo>({
    page: 1,
    limit: 18,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
    tagId: '',
    sortId: '',
  })
  maxPages[source.id as Rain.OnlineSource] = 0
}
