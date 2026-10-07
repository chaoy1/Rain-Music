import { arrPush, arrUnshift } from '@common/utils/common'
import {
  queryDownloadList,
  insertDownloadList,
  updateDownloadList,
  deleteDownloadList,
  clearDownloadList,
} from './dbHelper'

let list: Rain.Download.ListItem[]

const toDBDownloadInfo = (musicInfos: Rain.Download.ListItem[], offset: number = 0): Rain.DBService.DownloadMusicInfo[] => {
  return musicInfos.map((info, index) => {
    return {
      id: info.id,
      isComplate: info.isComplate ? 1 : 0,
      status: info.status,
      statusText: info.statusText,
      progress_downloaded: info.downloaded,
      progress_total: info.total,
      url: info.metadata.url,
      quality: info.metadata.quality,
      ext: info.metadata.ext,
      fileName: info.metadata.fileName,
      filePath: info.metadata.filePath,
      musicInfo: JSON.stringify(info.metadata.musicInfo),
      position: offset + index,
    }
  })
}

const initDownloadList = async() => {
  list = (await queryDownloadList()).map(item => {
    const musicInfo = JSON.parse(item.musicInfo) as Rain.Music.MusicInfoOnline
    return {
      id: item.id,
      isComplate: item.isComplate == 1,
      status: item.status,
      statusText: item.statusText,
      downloaded: item.progress_downloaded,
      total: item.progress_total,
      progress: item.progress_total ? Math.round(item.progress_downloaded / item.progress_total * 100) : 0,
      speed: '',
      writeQueue: 0,
      metadata: {
        musicInfo,
        url: item.url,
        quality: item.quality,
        ext: item.ext,
        fileName: item.fileName,
        filePath: item.filePath,
      },
    }
  })
}

/**
 * 获取下载列表
 * @returns 下载列表
 */
export const getDownloadList = async(): Promise<Rain.Download.ListItem[]> => {
  if (!list) await initDownloadList()
  return list
}

/**
 * 添加下载歌曲信息
 * @param downloadInfos url信息
 */
export const downloadInfoSave = async(downloadInfos: Rain.Download.ListItem[], addMusicLocationType: Rain.AddMusicLocationType) => {
  if (!list) await initDownloadList()
  if (addMusicLocationType == 'top') {
    let newList = [...list]
    arrUnshift(newList, downloadInfos)
    await insertDownloadList(toDBDownloadInfo(downloadInfos), list.map((info, index) => {
      return { id: info.id, position: downloadInfos.length + index }
    }))
    list = newList // eslint-disable-line require-atomic-updates -- dbService 入口已串行化（../../index.ts），不存在并发读改写
  } else {
    await insertDownloadList(toDBDownloadInfo(downloadInfos, list.length), [])
    arrPush(list, downloadInfos)
  }
}

/**
 * 批量更新列表信息
 * @param lists 列表信息
 */
export const downloadInfoUpdate = async(lists: Rain.Download.ListItem[]) => {
  await updateDownloadList(toDBDownloadInfo(lists))
  if (list) {
    for (const item of lists) {
      const index = list.findIndex(info => info.id === item.id)
      if (index < 0) continue
      list.splice(index, 1, item)
    }
  }
}


/**
 * 删除下载列表
 * @param ids 歌曲id
 */
export const downloadInfoRemove = async(ids: string[]) => {
  await deleteDownloadList(ids)
  if (list) {
    const idSet = new Set<string>(ids)
    list = list.filter(task => !idSet.has(task.id))
  }
}

/**
 * 清空下载列表
 */
export const downloadInfoClear = async() => {
  await clearDownloadList()
  list = []
}
