import initRendererEvent, { sendMainWindowInitedEvent } from './rendererEvent'
import { setLrcConfig } from './config'
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

  // 注：原先这里处理桌面歌词相关的全局快捷键（开/关歌词、锁定、置顶）。
  // 这些动作已从可配置动作集合里移除（只剩四项，见 src/common/hotKey.ts），
  // 因此该 hot_key_down 分支一并删除。
}
export * from './main'
export * from './rendererEvent'

// export {
//   EVENT_NAMES,
// }
