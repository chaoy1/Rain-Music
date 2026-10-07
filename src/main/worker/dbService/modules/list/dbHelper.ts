import { getDB } from '../../db'
import {
  createListQueryStatement,
  createListInsertStatement,
  createListDeleteStatement,
  createListClearStatement,
  createListUpdateStatement,
  createMusicInfoQueryStatement,
  createMusicInfoInsertStatement,
  createMusicInfoUpdateStatement,
  createMusicInfoDeleteStatement,
  createMusicInfoDeleteByListIdStatement,
  createMusicInfoOrderInsertStatement,
  createMusicInfoOrderDeleteStatement,
  createMusicInfoOrderDeleteByListIdStatement,
  createMusicInfoClearStatement,
  createMusicInfoOrderClearStatement,
  createMusicInfoByListAndMusicInfoIdQueryStatement,
  createMusicInfoByMusicInfoIdQueryStatement,
  createMusicInfoOrderStatement,
} from './statements'

const idFixRxp = /\.0$/
const QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'
type QueueRestoreRecord = Pick<Rain.Music.MusicInfo, 'id' | 'name' | 'singer'>

export const getPlaybackQueueRestoreSnapshot = async(): Promise<QueueRestoreRecord[] | null> => {
  const row = await getDB().prepare('SELECT field_value FROM db_info WHERE field_name = ?').get(QUEUE_RESTORE_SNAPSHOT_KEY) as { field_value: string } | undefined
  if (!row) return null
  const records = JSON.parse(row.field_value) as QueueRestoreRecord[]
  if (!Array.isArray(records) || records.some(record => typeof record.id != 'string' || typeof record.name != 'string' || typeof record.singer != 'string')) throw new Error('Invalid playback queue restoration metadata')
  return records
}

export const clearPlaybackQueueRestoreSnapshot = async() => {
  await getDB().prepare('DELETE FROM db_info WHERE field_name = ?').run(QUEUE_RESTORE_SNAPSHOT_KEY)
}
/**
 * 获取用户列表
 * @returns
 */
export const queryAllUserList = async() => {
  const list = await createListQueryStatement().all() as Rain.DBService.UserListInfo[]
  for (const info of list) {
    // 兼容v2.3.0之前版本插入数字类型的ID导致其意外在末尾追加 .0 的问题
    if (info.sourceListId?.endsWith?.('.0')) {
      info.sourceListId = info.sourceListId.replace(idFixRxp, '')
    }
  }
  return list
}

/**
 * 批量插入用户列表
 * @param lists 列表
 * @param isClear 是否清空列表
 */
export const insertUserLists = async(lists: Rain.DBService.UserListInfo[], isClear: boolean = false) => {
  const db = getDB()
  const listClearStatement = createListClearStatement()
  const listInsertStatement = createListInsertStatement()
  await db.transaction(async(lists: Rain.DBService.UserListInfo[]) => {
    if (isClear) await listClearStatement.run()
    for (const list of lists) {
      await listInsertStatement.run({
        id: list.id,
        name: list.name,
        source: list.source,
        sourceListId: list.sourceListId,
        locationUpdateTime: list.locationUpdateTime,
        position: list.position,
      })
    }
  })(lists)
}

/**
 * 批量删除用户列表及列表内歌曲
 * @param listIds 列表id
 */
export const deleteUserLists = async(listIds: string[]) => {
  const db = getDB()
  const listDeleteStatement = createListDeleteStatement()
  const musicInfoDeleteByListIdStatement = createMusicInfoDeleteByListIdStatement()
  const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()
  await db.transaction(async(listIds: string[]) => {
    for (const id of listIds) {
      await listDeleteStatement.run(id)
      await musicInfoDeleteByListIdStatement.run(id)
      await musicInfoOrderDeleteByListIdStatement.run(id)
    }
  })(listIds)
}

/**
 * 批量更新用户列表
 * @param lists 列表
 */
export const updateUserLists = async(lists: Rain.DBService.UserListInfo[]) => {
  const db = getDB()
  const listUpdateStatement = createListUpdateStatement()
  await db.transaction(async(lists: Rain.DBService.UserListInfo[]) => {
    for (const list of lists) await listUpdateStatement.run(list)
  })(lists)
}


/**
 * 批量添加歌曲
 * @param list
 */
export const insertMusicInfoList = async(list: Rain.DBService.MusicInfo[]) => {
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  const db = getDB()
  await db.transaction(async(musics: Rain.DBService.MusicInfo[]) => {
    for (const music of musics) {
      await musicInfoInsertStatement.run(music)
      await musicInfoOrderInsertStatement.run({
        listId: music.listId,
        musicInfoId: music.id,
        order: music.order,
      })
    }
  })(list)
}

/**
 * 批量添加歌曲并刷新排序
 * @param list 新增歌曲
 * @param listId 列表Id
 * @param listAll 原始列表歌曲，列表去重后
 */
export const insertMusicInfoListAndRefreshOrder = async(list: Rain.DBService.MusicInfo[], listId: string, listAll: Rain.DBService.MusicInfo[]) => {
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()

  const db = getDB()
  await db.transaction(async(list: Rain.DBService.MusicInfo[], listId: string, listAll: Rain.DBService.MusicInfo[]) => {
    await musicInfoOrderDeleteByListIdStatement.run(listId)
    for (const music of list) {
      await musicInfoInsertStatement.run(music)
      await musicInfoOrderInsertStatement.run({
        listId: music.listId,
        musicInfoId: music.id,
        order: music.order,
      })
    }
    for (const music of listAll) {
      await musicInfoOrderInsertStatement.run({
        listId: music.listId,
        musicInfoId: music.id,
        order: music.order,
      })
    }
  })(list, listId, listAll)
}

/**
 * 批量更新歌曲
 * @param list
 */
export const updateMusicInfos = async(list: Rain.DBService.MusicInfo[]) => {
  const musicInfoUpdateStatement = createMusicInfoUpdateStatement()
  const db = getDB()
  await db.transaction(async(musics: Rain.DBService.MusicInfo[]) => {
    for (const music of musics) {
      await musicInfoUpdateStatement.run(music)
    }
  })(list)
}

/**
 * 获取列表内的歌曲
 * @param listId 列表Id
 * @returns 列表歌曲
 */
export const queryMusicInfoByListId = async(listId: string) => {
  const musicInfoQueryStatement = createMusicInfoQueryStatement()
  return await musicInfoQueryStatement.all({ listId }) as Rain.DBService.MusicInfo[]
}

/**
 * 批量移动歌曲
 * @param fromId 源列表Id
 * @param ids 要移动的歌曲
 * @param musicInfos 音乐信息
 */
export const moveMusicInfo = async(fromId: string, ids: string[], musicInfos: Rain.DBService.MusicInfo[]) => {
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  const musicInfoDeleteStatement = createMusicInfoDeleteStatement()
  const musicInfoOrderDeleteStatement = createMusicInfoOrderDeleteStatement()
  // const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()

  const db = getDB()
  await db.transaction(async(fromId: string, ids: string[], musicInfos: Rain.DBService.MusicInfo[]) => {
    // musicInfoOrderDeleteByListIdStatement.run(fromId)
    for (const id of ids) {
      await musicInfoDeleteStatement.run({ listId: fromId, id })
      await musicInfoOrderDeleteStatement.run({ listId: fromId, id })
    }
    for (const music of musicInfos) {
      await musicInfoInsertStatement.run(music)
      await musicInfoOrderInsertStatement.run({
        listId: music.listId,
        musicInfoId: music.id,
        order: music.order,
      })
    }
  })(fromId, ids, musicInfos)
}

/**
 * 批量移动歌曲并刷新排序
 * @param fromId 源列表Id
 * @param ids 要移动的歌曲id，原始选择的歌曲
 * @param musicInfos 要移动的歌曲，目标列表去重后
 * @param toListAll 目标列表歌曲
 */
export const moveMusicInfoAndRefreshOrder = async(fromId: string, ids: string[], toId: string, musicInfos: Rain.DBService.MusicInfo[], toListAll: Rain.DBService.MusicInfo[]) => {
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  const musicInfoDeleteStatement = createMusicInfoDeleteStatement()
  const musicInfoOrderDeleteStatement = createMusicInfoOrderDeleteStatement()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()

  const db = getDB()
  await db.transaction(async(fromId: string, ids: string[], musicInfos: Rain.DBService.MusicInfo[], toListAll: Rain.DBService.MusicInfo[]) => {
    for (const id of ids) {
      await musicInfoDeleteStatement.run({ listId: fromId, id })
      await musicInfoOrderDeleteStatement.run({ listId: fromId, id })
    }
    await musicInfoOrderDeleteByListIdStatement.run(toId)
    for (const music of musicInfos) {
      await musicInfoInsertStatement.run(music)
      await musicInfoOrderInsertStatement.run({
        listId: music.listId,
        musicInfoId: music.id,
        order: music.order,
      })
    }
    for (const music of toListAll) {
      await musicInfoOrderInsertStatement.run({
        listId: music.listId,
        musicInfoId: music.id,
        order: music.order,
      })
    }
  })(fromId, ids, musicInfos, toListAll)
}

/**
 * 批量移除列表内音乐
 * @param listId 列表id
 * @param ids 音乐id
 */
export const removeMusicInfos = async(listId: string, ids: string[]) => {
  const musicInfoDeleteStatement = createMusicInfoDeleteStatement()
  const musicInfoOrderDeleteStatement = createMusicInfoOrderDeleteStatement()
  const db = getDB()
  await db.transaction(async(listId: string, ids: string[]) => {
    for (const id of ids) {
      await musicInfoDeleteStatement.run({ listId, id })
      await musicInfoOrderDeleteStatement.run({ listId, id })
    }
  })(listId, ids)
}

/**
 * 清空列表内歌曲
 * @param listId 列表id
 */
export const removeMusicInfoByListId = async(ids: string[]) => {
  const db = getDB()
  const musicInfoDeleteByListIdStatement = createMusicInfoDeleteByListIdStatement()
  const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()
  await db.transaction(async(ids: string[]) => {
    for (const id of ids) {
      await musicInfoDeleteByListIdStatement.run(id)
      await musicInfoOrderDeleteByListIdStatement.run(id)
    }
  })(ids)
}

/**
 * 创建根据列表Id与音乐id查询音乐信息
 * @param listId 列表id
 * @param musicInfoId 音乐id
 * @returns
 */
export const queryMusicInfoByListIdAndMusicInfoId = async(listId: string, musicInfoId: string) => {
  const musicInfoByListAndMusicInfoIdQueryStatement = createMusicInfoByListAndMusicInfoIdQueryStatement()
  return await musicInfoByListAndMusicInfoIdQueryStatement.get({ listId, musicInfoId }) as Rain.DBService.MusicInfo | null
}

/**
 * 创建根据音乐id查询所有列表的音乐信息
 * @param id 音乐id
 * @returns
 */
export const queryMusicInfoByMusicInfoId = async(id: string) => {
  const musicInfoByMusicInfoIdQueryStatement = createMusicInfoByMusicInfoIdQueryStatement()
  return await musicInfoByMusicInfoIdQueryStatement.all(id) as Rain.DBService.MusicInfo[]
}

/**
 * 批量更新歌曲位置
 * @param listId 列表id
 * @param musicInfoOrders 音乐顺序
 */
export const updateMusicInfoOrder = async(listId: string, musicInfoOrders: Rain.DBService.MusicInfoOrder[]) => {
  const db = getDB()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()
  await db.transaction(async(listId: string, musicInfoOrders: Rain.DBService.MusicInfoOrder[]) => {
    await musicInfoOrderDeleteByListIdStatement.run(listId)
    for (const orderInfo of musicInfoOrders) await musicInfoOrderInsertStatement.run(orderInfo)
  })(listId, musicInfoOrders)
}

/**
 * 覆盖列表内的歌曲
 * @param listId 列表id
 * @param musicInfos 歌曲列表
 */
export const overwriteMusicInfo = async(listId: string, musicInfos: Rain.DBService.MusicInfo[], startupRestoreSnapshot?: QueueRestoreRecord[]) => {
  const db = getDB()
  const musicInfoDeleteByListIdStatement = createMusicInfoDeleteByListIdStatement()
  const musicInfoOrderDeleteByListIdStatement = createMusicInfoOrderDeleteByListIdStatement()
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  await db.transaction(async(listId: string, musicInfos: Rain.DBService.MusicInfo[]) => {
    // Commit the old index identities atomically with the first merge. A crash
    // after this transaction can then restore the correct song in a new worker.
    if (startupRestoreSnapshot && !await getPlaybackQueueRestoreSnapshot()) {
      await db.prepare('INSERT INTO db_info (field_name, field_value) VALUES (?, ?)').run(QUEUE_RESTORE_SNAPSHOT_KEY, JSON.stringify(startupRestoreSnapshot))
    }
    await musicInfoDeleteByListIdStatement.run(listId)
    await musicInfoOrderDeleteByListIdStatement.run(listId)
    for (const musicInfo of musicInfos) {
      await musicInfoInsertStatement.run(musicInfo)
      await musicInfoOrderInsertStatement.run({
        listId: musicInfo.listId,
        musicInfoId: musicInfo.id,
        order: musicInfo.order,
      })
    }
  })(listId, musicInfos)
}

/**
 * 覆盖整个列表
 * @param lists 列表
 * @param musicInfos 歌曲列表
 */
export const overwriteListData = async(lists: Rain.DBService.UserListInfo[], musicInfos: Rain.DBService.MusicInfo[]) => {
  const db = getDB()
  const listClearStatement = createListClearStatement()
  const listInsertStatement = createListInsertStatement()
  const musicInfoClearStatement = createMusicInfoClearStatement()
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  const musicInfoOrderClearStatement = createMusicInfoOrderClearStatement()
  const musicInfoOrderInsertStatement = createMusicInfoOrderInsertStatement()
  await db.transaction(async(lists: Rain.DBService.UserListInfo[], musicInfos: Rain.DBService.MusicInfo[]) => {
    await listClearStatement.run()
    for (const list of lists) {
      await listInsertStatement.run({
        id: list.id,
        name: list.name,
        source: list.source,
        sourceListId: list.sourceListId,
        locationUpdateTime: list.locationUpdateTime,
        position: list.position,
      })
    }
    await musicInfoClearStatement.run()
    await musicInfoOrderClearStatement.run()
    for (const musicInfo of musicInfos) {
      await musicInfoInsertStatement.run(musicInfo)
      await musicInfoOrderInsertStatement.run({
        listId: musicInfo.listId,
        musicInfoId: musicInfo.id,
        order: musicInfo.order,
      })
    }
  })(lists, musicInfos)
}


/**
 * 获取列表内音乐的排序
 * @param listId 列表id
 * @param musicInfoId 音乐id
 * @returns 音乐排序信息
 */
export const getMusicInfoOrder = async(listId: string, musicInfoId: string) => {
  const musicInfoOrderStatement = createMusicInfoOrderStatement()
  return await musicInfoOrderStatement.get({ listId, musicInfoId })
}
