<template>
  <div ref="dom_btn" :class="$style.content">
    <button
      type="button"
      :class="[$style.trigger, { [$style.active]: isActive }]"
      data-sleep-timer
      :aria-label="$t('play_timeout')"
      :aria-pressed="isActive"
      :aria-expanded="visible"
      aria-controls="sleep-timer-panel"
      @click.stop="handleShowPopup"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.4 14.4A8.7 8.7 0 1 1 9.6 3.6a6.9 6.9 0 0 0 10.8 10.8Z" />
        <path d="M12 7.3v4.9l2.7 1.6" />
      </svg>
      <span v-if="timeLabel" :class="$style.label">{{ timeLabel }}</span>
    </button>
    <base-popup v-model:visible="visible" :btn-el="dom_btn">
      <div id="sleep-timer-panel" :class="$style.panel" data-sleep-timer-panel @keydown.esc.stop.prevent="visible = false">
      <ul :class="$style.list">
        <li v-for="item in presets" :key="item.minutes">
          <button type="button" :class="$style.item" :data-sleep-timer-preset="item.minutes" @click="handleStart(item.minutes)">{{ $t(item.label) }}</button>
        </li>
      </ul>
      <form :class="$style.custom" data-sleep-timer-custom novalidate @submit.prevent="handleCustomStart">
        <label for="sleep-timer-minutes">{{ $t('play_timeout_custom') }}</label>
        <div :class="$style.customControls">
          <input id="sleep-timer-minutes" v-model="customMinutes" data-sleep-timer-minutes type="number" min="1" max="1440" step="1" inputmode="numeric" :aria-label="$t('play_timeout_custom')" :aria-invalid="customError" :aria-describedby="customError ? 'sleep-timer-error' : undefined" @input="customError = false">
          <span>{{ $t('play_timeout_minutes') }}</span>
          <button type="submit" :class="$style.start" data-sleep-timer-start>{{ $t('play_timeout_start') }}</button>
        </div>
        <p v-if="customError" id="sleep-timer-error" :class="$style.error" role="alert">{{ $t('play_timeout_custom_error') }}</p>
      </form>
      <button v-if="isActive" type="button" :class="[$style.item, $style.cancel]" data-sleep-timer-off @click="handleStop">{{ $t('play_timeout_stop') }}</button>
      </div>
    </base-popup>
  </div>
</template>

<script>
import { computed, ref } from '@common/utils/vueTools'
import { minutesToTimeoutSeconds, startTimeoutStop, stopTimeoutStop, useTimeout } from '@renderer/core/player/timeoutStop'

export default {
  setup() {
    const visible = ref(false)
    const dom_btn = ref(null)
    const { timeLabel } = useTimeout()

    const isActive = computed(() => !!timeLabel.value)
    const customMinutes = ref('45')
    const customError = ref(false)
    const closePopup = () => { visible.value = false }
    const handleShowPopup = () => { visible.value = !visible.value }

    const presets = [
      { minutes: 15, label: 'play_timeout_preset_15' },
      { minutes: 30, label: 'play_timeout_preset_30' },
      { minutes: 60, label: 'play_timeout_preset_60' },
    ]

    const handleStart = (minutes) => {
      startTimeoutStop(minutes * 60)
      closePopup()
    }
    const handleCustomStart = () => {
      const seconds = minutesToTimeoutSeconds(customMinutes.value)
      customError.value = seconds === null
      if (customError.value) return
      startTimeoutStop(seconds)
      closePopup()
    }
    const handleStop = () => {
      stopTimeoutStop()
      closePopup()
    }

    return {
      visible,
      dom_btn,
      timeLabel,
      isActive,
      presets,
      handleShowPopup,
      handleStart,
      customMinutes,
      customError,
      handleCustomStart,
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
  width: auto;
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
  flex-flow: row nowrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  li { flex: 1; }
}

.panel { width: 282px; padding: 4px; }
.list .item { text-align: center; background: var(--control-rest); padding: 9px 6px; }
.custom { margin-top: 14px; label { display: block; font-size: 12px; color: var(--color-font-label); margin-bottom: 7px; } }
.customControls {
  display: flex; align-items: center; gap: 8px; color: var(--color-font); font-size: 12px;
  input { flex: 1; min-width: 0; width: 74px; height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--control-outline); border-radius: 8px; background: var(--control-rest); color: inherit; font: inherit; font-variant-numeric: tabular-nums; &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; } }
}
.start { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--control-ink); color: var(--color-content-background); font-size: 12px; cursor: pointer; &:hover { opacity: .85; } &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; } }
.error { margin: 8px 0 0; color: var(--color-font); font-size: 11px; line-height: 1.5; }
.cancel { margin-top: 10px; text-align: center !important; }

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
