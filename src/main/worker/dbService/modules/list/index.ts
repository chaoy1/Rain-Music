import { LIST_IDS } from '@common/constants'
import { arrPush, arrPushByPosition, arrUnshift } from '@common/utils/common'
import { dedupePlaybackQueue, filterPlaybackQueueAdditions, findPlaybackQueueMusicIndex } from '@common/utils/playbackQueue'
import {
  deleteUserLists,
  insertUserLists,
  insertMusicInfoList,
  insertMusicInfoListAndRefreshOrder,
  moveMusicInfo,
  moveMusicInfoAndRefreshOrder,
  overwriteListData,
  overwriteMusicInfo,
  queryAllUserList,
  queryMusicInfoByListId,
  queryMusicInfoByListIdAndMusicInfoId,
  queryMusicInfoByMusicInfoId,
  removeMusicInfoByListId,
  removeMusicInfos,
  updateMusicInfoOrder,
  updateMusicInfos,
  updateUserLists as updateUserListsFromDB,
  getMusicInfoOrder,
  getPlaybackQueueRestoreSnapshot,
  clearPlaybackQueueRestoreSnapshot,
} from './dbHelper'

let userLists: Rain.DBService.UserListInfo[]
let musicLists = new Map<string, Rain.Music.MusicInfo[]>()
let rawPoss = new Map<string, number>()
// The snapshot itself is durable SQLite metadata, consumed only after the main
// process has atomically saved the corrected playback identity to disk.
let queueStartupRestorePending = true

// 这里的模块级缓存（userLists / musicLists / rawPoss）与下面的 `await` 之间是
// "读内存缓存 → 写 SQLite → 改内存缓存"的复合操作：改造前它们因为 SQL 是同步的而天然独占，
// 异步化之后靠 `dbService` 入口的串行化（`../../index.ts` 的 `serializeCalls`）保持同样的独占性。
// 因此下面几处"await 之后写回缓存"的赋值是安全的 —— 这也是 `require-atomic-updates` 的例外来源。

const toDBMusicInfo = (musicInfos: Rain.Music.MusicInfo[], listId: string, offset: number = 0): Rain.DBService.MusicInfo[] => {
  return musicInfos.map((info, index) => {
    return {
      ...info,
      listId,
      meta: JSON.stringify(info.meta),
      order: offset + index,
    }
  })
}

/**
 * 获取所有用户列表
 * @returns
 */
export const getAllUserList = async(): Promise<Rain.List.UserListInfo[]> => {
  userLists ??= await queryAllUserList() // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写

  rawPoss.clear()
  return userLists.map(list => {
    const { position, ...newList } = list
    rawPoss.set(list.id, position)
    return newList
  })
}

/**
 * 批量创建列表
 * @param position 列表位置
 * @param lists 列表信息
 */
export const createUserLists = async(position: number, lists: Rain.List.UserListInfo[]) => {
  userLists ??= await queryAllUserList() // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写
  if (position < 0 || position >= userLists.length) {
    // 如果是最末尾，那么取最后一个列表的原始位置 + 1 作为新列表的原始位置，否则新列表的原始位置为 position
    // 因为原始 pos 可能比 userLists.length 大，所以不能直接用 userLists.length 作为新列表的原始位置
    const order = userLists.length ? (rawPoss.get(userLists.at(-1)!.id) ?? userLists.length) + 1 : 0
    const newLists: Rain.DBService.UserListInfo[] = lists.map((list, index) => {
      const pos = order + index
      rawPoss.set(list.id, pos)
      return {
        ...list,
        position: pos,
      }
    })
    await insertUserLists(newLists)
    userLists = [...userLists, ...newLists]
  } else {
    const newUserLists = [...userLists]
    // @ts-expect-error
    newUserLists.splice(position, 0, ...lists)
    newUserLists.forEach((list, index) => {
      list.position = index
    })
    await insertUserLists(newUserLists, true)
    userLists = newUserLists // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写
    rawPoss.clear()
    for (const list of userLists) rawPoss.set(list.id, list.position)
  }
}

/**
 * 覆盖列表
 * @param lists 列表信息
 */
// const setUserLists = (lists: Rain.List.UserListInfo[]) => {
//   const newUserLists: Rain.DBService.UserListInfo[] = lists.map((list, index) => {
//     return {
//       ...list,
//       position: index,
//     }
//   })
//   insertUserLists(newUserLists, true)
//   userLists = newUserLists
// }

/**
 * 批量删除列表
 * @param ids 列表ids
 */
export const removeUserLists = async(ids: string[]) => {
  await deleteUserLists(ids)
  userLists &&= await queryAllUserList() // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写
  for (const id of ids) rawPoss.delete(id)
}

/**
 * 批量更新列表信息
 * @param lists 列表信息
 */
export const updateUserLists = async(lists: Rain.List.UserListInfo[]) => {
  const positionMap = new Map<string, number>()
  for (const list of userLists) {
    positionMap.set(list.id, list.position)
  }
  const dbList: Rain.DBService.UserListInfo[] = lists.map(list => {
    const position = positionMap.get(list.id)
    if (position == null) return null
    return {
      ...list,
      position,
    }
  }).filter(Boolean) as Rain.DBService.UserListInfo[]
  await updateUserListsFromDB(dbList)
  userLists &&= await queryAllUserList() // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写
}

/**
 * 批量更新列表位置
 * @param position 列表位置
 * @param ids 列表ids
 */
export const updateUserListsPosition = async(position: number, ids: string[]) => {
  userLists ??= await queryAllUserList() // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写

  const newUserLists = [...userLists]

  const updateLists: Rain.DBService.UserListInfo[] = []

  for (let i = newUserLists.length - 1; i >= 0; i--) {
    if (ids.includes(newUserLists[i].id)) {
      const list = newUserLists.splice(i, 1)[0]
      list.locationUpdateTime = Date.now()
      updateLists.push(list)
    }
  }
  position = Math.min(newUserLists.length, position)

  newUserLists.splice(position, 0, ...updateLists)
  newUserLists.forEach((list, index) => {
    list.position = index
  })
  await insertUserLists(newUserLists, true)
  userLists = newUserLists // eslint-disable-line require-atomic-updates -- 入口已串行化，不存在并发读改写
  rawPoss.clear()
  for (const list of userLists) rawPoss.set(list.id, list.position)
}

/**
 * 根据列表ID获取列表内歌曲
 * @param listId 列表ID
 * @returns 列表内歌曲
 */
export const getListMusics = async(listId: string): Promise<Rain.Music.MusicInfo[]> => {
  let targetList: Rain.Music.MusicInfo[] | undefined = musicLists.get(listId)
  if (targetList == null) {
    targetList = (await queryMusicInfoByListId(listId)).map(info => {
      return {
        id: info.id,
        name: info.name,
        singer: info.singer,
        source: info.source,
        interval: info.interval,
        meta: JSON.parse(info.meta),
      }
    })
    if (listId == LIST_IDS.DEFAULT) {
      const merged = dedupePlaybackQueue(targetList)
      if (merged.length != targetList.length) {
        const restoreSnapshot = queueStartupRestorePending ? targetList.map(({ id, name, singer }) => ({ id, name, singer })) : undefined
        await overwriteMusicInfo(listId, toDBMusicInfo(merged, listId), restoreSnapshot)
      }
      targetList = merged
    }
    musicLists.set(listId, targetList)
  }

  return targetList
}

export const resolvePlaybackQueueRestoreIndex = async(index: number, musicId?: string, musicName?: string, musicSinger?: string): Promise<number> => {
  if (index < 0 && !musicId) return -1
  const original = (await getPlaybackQueueRestoreSnapshot()) ?? (await queryMusicInfoByListId(LIST_IDS.DEFAULT))
  const originalSong = musicId ? original.find(item => item.id == musicId) : original[index]
  if (!originalSong && !musicId) return -1
  const target = originalSong ?? { id: musicId!, name: musicName ?? '', singer: musicSinger ?? '' }
  return findPlaybackQueueMusicIndex(await getListMusics(LIST_IDS.DEFAULT), target)
}

export const completePlaybackQueueRestore = async() => {
  await clearPlaybackQueueRestoreSnapshot()
  queueStartupRestorePending = false
}

/**
 * 覆盖列表内的歌曲
 * @param listId 列表id
 * @param musicInfos 歌曲列表
 */
export const musicOverwrite = async(listId: string, musicInfos: Rain.Music.MusicInfo[]) => {
  if (listId == LIST_IDS.DEFAULT) musicInfos = dedupePlaybackQueue(musicInfos)
  let targetList = await getListMusics(listId)
  await overwriteMusicInfo(listId, toDBMusicInfo(musicInfos, listId))
  if (targetList) {
    targetList.splice(0, targetList.length)
    arrPush(targetList, musicInfos)
  }
}

/**
 * 批量添加歌曲
 * @param listId 列表id
 * @param musicInfos 添加的歌曲信息
 * @param addMusicLocationType 添加在到列表的位置
 */
export const musicsAdd = async(listId: string, musicInfos: Rain.Music.MusicInfo[], addMusicLocationType: Rain.AddMusicLocationType) => {
  let targetList = await getListMusics(listId)

  const set = new Set<string>()
  for (const item of targetList) set.add(item.id)
  musicInfos = listId == LIST_IDS.DEFAULT ? filterPlaybackQueueAdditions(targetList, musicInfos) : musicInfos.filter(item => {
    if (set.has(item.id)) return false
    set.add(item.id)
    return true
  })

  switch (addMusicLocationType) {
    case 'top':
      await insertMusicInfoListAndRefreshOrder(toDBMusicInfo(musicInfos, listId), listId, toDBMusicInfo(targetList, listId, musicInfos.length))
      arrUnshift(targetList, musicInfos)
      break
    case 'bottom':
    default: {
      // 如果是添加到最后，那么取最后一个歌曲的原始位置 + 1 作为新歌曲的原始位置，否则新歌曲的原始位置为 position
      // 因为原始 pos 可能比 targetList.length 大，所以不能直接用 targetList.length 作为新歌曲的原始位置
      const order = targetList.length ? ((await getMusicInfoOrder(listId, targetList.at(-1)!.id))?.order ?? targetList.length) + 1 : 0
      await insertMusicInfoList(toDBMusicInfo(musicInfos, listId, order))
      arrPush(targetList, musicInfos)
      break
    }
  }
}

/**
 * 批量删除歌曲
 * @param listId 列表Id
 * @param ids 要删除歌曲的id
 */
export const musicsRemove = async(listId: string, ids: string[]) => {
  let targetList = await getListMusics(listId)
  if (!targetList.length) return
  await removeMusicInfos(listId, ids)
  const idsSet = new Set<string>(ids)
  musicLists.set(listId, targetList.filter(mInfo => !idsSet.has(mInfo.id)))
}

/**
 * 批量移动歌曲
 * @param fromId 源列表id
 * @param toId 目标列表id
 * @param musicInfos 添加的歌曲信息
 * @param addMusicLocationType 添加在到列表的位置
 */
export const musicsMove = async(fromId: string, toId: string, musicInfos: Rain.Music.MusicInfo[], addMusicLocationType: Rain.AddMusicLocationType) => {
  let fromList = await getListMusics(fromId)
  let toList = await getListMusics(toId)

  const ids = musicInfos.map(musicInfo => musicInfo.id)

  let listSet = new Set<string>()
  for (const item of toList) listSet.add(item.id)
  musicInfos = toId == LIST_IDS.DEFAULT ? filterPlaybackQueueAdditions(toList, musicInfos) : musicInfos.filter(item => {
    if (listSet.has(item.id)) return false
    listSet.add(item.id)
    return true
  })

  switch (addMusicLocationType) {
    case 'top':
      await moveMusicInfoAndRefreshOrder(fromId, ids, toId, toDBMusicInfo(musicInfos, toId), toDBMusicInfo(toList, toId, musicInfos.length))
      arrUnshift(toList, musicInfos)
      break
    case 'bottom':
    default:{
      // 如果是添加到最后，那么取最后一个歌曲的原始位置 + 1 作为新歌曲的原始位置，否则新歌曲的原始位置为 position
      // 因为原始 pos 可能比 targetList.length 大，所以不能直接用 targetList.length 作为新歌曲的原始位置
      const order = toList.length ? ((await getMusicInfoOrder(toId, toList.at(-1)!.id))?.order ?? toList.length) + 1 : 0
      await moveMusicInfo(fromId, ids, toDBMusicInfo(musicInfos, toId, order))
      arrPush(toList, musicInfos)
      break
    }
  }

  const movedIds = new Set<string>(ids)
  musicLists.set(fromId, fromList.filter(mInfo => !movedIds.has(mInfo.id)))
}

/**
 * 批量更新歌曲信息
 * @param musicInfos 歌曲&列表信息
 */
export const musicsUpdate = async(musicInfos: Rain.List.ListActionMusicUpdate) => {
  await updateMusicInfos(musicInfos.map(({ id, musicInfo }) => {
    return {
      ...musicInfo,
      listId: id,
      meta: JSON.stringify(musicInfo.meta),
      order: 0,
    }
  }))
  for (const { id, musicInfo } of musicInfos) {
    const targetList = musicLists.get(id)
    if (targetList == null) continue
    const targetMusic = targetList.find(item => item.id == musicInfo.id)
    if (!targetMusic) continue
    targetMusic.name = musicInfo.name
    targetMusic.singer = musicInfo.singer
    targetMusic.source = musicInfo.source
    targetMusic.interval = musicInfo.interval
    targetMusic.meta = musicInfo.meta
  }
}

/**
 * 清空列表内的歌曲
 * @param listId 列表Id
 */
export const musicsClear = async(ids: string[]) => {
  await removeMusicInfoByListId(ids)
  for (const id of ids) {
    const targetList = musicLists.get(id)
    if (!targetList) continue
    targetList.splice(0, targetList.length)
  }
}

/**
 * 批量更新歌曲位置
 * @param listId 列表id
 * @param position 新位置
 * @param ids 要更新位置的歌曲id
 */
export const musicsPositionUpdate = async(listId: string, position: number, ids: string[]) => {
  let targetList = await getListMusics(listId)
  if (!targetList.length) return

  let newTargetList = [...targetList]

  const infos: Rain.Music.MusicInfo[] = []
  const map = new Map<string, Rain.Music.MusicInfo>()
  for (const item of newTargetList) map.set(item.id, item)
  for (const id of ids) {
    infos.push(map.get(id)!)
    map.delete(id)
  }
  newTargetList = newTargetList.filter(mInfo => map.has(mInfo.id))
  arrPushByPosition(newTargetList, infos, Math.min(position, newTargetList.length))

  await updateMusicInfoOrder(listId, newTargetList.map((info, index) => {
    return {
      listId,
      musicInfoId: info.id,
      order: index,
    }
  }))
  musicLists.set(listId, newTargetList)
}

/**
 * 覆盖所有列表数据
 * @param myListData 完整列表数据
 */
export const listDataOverwrite = async(myListData: MakeOptional<Rain.List.ListDataFull, 'tempList'>) => {
  const dbLists: Rain.DBService.UserListInfo[] = []
  const listData: Rain.List.ListDataFull = {
    ...myListData,
    defaultList: dedupePlaybackQueue(myListData.defaultList),
    tempList: myListData.tempList ?? (await getListMusics(LIST_IDS.TEMP)),
  }

  const dbMusicInfos: Rain.DBService.MusicInfo[] = [
    ...toDBMusicInfo(listData.defaultList, LIST_IDS.DEFAULT),
    ...toDBMusicInfo(listData.tempList, LIST_IDS.TEMP),
  ]
  listData.userList.forEach(({ list, ...listInfo }, index) => {
    dbLists.push({ ...listInfo, position: index })
    arrPush(dbMusicInfos, toDBMusicInfo(list, listInfo.id))
  })
  await overwriteListData(dbLists, dbMusicInfos)

  if (userLists) userLists.splice(0, userLists.length, ...dbLists)
  else userLists = dbLists

  rawPoss.clear()
  for (const list of userLists) rawPoss.set(list.id, list.position)
  musicLists.clear()
  musicLists.set(LIST_IDS.DEFAULT, listData.defaultList)
  musicLists.set(LIST_IDS.TEMP, listData.tempList)
  for (const list of listData.userList) musicLists.set(list.id, list.list)
}

/**
 * 检查音乐是否存在列表中
 * @param listId 列表id
 * @param musicInfoId 音乐id
 * @returns
 */
export const checkListExistMusic = async(listId: string, musicInfoId: string): Promise<boolean> => {
  const musicInfo = await queryMusicInfoByListIdAndMusicInfoId(listId, musicInfoId)
  return musicInfo != null
}

/**
 * 获取所有存在该音乐的列表id
 * @param musicInfoId 音乐id
 * @returns
 */
export const getMusicExistListIds = async(musicInfoId: string): Promise<string[]> => {
  const musicInfos = await queryMusicInfoByMusicInfoId(musicInfoId)
  return musicInfos.map(m => m.listId)
}
