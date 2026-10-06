<template>
  <div :class="$style.dock" data-detail-dock data-glass ignore-tip>
    <div v-if="hasTimeline" :class="$style.timeline" data-detail-progress role="slider" :tabindex="canSeek ? 0 : -1" :aria-disabled="!canSeek" :aria-label="$t('player__detail_progress')" :aria-valuemin="0" :aria-valuemax="playProgress.maxPlayTime" :aria-valuenow="playProgress.nowPlayTime" :aria-valuetext="`${nowPlayTimeStr} / ${maxPlayTimeStr}`" @keydown="seekByKey">
      <common-progress-bar :class-name="$style.progress" :progress="progress" :handle-transition-end="handleTransitionEnd" :is-active-transition="isActiveTransition" />
    </div>
    <div v-if="hasTimeline" :class="$style.time" data-detail-time><span>{{ nowPlayTimeStr }}</span><span>{{ maxPlayTimeStr }}</span></div>
    <div :class="$style.primary">
      <common-favorite-button />
      <common-playback-controls immersive />
      <common-toggle-play-mode-btn />
    </div>
  </div>
</template>

<script setup>
import { playProgress } from '@renderer/store/player/playProgress'
import usePlayProgress from '@renderer/utils/compositions/usePlayProgress'

const { nowPlayTimeStr, maxPlayTimeStr, progress, isActiveTransition, handleTransitionEnd, hasTimeline, canSeek } = usePlayProgress()
const seekByKey = event => {
  if (!canSeek.value) return
  let time = playProgress.nowPlayTime
  switch (event.key) {
    case 'ArrowLeft': case 'ArrowDown': time -= 5; break
    case 'ArrowRight': case 'ArrowUp': time += 5; break
    case 'Home': time = 0; break
    case 'End': time = playProgress.maxPlayTime; break
    default: return
  }
  event.preventDefault()
  window.app_event.setProgress(Math.max(0, Math.min(playProgress.maxPlayTime, time)))
}
</script>

<style lang="less" module>
.dock {
  flex: none;
  width: min(100%, 340px);
  box-sizing: border-box;
  padding: 14px 18px 16px;
  border-radius: 20px;
  background: var(--control-well);
  box-shadow: inset 0 0 0 1px var(--glass-highlight), 0 6px 22px var(--glass-edge);
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    width: 40px;
    height: 44px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--color-font);
    cursor: pointer;
    transition: background-color .18s ease;
    svg { width: 18px; height: 18px; fill: currentColor; }
    &:hover:not(:disabled) { background: var(--control-hover); }
    &:disabled { opacity: .25; cursor: default; }
    &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; }
  }
}
.timeline { position: relative; display: flex; align-items: center; height: 24px; cursor: pointer; border-radius: 4px; &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; } }
.progress { height: 3px !important; background: var(--control-outline) !important; > div { background: var(--control-ink); } }
.time { display: flex; justify-content: space-between; font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; opacity: .58; }
.primary { display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: center; gap: 8px; margin-top: 10px; min-height: 52px; > button { opacity: .8; } }
</style>
