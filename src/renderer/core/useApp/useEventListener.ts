import {
  onFocus,
  onSettingChanged,
  onThemeChange,
  openDevTools,
  setFullScreen,
  getFullScreen,
  onFullscreenChanged,
  showHideWindowToggle,
} from '@renderer/utils/ipc'
import {
  isFullscreen,
  themeId,
  themeShouldUseDarkColors,
} from '@renderer/store'
import {
  appSetting,
  mergeSetting,
} from '@renderer/store/setting'

import {
  onBeforeUnmount,
  watch,
} from '@common/utils/vueTools'
// import { isLinux, isProd } from '@common/utils'
import { openUrl } from '@common/utils/electron'
import { HOTKEY_COMMON } from '@common/hotKey'
import { clearDownKeys } from '@renderer/event'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import { setShowPlayerDetail } from '@renderer/store/player/action'

const handle_key_down = ({ event, type, key }: Rain.KeyDownEevent) => {
  // console.log(key)
  if (key != 'escape' || !event || event.repeat || type == 'up' || window.rain.isEditingHotKey || (event.target as HTMLElement)?.classList.contains('ignore-esc') || event.rain_handled) return
  if ((event.target as HTMLElement).tagName != 'INPUT') {
    if (isShowPlayerDetail.value) {
      event.rain_handled = true
      setShowPlayerDetail(false)
      return
    }
    if (isFullscreen.value) {
      event.rain_handled = true
      void setFullScreen(false).then(fullscreen => {
        isFullscreen.value = fullscreen
      })
    }
    return
  }
  (event.target as HTMLInputElement).value = ''
  ;(event.target as HTMLInputElement).blur()
  event.rain_handled = true
}

const handleBodyClick = (event: MouseEvent) => {
  if ((event?.target as HTMLElement)?.tagName != 'A') return
  if ((event?.target as HTMLAnchorElement).host == window.location.host) return
  event.preventDefault()
  if (/^https?:\/\//.test((event?.target as HTMLAnchorElement).href)) void openUrl((event?.target as HTMLAnchorElement).href)
}
const handle_open_devtools = () => {
  openDevTools()
}
const handle_fullscreen = (event: Rain.KeyDownEevent) => {
  let fullscreen = !isFullscreen.value
  if (typeof event == 'boolean') {
    fullscreen = event
  } else if (event.event?.repeat) return
  void setFullScreen(fullscreen).then(fullscreen => {
    isFullscreen.value = fullscreen
  })
}
const handle_selection = (event: Rain.KeyDownEevent) => {
  event.event?.preventDefault()
}

export default () => {
  watch(isFullscreen, val => {
    if (val) {
      document.documentElement.classList.remove(window.dt ? 'disableTransparent' : 'transparent')
      document.documentElement.classList.add('fullscreen')
    } else {
      document.documentElement.classList.remove('fullscreen')
      document.documentElement.classList.add(window.dt ? 'disableTransparent' : 'transparent')
    }
    // Fullscreen changes the available space, not the user's preferred UI scale.
    document.documentElement.style.fontSize = `${appSetting['common.fontSize']}px`
  }, {
    immediate: true,
  })

  // common.isShowAnimation 设置项已移除，行为固定为「显示动画」，
  // 因此这里不再往 <html> 上加 disableAnimation 类。

  const rSetConfig = onSettingChanged(({ params: setting }) => {
    // console.log(config)
    mergeSetting(setting)
    window.app_event.configUpdate(setting)
  })

  const rFocus = onFocus(() => {
    clearDownKeys()
  })
  const rFullscreen = onFullscreenChanged(fullscreen => { isFullscreen.value = fullscreen })
  void getFullScreen().then(fullscreen => { isFullscreen.value = fullscreen }).catch(console.error)

  const rThemeChange = onThemeChange(({ params: setting }) => {
    themeShouldUseDarkColors.value = setting.shouldUseDarkColors
    themeId.value = setting.theme.id
    // The main process resolves auto/custom themes and sends their final colors.
    // Apply every notification, including edits that keep the same theme ID.
    document.documentElement.classList.toggle('dark', setting.theme.isDark)
    document.documentElement.style.colorScheme = setting.theme.isDark ? 'dark' : 'light'
    window.setTheme(setting.theme.colors)
  })

  // 可配置的快捷键动作已收窄为「显示/隐藏程序」一项（见 src/common/hotKey.ts）
  window.key_event.on(HOTKEY_COMMON.hide_toggle.action, showHideWindowToggle)

  window.app_event.on('keyDown', handle_key_down)
  window.key_event.on('key_mod+f12_down', handle_open_devtools)
  window.key_event.on('key_f11_down', handle_fullscreen)
  window.key_event.on('key_mod+a_down', handle_selection)
  document.body.addEventListener('click', handleBodyClick, true)

  onBeforeUnmount(() => {
    window.key_event.off(HOTKEY_COMMON.hide_toggle.action, showHideWindowToggle)

    window.app_event.off('keyDown', handle_key_down)
    window.key_event.off('key_mod+f12_down', handle_open_devtools)
    window.key_event.off('key_f11_down', handle_fullscreen)
    window.key_event.off('key_mod+a_down', handle_selection)
    document.body.removeEventListener('click', handleBodyClick)
    rSetConfig()
    rFocus()
    rFullscreen()
    rThemeChange()
  })
}
