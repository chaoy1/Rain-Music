declare namespace Rain {
  namespace Player {
    interface ProgressBarOptions {
      progress: number
      mode?: Electron.ProgressBarOptions['mode']
    }

    type StatusButtonActions = 'unCollect'
    | 'collect'
    | 'prev'
    | 'pause'
    | 'play'
    | 'next'
    | 'seek'
    | 'volume'
    | 'mute'

    interface LyricInfo extends Rain.Music.LyricInfo {
      rawlrcInfo: Rain.Music.LyricInfo
    }

    interface Status {
      status: 'playing' | 'paused' | 'error' | 'stoped'
      name: string
      singer: string
      albumName: string
      picUrl: string
      progress: number
      duration: number
      playbackRate: number
      lyricLineText: string
      lyricLineAllText: string
      lyric: string
      tlyric: string
      rlyric: string
      rainlyric: string
      collect: boolean
      volume: number
      mute: boolean
    }
  }
}
