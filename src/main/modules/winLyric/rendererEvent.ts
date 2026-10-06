import { registerRendererEvents as common } from '@main/modules/commonRenderers/common'
import { mainOn, mainHandle } from '@common/mainIpc'
import { WIN_LYRIC_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { buildLyricConfig, getLyricWindowBounds } from './utils'
import { sendNewDesktopLyricClient } from '@main/modules/winMain'
import { getBounds, getMainFrame, sendEvent, setBounds, setResizeable } from './main'
import { MessageChannelMain } from 'electron'
import { mouseCheckTools } from './mouseCheckTools'

const isLyricMainFrame = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
  const frame = getMainFrame()
  return frame != null && event.senderFrame === frame
}

export default () => {
  // mainOn(WIN_LYRIC_RENDERER_EVENT_NAME.get_lyric_info, ({ params: action }) => {
  //   sendMainEvent(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_info, {
  //     name: WIN_LYRIC_RENDERER_EVENT_NAME.set_lyric_info,
  //     modal: 'lyricWindow',
  //     action,
  //   })
  // })
  common(sendEvent)

  mainHandle<Partial<Rain.AppSetting>>(WIN_LYRIC_RENDERER_EVENT_NAME.set_config, async({ event, params: config }) => {
    if (!isLyricMainFrame(event)) return
    global.rain.event_app.update_config(config)
  })

  // 非本窗口主 frame 的调用一律返回 undefined（见 tests/unit/lyric-ipc-trust.test.cjs），
  // 因此取值类型必须带上 undefined；参数需显式标注，否则会被第一个重载
  // 上下文推断成带 params 的形式而无法匹配返回值的重载。
  mainHandle<Rain.DesktopLyric.Config | undefined>(WIN_LYRIC_RENDERER_EVENT_NAME.get_config, async({ event }: Rain.IpcMainInvokeEvent) => {
    if (!isLyricMainFrame(event)) return
    return buildLyricConfig(global.rain.appSetting) as Rain.DesktopLyric.Config
  })

  mainOn<Rain.DesktopLyric.NewBounds>(WIN_LYRIC_RENDERER_EVENT_NAME.set_win_bounds, ({ event, params: options }) => {
    if (!isLyricMainFrame(event)) return
    setBounds(getLyricWindowBounds(getBounds()!, options))
  })

  mainOn<boolean>(WIN_LYRIC_RENDERER_EVENT_NAME.set_win_resizeable, ({ event, params: resizable }) => {
    if (!isLyricMainFrame(event)) return
    setResizeable(resizable)
  })

  mainOn(WIN_LYRIC_RENDERER_EVENT_NAME.request_main_window_channel, ({ event }) => {
    if (!isLyricMainFrame(event)) return
    // Create a new channel ...
    const { port1, port2 } = new MessageChannelMain()
    // ... send one end to the worker ...
    sendNewDesktopLyricClient(port1)
    // ... and the other end to the main window.
    event.senderFrame?.postMessage(WIN_LYRIC_RENDERER_EVENT_NAME.provide_main_window_channel, null, [port2])
    // Now the main window and the worker can communicate with each other
    // without going through the main process!
    console.log('request_main_window_channel')
  })

  mainOn<boolean>(WIN_LYRIC_RENDERER_EVENT_NAME.mouse_enter_leave, ({ event, params: isEnter }) => {
    if (!isLyricMainFrame(event)) return
    if (isEnter) {
      mouseCheckTools.setMouseInWindow(true)
      mouseCheckTools.runCheck(sendMouseLeave)
    } else {
      mouseCheckTools.setMouseInWindow(false)
      mouseCheckTools.cacnelCheck()
    }
  })
}

export const sendConfigChange = (setting: Partial<Rain.DesktopLyric.Config>) => {
  sendEvent(WIN_LYRIC_RENDERER_EVENT_NAME.on_config_change, setting)
}

export const sendMainWindowInitedEvent = () => {
  sendEvent(WIN_LYRIC_RENDERER_EVENT_NAME.main_window_inited)
}

export const sendMouseLeave = () => {
  sendEvent(WIN_LYRIC_RENDERER_EVENT_NAME.mouse_enter_leave, false)
}
