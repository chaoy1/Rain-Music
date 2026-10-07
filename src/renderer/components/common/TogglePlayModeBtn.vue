<template>
  <button type="button" :class="$style.btn" data-round-control data-play-mode :data-mode="appSetting['player.togglePlayMethod']" ignore-tip :aria-label="nextTogglePlayName" :title="nextTogglePlayName" @click="toggleNextPlayMode()">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path v-if="appSetting['player.togglePlayMethod'] === 'list'" d="M4 7h12M4 12h8M4 17h8M17 10l3 3-3 3M15 13h5" />
      <path v-else-if="appSetting['player.togglePlayMethod'] === 'random'" d="M4 7h2c5 0 7 10 12 10h2M4 17h2c2 0 3.5-2 5-4.5M14 8.5C15 7.5 16.5 7 18 7h2M17 4l3 3-3 3M17 14l3 3-3 3" />
      <template v-else>
        <path d="M4 10V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 14v1a3 3 0 0 1-3 3H4M7 15l-3 3 3 3" />
        <path v-if="appSetting['player.togglePlayMethod'] === 'singleLoop'" d="m11 10 1.5-1v6" />
      </template>
    </svg>
    <span :class="$style.announcement" aria-live="polite">{{ nextTogglePlayName }}</span>
  </button>
</template>

<script setup>
import { appSetting } from '@renderer/store/setting'
import useNextTogglePlay from '@renderer/utils/compositions/useNextTogglePlay'

const { nextTogglePlayName, toggleNextPlayMode } = useNextTogglePlay()
</script>

<style lang="less" module>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  svg { display: block; width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; opacity: .8; }
  &:hover { background: var(--control-hover); svg { opacity: .9; } }
  &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; }
}
.announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
