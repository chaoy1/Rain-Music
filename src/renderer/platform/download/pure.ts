import { DOWNLOAD_STATUS, QUALITYS } from '@common/constants'
import { clipFileNameLength, clipNameLength, formatMusicName } from '@common/utils/tools'

// Browser-safe equivalent of worker/download/utils.ts's task construction.
// Keep fs, node-id3, iconv and download sockets outside the main WebView bundle.
export const checkList = (list: Rain.Download.ListItem[], musicInfo: Rain.Music.MusicInfo, quality: Rain.Quality, ext: string): boolean => (
  list.some(item => item.id === musicInfo.id && (item.metadata.quality === quality || item.metadata.ext === ext))
)

export const createDownloadTasks = (list: Rain.Music.MusicInfoOnline[], quality: Rain.Quality, format: string, qualityList: Rain.QualityList, listId?: string): Rain.Download.ListItem[] => list.map(musicInfo => {
  const supported = qualityList[musicInfo.source]
  let selected: Rain.Quality = '128k'
  if (supported) {
    const requested = supported.includes(quality) ? quality : supported[supported.length - 1]
    selected = QUALITYS.slice(QUALITYS.indexOf(requested)).find(type => musicInfo.meta._qualitys[type]) ?? '128k'
  }
  const ext: Rain.Download.FileExt = selected === 'flac24bit' || selected === 'flac' ? 'flac' : selected === 'wav' ? 'wav' : selected === 'ape' ? 'ape' : 'mp3'
  return {
    id: `${musicInfo.id}_${selected}_${ext}`,
    isComplate: false,
    status: DOWNLOAD_STATUS.WAITING,
    statusText: '待下载',
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
    writeQueue: 0,
    metadata: {
      musicInfo,
      url: null,
      quality: selected,
      ext,
      filePath: '',
      listId,
      fileName: `${clipFileNameLength(formatMusicName(format, musicInfo.name, clipNameLength(musicInfo.singer)))}.${ext}`.replace(/[\\/:*?#"<>|]/g, ''),
    },
  }
})
