<template>
  <div :class="[$style.progress, className]" :data-seeking="dragging">
    <div :class="[$style.progressBar, { [$style.barTransition]: isActiveTransition && !dragging }]" :style="{ transform: `scaleX(${displayProgress})` }" @transitionend="handleTransitionEnd" />
  </div>
  <div :class="[$style.progressMask, { [$style.dragging]: dragging }]" data-seek-hit @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel">
    <span :class="$style.thumb" :style="{ left: `${displayProgress * 100}%` }" />
  </div>
</template>

<script setup>
import { ref, computed } from '@common/utils/vueTools'
import { playProgress } from '@renderer/store/player/playProgress'

const props = defineProps({
  className: { type: String, default: '' },
  progress: { type: Number, required: true },
  isActiveTransition: { type: Boolean, required: true },
  handleTransitionEnd: { type: Function, required: true },
})
const dragging = ref(false)
const dragProgress = ref(0)
let activePointer
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const displayProgress = computed(() => clamp(dragging.value ? dragProgress.value : props.progress))
const update = event => {
  const rect = event.currentTarget.getBoundingClientRect()
  dragProgress.value = rect.width ? clamp((event.clientX - rect.left) / rect.width) : 0
}
const start = event => {
  if (event.button !== 0 || playProgress.maxPlayTime <= 0) return
  event.preventDefault()
  activePointer = event.pointerId
  event.currentTarget.setPointerCapture(activePointer)
  event.currentTarget.closest('[role="slider"]')?.focus({ preventScroll: true })
  update(event)
  dragging.value = true
}
const move = event => { if (dragging.value && event.pointerId === activePointer) update(event) }
const cancel = () => { dragging.value = false; activePointer = undefined }
const finish = event => {
  if (!dragging.value || event.pointerId !== activePointer) return
  update(event)
  window.app_event.setProgress(dragProgress.value * playProgress.maxPlayTime)
  cancel()
}
</script>

<style lang="less" module>
.progress { position: relative; width: 100%; height: 4px; overflow: hidden; background: color-mix(in srgb, var(--control-ink) 18%, transparent); border-radius: 3px; }
.progressBar { position: absolute; inset: 0; width: 100%; height: 100%; transform-origin: 0; border-radius: inherit; background: var(--control-ink); }
.barTransition { transition: transform .2s ease-out; }
.progressMask { position: absolute; left: 0; top: 50%; width: 100%; height: max(100%, 24px); transform: translateY(-50%); cursor: pointer; touch-action: none; }
.thumb { position: absolute; top: 50%; width: 10px; height: 10px; border-radius: 50%; background: var(--control-ink); box-shadow: 0 0 0 2px var(--color-content-background), 0 1px 3px var(--glass-edge); transform: translate(-50%, -50%); pointer-events: none; opacity: 0; transition: opacity .14s ease; }
.progressMask:hover .thumb, .dragging .thumb, :global([role="slider"]:focus-visible) .thumb { opacity: 1; }
</style>
