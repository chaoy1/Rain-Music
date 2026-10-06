// 设置窗口位置、大小
import { DESKTOP_LYRIC_ALWAYS_ON_TOP, DESKTOP_LYRIC_PAUSE_HIDE } from '@common/constants'

export const minWidth = 360
export const minHeight = 116


// const updateBounds = (bounds: Bounds) => {
//   bounds.x = bounds.x
//   return bounds
// }

/**
 *
 * @param bounds 当前设置
 * @param param 新设置（相对于当前设置）
 * @returns
 */
export const getLyricWindowBounds = (bounds: Electron.Rectangle, { x, y, w, h }: Rain.DesktopLyric.NewBounds): Electron.Rectangle => {
  if (w < minWidth) w = minWidth
  h = minHeight

  if (global.rain.appSetting['desktopLyric.isLockScreen']) {
    if (!global.envParams.workAreaSize) return bounds
    const maxWinW = global.envParams.workAreaSize.width
    const maxWinH = global.envParams.workAreaSize.height

    if (w > maxWinW) w = maxWinW
    if (h > maxWinH) h = maxWinH

    const maxX = global.envParams.workAreaSize.width - w
    const maxY = global.envParams.workAreaSize.height - h

    x += bounds.x
    y += bounds.y

    if (x > maxX) x = maxX
    else if (x < 0) x = 0

    if (y > maxY) y = maxY
    else if (y < 0) y = 0
  } else {
    y += bounds.y
    x += bounds.x
  }

  // console.log('util bounds', bounds)
  return { width: w, height: h, x, y }
}


export const watchConfigKeys = [
  'desktopLyric.enable',
  'desktopLyric.isLock',
  'desktopLyric.isAlwaysOnTopLoop',
  'desktopLyric.isShowTaskbar',
  'desktopLyric.audioVisualization',
  'desktopLyric.width',
  'desktopLyric.height',
  'desktopLyric.x',
  'desktopLyric.y',
  'desktopLyric.isLockScreen',
  'desktopLyric.isDelayScroll',
  'desktopLyric.scrollAlign',
  'desktopLyric.isHoverHide',
  'desktopLyric.direction',
  'desktopLyric.style.align',
  'desktopLyric.style.lyricUnplayColor',
  'desktopLyric.style.lyricPlayedColor',
  'desktopLyric.style.lyricShadowColor',
  'desktopLyric.style.font',
  'desktopLyric.style.fontSize',
  'desktopLyric.style.lineGap',
  // 'desktopLyric.style.fontWeight',
  'desktopLyric.style.opacity',
  'desktopLyric.style.ellipsis',
  'desktopLyric.style.isFontWeightFont',
  'desktopLyric.style.isFontWeightLine',
  'desktopLyric.style.isFontWeightExtended',
  'desktopLyric.style.isZoomActiveLrc',
  'common.langId',
  'player.playbackRate',
] satisfies Array<keyof Rain.AppSetting>

// 已从设置页移除、行为固定的键：
// 用户配置里 `desktopLyric.isAlwaysOnTop` / `desktopLyric.pauseHide` 已不存在，
// 但歌词窗口仍然需要这两个值，因此这里在打包配置时直接补上固定常量
// （键的位置保持不变，避免改变 IPC 消息里键的顺序）。
const fixedLyricConfig: Partial<Rain.DesktopLyric.Config> = {
  'desktopLyric.isAlwaysOnTop': DESKTOP_LYRIC_ALWAYS_ON_TOP,
  'desktopLyric.pauseHide': DESKTOP_LYRIC_PAUSE_HIDE,
}

export const buildLyricConfig = (appSetting: Partial<Rain.AppSetting>): Partial<Rain.DesktopLyric.Config> => {
  const setting: Partial<Rain.DesktopLyric.Config> = { ...fixedLyricConfig }
  for (const key of watchConfigKeys) {
    // @ts-expect-error
    if (key in appSetting) setting[key] = appSetting[key]
  }
  return setting
}

export const initWindowSize = (x: Rain.AppSetting['desktopLyric.x'], y: Rain.AppSetting['desktopLyric.y'], width: Rain.AppSetting['desktopLyric.width'], height: Rain.AppSetting['desktopLyric.height']) => {
  if (x == null || y == null) {
    if (width < minWidth) width = minWidth
    if (height < minHeight) height = minHeight
    if (global.envParams.workAreaSize) {
      x = global.envParams.workAreaSize.width - width
      y = global.envParams.workAreaSize.height - height
    } else {
      x = y = 0
    }
  } else {
    let bounds = getLyricWindowBounds({ x, y, width, height }, { x: 0, y: 0, w: width, h: height })
    x = bounds.x
    y = bounds.y
    width = bounds.width
    height = bounds.height
  }
  return {
    x,
    y,
    width,
    height,
  }
}
