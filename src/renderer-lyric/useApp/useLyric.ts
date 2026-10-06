import { watch } from '@common/utils/vueTools'
import { setVertical, setPlaybackRate } from '@lyric/core/lyric'
import { getStatus } from '@lyric/core/mainWindowChannel'
import { isPlay, setting } from '@lyric/store/state'

export default () => {
  // 「显示歌词翻译」「显示罗马音」「调换翻译与罗马音位置」「使用卡拉OK歌词」四个设置项已移除，
  // 行为固定在主进程/主窗口侧（见 src/common/constants.ts），歌词窗口不再需要监听它们。
  watch(() => setting['player.playbackRate'], (rate) => {
    setPlaybackRate(rate)
    if (isPlay.value) {
      setTimeout(() => {
        getStatus()
      })
    }
  })
  watch(() => setting['desktopLyric.direction'], (direction) => {
    setVertical(direction == 'vertical')
    // if (isPlay.value)
  })
}
