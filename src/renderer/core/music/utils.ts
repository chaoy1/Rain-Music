import { qualityList } from '@renderer/store'
import { assertApiSupport } from '@renderer/store/utils'
import musicSdk from '@renderer/utils/musicSdk'
import {
  // getOtherSource as getOtherSourceFromStore,
  // saveOtherSource as saveOtherSourceFromStore,
  getMusicUrl as getStoreMusicUrl,
  removeMusicUrl as removeStoreMusicUrl,
  getPlayerLyric as getStoreLyric,
} from '@renderer/utils/ipc'
import { appSetting } from '@renderer/store/setting'
import { toNewMusicInfo, toOldMusicInfo } from '@renderer/utils'
import { requestMsg } from '@renderer/utils/message'
import { apis } from '@renderer/utils/musicSdk/api-source'


const getOtherSourcePromises = new Map()
const otherSourceCache = new Map<Rain.Music.MusicInfo | Rain.Download.ListItem, Rain.Music.MusicInfoOnline[]>()
export const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/

export const getOtherSource = async(musicInfo: Rain.Music.MusicInfo | Rain.Download.ListItem, isRefresh = false): Promise<Rain.Music.MusicInfoOnline[]> => {
  // if (!isRefresh && musicInfo.id) {
  //   const cachedInfo = await getOtherSourceFromStore(musicInfo.id)
  //   if (cachedInfo.length) return cachedInfo
  // }
  if (otherSourceCache.has(musicInfo)) return otherSourceCache.get(musicInfo)!
  let key: string
  let searchMusicInfo: {
    name: string
    singer: string
    source: string
    albumName: string
    interval: string
  }
  if ('progress' in musicInfo) {
    key = `local_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.metadata.musicInfo.name,
      singer: musicInfo.metadata.musicInfo.singer,
      source: musicInfo.metadata.musicInfo.source,
      albumName: musicInfo.metadata.musicInfo.meta.albumName,
      interval: musicInfo.metadata.musicInfo.interval ?? '',
    }
  } else {
    key = `${musicInfo.source}_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
      albumName: musicInfo.meta.albumName,
      interval: musicInfo.interval ?? '',
    }
  }
  if (getOtherSourcePromises.has(key)) return getOtherSourcePromises.get(key)

  const promise = new Promise<Rain.Music.MusicInfoOnline[]>((resolve, reject) => {
    let timeout: null | NodeJS.Timeout = setTimeout(() => {
      timeout = null
      reject(new Error('find music timeout'))
    }, 15_000)
    musicSdk.findMusic(searchMusicInfo).then((otherSource) => {
      if (otherSourceCache.size > 10) otherSourceCache.clear()
      const source = otherSource.map(toNewMusicInfo) as Rain.Music.MusicInfoOnline[]
      otherSourceCache.set(musicInfo, source)
      resolve(source)
    }).catch(reject).finally(() => {
      if (timeout) clearTimeout(timeout)
    })
  }).then((otherSource) => {
    // if (otherSource.length) void saveOtherSourceFromStore(musicInfo.id, otherSource)
    return otherSource
  }).finally(() => {
    if (getOtherSourcePromises.has(key)) getOtherSourcePromises.delete(key)
  })
  getOtherSourcePromises.set(key, promise)
  return promise
}


export const buildLyricInfo = async(lyricInfo: MakeOptional<Rain.Player.LyricInfo, 'rawlrcInfo'>): Promise<Rain.Player.LyricInfo> => {
  // player.isS2t 设置项已移除，行为固定为「不做简繁转换」，
  // 原来的 langS2T 转换分支随之删除（功能仍在 worker 里保留）。
  // @ts-expect-error
  if (lyricInfo.rawlrcInfo) return lyricInfo
  return { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
}

export const getCachedLyricInfo = async(musicInfo: Rain.Music.MusicInfo): Promise<Rain.Player.LyricInfo | null> => {
  let lrcInfo = await getStoreLyric(musicInfo)
  // lrcInfo = {} as unknown as Rain.Player.LyricInfo
  if (existTimeExp.test(lrcInfo.lyric)) {
    if (lrcInfo.tlyric != null) {
      // if (musicInfo.lrc.startsWith('\ufeff[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('\ufeff[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, rainlyric: musicInfo.tlrc })
      // } else if (musicInfo.lrc.startsWith('[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, rainlyric: musicInfo.tlrc })
      // }

      if (lrcInfo.rainlyric == null) {
        switch (musicInfo.source) { // 以下源支持rainlyric 重新获取
          case 'kg':
          case 'wy':
          case 'tx':
            break
          default:
            return lrcInfo
        }
      } else if (lrcInfo.rlyric == null) {
        // 以下源支持 rlyric 重新获取
        if (!['wy', 'kg', 'tx'].includes(musicInfo.source)) return lrcInfo
      } else return lrcInfo
    }
    if (musicInfo.source == 'local') return lrcInfo
  }
  return null
}

export const getOnlineOtherSourceMusicUrlByLocal = async(musicInfo: Rain.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  url: string
  quality: Rain.Quality
  isFromCache: boolean
}> => {
  if (!await window.rain.apiInitPromise[0]) throw new Error('source init failed')

  const quality = '128k'

  const cachedUrl = await getStoreMusicUrl(musicInfo, quality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, quality, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getMusicUrl(toOldMusicInfo(musicInfo), null).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then(({ url }: { url: string }) => {
    return { url, quality, isFromCache: false }
  })
}

export const getOnlineOtherSourceLyricByLocal = async(musicInfo: Rain.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  lyricInfo: Rain.Music.LyricInfo
  isFromCache: boolean
}> => {
  if (!await window.rain.apiInitPromise[0]) throw new Error('source init failed')

  const lyricInfo = await getCachedLyricInfo(musicInfo)
  if (lyricInfo && !isRefresh) return { lyricInfo, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getLyric(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((lyricInfo: Rain.Music.LyricInfo) => {
    return { lyricInfo, isFromCache: false }
  })
}

export const getOnlineOtherSourcePicByLocal = async(musicInfo: Rain.Music.MusicInfoLocal): Promise<{
  url: string
}> => {
  if (!await window.rain.apiInitPromise[0]) throw new Error('source init failed')

  let reqPromise
  try {
    reqPromise = apis('local').getPic(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((url: string) => {
    return { url }
  })
}

export const TRY_QUALITYS_LIST = ['flac24bit', 'flac', '320k'] as const
type TryQualityType = typeof TRY_QUALITYS_LIST[number]
export const getPlayQuality = (highQuality: Rain.Quality, musicInfo: Rain.Music.MusicInfoOnline): Rain.Quality => {
  let type: Rain.Quality = '128k'
  if (TRY_QUALITYS_LIST.includes(highQuality as TryQualityType)) {
    let list = qualityList.value[musicInfo.source]

    let t = TRY_QUALITYS_LIST
      .slice(TRY_QUALITYS_LIST.indexOf(highQuality as TryQualityType))
      .find(q => musicInfo.meta._qualitys[q] && list?.includes(q))

    if (t) type = t
  }
  return type
}

/**
 * 计算一首歌在 music_url 缓存里「正常播放时会被读取」的那条直链记录。
 * 读取用的 id 形状是 `<musicInfo.id>_<quality>`（见 @renderer/utils/ipc 的 createMusicUrlId），
 * 这里只负责推导出与各音源读取路径一致的 musicInfo 与 quality：
 * - 下载列表：实际读取的是 `metadata.musicInfo`（见 ./download.ts）；
 * - 存在换源对象(toggleMusicInfo)时，实际使用的是换源对象
 *   （见 core/player/action.ts 的 getMusicPlayUrl）；
 * - 本地歌曲固定 128k（见本文件 getOnlineOtherSourceMusicUrlByLocal）；
 * - 在线歌曲则是 getPlayQuality(appSetting['player.playQuality'], musicInfo)（见 ./online.ts）。
 */
export const getMusicUrlCacheInfo = (musicInfo: Rain.Music.MusicInfo | Rain.Download.ListItem): {
  musicInfo: Rain.Music.MusicInfo
  quality: Rain.Quality
} => {
  const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  const usedMusicInfo = info.meta.toggleMusicInfo ?? info
  if (usedMusicInfo.source == 'local') return { musicInfo: usedMusicInfo, quality: '128k' }
  return { musicInfo: usedMusicInfo, quality: getPlayQuality(appSetting['player.playQuality'], usedMusicInfo) }
}

/**
 * 删除一首歌（该音质）在 music_url 里缓存的直链。
 * 用于「刷新 2 次仍然失败」时丢弃已失效的直链，让下一次播放直接 cache miss。
 */
export const removeMusicUrlCache = async(musicInfo: Rain.Music.MusicInfo | Rain.Download.ListItem): Promise<void> => {
  const { musicInfo: usedMusicInfo, quality } = getMusicUrlCacheInfo(musicInfo)
  await removeStoreMusicUrl(usedMusicInfo, quality)
}

export const getOnlineOtherSourceMusicUrl = async({ musicInfos, quality, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: Rain.Music.MusicInfoOnline[]
  quality?: Rain.Quality
  onToggleSource: (musicInfo?: Rain.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: Rain.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: Rain.Music.MusicInfoOnline
  quality: Rain.Quality
  isFromCache: boolean
}> => {
  if (!await window.rain.apiInitPromise[0]) throw new Error('source init failed')

  let musicInfo: Rain.Music.MusicInfoOnline | null = null
  let itemQuality: Rain.Quality | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    if (!assertApiSupport(musicInfo.source)) continue
    itemQuality = quality ?? getPlayQuality(appSetting['player.playQuality'], musicInfo)
    if (!musicInfo.meta._qualitys[itemQuality]) continue

    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo || !itemQuality) throw new Error(window.i18n.t('toggle_source_failed'))

  const cachedUrl = await getStoreMusicUrl(musicInfo, itemQuality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, musicInfo, quality: itemQuality, isFromCache: true }

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), itemQuality).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then(({ url, type }: { url: string, type: Rain.Quality }) => {
    return { musicInfo, url, quality: type, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    if (err.message == requestMsg.tooManyRequests) throw err
    console.log(err)
    return getOnlineOtherSourceMusicUrl({ musicInfos, quality, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线音乐URL
 */
export const handleGetOnlineMusicUrl = async({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: Rain.Music.MusicInfoOnline
  quality?: Rain.Quality
  isRefresh: boolean
  allowToggleSource: boolean
  onToggleSource: (musicInfo?: Rain.Music.MusicInfoOnline) => void
}): Promise<{
  url: string
  musicInfo: Rain.Music.MusicInfoOnline
  quality: Rain.Quality
  isFromCache: boolean
}> => {
  if (!await window.rain.apiInitPromise[0]) throw new Error('source init failed')
  // console.log(musicInfo.source)
  const targetQuality = quality ?? getPlayQuality(appSetting['player.playQuality'], musicInfo)

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), targetQuality).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then(({ url, type }: { url: string, type: Rain.Quality }) => {
    return { musicInfo, url, quality: type, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource || err.message == requestMsg.tooManyRequests) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceMusicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          quality,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourcePicUrl = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: Rain.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: Rain.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: Rain.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: Rain.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: Rain.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(window.i18n.t('toggle_source_failed'))

  if (musicInfo.meta.picUrl && !isRefresh) return { musicInfo, url: musicInfo.meta.picUrl, isFromCache: true }

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourcePicUrl({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌曲封面
 */
export const handleGetOnlinePicUrl = async({ musicInfo, isRefresh, onToggleSource, allowToggleSource }: {
  musicInfo: Rain.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: Rain.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  url: string
  musicInfo: Rain.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourcePicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourceLyricInfo = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: Rain.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: Rain.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: Rain.OnlineSource[]
}): Promise<{
  lyricInfo: Rain.Music.LyricInfo | Rain.Player.LyricInfo
  musicInfo: Rain.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: Rain.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(window.i18n.t('toggle_source_failed'))

  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return { musicInfo, lyricInfo, isFromCache: true }
  }

  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)) as any).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: Rain.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      lyricInfo,
      musicInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourceLyricInfo({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌词信息
 */
export const handleGetOnlineLyricInfo = async({ musicInfo, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: Rain.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: Rain.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  musicInfo: Rain.Music.MusicInfoOnline
  lyricInfo: Rain.Music.LyricInfo | Rain.Player.LyricInfo
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)) as any).promise
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: Rain.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      musicInfo,
      lyricInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err

    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceLyricInfo({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}
