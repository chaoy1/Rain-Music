import { contextBridge, ipcRenderer } from 'electron'
import { CMMON_EVENT_NAME, WIN_LYRIC_RENDERER_EVENT_NAME as channels } from '@common/ipcNames'
import type { LyricBridge } from '../../../renderer-lyric/types/bridge'

// Only settings that can be changed by the lyric window's controls are writable.
// 「desktopLyric.isAlwaysOnTop」已固定为 true，歌词窗口不再有对应控件，故从可写集合中移除。
const booleanSettings = new Set([
  'desktopLyric.enable',
  'desktopLyric.isLock',
  'desktopLyric.style.isZoomActiveLrc',
])
const validateSetting = (setting: Partial<Rain.DesktopLyric.Config>) => {
  if (!setting || typeof setting !== 'object' || Array.isArray(setting)) throw new TypeError('Invalid lyric setting')
  for (const [key, value] of Object.entries(setting)) {
    if (booleanSettings.has(key) && typeof value === 'boolean') continue
    if (key === 'desktopLyric.style.fontSize' && typeof value === 'number' && Number.isFinite(value) && value >= 10 && value <= 80) continue
    if (key === 'desktopLyric.style.opacity' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) continue
    throw new TypeError('Invalid lyric setting')
  }
}
const subscribe = <T>(channel: string, listener: (params: T) => void): (() => void) => {
  if (typeof listener !== 'function') throw new TypeError('Invalid lyric listener')
  const wrapped = (_event: Electron.IpcRendererEvent, params: T) => { listener(params) }
  ipcRenderer.on(channel, wrapped)
  let active = true
  return () => {
    if (!active) return
    active = false
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const bridge: LyricBridge = {
  getSetting: async() => ipcRenderer.invoke(channels.get_config),
  updateSetting: async(setting) => {
    validateSetting(setting)
    return ipcRenderer.invoke(channels.set_config, setting)
  },
  setWindowBounds: (bounds) => {
    if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds) || Object.keys(bounds).length !== 4 ||
      !['x', 'y', 'w', 'h'].every(key => Object.prototype.hasOwnProperty.call(bounds, key) && typeof bounds[key as keyof typeof bounds] === 'number' && Number.isFinite(bounds[key as keyof typeof bounds])) ||
      bounds.w <= 0 || bounds.h <= 0 || Math.abs(bounds.x) > 100000 || Math.abs(bounds.y) > 100000 || bounds.w > 100000 || bounds.h > 100000) throw new TypeError('Invalid lyric bounds')
    ipcRenderer.send(channels.set_win_bounds, bounds)
  },
  requestMainWindowChannel: () => { ipcRenderer.send(channels.request_main_window_channel) },
  setMouseInWindow: (isEnter) => {
    if (typeof isEnter !== 'boolean') throw new TypeError('Invalid lyric mouse state')
    ipcRenderer.send(channels.mouse_enter_leave, isEnter)
  },
  onSettingChanged: listener => subscribe(channels.on_config_change, listener),
  onMainWindowInited: listener => subscribe(channels.main_window_inited, () => { listener() }),
  onMouseEnterLeave: listener => subscribe(channels.mouse_enter_leave, listener),
  onThemeChange: listener => subscribe(CMMON_EVENT_NAME.theme_change, listener),
}

// MessagePorts cannot pass through contextBridge. Transfer only the dedicated
// lyric channel to the main world, without exposing the Electron event.
ipcRenderer.on(channels.provide_main_window_channel, (event) => {
  const [port] = event.ports
  if (!port) return
  window.postMessage({ type: 'rain-lyric-main-window-channel' }, '*', [port])
})
contextBridge.exposeInMainWorld('lyricBridge', bridge)
