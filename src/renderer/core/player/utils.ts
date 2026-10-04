import { toRaw, markRawList } from '@common/utils/vueTools'
// import { qualityList } from '@renderer/store'
import { clearPlayedList } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { dislikeInfo } from '@renderer/store/dislikeList'
import { setPowerSaveBlocker as setPowerSaveBlockerRemote } from '@renderer/utils/ipc'

// export const getPlayType = (highQuality: boolean, musicInfo: Rain.Music.MusicInfo | Rain.Download.ListItem): Rain.Quality | null => {
//   if ('progress' in musicInfo || musicInfo.source == 'local') return null
//   let type: Rain.Quality = '128k'
//   let list = qualityList.value[musicInfo.source]
//   if (highQuality && musicInfo.meta._qualitys['320k'] && list?.includes('320k')) type = '320k'
//   return type
// }

/**
 * 过滤列表中已播放的歌曲
 */
export const filterList = async({ playedList, listId, list, playerMusicInfo, isNext }: {
  playedList: Rain.Player.PlayMusicInfo[]
  listId: string
  list: Array<Rain.Music.MusicInfo | Rain.Download.ListItem>
  playerMusicInfo?: Rain.Music.MusicInfo | Rain.Download.ListItem
  isNext: boolean
}) => {
  // if (this.list.listName === null) return
  // console.log(isCheckFile)
  let { filteredList, canPlayList, playerIndex } = await window.rain.worker.main.filterMusicList({
    listId,
    list: list.map(m => toRaw(m)),
    playedList: toRaw(playedList),
    // savePath: appSetting['download.savePath'],
    playerMusicInfo: toRaw(playerMusicInfo),
    dislikeInfo: { names: toRaw(dislikeInfo.names), musicNames: toRaw(dislikeInfo.musicNames), singerNames: toRaw(dislikeInfo.singerNames) },
    isNext,
  })

  if (!filteredList.length && playedList.length) {
    clearPlayedList()
    return { filteredList: markRawList(canPlayList), playerIndex }
  }
  return { filteredList: markRawList(filteredList), playerIndex }
}

let timeout: NodeJS.Timeout | null = null
const clearTimer = () => {
  if (!timeout) return
  clearTimeout(timeout)
  timeout = null
}
export const setPowerSaveBlocker = (enabled: boolean, force = false) => {
  if (enabled) {
    clearTimer()
    if (!force && !appSetting['player.powerSaveBlocker']) return
    setPowerSaveBlockerRemote(true)
  } else if (force) {
    clearTimer()
    setPowerSaveBlockerRemote(false)
  } else {
    if (timeout) return
    timeout = setTimeout(() => {
      setPowerSaveBlockerRemote(false)
    }, 60_000 * 1.5)
  }
}
