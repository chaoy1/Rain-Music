export interface LyricBridge {
  getSetting: () => Promise<Rain.DesktopLyric.Config>
  updateSetting: (setting: Partial<Rain.DesktopLyric.Config>) => Promise<void>
  setWindowBounds: (bounds: Rain.DesktopLyric.NewBounds) => void
  requestMainWindowChannel: () => void
  setMouseInWindow: (isEnter: boolean) => void
  onSettingChanged: (listener: (setting: Partial<Rain.DesktopLyric.Config>) => void) => () => void
  onMainWindowInited: (listener: () => void) => () => void
  onMouseEnterLeave: (listener: (isEnter: boolean) => void) => () => void
  onThemeChange: (listener: (theme: Rain.ThemeSetting) => void) => () => void
}

declare global {
  interface Window {
    lyricBridge: LyricBridge
  }
}
