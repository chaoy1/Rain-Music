<template>
  <div :class="$style.controlBtn" data-footer-tools>
    <!-- <common-volume-bar /> -->
    <common-favorite-button />
    <button :class="[$style.titleBtn, { [$style.enabled]: appSetting['desktopLyric.enable'] }]" data-round-control data-desktop-lyric :aria-pressed="appSetting['desktopLyric.enable']" :aria-label="toggleDesktopLyricBtnTitle" @click="toggleDesktopLyric" @contextmenu.prevent="toggleLockDesktopLyric">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3.5" width="18" height="13" rx="3" /><path d="M8 20.5h8M12 16.5v4M7 8h10M7 12h7" />
      </svg>
    </button>
    <sleep-timer-btn />
    <common-volume-btn />
    <common-toggle-play-mode-btn />
  </div>
</template>

<script>
import useToggleDesktopLyric from '@renderer/utils/compositions/useToggleDesktopLyric'
import { appSetting } from '@renderer/store/setting'
import SleepTimerBtn from './SleepTimerBtn.vue'

export default {
  components: {
    SleepTimerBtn,
  },
  setup() {
    const {
      toggleDesktopLyricBtnTitle,
      toggleDesktopLyric,
      toggleLockDesktopLyric,
    } = useToggleDesktopLyric()
    return {
      appSetting,
      toggleDesktopLyricBtnTitle,
      toggleDesktopLyric,
      toggleLockDesktopLyric,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.controlBtn {
  height: 44px;
  padding: 2px 4px;
  margin: 0 8px 0 12px;
  border-radius: var(--control-radius);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
  background: var(--control-well);
  background-image: var(--control-face);
  align-items: center;
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  gap: 2px;

  button {
    color: var(--color-button-font);
    width: 32px;
    height: 36px;
    border-radius: var(--control-radius);
    transition: background-color .16s ease;
    &:hover { background: var(--control-hover); }
    svg { width: 18px; height: 18px; filter: none; }
  }
}

.titleBtn {
  flex: none;
  height: 36px;
  width: 32px;
  transition: @transition-fast;
  transition-property: color, opacity;
  // color: var(--color-button-font);
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  background-color: transparent;
  border: none;
  width: 32px;
  padding: 0;

  opacity: .75;
  cursor: pointer;

  svg {
    filter: none;
    fill: none;
  }
  &:hover {
    opacity: 1;
  }
  &:active {
    opacity: 1;
  }
}
.enabled {
  opacity: 1;
  background: var(--surface-selected);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}


</style>
