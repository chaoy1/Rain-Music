import { setMaxOutputChannelCount, setMediaDeviceId } from '@renderer/plugins/player'
import { MAX_OUTPUT_CHANNEL_COUNT } from '@common/constants'
import { appSetting, saveMediaDeviceId } from '@renderer/store/setting'

export default () => {
  // 「使用设备能处理的最大声道数输出音频」已从设置页移除，行为固定为 true。
  setMaxOutputChannelCount(MAX_OUTPUT_CHANNEL_COUNT)

  // 原设置项开启时会把自定义音频输出设备重置为默认设备（自定义输出设备与该功能冲突），
  // 该项固定为开启后，这段初始化在这里执行一次。
  if (MAX_OUTPUT_CHANNEL_COUNT && appSetting['player.mediaDeviceId'] != 'default') {
    void setMediaDeviceId('default').catch(_ => _)
    saveMediaDeviceId('default')
  }
}

