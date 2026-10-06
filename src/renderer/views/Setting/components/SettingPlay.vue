<template lang="pug">
dt#play {{ $t('setting__play') }}
dd(v-if="isMac")
  //- 原先这一节的多数控件已移除，行为固定在 src/common/constants.ts：
  //- 「播放歌曲时阻止电脑休眠」POWER_SAVE_BLOCKER、「记住播放进度」SAVE_PLAY_TIME、
  //- 「切歌时清空已播放列表」AUTO_CLEAN_PLAYED_LIST、「显示歌词翻译」SHOW_LYRIC_TRANSLATION、
  //- 「显示罗马音」SHOW_LYRIC_ROMA、「调换翻译与罗马音位置」SWAP_LYRIC_TRANSLATION_AND_ROMA、
  //- 「播放错误时自动切歌」AUTO_SKIP_ON_ERROR、「使用卡拉OK歌词播放」PLAY_RAINLRC、
  //- 「在任务栏显示播放进度」SHOW_TASK_PROGRESS、
  //- 「使用最大声道数」MAX_OUTPUT_CHANNEL_COUNT、「输出设备改变时暂停歌曲」MEDIA_DEVICE_REMOVED_STOP_PLAY。
  //- 另外「启动后播放音乐」「将中文歌词转换为繁体」两个控件此前已移除（见上一轮）。
  .gap-top
    base-checkbox(id="setting_player_showStatusBarLyric" :model-value="appSetting['player.isShowStatusBarLyric']" :label="$t('setting__play_statusbar_lyric')" @update:model-value="updateSetting({'player.isShowStatusBarLyric': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_statusbar_lyric_tip')")

dd
  h3#basic_play_quality {{ $t('setting__play_playQuality') }}
  div
    base-checkbox.gap-left(
      v-for="item in playQualityList" :id="`setting_play_quality_${item}`" :key="item"
      name="setting_play_quality" need :model-value="appSetting['player.playQuality']" :value="item" :label="item"
      @update:model-value="updateSetting({'player.playQuality': $event})")

dd(:aria-label="$t('setting__play_mediaDevice_title')")
  h3#play_mediaDevice {{ $t('setting__play_mediaDevice') }}
  div
    base-selection.gap-left(v-model="mediaDeviceId" :list="mediaDevices" item-key="deviceId" item-name="label" @change="handleMediaDeviceIdChnage")

</template>

<script>
import { ref, onBeforeUnmount, watch } from '@common/utils/vueTools'
import { hasInitedAdvancedAudioFeatures } from '@renderer/plugins/player'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { TRY_QUALITYS_LIST } from '@renderer/core/music/utils'
import { isMac } from '@common/utils'


export default {
  name: 'SettingPlay',
  setup() {
    const t = useI18n()
    const playQualityList = [...TRY_QUALITYS_LIST, '128k'].reverse()

    const mediaDevices = ref([])
    const getMediaDevice = async() => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      let audioDevices = devices.filter(device => device.kind === 'audiooutput')
      mediaDevices.value = audioDevices
      // console.log(this.mediaDevices)
    }
    void getMediaDevice()

    navigator.mediaDevices.addEventListener('devicechange', getMediaDevice)
    onBeforeUnmount(() => {
      navigator.mediaDevices.removeEventListener('devicechange', getMediaDevice)
    })

    const mediaDeviceId = ref(appSetting['player.mediaDeviceId'])
    const handleMediaDeviceIdChnage = async() => {
      if (hasInitedAdvancedAudioFeatures()) {
        await dialog({
          message: t('setting__play_media_device_error_tip'),
          confirmButtonText: t('alert_button_text'),
        })
        mediaDeviceId.value = appSetting['player.mediaDeviceId']
      } else if (appSetting['player.audioVisualization']) {
        const confirm = await dialog.confirm({
          message: t('setting__play_media_device_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })
        if (confirm) {
          updateSetting({
            'player.audioVisualization': false,
            'player.mediaDeviceId': mediaDeviceId.value,
          })
        } else {
          mediaDeviceId.value = appSetting['player.mediaDeviceId']
        }
      } else {
        appSetting['player.mediaDeviceId'] = mediaDeviceId.value
      }
    }
    watch(() => appSetting['player.mediaDeviceId'], val => {
      mediaDeviceId.value = val
    })

    return {
      appSetting,
      updateSetting,
      mediaDevices,
      mediaDeviceId,
      handleMediaDeviceIdChnage,
      playQualityList,
      isMac,
    }
  },
}
</script>
