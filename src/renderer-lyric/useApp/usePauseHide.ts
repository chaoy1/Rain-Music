import { ref, watch } from '@common/utils/vueTools'
import { isPlay } from '@lyric/store/state'

export default () => {
  // 「暂停时提高歌词透明度」设置项已移除，行为固定为 true（DESKTOP_LYRIC_PAUSE_HIDE），
  // 因此原先按设置开关订阅 isPlay 的分支固定为「始终启用」这一支。
  let isHide = ref(false)
  let timeout: number | null = null
  const clearIntv = () => {
    if (!timeout) return
    window.clearTimeout(timeout)
    timeout = null
  }
  watch(isPlay, (isPlay) => {
    clearIntv()
    if (isPlay) {
      isHide.value &&= false
    } else {
      timeout = window.setTimeout(() => {
        timeout = null
        isHide.value = true
      }, 200)
    }
  }, {
    immediate: true,
  })

  return isHide
}
