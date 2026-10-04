<template>
  <div :class="[$style.lights, { [$style.blur]: !isFocused }]" role="group" aria-label="Window controls">
    <button
      type="button"
      data-native-window-control
      :class="[$style.light, $style.close]"
      :aria-label="$t('close')"
      ignore-tip
      :title="$t('close')"
      @click="closeWindow"
    >
      <svg viewBox="0 0 12 12" :class="$style.glyph" aria-hidden="true">
        <path d="M3.5 3.5 L8.5 8.5 M8.5 3.5 L3.5 8.5" />
      </svg>
    </button>
    <button
      type="button"
      data-native-window-control
      :class="[$style.light, $style.min]"
      :aria-label="$t('min')"
      ignore-tip
      :title="$t('min')"
      @click="minWindow"
    >
      <svg viewBox="0 0 12 12" :class="$style.glyph" aria-hidden="true">
        <path d="M3 6 L9 6" />
      </svg>
    </button>
    <button
      type="button"
      data-native-window-control
      :class="[$style.light, $style.max]"
      :aria-label="$t(isFullscreen ? 'fullscreen_exit' : 'fullscreen')"
      ignore-tip
      :title="$t(isFullscreen ? 'fullscreen_exit' : 'fullscreen')"
      :aria-pressed="isFullscreen"
      :disabled="isChangingFullscreen"
      @click="toggleFullscreen"
    >
      <svg viewBox="0 0 12 12" :class="$style.glyph" aria-hidden="true">
        <path v-if="isFullscreen" d="M2.8 2.8 L5 5 M3 5 H5 V3 M9.2 9.2 L7 7 M9 7 H7 V9" />
        <path v-else d="M5 5 L2.8 2.8 M2.8 5 V2.8 H5 M7 7 L9.2 9.2 M7 9.2 H9.2 V7" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { closeWindow, minWindow, setFullScreen } from '@renderer/utils/ipc'
import { onMounted, onBeforeUnmount, ref } from '@common/utils/vueTools'
import { isFullscreen } from '@renderer/store'

const isFocused = ref(document.hasFocus())
const isChangingFullscreen = ref(false)
const toggleFullscreen = async() => {
  if (isChangingFullscreen.value) return
  isChangingFullscreen.value = true
  try {
    isFullscreen.value = await setFullScreen(!isFullscreen.value)
  } catch (error) {
    console.error('Unable to change fullscreen state', error)
  } finally {
    isChangingFullscreen.value = false
  }
}
// Renderer window events reflect native focus; the app event hub has no blur event.
const handleFocus = () => { isFocused.value = true }
const handleBlur = () => { isFocused.value = false }

onMounted(() => {
  window.addEventListener('focus', handleFocus)
  window.addEventListener('blur', handleBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', handleFocus)
  window.removeEventListener('blur', handleBlur)
})
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

// macOS 实测规格：
//   圆直径 12px、圆心间距 20px（即间隙 8px）、距窗口左边缘 20px
.lights {
  display: flex;
  align-items: center;
  gap: 0;
  flex: none;
  // 距窗口左边缘 20px，与 macOS 一致
  padding-left: 14px;
  -webkit-app-region: no-drag;
}

.light {
  position: relative;
  width: 24px;
  height: 28px;
  padding: 0;
  border: none;
  outline: none;
  border-radius: 6px;
  cursor: default;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  transition: filter @transition-fast;
  -webkit-app-region: no-drag;
  &::before {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: var(--light-color);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .12), 0 1px 1px rgba(0, 0, 0, .04);
  }
  &.close { --light-color: #ff5f57; }
  &.min { --light-color: #febc2e; }
  &.max { --light-color: #28c840; }
  &:active { filter: brightness(0.86); }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
}

// 图标默认隐藏，hover 时浮现
.glyph {
  position: relative;
  width: 12px;
  height: 12px;
  opacity: 0;
  transition: opacity @transition-fast;

  path {
    stroke: rgba(0, 0, 0, 0.58);
    stroke-width: 1.5;
    stroke-linecap: round;
    fill: none;
  }
}

.lights:hover, .lights:focus-within {
  .glyph { opacity: 1; }
}

// 窗口失焦时交通灯统一变灰
.blur {
  .light::before {
    background-color: var(--glass-inactive, #c9c9ce);
  }
  &:not(:hover):not(:focus-within) .glyph { opacity: 0; }
}

// 深色主题下描边改为亮色，避免糊在背景里
:global(.dark) .light::before {
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.14);
}
</style>
