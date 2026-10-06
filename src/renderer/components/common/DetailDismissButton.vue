<template>
  <button type="button" :class="$style.button" data-detail-dismiss ignore-tip :aria-label="$t('back')">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 8 9 8 9-8" /></svg>
  </button>
</template>

<style lang="less" module>
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none !important;
  color: var(--control-ink);
  cursor: pointer;
  -webkit-app-region: no-drag;
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
}
</style>
