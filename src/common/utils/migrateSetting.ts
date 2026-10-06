import { compareVer } from './index'
import {
  DEFAULT_THEME_ID,
  THEME_LIGHT_ID,
  THEME_DARK_ID,
  LEGACY_DEFAULT_THEME_ID,
  LEGACY_DEFAULT_DARK_THEME_ID,
} from '../constants'

const oldThemeMap = {
  0: 'green',
  1: 'blue',
  2: 'yellow',
  3: 'orange',
  4: 'red',
  10: 'pink',
  5: 'purple',
  6: 'grey',
  11: 'ming',
  12: 'blue2',
  13: 'black',
  7: 'mid_autumn',
  8: 'naruto',
  9: 'happy_new_year',
} as const

export default (setting: any): Partial<Rain.AppSetting> => {
  setting = { ...setting }

  // 迁移 v2.0.0 之前的配置
  if (compareVer(setting.version, '2.0.0') < 0) {
    // 列表设置项已全部移除（行为固定），不再迁移 list.* 下的旧键
    // （旧配置里的 list 对象即使保留也不会再被读取）

    // 拼写修正 v1.8.2 及以前：
    // 原本把旧的 player.isShowLyricTransition 并入 player.isShowLyricTranslation，
    // 但该设置项已移除（行为固定为显示歌词翻译），因此不再做这项迁移。

    // 迁移v1.19.0之前的主题设置
    if (setting.themeId != null) {
      setting.theme = {
        id: setting.themeId,
      }
      delete setting.themeId
    }

    if (setting.tray?.isShow != null) setting.tray.enable = setting.tray?.isShow

    setting['common.windowSizeId'] = setting.windowSizeId
    setting['common.langId'] = setting.langId
    setting['common.apiSource'] = setting.apiSource
    setting['common.isAgreePact'] = setting.isAgreePact

    setting['player.togglePlayMethod'] = setting.player?.togglePlayMethod
    setting['player.volume'] = setting.player?.volume
    setting['player.isMute'] = setting.player?.isMute
    setting['player.mediaDeviceId'] = setting.player?.mediaDeviceId
    setting['player.audioVisualization'] = setting.player?.audioVisualization
    setting['player.waitPlayEndStop'] = setting.player?.waitPlayEndStop
    setting['player.waitPlayEndStopTime'] = setting.player?.waitPlayEndStopTime

    setting['playDetail.style.fontSize'] = setting.playDetail?.style?.fontSize

    setting['desktopLyric.enable'] = setting.desktopLyric?.enable
    setting['desktopLyric.isLock'] = setting.desktopLyric?.isLock
    setting['desktopLyric.isAlwaysOnTopLoop'] = setting.desktopLyric?.isAlwaysOnTopLoop
    setting['desktopLyric.width'] = setting.desktopLyric?.width
    setting['desktopLyric.height'] = setting.desktopLyric?.height
    setting['desktopLyric.x'] = setting.desktopLyric?.x
    setting['desktopLyric.y'] = setting.desktopLyric?.y
    setting['desktopLyric.isLockScreen'] = setting.desktopLyric?.isLockScreen
    setting['desktopLyric.isDelayScroll'] = setting.desktopLyric?.isDelayScroll
    setting['desktopLyric.isHoverHide'] = setting.desktopLyric?.isHoverHide
    setting['desktopLyric.style.font'] = setting.desktopLyric?.style?.font
    if (setting.desktopLyric?.style?.fontSize) setting['desktopLyric.style.fontSize'] = setting.desktopLyric.style.fontSize / 100 * 16
    setting['desktopLyric.style.opacity'] = setting.desktopLyric?.style?.opacity
    setting['desktopLyric.style.isZoomActiveLrc'] = setting.desktopLyric?.style?.isZoomActiveLrc

    setting['download.enable'] = setting.download?.enable
    setting['download.savePath'] = setting.download?.savePath

    setting['theme.id'] = oldThemeMap[setting.theme?.id as keyof typeof oldThemeMap]
    setting['theme.lightId'] = oldThemeMap[setting.theme?.lightId as keyof typeof oldThemeMap]
    setting['theme.darkId'] = oldThemeMap[setting.theme?.darkId as keyof typeof oldThemeMap]

    setting.version = '2.0.0'
  }

  // 迁移本次预览定制：
  // 默认主题改为跟随系统的黑白主题（浅色 mono / 深色 mono_dark）。
  // 只改「仍停留在旧默认 green」的用户，不动主动选过其它主题的人。
  // 注：托盘样式已固定为黑色字形（TRAY_THEME_ID），用户配置里不再有该键，
  // 因此原来针对 tray.themeId 的迁移分支一并删除。
  if (compareVer(setting.version, '2.12.8') < 0) {
    if (setting['theme.id'] === LEGACY_DEFAULT_THEME_ID) {
      setting['theme.id'] = DEFAULT_THEME_ID
      if (setting['theme.lightId'] === LEGACY_DEFAULT_THEME_ID) setting['theme.lightId'] = THEME_LIGHT_ID
      if (setting['theme.darkId'] === LEGACY_DEFAULT_DARK_THEME_ID) setting['theme.darkId'] = THEME_DARK_ID
    }

    setting.version = '2.12.8'
  }

  // 收藏时始终由用户选择歌单；旧配置与备份里的固定目标不再参与读写。
  delete setting['common.favoriteListId']
  if (compareVer(setting.version, '2.12.10') < 0) setting.version = '2.12.10'

  return setting
}
