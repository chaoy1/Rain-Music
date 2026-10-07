import {
  queryMusicUrl,
  insertMusicUrl,
  deleteMusicUrl,
  clearMusicUrl,
  countMusicUrl,
} from './dbHelper'


/**
 * 获取歌曲url
 * @param id 歌曲id
 * @returns 歌曲url
 */
export const getMusicUrl = async(id: string): Promise<string | null> => {
  const url = await queryMusicUrl(id)
  return url
}

/**
 * 保存歌曲url
 * @param urlInfos url信息
 */
export const musicUrlSave = async(urlInfos: Rain.Music.MusicUrlInfo[]) => {
  await insertMusicUrl(urlInfos)
}

/**
 * 删除歌曲url
 * @param ids 歌曲id
 */
export const musicUrlRemove = async(ids: string[]) => {
  await deleteMusicUrl(ids)
}

/**
 * 清空歌曲url
 */
export const musicUrlClear = async() => {
  await clearMusicUrl()
}

/**
 * 统计歌曲url数量
 */
export const musicUrlCount = async() => {
  return await countMusicUrl()
}
