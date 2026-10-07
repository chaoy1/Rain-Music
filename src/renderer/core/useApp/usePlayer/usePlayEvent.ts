import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { setStop, isEmpty } from '@renderer/plugins/player'
import {
  playNext,
  setMusicUrl,
  getMusicUrlRefreshNum,
  increaseMusicUrlRefreshNum,
  resetMusicUrlRefreshNum,
  MAX_MUSIC_URL_REFRESH_TIMES,
} from '@renderer/core/player'
import { removeMusicUrlCache } from '@renderer/core/music'
import { setAllStatus } from '@renderer/store/player/action'
import { AUTO_SKIP_ON_ERROR } from '@common/constants'

export default () => {
  const t = useI18n()
  let prevTimeoutId: string | null = null

  let loadingTimeout: NodeJS.Timeout | null = null
  let delayNextTimeout: NodeJS.Timeout | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    loadingTimeout = setTimeout(() => {
      if (window.rain.isPlayedStop) {
        prevTimeoutId = null
        setAllStatus('')
        return
      }

      // 如果加载超时，则尝试刷新URL
      if (prevTimeoutId == musicInfo.id) {
        prevTimeoutId = null
        void playNext(true)
      } else {
        prevTimeoutId = musicInfo.id
        if (playMusicInfo.musicInfo) setMusicUrl(playMusicInfo.musicInfo, true)
      }
    }, 25000)
  }
  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    // console.log('clear load timeout')
    clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const clearDelayNextTimeout = () => {
    // console.log(this.delayNextTimeout)
    if (!delayNextTimeout) return
    clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }
  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    delayNextTimeout = setTimeout(() => {
      if (window.rain.isPlayedStop) {
        setAllStatus('')
        return
      }
      void playNext(true)
    }, 5000)
  }

  const handleLoadstart = () => {
    if (window.rain.isPlayedStop) return
    if (AUTO_SKIP_ON_ERROR) startLoadingTimeout()
    setAllStatus(t('player__loading'))
  }

  const handleLoadeddata = () => {
    setAllStatus(t('player__loading'))
  }

  const handlePlaying = () => {
    setAllStatus('')
    clearLoadingTimeout()
  }

  const handleEmpied = () => {
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const handleWating = () => {
    setAllStatus(t('player__buffering'))
  }

  const handleError = (errCode?: number) => {
    if (!musicInfo.id) return
    clearLoadingTimeout()
    if (window.rain.isPlayedStop) return
    if (!isEmpty()) setStop()
    // 若音频URL无效则尝试刷新2次URL。
    // 刷新计数由 core/player/action.ts 持有：只有「新的一次播放」
    // （setMusicUrl 以 isRefresh 为假调用）才会把它清零，
    // 刷新动作本身（isRefresh = true）永远不会清零，所以这里的上限依然成立。
    if (playMusicInfo.musicInfo && errCode !== 1 && getMusicUrlRefreshNum() < MAX_MUSIC_URL_REFRESH_TIMES) {
      // console.log(getMusicUrlRefreshNum())
      increaseMusicUrlRefreshNum()
      setMusicUrl(playMusicInfo.musicInfo, true)
      setAllStatus(t('player__refresh_url'))
      return
    }

    // 刷新 2 次仍失败、即将放弃：删掉这首歌（该音质）在 music_url 里的失效缓存，
    // 让下一次播放直接 cache miss、重新向音源取，而不是先拿一条死链再白跑一轮刷新。
    // 删除失败不能影响播放流程，这里吞掉异常。
    if (playMusicInfo.musicInfo && errCode !== 1) {
      void removeMusicUrlCache(playMusicInfo.musicInfo).catch(() => {})
    }

    if (AUTO_SKIP_ON_ERROR) {
      if (document.hidden) {
        console.warn('error skip to next')
        void playNext(true)
      } else {
        setAllStatus(t('player__error'))
        setTimeout(addDelayNextTimeout)
      }
    }
  }

  const handleSetPlayInfo = () => {
    // 切歌（playMusicInfo 变更）同样属于「新的一次播放」，一并清零。
    resetMusicUrlRefreshNum()
    prevTimeoutId = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  // const handlePlayedStop = () => {
  //   clearDelayNextTimeout()
  //   clearLoadingTimeout()
  // }


  window.app_event.on('playerLoadstart', handleLoadstart)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('playerError', handleError)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  onBeforeUnmount(() => {
    window.app_event.off('playerLoadstart', handleLoadstart)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('playerError', handleError)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
