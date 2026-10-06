import { tempListMeta, userLists } from '@renderer/store/list/state'
import { getListDetail, getListDetailAll } from '@renderer/store/songList/action'
import { createUserList, removeUserList, setTempList } from '@renderer/store/list/action'
import { playList } from '@renderer/core/player/action'
import { LIST_IDS } from '@common/constants'
import { toMD5 } from '@renderer/utils'

const getListId = (id: string, source: Rain.OnlineSource) => `${source}__${id}`

const pendingCollections = new Map<string, Promise<void>>()

export const getSavedSongList = (id: string, source: Rain.OnlineSource) => {
  const localId = `${source}_${toMD5(getListId(id, source))}`
  return userLists.find(l => l.id === localId || (l.source === source && l.sourceListId === id))
}

const collectSongList = async(id: string, source: Rain.OnlineSource, name?: string) => {
  const listId = getListId(id, source)
  const localId = `${source}_${toMD5(listId)}`
  // sourceListId stores the provider's raw ID; the local ID is also stable
  // across imports and recognizes older lists with incomplete metadata.
  const findSavedList = () => getSavedSongList(id, source)
  const targetList = findSavedList()
  if (targetList) return

  const list = await getListDetailAll(id, source)
  // Another import can finish while the online request is in flight.
  const savedWhileFetching = findSavedList()
  if (savedWhileFetching) return
  await createUserList({
    name,
    id: localId,
    list,
    source,
    sourceListId: id,
  })
}

export const addSongListDetail = async(id: string, source: Rain.OnlineSource, name?: string) => {
  const key = getListId(id, source)
  const pending = pendingCollections.get(key)
  if (pending) return pending
  const operation = collectSongList(id, source, name).finally(() => { pendingCollections.delete(key) })
  pendingCollections.set(key, operation)
  return operation
}

export const toggleSongListCollection = async(id: string, source: Rain.OnlineSource, name?: string) => {
  const key = getListId(id, source)
  const pending = pendingCollections.get(key)
  if (pending) return pending
  const saved = getSavedSongList(id, source)
  const operation = (saved ? removeUserList([saved.id]) : collectSongList(id, source, name))
    .finally(() => { pendingCollections.delete(key) })
  pendingCollections.set(key, operation)
  return operation
}

export const playSongListDetail = async(id: string, source: Rain.OnlineSource, list?: Rain.Music.MusicInfoOnline[], index: number = 0) => {
  let isPlayingList = false
  // console.log(list)
  const listId = getListId(id, source)
  if (!list?.length) list = (await getListDetail(id, source, 1)).list
  if (list?.length) {
    await setTempList(listId, [...list])
    playList(LIST_IDS.TEMP, index)
    isPlayingList = true
  }
  const fullList = await getListDetailAll(id, source)
  if (!fullList.length) return
  if (isPlayingList) {
    if (tempListMeta.id == listId) {
      await setTempList(listId, [...fullList])
    }
  } else {
    await setTempList(listId, [...fullList])
    playList(LIST_IDS.TEMP, index)
  }
}
