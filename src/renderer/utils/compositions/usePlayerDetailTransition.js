import { ref, watch, nextTick, onBeforeUnmount } from '@common/utils/vueTools'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'

// Keep the routed page mounted. Only the immersive layer moves; native window
// fullscreen and audio playback remain independent of this transition.
export default function usePlayerDetailTransition() {
  const detailPresent = ref(isShowPlayerDetail.value)
  const detailSettled = ref(false)
  const running = new Map()
  let origin
  const coverOrigin = () => document.querySelector('[data-player-cover]')?.getBoundingClientRect()
  const motionEnabled = () => appSetting['common.isShowAnimation'] && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  watch(isShowPlayerDetail, show => {
    if (show) {
      origin = coverOrigin()
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
    const cover = el.querySelector('[data-detail-cover]')
    const opacity = window.getComputedStyle(el).opacity
    const currentTransform = cover ? window.getComputedStyle(cover).transform : 'none'
    cancel(el)
    if (!motionEnabled()) { done(); return }
    const duration = entering ? 520 : 380
    const easing = entering ? 'cubic-bezier(.18,.8,.22,1)' : 'cubic-bezier(.4,0,.2,1)'
    const animations = [el.animate({ opacity: entering ? [0, 1] : [opacity, 0] }, { duration: entering ? 300 : duration, fill: 'both', easing })]
    if (cover) {
      const target = entering ? origin : coverOrigin()
      const rect = cover.getBoundingClientRect()
      if (target?.width && rect.width) {
        const transform = `translate(${target.left - rect.left}px, ${target.top - rect.top}px) scale(${target.width / rect.width}, ${target.height / rect.height})`
        animations.push(cover.animate({ transform: entering ? [transform, 'none'] : [currentTransform, transform] }, { duration, easing, fill: 'both' }))
      }
    }
    for (const part of el.querySelectorAll('[data-detail-reveal]')) {
      animations.push(part.animate(entering
        ? { opacity: [0, 1], transform: ['translateY(12px)', 'none'] }
        : { opacity: [window.getComputedStyle(part).opacity, 0], transform: ['none', 'translateY(8px)'] },
      { duration: entering ? 400 : 220, delay: entering ? 100 : 0, easing, fill: 'both' }))
    }
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
    // A close during entry starts from the current cover transform in onLeave.
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
