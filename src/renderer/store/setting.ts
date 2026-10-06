import { reactive, computed } from '@common/utils/vueTools'
import defaultSetting from '@common/defaultSetting'
import { updateSetting as saveSetting } from '@renderer/utils/ipc'

export const appSetting = window.rainData.appSetting = reactive<Rain.AppSetting>({ ...defaultSetting })

// common.isShowAnimation 设置项已移除，行为固定为「始终显示动画」。
// 保留这个导出是为了不动各处已有的引用点。
export const isShowAnimation = computed(() => true)


export const initSetting = (newSetting: Rain.AppSetting) => {
  mergeSetting(newSetting)
}

export const mergeSetting = (newSetting: Partial<Rain.AppSetting>) => {
  for (const [key, value] of Object.entries(newSetting)) {
    // @ts-expect-error
    appSetting[key] = value
  }
}

export const updateSetting = window.rainData.updateSetting = (setting: Partial<Rain.AppSetting>) => {
  // console.warn(setting)
  void saveSetting(setting)
}

/**
 * 保存是否同意协议
 * @param isAgreePact 是否同意协议
 */
export const saveAgreePact = (isAgreePact: boolean) => {
  updateSetting({ 'common.isAgreePact': isAgreePact })
}

/**
 * 保存音频输出id
 * @param id 媒体驱动id
 */
export const saveMediaDeviceId = (id: string) => {
  updateSetting({ 'player.mediaDeviceId': id })
}

/**
 * 保存音量大小
 * @param volume 音量
 */
export const saveVolume = (volume: number) => {
  updateSetting({ 'player.volume': volume })
}

/**
 * 设置是否静音
 * @param isMute 是否静音
 */
export const saveVolumeIsMute = (isMute: boolean) => {
  updateSetting({ 'player.isMute': isMute })
}

/**
 * 设置播放速率
 * @param rate 播放速率
 */
export const savePlaybackRate = (rate: number) => {
  updateSetting({ 'player.playbackRate': rate })
}


/**
 * 设置是否开启桌面歌词
 * @param enabled
 */
export const setVisibleDesktopLyric = (enabled: boolean) => {
  updateSetting({ 'desktopLyric.enable': enabled })
}

/**
 * 设置是否锁定桌面歌词
 * @param isLock
 */
export const setLockDesktopLyric = (isLock: boolean) => {
  updateSetting({ 'desktopLyric.isLock': isLock })
}

/**
 * 设置切歌模式
 * @param mode
 */
export const setTogglePlayMode = (mode: Rain.AppSetting['player.togglePlayMethod']) => {
  updateSetting({ 'player.togglePlayMethod': mode })
}

/**
 * 设置API id
 * @param sourceId
 */
export const setApiSource = (sourceId: string) => {
  updateSetting({ 'common.apiSource': sourceId })
}

/**
 * 设置播放详情页歌词字体大小
 * @param size 字体大小
 */
export const setPlayDetailLyricFont = (size: number) => {
  updateSetting({ 'playDetail.style.fontSize': size })
}

/**
 * 设置播放详情页音频可视化
 * @param enable 是否启用
 */
export const setEnableAudioVisualization = (enable: boolean) => {
  updateSetting({ 'player.audioVisualization': enable })
}
