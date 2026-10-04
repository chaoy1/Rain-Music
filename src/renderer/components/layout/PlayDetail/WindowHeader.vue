<template>
  <header :class="[$style.header, { [$style.fullscreen]: isFullscreen }]">
    <TrafficLights />
    <div :class="$style.title">{{ title }}</div>
    <button type="button" :class="$style.back" :aria-label="$t('player__hide_detail_tip')" :title="$t('player__hide_detail_tip')" @click="$emit('back')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
  </header>
</template>

<script setup>
import { isFullscreen } from '@renderer/store'
import TrafficLights from '../Toolbar/TrafficLights.vue'
defineProps({ title: { type: String, default: '' } })
defineEmits(['back'])
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.header {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 @height-toolbar;
  gap: 24px;
  padding-right: 22px;
  -webkit-app-region: drag;
  background: linear-gradient(var(--glass-highlight), transparent), var(--color-glass-bar);
  border-bottom: 1px solid var(--glass-edge);
  &.fullscreen { -webkit-app-region: no-drag; }
}
.title {
  flex: auto;
  min-width: 0;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  .mixin-ellipsis-1();
}
.back {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--glass-edge);
  border-radius: 8px;
  background: var(--glass-highlight);
  -webkit-app-region: no-drag;
  cursor: pointer;
  &:hover { background: var(--color-primary-alpha-900); }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
}
</style>
