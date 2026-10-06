import path from 'node:path'
import os from 'node:os'
import { RESOURCE_CACHE_AUTO_CLEAN_SIZE_OFF_MB, DEFAULT_THEME_ID, THEME_LIGHT_ID, THEME_DARK_ID } from './constants'

const isWin = process.platform == 'win32'

const defaultSetting: Rain.AppSetting = {
  // 需要与 migrateSetting.ts 中最后一个迁移块的版本号保持一致：
  // 若此值高于迁移目标版本，迁移会被 compareVer 跳过，改动无法生效。
  version: '2.12.10',

  'common.windowSizeId': 3,
  'common.fontSize': 16,
  'common.langId': null,
  'common.apiSource': 'temp',
  'common.isAgreePact': false,
  'common.playBarProgressStyle': 'full',
  // 资源缓存自动清理阈值（MB），0 表示关闭自动清理
  'common.resourceCacheAutoCleanSize': RESOURCE_CACHE_AUTO_CLEAN_SIZE_OFF_MB,
  // common.transparentWindow 已移除，行为固定为 true（TRANSPARENT_WINDOW）

  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': '128k',
  'player.isShowStatusBarLyric': false,
  'player.volume': 1,
  'player.isMute': false,
  'player.playbackRate': 1,
  'player.preservesPitch': true,
  'player.mediaDeviceId': 'default',
  'player.audioVisualization': false,
  'player.waitPlayEndStop': true,
  'player.waitPlayEndStopTime': '',
  'player.soundEffect.convolution.fileName': '',
  'player.soundEffect.convolution.mainGain': 10,
  'player.soundEffect.convolution.sendGain': 0,
  'player.soundEffect.biquadFilter.hz31': 0,
  'player.soundEffect.biquadFilter.hz62': 0,
  'player.soundEffect.biquadFilter.hz125': 0,
  'player.soundEffect.biquadFilter.hz250': 0,
  'player.soundEffect.biquadFilter.hz500': 0,
  'player.soundEffect.biquadFilter.hz1000': 0,
  'player.soundEffect.biquadFilter.hz2000': 0,
  'player.soundEffect.biquadFilter.hz4000': 0,
  'player.soundEffect.biquadFilter.hz8000': 0,
  'player.soundEffect.biquadFilter.hz16000': 0,
  'player.soundEffect.panner.enable': false,
  'player.soundEffect.panner.soundR': 5,
  'player.soundEffect.panner.speed': 25,
  'player.soundEffect.pitchShifter.playbackRate': 1,

  'playDetail.style.fontSize': 140,

  'desktopLyric.enable': false,
  'desktopLyric.isLock': false,
  // desktopLyric.isAlwaysOnTop 已移除，行为固定为 true（DESKTOP_LYRIC_ALWAYS_ON_TOP）
  'desktopLyric.isAlwaysOnTopLoop': false,
  'desktopLyric.isShowTaskbar': false,
  'desktopLyric.audioVisualization': false,
  'desktopLyric.fullscreenHide': false,
  // desktopLyric.pauseHide 已移除，行为固定为 true（DESKTOP_LYRIC_PAUSE_HIDE）
  'desktopLyric.width': 460,
  'desktopLyric.height': 116,
  'desktopLyric.x': null,
  'desktopLyric.y': null,
  'desktopLyric.isLockScreen': isWin,
  'desktopLyric.isDelayScroll': true,
  'desktopLyric.scrollAlign': 'center',
  'desktopLyric.isHoverHide': false,
  'desktopLyric.direction': 'horizontal',
  'desktopLyric.style.align': 'center',
  'desktopLyric.style.font': '',
  'desktopLyric.style.fontSize': 24,
  'desktopLyric.style.lineGap': 15,
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.18)',
  // 'desktopLyric.style.fontWeight': false,
  'desktopLyric.style.opacity': 95,
  'desktopLyric.style.ellipsis': false,
  'desktopLyric.style.isZoomActiveLrc': false,
  'desktopLyric.style.isFontWeightFont': true,
  'desktopLyric.style.isFontWeightLine': true,
  'desktopLyric.style.isFontWeightExtended': true,

  // 列表设置项已全部移除，行为固定在 src/common/constants.ts 的 ADD_MUSIC_LOCATION_TYPE 等常量里

  // 下载设置只保留「启用下载功能」与下载路径，
  // 其余行为（同时下载任务数、文件名格式、歌词编码、歌词下载、嵌入内容等）
  // 固定在 src/common/constants.ts 的常量里
  'download.enable': false,
  'download.savePath': path.join(os.homedir(), 'Desktop'),

  // 主题id
  // 默认跟随系统：浅色用黑白 mono，深色用黑白 mono_dark
  // （'theme.id' 还可取 'auto'，取值常量集中在 constants.ts）
  'theme.id': DEFAULT_THEME_ID,
  'theme.lightId': THEME_LIGHT_ID,
  'theme.darkId': THEME_DARK_ID,
}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'happy_new_year'
  defaultSetting['desktopLyric.style.lyricPlayedColor'] = 'rgba(255, 57, 71, 1)'
}


export default defaultSetting

