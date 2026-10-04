<template>
  <div :class="$style.controlBtn" data-footer-tools>
    <!-- <common-volume-bar /> -->
    <button :class="$style.titleBtn" data-round-control :aria-label="$t('player__add_music_to')" @click="addMusicTo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20.5 4.3 13A4.9 4.9 0 0 1 11.2 6l.8.8.8-.8a4.9 4.9 0 0 1 6.9 7M19 15v6M16 18h6" />
      </svg>
    </button>
    <button :class="[$style.titleBtn, { [$style.enabled]: appSetting['desktopLyric.enable'] }]" data-round-control data-desktop-lyric :aria-pressed="appSetting['desktopLyric.enable']" :aria-label="toggleDesktopLyricBtnTitle" @click="toggleDesktopLyric" @contextmenu.prevent="toggleLockDesktopLyric">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3.5" width="18" height="13" rx="3" /><path d="M8 20.5h8M12 16.5v4M7 8h10M7 12h7" />
      </svg>
    </button>
    <common-volume-btn />
    <common-toggle-play-mode-btn />
    <common-list-add-modal v-model:show="isShowAddMusicTo" :music-info="playMusicInfo.musicInfo" />
  </div>
</template>

<script>
import { ref } from '@common/utils/vueTools'
import useToggleDesktopLyric from '@renderer/utils/compositions/useToggleDesktopLyric'
import { musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'

export default {
  setup() {
    const isShowAddMusicTo = ref(false)
    const {
      toggleDesktopLyricBtnTitle,
      toggleDesktopLyric,
      toggleLockDesktopLyric,
    } = useToggleDesktopLyric()
    const addMusicTo = () => {
      if (!musicInfo.id) return
      isShowAddMusicTo.value = true
    }
    return {
      appSetting,
      isShowAddMusicTo,
      toggleDesktopLyricBtnTitle,
      toggleDesktopLyric,
      toggleLockDesktopLyric,
      addMusicTo,
      playMusicInfo,
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
