<template lang="pug">
dt#desktop_lyric {{ $t('setting__desktop_lyric') }}
dd
  .gap-top
    base-checkbox(id="setting_desktop_lyric_enable" :model-value="appSetting['desktopLyric.enable']" :label="$t('setting__desktop_lyric_enable')" @update:model-value="updateSetting({ 'desktopLyric.enable': $event })")
  .gap-top
    base-checkbox(id="setting_desktop_lyric_lock" :model-value="appSetting['desktopLyric.isLock']" :label="$t('setting__desktop_lyric_lock')" @update:model-value="updateSetting({ 'desktopLyric.isLock': $event })")
  //- 「使歌词总是在其他窗口之上」（desktopLyric.isAlwaysOnTop）与
  //- 「暂停时提高歌词透明度」（desktopLyric.pauseHide）两个控件已移除，行为固定为 true
  //- （见 src/common/constants.ts 的 DESKTOP_LYRIC_ALWAYS_ON_TOP / DESKTOP_LYRIC_PAUSE_HIDE）。
  //- 子项「自动刷新歌词置顶」（desktopLyric.isAlwaysOnTopLoop）保留，未做改动。
dd
  h3 {{ $t('setting__desktop_lyric_font') }}
  div(:class="$style.size")
    base-btn(min :disabled="appSetting['desktopLyric.style.fontSize'] <= 16" :aria-label="$t('desktop_lyric__font_decrease')" @click="changeSize(-1)") −
    span {{ appSetting['desktopLyric.style.fontSize'] }}
    base-btn(min :disabled="appSetting['desktopLyric.style.fontSize'] >= 28" :aria-label="$t('desktop_lyric__font_increase')" @click="changeSize(1)") ＋
//- 「重置窗口设置」按钮（setting__desktop_lyric_reset_window）已按要求删除；
//- 「重置颜色」等其它重置按钮不在本组件中，未受影响。
</template>

<script setup>
import { appSetting, updateSetting } from '@renderer/store/setting'

const changeSize = step => { updateSetting({ 'desktopLyric.style.fontSize': Math.max(16, Math.min(28, appSetting['desktopLyric.style.fontSize'] + step)) }) }
</script>

<style lang="less" module>
.size { display: flex; align-items: center; gap: 14px; font-variant-numeric: tabular-nums; }
</style>
