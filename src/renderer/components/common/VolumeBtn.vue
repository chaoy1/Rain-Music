<template>
  <div ref="root" :class="$style.volume" data-footer-volume @pointerenter="enter" @pointerleave="leave" @focusout="focusOut" @keydown.esc.stop.prevent="dismiss" @wheel.prevent="adjustVolumeByWheel">
    <button ref="trigger" type="button" data-volume-trigger data-round-control ignore-tip :class="$style.trigger" :aria-label="`${$t('player__volume')} ${Math.round(volume * 100)}%`" :aria-expanded="open" aria-controls="footer-volume-panel" @click="show" @focus="focusIn">
      <svg viewBox="0 0 24 24" aria-hidden="true"><use :xlink:href="icon" /></svg>
    </button>
    <div id="footer-volume-panel" :class="[$style.panel, { [$style.open]: open }]" data-volume-panel :aria-hidden="!open" :inert="!open ? '' : undefined" role="group" :aria-label="$t('player__volume')">
      <div :class="$style.caption"><span>{{ $t('player__volume') }}</span><span>{{ Math.round((isMute ? 0 : volume) * 100) }}%</span></div>
      <div :class="$style.adjustment">
        <button type="button" data-volume-mute :aria-label="isMute ? $t('player__volume_muted') : $t('player__volume_mute_label')" :aria-pressed="isMute" @click="toggleMute"><svg viewBox="0 0 24 24" aria-hidden="true"><use :xlink:href="icon" /></svg></button>
        <input type="range" min="0" max="1" step="0.01" :value="isMute ? 0 : volume" :style="{ '--volume-fill': `${(isMute ? 0 : volume) * 100}%` }" :aria-label="$t('player__volume')" :aria-valuetext="`${Math.round((isMute ? 0 : volume) * 100)}%`" @input="changeVolume(Number($event.target.value))" @pointerdown="startDrag" @keydown="keyboard = true">
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { volume, isMute } from '@renderer/store/player/volume'
import { isShowPlayerDetail } from '@renderer/store/player/state'

const root = ref(null)
const trigger = ref(null)
const open = ref(false)
let inside = false
let dragging = false
let keyboard = false
let timer
const clearTimer = () => { clearTimeout(timer) }
const show = () => { clearTimer(); open.value = true }
const hide = () => { clearTimer(); open.value = false; dragging = false; keyboard = false }
const scheduleHide = () => {
  clearTimer()
  if (dragging || keyboard || inside) return
  timer = setTimeout(hide, 420)
}
const enter = event => {
  if (event.pointerType === 'touch') return
  inside = true
  clearTimer()
  timer = setTimeout(show, 70)
}
const leave = () => { inside = false; scheduleHide() }
const focusIn = () => {
  keyboard = trigger.value?.matches(':focus-visible') ?? false
  show()
}
const focusOut = event => {
  if (root.value?.contains(event.relatedTarget)) return
  keyboard = false
  scheduleHide()
}
const dismiss = () => {
  // Focus first, then close: focus must not reopen a dismissed panel.
  trigger.value?.focus()
  hide()
}
const startDrag = () => { keyboard = false; dragging = true; clearTimer() }
const endDrag = () => { dragging = false; scheduleHide() }
const outsidePress = event => { if (!root.value?.contains(event.target)) hide() }
const changeVolume = value => {
  if (isMute.value) window.app_event.setVolumeIsMute(false)
  window.app_event.setVolume(Math.max(0, Math.min(1, value)))
}
const adjustVolumeByWheel = event => {
  show()
  changeVolume(volume.value - event.deltaY / 5000)
  scheduleHide()
}
const toggleMute = () => { window.app_event.setVolumeIsMute(!isMute.value) }
const icon = computed(() => isMute.value ? '#icon-volume-mute-outline' : volume.value === 0 ? '#icon-volume-off-outline' : volume.value < 0.5 ? '#icon-volume-low-outline' : '#icon-volume-high-outline')
watch(isShowPlayerDetail, hide)
onMounted(() => {
  document.addEventListener('pointerdown', outsidePress)
  document.addEventListener('pointerup', endDrag)
  document.addEventListener('pointercancel', endDrag)
  window.addEventListener('blur', hide)
  window.addEventListener('resize', hide)
})
onBeforeUnmount(() => {
  clearTimer()
  document.removeEventListener('pointerdown', outsidePress)
  document.removeEventListener('pointerup', endDrag)
  document.removeEventListener('pointercancel', endDrag)
  window.removeEventListener('blur', hide)
  window.removeEventListener('resize', hide)
})
</script>

<style lang="less" module>
.volume { position: relative; flex: none; width: 32px; height: 36px; }
.volume button {
  display: grid; place-items: center; width: 32px; height: 36px; border: 0; padding: 0; border-radius: 10px; background: transparent; color: var(--color-font); cursor: pointer;
  svg { display: block; width: 19px; height: 19px; fill: currentColor; opacity: .72; }
  &:hover { background: var(--control-hover); svg { opacity: 1; } }
}
.panel {
  position: absolute; bottom: calc(100% + 10px); left: 50%; width: 210px; box-sizing: border-box; padding: 12px 14px; border-radius: 16px;
  background: var(--surface-popup); backdrop-filter: blur(32px) saturate(110%); box-shadow: var(--surface-shadow), inset 0 0 0 1px var(--glass-highlight);
  transform: translate(-50%, 6px) scale(.97); transform-origin: 50% 100%; opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .18s ease, transform .22s var(--control-ease), visibility .18s; z-index: 10;
  &::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 12px; }
  &.open { opacity: 1; visibility: visible; pointer-events: auto; transform: translate(-50%, 0) scale(1); }
}
.caption { display: flex; justify-content: space-between; font-size: 11px; line-height: 16px; opacity: .6; font-variant-numeric: tabular-nums; }
.adjustment {
  display: flex; align-items: center; gap: 10px; margin-top: 5px;
  input {
    flex: auto; min-width: 0; width: 0; height: 32px; padding: 0; margin: 0; appearance: none; cursor: pointer; background: transparent; border-radius: 6px;
    &::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--control-ink) var(--volume-fill), var(--control-outline) var(--volume-fill)); }
    &::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: var(--control-ink); box-shadow: 0 1px 3px var(--glass-edge); transition: scale .15s var(--control-ease); }
    &:hover::-webkit-slider-thumb, &:active::-webkit-slider-thumb { scale: 1.15; }
    &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; }
  }
}
</style>
