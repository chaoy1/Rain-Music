import { getDB } from '../../db'
import {
  createQueryStatement,
  createInsertStatement,
  createDeleteStatement,
  createUpdateStatement,
  createUpdatePositionStatement,
  createClearStatement,
} from './statements'

/**
 * 查询下载歌曲列表
 */
export const queryDownloadList = async() => {
  const queryStatement = createQueryStatement()
  return await queryStatement.all() as Rain.DBService.DownloadMusicInfo[]
}

/**
 * 批量插入下载歌曲并刷新顺序
 * @param mInfos 列表
 */
export const insertDownloadList = async(mInfos: Rain.DBService.DownloadMusicInfo[], listPositions: Array<{ id: string, position: number }>) => {
  const db = getDB()
  const insertStatement = createInsertStatement()
  const updatePositionStatement = createUpdatePositionStatement()
  await db.transaction(async(mInfos: Rain.DBService.DownloadMusicInfo[]) => {
    for (const info of mInfos) await insertStatement.run(info)
    for (const info of listPositions) await updatePositionStatement.run(info)
  })(mInfos)
}

/**
 * 批量删除下载歌曲
 * @param ids 列表
 */
export const deleteDownloadList = async(ids: string[]) => {
  const db = getDB()
  const deleteStatement = createDeleteStatement()
  await db.transaction(async(ids: string[]) => {
    for (const id of ids) await deleteStatement.run(id)
  })(ids)
}

/**
 * 批量更新下载歌曲
 * @param urlInfo 列表
 */
export const updateDownloadList = async(urlInfo: Rain.DBService.DownloadMusicInfo[]) => {
  const db = getDB()
  const updateStatement = createUpdateStatement()
  await db.transaction(async(urlInfo: Rain.DBService.DownloadMusicInfo[]) => {
    for (const info of urlInfo) await updateStatement.run(info)
  })(urlInfo)
}

/**
 * 清空下载歌曲列表
 */
export const clearDownloadList = async() => {
  const clearStatement = createClearStatement()
  await clearStatement.run()
}
