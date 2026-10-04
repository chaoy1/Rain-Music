import { APP_EVENT_NAMES } from '@common/constants'
import initRendererEvent, { sendMainWindowInitedEvent } from './rendererEvent'
import { setLrcConfig } from './config'
import { HOTKEY_DESKTOP_LYRIC } from '@common/hotKey'
import { closeWindow, createWindow, isExistWindow, raiseWindow } from './main'
// import main from './main'
// import { Event, EVENT_NAMES } from './event'

export default () => {
  initRendererEvent()
  // global.rain.event_app.winLyric = new Event()
  // global.app_event.winMain.

  global.rain.event_app.on('main_window_inited', () => {
    if (global.rain.appSetting['desktopLyric.enable']) {
      if (isExistWindow()) sendMainWindowInitedEvent()
      else createWindow()
    }
  })
  global.rain.event_app.on('updated_config', (keys, setting) => {
    setLrcConfig(keys, setting)
  })
  global.rain.event_app.on('main_window_close', () => {
    closeWindow()
  })
  global.rain.event_app.on('main_window_fullscreen', raiseWindow)
  global.rain.event_app.on('main_window_focus', raiseWindow)
  global.rain.event_app.on('main_window_show', raiseWindow)


  // global.rain_event.mainWindow.on(MAIN_WINDOW_EVENT_NAME.setLyricInfo, info => {
  //   if (!global.modules.lyricWindow) return
  //   mainSend(global.modules.lyricWindow, ipcWinLyricNames.set_lyric_info, info)
  // })

  global.rain.event_app.on('hot_key_down', ({ type, key }) => {
    let info = global.rain.hotKey.config.global.keys[key]
    if (!info || info.type != APP_EVENT_NAMES.winLyricName) return
    let newSetting: Partial<Rain.AppSetting> = {}
    let settingKey: keyof Rain.AppSetting
    switch (info.action) {
      case HOTKEY_DESKTOP_LYRIC.toggle_visible.action:
        settingKey = 'desktopLyric.enable'
        break
      case HOTKEY_DESKTOP_LYRIC.toggle_lock.action:
        settingKey = 'desktopLyric.isLock'
        break
      case HOTKEY_DESKTOP_LYRIC.toggle_always_top.action:
        settingKey = 'desktopLyric.isAlwaysOnTop'
        break
      default: return
    }
    newSetting[settingKey] = !global.rain.appSetting[settingKey]

    global.rain.event_app.update_config(newSetting)
  })
}
export * from './main'
export * from './rendererEvent'

// export {
//   EVENT_NAMES,
// }
