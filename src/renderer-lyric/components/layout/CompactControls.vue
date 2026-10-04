<template>
  <div :class="$style.controls">
    <button type="button" data-lyric-lock :title="$t('desktop_lyric__lock')" :aria-label="$t('desktop_lyric__lock')" @click="updateSetting({ 'desktopLyric.isLock': true })">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10" rx="3" /><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3M12 14v2" /></svg>
    </button>
    <button type="button" data-lyric-close :title="$t('desktop_lyric__close')" :aria-label="$t('desktop_lyric__close')" @click="updateSetting({ 'desktopLyric.enable': false })">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
    </button>
  </div>
</template>

<script setup>
import { updateSetting } from '@lyric/store/action'
</script>

<style lang="less" module>
.controls {
  display: flex; gap: 2px; padding: 2px;
  button {
    display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0;
    border-radius: 8px; color: #69736d; background: transparent; cursor: pointer;
    transition: background-color .15s ease, scale .18s ease, color .15s ease;
    &:hover { color: #16834b; background: rgba(40, 90, 60, .07); }
    &:active { scale: .93; background: rgba(40, 90, 60, .12); }
    &:focus-visible { outline: 2px solid #16834b; outline-offset: -2px; }
  }
  svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
}
@media (prefers-reduced-motion: reduce) { .controls button { transition: none; scale: none; } }
</style>
