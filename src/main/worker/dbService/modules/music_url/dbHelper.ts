import { getDB } from '../../db'
import {
  createQueryStatement,
  createInsertStatement,
  createDeleteStatement,
  // createUpdateStatement,
  createClearStatement,
  createCountStatement,
} from './statements'

/**
 * 查询歌曲url
 * @param id 歌曲id
 * @returns url
 */
export const queryMusicUrl = async(id: string) => {
  const queryStatement = createQueryStatement()
  return ((await queryStatement.get(id)) as { url: string } | null)?.url ?? null
}

/**
 * 批量插入歌曲url
 * @param urlInfo 列表
 */
export const insertMusicUrl = async(urlInfo: Rain.DBService.MusicUrlInfo[]) => {
  const db = getDB()
  const insertStatement = createInsertStatement()
  const deleteStatement = createDeleteStatement()
  await db.transaction(async(urlInfo: Rain.DBService.MusicUrlInfo[]) => {
    for (const info of urlInfo) {
      await deleteStatement.run(info.id)
      await insertStatement.run(info)
    }
  })(urlInfo)
}

/**
 * 批量删除歌曲url
 * @param ids 列表
 */
export const deleteMusicUrl = async(ids: string[]) => {
  const db = getDB()
  const deleteStatement = createDeleteStatement()
  await db.transaction(async(ids: string[]) => {
    for (const id of ids) await deleteStatement.run(id)
  })(ids)
}

/**
 * 批量更新歌曲url
 * @param urlInfo 列表
 */
// export const updateMusicUrl = async(urlInfo: Rain.DBService.MusicUrlInfo[]) => {
//   const db = getDB()
//   const updateStatement = createUpdateStatement()
//   await db.transaction(async(urlInfo: Rain.DBService.MusicUrlInfo[]) => {
//     for (const info of urlInfo) await updateStatement.run(info)
//   })(urlInfo)
// }

/**
 * 清空歌曲url
 */
export const clearMusicUrl = async() => {
  const clearStatement = createClearStatement()
  await clearStatement.run()
}

/**
 * 统计歌曲信息数量
 */
export const countMusicUrl = async() => {
  const countStatement = createCountStatement()
  return ((await countStatement.get()) as { count: number }).count
}
