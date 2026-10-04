import { onMounted, onBeforeUnmount } from '@common/utils/vueTools'

// Update DOM properties once per frame; pointer movement never rerenders Vue.
export default function useLiquidGlass() {
  let root: HTMLElement | null = null
  let surface: HTMLElement | null = null
  let frame = 0
  let x = 0
  let y = 0
  const clear = () => {
    cancelAnimationFrame(frame)
    frame = 0
    surface?.style.setProperty('--shine-opacity', '0')
    surface = null
  }
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-glass]') : null
    if (target !== surface) {
      clear()
      surface = target
    }
    if (!surface) return
    x = event.clientX
    y = event.clientY
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      surface.style.setProperty('--shine-x', `${x - rect.left}px`)
      surface.style.setProperty('--shine-y', `${y - rect.top}px`)
      surface.style.setProperty('--shine-opacity', '1')
    })
  }
  onMounted(() => {
    root = document.getElementById('container')
    root?.addEventListener('pointermove', move, { passive: true })
    root?.addEventListener('pointerleave', clear)
    window.addEventListener('blur', clear)
  })
  onBeforeUnmount(() => {
    root?.removeEventListener('pointermove', move)
    root?.removeEventListener('pointerleave', clear)
    window.removeEventListener('blur', clear)
    clear()
  })
}
