declare namespace Rain {
  namespace DesktopLyric {
    interface Config {
      'desktopLyric.enable': Rain.AppSetting['desktopLyric.enable']
      'desktopLyric.isLock': Rain.AppSetting['desktopLyric.isLock']
      'desktopLyric.isAlwaysOnTop': Rain.AppSetting['desktopLyric.isAlwaysOnTop']
      'desktopLyric.isAlwaysOnTopLoop': Rain.AppSetting['desktopLyric.isAlwaysOnTopLoop']
      'desktopLyric.isShowTaskbar': Rain.AppSetting['desktopLyric.isShowTaskbar']
      'desktopLyric.pauseHide': Rain.AppSetting['desktopLyric.pauseHide']
      'desktopLyric.audioVisualization': Rain.AppSetting['desktopLyric.audioVisualization']
      'desktopLyric.width': Rain.AppSetting['desktopLyric.width']
      'desktopLyric.height': Rain.AppSetting['desktopLyric.height']
      'desktopLyric.x': Rain.AppSetting['desktopLyric.x']
      'desktopLyric.y': Rain.AppSetting['desktopLyric.y']
      'desktopLyric.isLockScreen': Rain.AppSetting['desktopLyric.isLockScreen']
      'desktopLyric.isDelayScroll': Rain.AppSetting['desktopLyric.isDelayScroll']
      'desktopLyric.scrollAlign': Rain.AppSetting['desktopLyric.scrollAlign']
      'desktopLyric.isHoverHide': Rain.AppSetting['desktopLyric.isHoverHide']
      'desktopLyric.direction': Rain.AppSetting['desktopLyric.direction']
      'desktopLyric.style.align': Rain.AppSetting['desktopLyric.style.align']
      'desktopLyric.style.font': Rain.AppSetting['desktopLyric.style.font']
      'desktopLyric.style.fontSize': Rain.AppSetting['desktopLyric.style.fontSize']
      'desktopLyric.style.lineGap': Rain.AppSetting['desktopLyric.style.lineGap']
      'desktopLyric.style.lyricUnplayColor': Rain.AppSetting['desktopLyric.style.lyricUnplayColor']
      'desktopLyric.style.lyricPlayedColor': Rain.AppSetting['desktopLyric.style.lyricPlayedColor']
      'desktopLyric.style.lyricShadowColor': Rain.AppSetting['desktopLyric.style.lyricShadowColor']
      // 'desktopLyric.style.fontWeight': Rain.AppSetting['desktopLyric.style.fontWeight']
      'desktopLyric.style.opacity': Rain.AppSetting['desktopLyric.style.opacity']
      'desktopLyric.style.ellipsis': Rain.AppSetting['desktopLyric.style.ellipsis']
      'desktopLyric.style.isFontWeightFont': Rain.AppSetting['desktopLyric.style.isFontWeightFont']
      'desktopLyric.style.isFontWeightLine': Rain.AppSetting['desktopLyric.style.isFontWeightLine']
      'desktopLyric.style.isFontWeightExtended': Rain.AppSetting['desktopLyric.style.isFontWeightExtended']
      'desktopLyric.style.isZoomActiveLrc': Rain.AppSetting['desktopLyric.style.isZoomActiveLrc']
      'common.langId': Rain.AppSetting['common.langId']
      'player.isShowLyricTranslation': Rain.AppSetting['player.isShowLyricTranslation']
      'player.isShowLyricRoma': Rain.AppSetting['player.isShowLyricRoma']
      'player.isSwapLyricTranslationAndRoma': Rain.AppSetting['player.isSwapLyricTranslationAndRoma']
      'player.isPlayRainlrc': Rain.AppSetting['player.isPlayRainlrc']
      'player.playbackRate': Rain.AppSetting['player.playbackRate']
    }

    type WinMainActions = 'get_info' | 'get_status' | 'get_analyser_data_array'

    interface LyricActionBase <A> {
      action: A
    }
    interface LyricActionData<A, D> extends LyricActionBase<A> {
      data: D
    }
    type LyricAction<A, D = undefined> = D extends undefined ? LyricActionBase<A> : LyricActionData<A, D>

    type LyricActions = LyricAction<'set_info', {
      id: string | null
      singer: string
      name: string
      album: string
      lrc: string | null
      tlrc: string | null
      rlrc: string | null
      rainlrc: string | null
      // pic: string | null
      isPlay: boolean
      line: number
      played_time: number
    }>
    | LyricAction<'set_status', {
      isPlay: boolean
      line: number
      played_time: number
    }>
    | LyricAction<'set_lyric', {
      lrc: string | null
      tlrc: string | null
      rlrc: string | null
      rainlrc: string | null
    }>
    | LyricAction<'set_offset', number>
    | LyricAction<'set_playbackRate', number>
    | LyricAction<'set_play', number>
    | LyricAction<'set_pause'>
    | LyricAction<'set_stop'>
    | LyricAction<'send_analyser_data_array', Uint8Array>


    interface NewBounds {
      x: number
      y: number
      w: number
      h: number
    }
  }
}
