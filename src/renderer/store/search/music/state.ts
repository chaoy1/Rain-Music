import { reactive, markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

// import { deduplicationList } from '@common/utils/renderer'

export declare interface ListInfo {
  list: Rain.Music.MusicInfo[]
  total: number
  page: number
  maxPage: number
  limit: number
  key: string | null
  noItemLabel: string
}

interface ListInfos extends Partial<Record<Rain.OnlineSource, ListInfo>> {
  'all': ListInfo
}

export const sources: Array<Rain.OnlineSource | 'all'> = markRaw([])

export const listInfos: ListInfos = markRaw({
  all: reactive<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
  }),
})
export const maxPages: Partial<Record<Rain.OnlineSource, number>> = {}
for (const source of music.sources) {
  if (!music[source.id as Rain.OnlineSource]?.musicSearch) continue
  sources.push(source.id as Rain.OnlineSource)
  listInfos[source.id as Rain.OnlineSource] = reactive<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: '',
    noItemLabel: '',
  })
  maxPages[source.id as Rain.OnlineSource] = 0
}
sources.push('all')
