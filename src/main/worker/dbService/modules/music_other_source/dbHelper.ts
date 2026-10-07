import { getDB } from '../../db'
import {
  createMusicInfoQueryStatement,
  createMusicInfoInsertStatement,
  createMusicInfoDeleteStatement,
  createMusicInfoClearStatement,
  createCountStatement,
} from './statements'


/**
 * 查询歌曲信息
 * @param id 歌曲id
 * @returns 歌曲信息
 */
export const queryMusicInfo = async(id: string) => {
  const musicInfoQueryStatement = createMusicInfoQueryStatement()
  return await musicInfoQueryStatement.all(id) as Rain.DBService.MusicInfoOtherSource[]
}

/**
 * 批量插入歌曲信息
 * @param musicInfos 列表
 */
export const insertMusicInfo = async(musicInfos: Rain.DBService.MusicInfoOtherSource[]) => {
  const db = getDB()
  const musicInfoInsertStatement = createMusicInfoInsertStatement()
  await db.transaction(async(musicInfos: Rain.DBService.MusicInfoOtherSource[]) => {
    for (const info of musicInfos) await musicInfoInsertStatement.run(info)
  })(musicInfos)
}

/**
 * 批量删除歌曲信息
 * @param ids 列表
 */
export const deleteMusicInfo = async(ids: string[]) => {
  const db = getDB()
  const musicInfoDeleteStatement = createMusicInfoDeleteStatement()
  await db.transaction(async(ids: string[]) => {
    for (const id of ids) await musicInfoDeleteStatement.run(id)
  })(ids)
}

/**
 * 清空歌曲信息
 */
export const clearMusicInfo = async() => {
  const musicInfoClearStatement = createMusicInfoClearStatement()
  await musicInfoClearStatement.run()
}

/**
 * 统计歌曲信息数量
 */
export const countMusicInfo = async() => {
  const countStatement = createCountStatement()
  return ((await countStatement.get()) as { count: number }).count
}
