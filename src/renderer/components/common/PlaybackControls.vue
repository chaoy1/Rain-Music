<template>
  <div :class="[$style.controls, { [$style.immersive]: immersive }]" data-playback-controls>
    <button type="button" data-round-control :data-detail-prev="immersive ? '' : undefined" :aria-label="$t('player__prev')" @click="playPrev()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="6" width="2.4" height="12" rx="1.2" /><path d="M17.5 6.9c.7-.4 1.5.1 1.5.9v8.4c0 .8-.8 1.3-1.5.9l-7.2-4.2c-.7-.4-.7-1.4 0-1.8Z" /></svg>
    </button>
    <button type="button" data-round-control :class="$style.play" :data-detail-play="immersive ? '' : undefined" :aria-label="isPlay ? $t('player__pause') : $t('player__play')" @click="togglePlay">
      <svg v-if="isPlay" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.4" /><rect x="13.5" y="5" width="4" height="14" rx="1.4" /></svg>
      <svg v-else :class="$style.playGlyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.7c0-.8.9-1.3 1.6-.9l10 6.3c.7.4.7 1.4 0 1.8l-10 6.3c-.7.4-1.6-.1-1.6-.9Z" /></svg>
    </button>
    <button type="button" data-round-control :data-detail-next="immersive ? '' : undefined" :aria-label="$t('player__next')" @click="playNext()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="17.1" y="6" width="2.4" height="12" rx="1.2" /><path d="M6.5 6.9C5.8 6.5 5 7 5 7.8v8.4c0 .8.8 1.3 1.5.9l7.2-4.2c.7-.4.7-1.4 0-1.8Z" /></svg>
    </button>
  </div>
</template>

<script setup>
import { playNext, playPrev, togglePlay } from '@renderer/core/player'
import { isPlay } from '@renderer/store/player/state'

defineProps({ immersive: Boolean })
</script>

<style lang="less" module>
.controls {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 44px;
  padding: 2px;
  border-radius: var(--control-radius);
  background: var(--control-well);
  box-shadow: inset 0 1px 0 var(--glass-highlight), inset 0 -1px 0 var(--glass-edge);
  button {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--color-font);
    cursor: pointer;
    svg { display: block; width: 21px; height: 21px; fill: currentColor; stroke: none; opacity: .85; }
    &:hover { background: var(--control-hover); }
  }
  button.play {
    width: 40px;
    background: var(--control-rest);
    background-image: var(--control-face);
    box-shadow: var(--control-raised-shadow);
    svg { width: 23px; height: 23px; stroke: none; opacity: 1; }
    &:hover { background: var(--control-hover); }
  }
}
.playGlyph { translate: 1px 0; }
.immersive {
  gap: 8px;
  height: 52px;
  padding: 0;
  background: transparent;
  box-shadow: none;
  button { width: 40px; height: 44px; svg { width: 24px; height: 24px; } }
  button.play { width: 52px; height: 52px; border-radius: var(--control-radius); background: var(--control-active); svg { width: 27px; height: 27px; } }
}
</style>
