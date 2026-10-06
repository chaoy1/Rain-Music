<template>
  <div ref="dom_btn" :class="$style.content" @click="handleShowPopup" @mouseenter="handlMsEnter" @mouseleave="handlMsLeave">
    <button
      type="button"
      :class="[$style.trigger, { [$style.active]: isActive }]"
      data-sleep-timer
      :aria-label="$t('play_timeout')"
      :aria-pressed="isActive"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.4 14.4A8.7 8.7 0 1 1 9.6 3.6a6.9 6.9 0 0 0 10.8 10.8Z" />
        <path d="M12 7.3v4.9l2.7 1.6" />
      </svg>
      <span v-if="timeLabel" :class="$style.label">{{ timeLabel }}</span>
    </button>
    <base-popup v-model:visible="visible" :btn-el="dom_btn" @mouseenter="handlMsEnter" @mouseleave="handlMsLeave">
      <ul :class="$style.list" data-sleep-timer-panel>
        <li v-for="item in presets" :key="item.minutes">
          <button type="button" :class="$style.item" :data-sleep-timer-preset="item.minutes" @click="handleStart(item.minutes)">{{ $t(item.label) }}</button>
        </li>
        <li>
          <button type="button" :class="$style.item" data-sleep-timer-after-current @click="handleStopAfterCurrent">{{ $t('play_timeout_after_current') }}</button>
        </li>
        <li v-if="isActive">
          <button type="button" :class="$style.item" data-sleep-timer-off @click="handleStop">{{ $t('play_timeout_stop') }}</button>
        </li>
      </ul>
    </base-popup>
  </div>
</template>

<script>
import { computed, ref, watch } from '@common/utils/vueTools'
import { startTimeoutStop, stopTimeoutStop, useTimeout } from '@renderer/core/player/timeoutStop'

export default {
  setup() {
    const visible = ref(false)
    const dom_btn = ref(null)
    const { timeLabel } = useTimeout()

    // window.rain.isPlayedStop 只是普通全局变量，不具备响应性，这里用本地 ref 同步维护
    const stopAfterCurrent = ref(!!(window.rain && window.rain.isPlayedStop))

    const isActive = computed(() => !!timeLabel.value || stopAfterCurrent.value)

    // 倒计时到点后 timeoutStop 会设置 isPlayedStop，此时同步本地标记
    watch(timeLabel, (label, oldLabel) => {
      if (label || !oldLabel) return
      if (window.rain.isPlayedStop) stopAfterCurrent.value = true
    })

    let timeout = null
    const clearTimer = () => {
      if (!timeout) return
      clearTimeout(timeout)
      timeout = null
    }
    const closePopup = () => {
      clearTimer()
      visible.value = false
    }
    const handlMsEnter = () => {
      clearTimer()
      if (visible.value) return
      timeout = setTimeout(() => {
        timeout = null
        visible.value = true
      }, 100)
    }
    const handlMsLeave = () => {
      clearTimer()
      if (!visible.value) return
      timeout = setTimeout(() => {
        timeout = null
        visible.value = false
      }, 100)
    }
    const handleShowPopup = (evt) => {
      if (visible.value) {
        evt.stopPropagation()
        handlMsLeave()
      } else handlMsEnter()
    }

    const presets = [
      { minutes: 15, label: 'play_timeout_preset_15' },
      { minutes: 30, label: 'play_timeout_preset_30' },
      { minutes: 60, label: 'play_timeout_preset_60' },
    ]

    const handleStart = (minutes) => {
      stopAfterCurrent.value = false
      startTimeoutStop(minutes * 60)
      closePopup()
    }
    const handleStopAfterCurrent = () => {
      stopTimeoutStop()
      stopAfterCurrent.value = true
      window.rain.isPlayedStop = true
      closePopup()
    }
    const handleStop = () => {
      stopTimeoutStop()
      stopAfterCurrent.value = false
      window.rain.isPlayedStop = false
      closePopup()
    }

    return {
      visible,
      dom_btn,
      timeLabel,
      isActive,
      presets,
      handleShowPopup,
      handlMsEnter,
      handlMsLeave,
      handleStart,
      handleStopAfterCurrent,
      handleStop,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.content {
  position: relative;
  flex: none;
  height: 36px;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
}

.trigger {
  display: flex;
  flex-flow: row nowrap;
  justify-content: center;
  align-items: center;
  gap: 4px;
  min-width: 32px;
  height: 36px;
  padding: 0 7px;
  border: none;
  border-radius: 10px;
  background-color: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  opacity: .75;
  transition: @transition-fast;
  transition-property: color, opacity, background-color;

  svg {
    flex: none;
    width: 18px;
    height: 18px;
    filter: none;
    fill: none;
  }

  &:hover {
    opacity: 1;
    background: var(--control-hover);
  }
  &:active {
    opacity: 1;
  }
  &:focus-visible {
    outline: 2px solid var(--control-outline);
    outline-offset: 2px;
  }
}

.active {
  opacity: 1;
  background: var(--surface-selected);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}

.label {
  flex: none;
  font-size: 12px;
  line-height: 1;
  letter-spacing: .02em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.list {
  display: flex;
  flex-flow: column nowrap;
  min-width: 172px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background-color: transparent;
  color: var(--color-font);
  font-size: 13px;
  line-height: 1.3;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: @transition-fast;
  transition-property: background-color, color;

  &:hover {
    background: var(--control-hover);
  }
  &:focus-visible {
    outline: 2px solid var(--control-outline);
    outline-offset: -2px;
  }
}

</style>
