import path from 'node:path'
import os from 'node:os'
import { TRAY_AUTO_ID, DEFAULT_THEME_ID, THEME_LIGHT_ID, THEME_DARK_ID } from './constants'

const isMac = process.platform == 'darwin'
const isWin = process.platform == 'win32'

const defaultSetting: Rain.AppSetting = {
  // 需要与 migrateSetting.ts 中最后一个迁移块的版本号保持一致：
  // 若此值高于迁移目标版本，迁移会被 compareVer 跳过，改动无法生效。
  version: '2.12.8',

  'common.windowSizeId': 3,
  'common.fontSize': 16,
  'common.startInFullscreen': false,
  'common.langId': null,
  'common.apiSource': 'temp',
  'common.sourceNameType': 'alias',
  'common.font': '',
  'common.isShowAnimation': true,
  'common.randomAnimate': true,
  'common.isAgreePact': false,
  'common.controlBtnPosition': isMac ? 'left' : 'right',
  'common.playBarProgressStyle': 'full',
  'common.transparentWindow': !isMac,

  'player.startupAutoPlay': false,
  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': '128k',
  'player.isShowTaskProgess': true,
  'player.isShowStatusBarLyric': false,
  'player.volume': 1,
  'player.powerSaveBlocker': true,
  'player.isMute': false,
  'player.playbackRate': 1,
  'player.preservesPitch': true,
  'player.isMaxOutputChannelCount': false,
  'player.mediaDeviceId': 'default',
  'player.isMediaDeviceRemovedStopPlay': false,
  'player.isShowLyricTranslation': false,
  'player.isShowLyricRoma': false,
  'player.isSwapLyricTranslationAndRoma': false,
  'player.isS2t': false,
  'player.isPlayRainlrc': !isMac,
  'player.isSavePlayTime': false,
  'player.audioVisualization': false,
  'player.waitPlayEndStop': true,
  'player.waitPlayEndStopTime': '',
  'player.autoSkipOnError': true,
  'player.isAutoCleanPlayedList': false,
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

  'playDetail.isZoomActiveLrc': false,
  'playDetail.isShowLyricProgressSetting': false,
  'playDetail.style.fontSize': 140,
  'playDetail.style.align': 'center',
  'playDetail.isDelayScroll': true,

  'desktopLyric.enable': false,
  'desktopLyric.isLock': false,
  'desktopLyric.isAlwaysOnTop': true,
  'desktopLyric.isAlwaysOnTopLoop': false,
  'desktopLyric.isShowTaskbar': false,
  'desktopLyric.audioVisualization': false,
  'desktopLyric.fullscreenHide': false,
  'desktopLyric.pauseHide': true,
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

  'list.isClickPlayList': false,
  'list.isShowSource': true,
  'list.isSaveScrollLocation': true,
  'list.addMusicLocationType': 'top',
  'list.actionButtonsVisible': false,

  'download.enable': false,
  'download.isSavePathGroupByListName': false,
  'download.savePath': path.join(os.homedir(), 'Desktop'),
  'download.fileName': '歌名 - 歌手',
  'download.maxDownloadNum': 3,
  'download.skipExistFile': true,
  'download.isDownloadLrc': false,
  'download.isDownloadRainLrc': true,
  'download.isDownloadTLrc': false,
  'download.isDownloadRLrc': false,
  'download.lrcFormat': 'utf8',
  'download.isEmbedPic': true,
  'download.isEmbedLyric': false,
  'download.isEmbedLyricRain': true,
  'download.isEmbedLyricT': false,
  'download.isEmbedLyricR': false,
  'download.isUseOtherSource': false,

  'search.isShowHotSearch': false,
  'search.isShowHistorySearch': false,
  'search.isFocusSearchBox': false,

  'network.proxy.enable': false,
  'network.proxy.host': '',
  'network.proxy.port': '',

  'tray.enable': false,
  // 'tray.isToTray': false,
  // 默认跟随系统深色模式自动切换托盘字形（TRAY_AUTO_ID = -1）。
  // 此前默认值是 0（native，白字形），在浅色任务栏上会看不见。
  'tray.themeId': TRAY_AUTO_ID,

  'sync.mode': 'server',
  'sync.enable': false,
  'sync.server.port': '23332',
  'sync.server.maxSsnapshotNum': 5,
  'sync.client.host': '',

  'openAPI.enable': false,
  'openAPI.port': '23330',
  'openAPI.bindLan': false,

  // 'theme.id': 'blue_plus',
  // 默认跟随系统：浅色用黑白 mono，深色用黑白 mono_dark
  // （'theme.id' 还可取 'auto'，取值常量集中在 constants.ts）
  'theme.id': DEFAULT_THEME_ID,
  'theme.lightId': THEME_LIGHT_ID,
  'theme.darkId': THEME_DARK_ID,

  'odc.isAutoClearSearchInput': false,
  'odc.isAutoClearSearchList': false,

}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'happy_new_year'
  defaultSetting['desktopLyric.style.lyricPlayedColor'] = 'rgba(255, 57, 71, 1)'
}


export default defaultSetting

