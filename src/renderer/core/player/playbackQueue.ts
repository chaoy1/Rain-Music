import { LIST_IDS } from '@common/constants'
import { toRaw } from '@common/utils/vueTools'
import { findPlaybackQueueMusicIndex } from '@common/utils/playbackQueue'
import { getListMusics, addListMusics } from '@renderer/store/list/action'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { setPlayListId, updatePlayIndex, clearPlayedList } from '@renderer/store/player/action'
import { resetRandomNextMusicInfo } from '@renderer/core/player/action'
import { appSetting } from '@renderer/store/setting'
import { getDownloadFilePath } from '@renderer/utils/music'

type QueueMusic = Rain.Music.MusicInfo | Rain.Download.ListItem

const toQueueMusic = async(music: QueueMusic): Promise<Rain.Music.MusicInfo> => {
  music = toRaw(music)
  if (!('progress' in music)) return music
  const filePath = await getDownloadFilePath(music, appSetting['download.savePath'])
  if (!filePath) throw new Error('Downloaded music file is unavailable')
  const info = music.metadata.musicInfo
  return {
    id: music.id,
    name: info.name,
    singer: info.singer,
    interval: info.interval,
    source: 'local',
    meta: {
      songId: filePath,
      filePath,
      ext: music.metadata.ext,
      albumName: info.meta.albumName,
      picUrl: info.meta.picUrl,
    },
  }
}

// Serialize writes so rapid clicks and batches keep the same visible/SQLite order.
let pendingWrite: Promise<unknown> = Promise.resolve()

export const addToPlaybackQueue = async(musicInfos: QueueMusic[]): Promise<Rain.Music.MusicInfo[]> => {
  const requested = musicInfos.map(music => toRaw(music))
  const operation = pendingWrite.then(async() => {
    const current = playMusicInfo.musicInfo
    const currentListId = playMusicInfo.listId
    const playerListId = playInfo.playerListId
    const pending = [...tempPlayList]
    const queue = await getListMusics(LIST_IDS.DEFAULT)
    const incoming = await Promise.all(requested.map(toQueueMusic))
    if (!incoming.length) return []
    const additions = await Promise.all([
      ...(current ? [current] : []),
      ...pending.map(item => item.musicInfo),
      ...incoming,
    ].map(toQueueMusic))
    await addListMusics(LIST_IDS.DEFAULT, additions, 'bottom')

    // A queue write must never replace a newer explicit play action, reset the
    // current audio, or seek it. Only move its cursor to the canonical queue row.
    if (current && playMusicInfo.musicInfo === current && playMusicInfo.listId === currentListId && playInfo.playerListId === playerListId) {
      setPlayListId(LIST_IDS.DEFAULT)
      playMusicInfo.listId = LIST_IDS.DEFAULT
      playMusicInfo.isTempPlay = false
      clearPlayedList()
      resetRandomNextMusicInfo()
      updatePlayIndex()
    }
    for (const item of pending) {
      const index = tempPlayList.indexOf(item)
      if (index >= 0) tempPlayList.splice(index, 1)
    }
    return incoming.map(music => queue[findPlaybackQueueMusicIndex(queue, music)])
  })
  pendingWrite = operation.catch(() => {})
  return operation
}
