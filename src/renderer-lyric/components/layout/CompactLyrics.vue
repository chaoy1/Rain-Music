<template>
  <div :class="[$style.lyrics, { [$style.locked]: setting['desktopLyric.isLock'] }]" :style="textStyle" data-compact-lyrics @pointerdown="startDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
    <div v-if="!lyric.lines.length" :class="$style.empty" data-desktop-lyric-empty>
      <p>{{ musicInfo.name || $t('player__detail_empty_title') }}</p>
      <p>{{ musicInfo.name ? $t('player__detail_no_lyric') : 'Rain Music' }}</p>
    </div>
    <template v-else>
      <div :key="`current-${index}-${lyric.lines[index]?.text}`" ref="currentRow" :class="[$style.current, 'active']" :data-word-lyric="isWordLyric ? '' : undefined" data-desktop-lyric-line data-current-lyric />
      <p :key="`next-${index}-${next}`" :class="$style.next" data-desktop-lyric-line data-next-lyric :aria-hidden="!next">{{ next }}</p>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watchEffect } from '@common/utils/vueTools'
import { lyric } from '@lyric/store/lyric'
import { setting, musicInfo } from '@lyric/store/state'
import { setWindowBounds } from '@lyric/utils/ipc'

const index = computed(() => Math.max(0, Math.min(lyric.line, lyric.lines.length - 1)))
const currentRow = ref(null)
const isWordLyric = computed(() => lyric.lines[index.value]?.dom_line.classList.contains('font-mode'))
watchEffect(() => {
  const line = lyric.lines[index.value]?.dom_line.querySelector('.line')
  if (currentRow.value && line) currentRow.value.replaceChildren(line)
}, { flush: 'post' })
const next = computed(() => lyric.lines.slice(index.value + 1).find(line => line.text.trim())?.text ?? '')
const textStyle = computed(() => ({
  '--lyric-font-size': `${Math.max(16, Math.min(28, setting['desktopLyric.style.fontSize']))}px`,
  fontFamily: setting['desktopLyric.style.font'] || undefined,
  opacity: Math.max(0.4, Math.min(1, setting['desktopLyric.style.opacity'] / 100)),
}))
let pointer
let screenX = 0
let screenY = 0
const startDrag = event => {
  if (setting['desktopLyric.isLock'] || event.button !== 0) return
  event.preventDefault()
  pointer = event.pointerId
  screenX = event.screenX
  screenY = event.screenY
  event.currentTarget.setPointerCapture(pointer)
}
const drag = event => {
  if (event.pointerId !== pointer) return
  setWindowBounds({ x: event.screenX - screenX, y: event.screenY - screenY, w: window.innerWidth, h: window.innerHeight })
  screenX = event.screenX
  screenY = event.screenY
}
const endDrag = () => { pointer = undefined }
</script>

<style lang="less" module>
.lyrics {
  height: 100%;
  box-sizing: border-box;
  padding: 20px 56px 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  cursor: grab;
  touch-action: none;
  text-align: center;
  color: #535d58;
  p { margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.35; animation: lyric-arrive .24s ease; }
  &:active { cursor: grabbing; }
}
.locked { cursor: default; }
.current {
  color: #11663a;
  font-size: var(--lyric-font-size);
  font-weight: 500;
  letter-spacing: .02em;
  line-height: 1.35;
  animation: lyric-arrive .24s ease;
  white-space: nowrap;
  overflow: hidden;
  :global(.line) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: top; }
  &[data-word-lyric] :global(.font-lrc > span) {
    background-color: #69766e;
    background-image: linear-gradient(90deg, #11663a, #11663a);
    background-repeat: no-repeat;
    background-size: 0 100%;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
}
.next { color: #45574b; min-height: 1.35em; font-size: calc(var(--lyric-font-size) * .78); font-weight: 400; opacity: .95; }
.empty {
  display: flex; flex-direction: column; gap: 9px;
  p:first-child { font-size: 16px; opacity: .85; }
  p:last-child { font-size: 12px; opacity: .45; }
}
@keyframes lyric-arrive { from { opacity: .35; transform: translateY(4px); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .lyrics p, .current { animation: none; } }
</style>
