import { ref, computed, onBeforeUnmount, toRef } from '@common/utils/vueTools'
import { playProgress } from '@renderer/store/player/playProgress'
import { musicInfo } from '@renderer/store/player/state'

export default () => {
  const isActiveTransition = ref(false)
  const progress = toRef(playProgress, 'progress')
  const nowPlayTimeStr = toRef(playProgress, 'nowPlayTimeStr')
  const maxPlayTimeStr = toRef(playProgress, 'maxPlayTimeStr')
  const nowPlayTime = toRef(playProgress, 'nowPlayTime')
  const maxPlayTime = toRef(playProgress, 'maxPlayTime')
  const hasTimeline = computed(() => !!musicInfo.id)
  const canSeek = computed(() => hasTimeline.value && Number.isFinite(maxPlayTime.value) && maxPlayTime.value > 0)

  const handleTransitionEnd = () => {
    isActiveTransition.value = false
  }
  const handleActiveTransition = () => {
    isActiveTransition.value = true
  }

  window.app_event.on('activePlayProgressTransition', handleActiveTransition)

  onBeforeUnmount(() => {
    window.app_event.off('activePlayProgressTransition', handleActiveTransition)
  })

  return {
    hasTimeline,
    canSeek,
    nowPlayTimeStr,
    maxPlayTimeStr,
    nowPlayTime,
    maxPlayTime,
    progress,
    isActiveTransition,
    handleTransitionEnd,
  }
}
