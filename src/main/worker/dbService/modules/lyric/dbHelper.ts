import { getDB } from '../../db'
import {
  createLyricQueryStatement,
  createRawLyricQueryStatement,
  createRawLyricInsertStatement,
  createRawLyricDeleteStatement,
  createRawLyricUpdateStatement,
  createRawLyricClearStatement,
  createEditedLyricQueryStatement,
  createEditedLyricInsertStatement,
  createEditedLyricDeleteStatement,
  createEditedLyricUpdateStatement,
  createEditedLyricClearStatement,
  createEditedLyricCountStatement,
  createRawLyricCountStatement,
} from './statements'

/**
 * 查询原始歌词
 * @param id 歌曲id
 * @returns 歌词信息
 */
export const queryLyric = async(id: string) => {
  const lyricQueryStatement = createLyricQueryStatement()
  return await lyricQueryStatement.all(id) as Rain.DBService.Lyricnfo[]
}

/**
 * 查询原始歌词
 * @param id 歌曲id
 * @returns 歌词信息
 */
export const queryRawLyric = async(id: string) => {
  const rawLyricQueryStatement = createRawLyricQueryStatement()
  return await rawLyricQueryStatement.all(id) as Rain.DBService.Lyricnfo[]
}

/**
 * 批量插入原始歌词
 * @param lyrics 列表
 */
export const insertRawLyric = async(lyrics: Rain.DBService.Lyricnfo[]) => {
  const db = getDB()
  const rawLyricInsertStatement = createRawLyricInsertStatement()
  await db.transaction(async(lyrics: Rain.DBService.Lyricnfo[]) => {
    for (const lyric of lyrics) await rawLyricInsertStatement.run(lyric)
  })(lyrics)
}

/**
 * 批量删除原始歌词
 * @param ids 列表
 */
export const deleteRawLyric = async(ids: string[]) => {
  const db = getDB()
  const rawLyricDeleteStatement = createRawLyricDeleteStatement()
  await db.transaction(async(ids: string[]) => {
    for (const id of ids) await rawLyricDeleteStatement.run(id)
  })(ids)
}

/**
 * 批量更新原始歌词
 * @param lyrics 列表
 */
export const updateRawLyric = async(lyrics: Rain.DBService.Lyricnfo[]) => {
  const db = getDB()
  const rawLyricUpdateStatement = createRawLyricUpdateStatement()
  await db.transaction(async(lyrics: Rain.DBService.Lyricnfo[]) => {
    for (const lyric of lyrics) await rawLyricUpdateStatement.run(lyric)
  })(lyrics)
}

/**
 * 清空原始歌词
 */
export const clearRawLyric = async() => {
  const rawLyricClearStatement = createRawLyricClearStatement()
  await rawLyricClearStatement.run()
}

/**
 * 统计已编辑歌词数量
 */
export const countRawLyric = async() => {
  const countStatement = createRawLyricCountStatement()
  return ((await countStatement.get()) as { count: number }).count
}


/**
 * 查询已编辑歌词
 * @param id 歌曲id
 * @returns 歌词信息
 */
export const queryEditedLyric = async(id: string) => {
  const rawLyricQueryStatement = createEditedLyricQueryStatement()
  return await rawLyricQueryStatement.all(id) as Rain.DBService.Lyricnfo[]
}

/**
 * 批量插入已编辑歌词
 * @param lyrics 列表
 */
export const insertEditedLyric = async(lyrics: Rain.DBService.Lyricnfo[]) => {
  const db = getDB()
  const rawLyricInsertStatement = createEditedLyricInsertStatement()
  await db.transaction(async(lyrics: Rain.DBService.Lyricnfo[]) => {
    for (const lyric of lyrics) await rawLyricInsertStatement.run(lyric)
  })(lyrics)
}

/**
 * 批量删除已编辑歌词
 * @param ids 列表
 */
export const deleteEditedLyric = async(ids: string[]) => {
  const db = getDB()
  const rawLyricDeleteStatement = createEditedLyricDeleteStatement()
  await db.transaction(async(ids: string[]) => {
    for (const id of ids) await rawLyricDeleteStatement.run(id)
  })(ids)
}

/**
 * 批量更新已编辑歌词
 * @param lyrics 列表
 */
export const updateEditedLyric = async(lyrics: Rain.DBService.Lyricnfo[]) => {
  const db = getDB()
  const rawLyricUpdateStatement = createEditedLyricUpdateStatement()
  await db.transaction(async(lyrics: Rain.DBService.Lyricnfo[]) => {
    for (const lyric of lyrics) await rawLyricUpdateStatement.run(lyric)
  })(lyrics)
}

/**
 * 清空已编辑歌词
 */
export const clearEditedLyric = async() => {
  const rawLyricClearStatement = createEditedLyricClearStatement()
  await rawLyricClearStatement.run()
}


/**
 * 统计已编辑歌词数量
 */
export const countEditedLyric = async() => {
  const countStatement = createEditedLyricCountStatement()
  return ((await countStatement.get()) as { count: number }).count
}
