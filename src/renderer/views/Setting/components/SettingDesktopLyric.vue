<template lang="pug">
dt#desktop_lyric {{ $t('setting__desktop_lyric') }}
dd
  .gap-top
    base-checkbox(id="setting_desktop_lyric_enable" :model-value="appSetting['desktopLyric.enable']" :label="$t('setting__desktop_lyric_enable')" @update:model-value="updateSetting({ 'desktopLyric.enable': $event })")
  .gap-top
    base-checkbox(id="setting_desktop_lyric_lock" :model-value="appSetting['desktopLyric.isLock']" :label="$t('setting__desktop_lyric_lock')" @update:model-value="updateSetting({ 'desktopLyric.isLock': $event })")
  .gap-top
    base-checkbox(id="setting_desktop_lyric_alwaysOnTop" :model-value="appSetting['desktopLyric.isAlwaysOnTop']" :label="$t('setting__desktop_lyric_always_on_top')" @update:model-value="updateSetting({ 'desktopLyric.isAlwaysOnTop': $event })")
  .gap-top
    base-checkbox(id="setting_desktop_lyric_pause_hide" :model-value="appSetting['desktopLyric.pauseHide']" :label="$t('setting__desktop_lyric_pause_hide')" @update:model-value="updateSetting({ 'desktopLyric.pauseHide': $event })")
dd
  h3 {{ $t('setting__desktop_lyric_font') }}
  div(:class="$style.size")
    base-btn(min :disabled="appSetting['desktopLyric.style.fontSize'] <= 16" :aria-label="$t('desktop_lyric__font_decrease')" @click="changeSize(-1)") −
    span {{ appSetting['desktopLyric.style.fontSize'] }}
    base-btn(min :disabled="appSetting['desktopLyric.style.fontSize'] >= 28" :aria-label="$t('desktop_lyric__font_increase')" @click="changeSize(1)") ＋
dd
  base-btn(min @click="resetWindow") {{ $t('setting__desktop_lyric_reset_window') }}
</template>

<script setup>
import { appSetting, updateSetting } from '@renderer/store/setting'

const changeSize = step => { updateSetting({ 'desktopLyric.style.fontSize': Math.max(16, Math.min(28, appSetting['desktopLyric.style.fontSize'] + step)) }) }
const resetWindow = () => { updateSetting({ 'desktopLyric.width': 460, 'desktopLyric.height': 116, 'desktopLyric.x': null, 'desktopLyric.y': null }) }
</script>

<style lang="less" module>
.size { display: flex; align-items: center; gap: 14px; font-variant-numeric: tabular-nums; }
</style>
