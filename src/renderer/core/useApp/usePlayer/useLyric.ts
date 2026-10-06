import { onBeforeUnmount } from '@common/utils/vueTools'
import { debounce } from '@common/utils/common'
// import { setDesktopLyricInfo, onGetDesktopLyricInfo } from '@renderer/utils/ipc'
// import { musicInfo } from '@renderer/store/player/state'
import {
  pause,
  play,
  setLyric,
  stop,
  init,
  sendInfo,
  setPlaybackRate,
} from '@renderer/core/lyric'

const handleApplyPlaybackRate = debounce(setPlaybackRate, 300)

export default () => {
  init()

  const setPlayInfo = () => {
    stop()
    sendInfo()
  }

  // 「显示歌词翻译」「显示罗马音」「调换翻译与罗马音位置」「使用卡拉OK歌词」四个设置项已移除，
  // setLyric() 内部直接引用固定常量（见 src/common/constants.ts），不再需要监听设置变化。

  window.app_event.on('play', play)
  window.app_event.on('pause', pause)
  window.app_event.on('stop', stop)
  window.app_event.on('error', pause)
  window.app_event.on('musicToggled', setPlayInfo)
  window.app_event.on('lyricUpdated', setLyric)
  window.app_event.on('setPlaybackRate', handleApplyPlaybackRate)

  onBeforeUnmount(() => {
    window.app_event.off('play', play)
    window.app_event.off('pause', pause)
    window.app_event.off('stop', stop)
    window.app_event.off('error', pause)
    window.app_event.off('musicToggled', setPlayInfo)
    window.app_event.off('lyricUpdated', setLyric)
    window.app_event.off('setPlaybackRate', handleApplyPlaybackRate)
  })
}
