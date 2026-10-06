import type {} from '../types/bridge'

type RemoveListener = () => void
type Listener<T> = (payload: { params: T }) => void

export const getSetting = async() => window.lyricBridge.getSetting()
export const updateSetting = async(setting: Partial<Rain.DesktopLyric.Config>) => window.lyricBridge.updateSetting(setting)
export const onSettingChanged = (listener: Listener<Partial<Rain.DesktopLyric.Config>>): RemoveListener => {
  return window.lyricBridge.onSettingChanged(params => { listener({ params }) })
}
export const setWindowBounds = (bounds: Rain.DesktopLyric.NewBounds) => { window.lyricBridge.setWindowBounds(bounds) }
let previousResizable: boolean | null = null
export const setWindowResizeable = (resizable: boolean) => {
  if (previousResizable === resizable) return
  previousResizable = resizable
  // https://github.com/electron/electron/issues/48352
  // Resizing remains disabled to avoid the Electron transparency regression.
}

export const sendConnectMainWindowEvent = () => { window.lyricBridge.requestMainWindowChannel() }
export const onProvideMainWindowChannel = (listener: (port: MessagePort) => void): RemoveListener => {
  const wrapped = (event: MessageEvent) => {
    if (event.source !== window || event.data?.type !== 'rain-lyric-main-window-channel' || event.ports.length !== 1) return
    listener(event.ports[0])
  }
  window.addEventListener('message', wrapped)
  return () => { window.removeEventListener('message', wrapped) }
}
export const onMainWindowInited = (listener: () => void): RemoveListener => window.lyricBridge.onMainWindowInited(listener)
export const sendMouseEnterLeave = (isEnter: boolean) => { window.lyricBridge.setMouseInWindow(isEnter) }
export const onMouseEnterLeave = (listener: Listener<boolean>): RemoveListener => {
  return window.lyricBridge.onMouseEnterLeave(params => { listener({ params }) })
}
export const onThemeChange = (listener: Listener<Rain.ThemeSetting>): RemoveListener => {
  return window.lyricBridge.onThemeChange(params => { listener({ params }) })
}
