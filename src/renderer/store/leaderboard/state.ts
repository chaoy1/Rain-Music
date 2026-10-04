import { reactive, markRaw, shallowReactive } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

export type Source = Rain.OnlineSource

export const sources: Rain.OnlineSource[] = markRaw([])

for (const source of music.sources) {
  if (!music[source.id as Rain.OnlineSource]?.leaderboard?.getBoards) continue
  sources.push(source.id as Rain.OnlineSource)
}

export interface BoardItem {
  id: string
  name: string
  bangid: string
}
export interface Board {
  list: BoardItem[]
  source: Rain.OnlineSource
}
type Boards = Partial<Record<Rain.OnlineSource, Board>>

export const boards = shallowReactive<Boards>({})

export interface ListDetailInfo {
  list: Rain.Music.MusicInfoOnline[]
  total: number
  page: number
  source: Rain.OnlineSource | null
  limit: number
  key: string | null
  id: string
  noItemLabel: string
}

export const listDetailInfo = reactive<ListDetailInfo>({
  list: [],
  total: 0,
  page: 1,
  limit: 30,
  key: null,
  source: null,
  id: '',
  noItemLabel: '',
})

