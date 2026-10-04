<template>
  <div :class="$style.tools" role="group" ignore-tip :aria-label="$t('player__detail_title')">
    <button
      type="button" :class="{ [$style.active]: isShowLrcSelectContent }" data-detail-select-lyrics
      :disabled="!lyric.lines.length || isShowPlayComment" ignore-tip :title="$t('lyric__select')" :aria-label="$t('lyric__select')" :aria-pressed="isShowLrcSelectContent"
      @click="setShowPlayLrcSelectContentLrc(!isShowLrcSelectContent)"
    ><svg viewBox="0 0 24 24" aria-hidden="true"><use xlink:href="#icon-text" /></svg></button>
    <button
      type="button" :class="{ [$style.active]: isShowPlayComment }" data-detail-comment
      :disabled="!playMusicInfo.musicInfo" ignore-tip :title="$t('comment__show')" :aria-label="$t('comment__show')" :aria-pressed="isShowPlayComment"
      @click="setShowPlayComment(!isShowPlayComment)"
    ><svg viewBox="0 0 24 24" aria-hidden="true"><use xlink:href="#icon-comment" /></svg></button>
    <button
      type="button" :class="{ [$style.active]: appSetting['player.audioVisualization'] }"
      ignore-tip :title="$t('audio_visualization')" :aria-label="$t('audio_visualization')" :aria-pressed="appSetting['player.audioVisualization']" @click="toggleAudioVisualization"
    ><svg viewBox="0 0 24 24" aria-hidden="true"><use xlink:href="#icon-audio-wave" /></svg></button>
    <span :class="$style.divider" aria-hidden="true" />
    <common-sound-effect-btn />
    <common-playback-rate-btn />
  </div>
</template>

<script setup>
import { isShowLrcSelectContent, isShowPlayComment, playMusicInfo } from '@renderer/store/player/state'
import { lyric } from '@renderer/store/player/lyric'
import { setShowPlayLrcSelectContentLrc, setShowPlayComment } from '@renderer/store/player/action'
import { appSetting, saveMediaDeviceId, setEnableAudioVisualization } from '@renderer/store/setting'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'

const t = useI18n()
const toggleAudioVisualization = async() => {
  const enabled = !appSetting['player.audioVisualization']
  if (enabled && appSetting['player.mediaDeviceId'] != 'default') {
    const confirm = await dialog.confirm({
      message: t('setting__player_audio_visualization_tip'),
      cancelButtonText: t('cancel_button_text'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await setMediaDeviceId('default').catch(_ => _)
    saveMediaDeviceId('default')
  }
  setEnableAudioVisualization(enabled)
}
</script>

<style lang="less" module>
.tools {
  display: flex;
  align-items: center;
  flex: none;
  gap: 2px;
  padding: 3px;
  border-radius: 11px;
  background: var(--control-well);
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--color-font);
    cursor: pointer;
    opacity: .68;
    transition: background-color .16s ease, opacity .16s ease;
    svg { width: 17px; height: 17px; fill: currentColor; }
    &:hover:not(:disabled) { opacity: 1; background: var(--control-hover); }
    &:disabled { opacity: .25; cursor: default; }
    &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 1px; }
    &.active { opacity: 1; color: var(--control-ink); background: var(--control-active); }
  }
}
.divider { height: 13px; width: 1px; margin: 0 3px; background: var(--control-outline); opacity: .35; }
</style>
