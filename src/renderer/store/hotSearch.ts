import { reactive, markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'

// 「聚合搜索」已移除：热搜词只按当前音源获取，不再跨音源聚合。
export type Source = Rain.OnlineSource

export const sources: Source[] = markRaw([])

export const sourceList: Partial<Record<Rain.OnlineSource, string[]>> = markRaw<Partial<Record<Rain.OnlineSource, string[]>>>({})

for (const source of music.sources) {
  if (!music[source.id as Rain.OnlineSource]?.hotSearch) continue
  sources.push(source.id as Rain.OnlineSource)
  sourceList[source.id as Rain.OnlineSource] = reactive<string[]>([])
}


const setList = (source: Rain.OnlineSource, list: string[]): string[] => {
  return sourceList[source] = list.slice(0, 20)
}

export const getList = async(source: Source): Promise<string[]> => {
  if (sourceList[source]?.length) return Promise.resolve(sourceList[source])
  if (!music[source]?.hotSearch) {
    setList(source, [])
    return Promise.resolve([])
  }
  return music[source].hotSearch.getList().then(data => setList(source, data.list))
}


export const clearList = (source: Source) => {
  sourceList[source] = []
}
