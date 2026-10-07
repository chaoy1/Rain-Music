import { onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { updateListMusicsPosition } from '@renderer/store/list/action'
import { clearDownKeys } from '@renderer/event'

const HOLD_DELAY = 500
const HOLD_TOLERANCE = 5
const EDGE_ZONE = 44

// Virtualized rows represent only the visible slice. Use full-list coordinates
// rather than moving those DOM nodes with Sortable, which loses offscreen indices.
export default ({ props, list, listRef, listItemHeight, removeAllSelect }) => {
  const isSongDragging = ref(false)
  let gesture = null
  let suppressClickUntil = 0
  let saving = false

  const removeListeners = () => {
    document.removeEventListener('pointermove', handleMove, true)
    document.removeEventListener('pointerup', handleRelease, true)
    document.removeEventListener('pointercancel', cancel, true)
    document.removeEventListener('keydown', handleKey, true)
    window.removeEventListener('blur', cancel)
  }

  const cancel = () => {
    if (!gesture) return
    clearTimeout(gesture.timer)
    window.cancelAnimationFrame(gesture.frame)
    gesture.preview?.remove()
    gesture.indicator?.remove()
    if (gesture.container.hasPointerCapture?.(gesture.pointerId)) gesture.container.releasePointerCapture(gesture.pointerId)
    if (isSongDragging.value) {
      suppressClickUntil = performance.now() + 250
      window.app_event.dragEnd()
      clearDownKeys()
    }
    gesture = null
    isSongDragging.value = false
    removeListeners()
  }

  const updateFeedback = () => {
    if (!gesture || !isSongDragging.value) return
    const { container, preview, indicator, x, y } = gesture
    const rect = container.getBoundingClientRect()
    const inBounds = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    gesture.inBounds = inBounds
    indicator.style.visibility = inBounds ? 'visible' : 'hidden'
    preview.style.transform = `translate(${Math.max(12, Math.min(x - 40, window.innerWidth - rect.width - 12))}px, ${y - listItemHeight.value / 2}px)`
    if (!inBounds) return
    const absoluteIndex = Math.floor((container.scrollTop + y - rect.top) / listItemHeight.value)
    gesture.targetIndex = Math.min(list.value.length - 1, Math.max(0, absoluteIndex))
    const boundary = gesture.targetIndex + (gesture.targetIndex >= gesture.initialIndex ? 1 : 0)
    const lineY = Math.max(rect.top, Math.min(rect.bottom, rect.top + boundary * listItemHeight.value - container.scrollTop))
    Object.assign(indicator.style, { left: `${rect.left + 8}px`, top: `${lineY - 1}px`, width: `${rect.width - 16}px` })
  }

  const autoScroll = () => {
    if (!gesture || !isSongDragging.value) return
    const rect = gesture.container.getBoundingClientRect()
    if (gesture.x >= rect.left && gesture.x <= rect.right) {
      const up = Math.max(0, rect.top + EDGE_ZONE - gesture.y)
      const down = Math.max(0, gesture.y - (rect.bottom - EDGE_ZONE))
      if (gesture.y >= rect.top && gesture.y <= rect.bottom) gesture.container.scrollTop += Math.max(-18, Math.min(18, (down - up) * 0.28))
    }
    updateFeedback()
    gesture.frame = window.requestAnimationFrame(autoScroll)
  }

  const start = () => {
    if (!gesture || props.listId !== gesture.listId || !list.value.some(item => item.id === gesture.id)) return cancel()
    isSongDragging.value = true
    removeAllSelect()
    window.getSelection()?.removeAllRanges()
    window.app_event.dragStart()
    gesture.container.setPointerCapture?.(gesture.pointerId)
    const preview = gesture.row.cloneNode(true)
    preview.removeAttribute('data-current-song')
    preview.removeAttribute('data-song-id')
    preview.setAttribute('data-song-drag-preview', '')
    preview.setAttribute('aria-hidden', 'true')
    const rowStyle = window.getComputedStyle(gesture.row)
    Object.assign(preview.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      display: 'flex',
      width: `${gesture.container.clientWidth}px`,
      height: `${listItemHeight.value}px`,
      zIndex: '10000',
      pointerEvents: 'none',
      borderRadius: '8px',
      overflow: 'hidden',
      font: rowStyle.font,
      color: 'var(--color-font)',
      background: 'var(--color-content-background)',
      opacity: '0.94',
      boxShadow: '0 8px 24px rgba(0,0,0,.2)',
    })
    const originalCells = [...gesture.row.children]
    ;[...preview.children].forEach((cell, index) => {
      const style = window.getComputedStyle(originalCells[index])
      for (const property of ['display', 'alignItems', 'flex', 'padding', 'overflow', 'minWidth']) cell.style[property] = style[property]
    })
    const indicator = document.createElement('div')
    indicator.setAttribute('data-song-drop-indicator', '')
    Object.assign(indicator.style, { position: 'fixed', height: '2px', borderRadius: '2px', background: 'var(--color-primary)', zIndex: '10001', pointerEvents: 'none' })
    document.querySelector('#root').append(preview, indicator)
    Object.assign(gesture, { preview, indicator })
    updateFeedback()
    gesture.frame = window.requestAnimationFrame(autoScroll)
  }

  const handleMove = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.x = event.clientX
    gesture.y = event.clientY
    if (!isSongDragging.value) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > HOLD_TOLERANCE) cancel()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    updateFeedback()
  }

  const handleRelease = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const { id, listId, targetIndex, initialIndex, inBounds } = gesture
    const shouldSave = isSongDragging.value && inBounds && targetIndex !== initialIndex
    if (isSongDragging.value) { event.preventDefault(); event.stopPropagation() }
    cancel()
    if (!shouldSave) return
    saving = true
    updateListMusicsPosition({ listId, position: targetIndex, ids: [id] }).catch(error => { console.error(error) }).finally(() => { saving = false })
  }

  const handleKey = event => {
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
  }

  const handleSongPointerDown = (event, index) => {
    if (event.button !== 0 || saving || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return
    cancel()
    const row = event.currentTarget
    const container = listRef.value?.$el
    const item = list.value[index]
    if (!item || !container) return
    gesture = {
      pointerId: event.pointerId,
      id: item.id,
      listId: props.listId,
      initialIndex: index,
      targetIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      row,
      container,
      timer: setTimeout(start, HOLD_DELAY),
      frame: 0,
      inBounds: true,
    }
    document.addEventListener('pointermove', handleMove, { capture: true, passive: false })
    document.addEventListener('pointerup', handleRelease, true)
    document.addEventListener('pointercancel', cancel, true)
    document.addEventListener('keydown', handleKey, true)
    window.addEventListener('blur', cancel)
  }

  const isDragClick = () => isSongDragging.value || performance.now() < suppressClickUntil
  watch(() => props.listId, cancel)
  watch(list, cancel)
  onBeforeUnmount(cancel)
  return { isSongDragging, handleSongPointerDown, isDragClick }
}
