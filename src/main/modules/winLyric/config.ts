import { isLinux } from '@common/utils'
import { closeWindow, createWindow, getBounds, isExistWindow, alwaysOnTopTools, setBounds, setIgnoreMouseEvents, setSkipTaskbar } from './main'
import { sendConfigChange, sendMouseLeave } from './rendererEvent'
import { buildLyricConfig, getLyricWindowBounds, initWindowSize, watchConfigKeys } from './utils'
import { mouseCheckTools } from './mouseCheckTools'

let isLock: boolean
let isEnable: boolean
let isAlwaysOnTopLoop: boolean
let isShowTaskbar: boolean
let isLockScreen: boolean
let isHoverHide: boolean


export const setLrcConfig = (keys: Array<keyof Rain.AppSetting>, setting: Partial<Rain.AppSetting>) => {
  if (!watchConfigKeys.some(key => keys.includes(key))) return

  if (isExistWindow()) {
    sendConfigChange(buildLyricConfig(setting))
    if (keys.includes('desktopLyric.isLock') && isLock != global.rain.appSetting['desktopLyric.isLock']) {
      isLock = global.rain.appSetting['desktopLyric.isLock']
      if (global.rain.appSetting['desktopLyric.isLock']) {
        setIgnoreMouseEvents(true, { forward: !isLinux && global.rain.appSetting['desktopLyric.isHoverHide'] })
        mouseCheckTools.runCheck(sendMouseLeave)
      } else {
        setIgnoreMouseEvents(false, { forward: !isLinux && global.rain.appSetting['desktopLyric.isHoverHide'] })
        mouseCheckTools.cacnelCheck()
      }
    }
    if (keys.includes('desktopLyric.isHoverHide') && isHoverHide != global.rain.appSetting['desktopLyric.isHoverHide']) {
      isHoverHide = global.rain.appSetting['desktopLyric.isHoverHide']
      if (!isLinux) {
        setIgnoreMouseEvents(global.rain.appSetting['desktopLyric.isLock'], { forward: isHoverHide })
        if (isHoverHide) {
          mouseCheckTools.runCheck(sendMouseLeave)
        } else {
          mouseCheckTools.cacnelCheck()
        }
      }
    }
    // 「使歌词总是在其他窗口之上」（desktopLyric.isAlwaysOnTop）已固定为 true，
    // 因此这里不再有该键的变更分支；子项「自动刷新歌词置顶」的开关由下面的分支处理。
    if (keys.includes('desktopLyric.isShowTaskbar') && isShowTaskbar != global.rain.appSetting['desktopLyric.isShowTaskbar']) {
      isShowTaskbar = global.rain.appSetting['desktopLyric.isShowTaskbar']
      setSkipTaskbar(!global.rain.appSetting['desktopLyric.isShowTaskbar'])
    }
    if (keys.includes('desktopLyric.isAlwaysOnTopLoop') && isAlwaysOnTopLoop != global.rain.appSetting['desktopLyric.isAlwaysOnTopLoop']) {
      isAlwaysOnTopLoop = global.rain.appSetting['desktopLyric.isAlwaysOnTopLoop']
      if (isAlwaysOnTopLoop) {
        alwaysOnTopTools.startLoop()
      } else {
        alwaysOnTopTools.clearLoop()
      }
    }
    if (keys.includes('desktopLyric.isLockScreen') && isLockScreen != global.rain.appSetting['desktopLyric.isLockScreen']) {
      isLockScreen = global.rain.appSetting['desktopLyric.isLockScreen']
      if (global.rain.appSetting['desktopLyric.isLockScreen']) {
        setBounds(getLyricWindowBounds(getBounds()!, {
          x: 0,
          y: 0,
          w: global.rain.appSetting['desktopLyric.width'],
          h: global.rain.appSetting['desktopLyric.height'],
        }))
      }
    }
    if (keys.includes('desktopLyric.x') && setting['desktopLyric.x'] == null) {
      setBounds(initWindowSize(
        global.rain.appSetting['desktopLyric.x'],
        global.rain.appSetting['desktopLyric.y'],
        global.rain.appSetting['desktopLyric.width'],
        global.rain.appSetting['desktopLyric.height'],
      ))
    }
  }
  if (keys.includes('desktopLyric.enable') && isEnable != global.rain.appSetting['desktopLyric.enable']) {
    isEnable = global.rain.appSetting['desktopLyric.enable']
    if (global.rain.appSetting['desktopLyric.enable']) {
      createWindow()
    } else {
      alwaysOnTopTools.clearLoop()
      mouseCheckTools.cacnelCheck()
      closeWindow()
    }
  }
}
