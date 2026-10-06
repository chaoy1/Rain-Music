import { ref, watch, nextTick, onBeforeUnmount } from '@common/utils/vueTools'
import { isShowPlayerDetail } from '@renderer/store/player/state'

// Keep the routed page mounted. Only the immersive layer moves; native window
// fullscreen and audio playback remain independent of this transition.
export default function usePlayerDetailTransition() {
  const detailPresent = ref(isShowPlayerDetail.value)
  const detailSettled = ref(false)
  const running = new Map()
  // common.isShowAnimation 设置项已移除，行为固定为「显示动画」，
  // 这里只保留对系统「减少动态效果」偏好的尊重。
  const motionEnabled = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  watch(isShowPlayerDetail, show => {
    if (show) {
      detailPresent.value = true
    }
  }, { flush: 'sync' })

  const cancel = el => {
    const animations = running.get(el)
    if (!animations) return
    running.delete(el)
    for (const animation of animations) animation.cancel()
  }
  const animate = (el, done, entering) => {
    const opacity = window.getComputedStyle(el).opacity
    cancel(el)
    if (!motionEnabled()) { done(); return }
    const animations = [el.animate({ opacity: entering ? [0, 1] : [opacity, 0] }, { duration: entering ? 180 : 140, fill: 'both', easing: 'ease-out' })]
    running.set(el, animations)
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (running.get(el) !== animations) return
      // Vue must finish mounting/removing the layer before cancelling fill styles.
      done()
      cancel(el)
    })
  }
  const detailTransition = {
    onBeforeEnter: () => { detailSettled.value = false },
    onEnter: (el, done) => { animate(el, done, true) },
    onAfterEnter: el => {
      detailSettled.value = true
      if (!el.contains(document.activeElement)) el.querySelector('[data-detail-back]')?.focus({ preventScroll: true })
    },
    onBeforeLeave: () => { detailSettled.value = false },
    onLeave: (el, done) => { animate(el, done, false) },
    // Interrupted transitions continue from the layer's current opacity.
    onLeaveCancelled: cancel,
    onAfterLeave: () => {
      if (isShowPlayerDetail.value) return
      detailPresent.value = false
      detailSettled.value = false
      nextTick(() => {
        if (!isShowPlayerDetail.value) document.querySelector('[data-player-cover]')?.focus({ preventScroll: true })
      })
    },
  }
  onBeforeUnmount(() => { for (const el of running.keys()) cancel(el) })
  return { detailPresent, detailSettled, detailTransition }
}
