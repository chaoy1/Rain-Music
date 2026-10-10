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

import { subscribeSkippable } from '@renderer/platform/ipcFallback/subscribe'
import { WIN_MAIN_RENDERER_EVENT_NAME, CMMON_EVENT_NAME } from '@common/ipcNames'
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

/**
 * ── 挂载期"可跳过订阅"（Android 移植 · 阻塞点 #8）───────────────────────────────
 *
 * `App.vue` 的 `setup()` 会同步走到这里（`useApp()` → `useEventListener()`）。下面 4 条
 * `onXxx()` 订阅最终都落到 IPC 传输层：
 * - `onSettingChanged` / `onFocus` / `onThemeChange` → `rendererOn` → `@common/platform/ipcBridge`；
 * - `onFullscreenChanged` → `@renderer/platform/ipcRenderer` 的裸 `ipcRenderer.on`。
 * 这两个 web 侧实现都是**刻意做成"调用/访问即抛错"**的占位实现（见各自文件头注释），
 * 所以它们在本机严格环境（以及真机 Capacitor）上是**同步抛错**：异常一路穿出 `setup()`，
 * Vue 拿不到根组件的 setup 结果 ⇒ `instance.render` 停在 `NOOP` ⇒ 返回空注释 vnode
 * ⇒ `#root` 全白且**没有任何可见报错**。完整因果链、判据与桌面语义保证见
 * `src/renderer/platform/ipcFallback/subscribe.ts` 与
 * `docs/android/web-runtime-blockers.md` 阻塞点 #8。
 *
 * 这里只负责**逐条**把 4 条订阅交给 `subscribeSkippable`，并保留它们的取消订阅函数
 * （`onBeforeUnmount` 会逐条调用；订阅被跳过时是空操作）。
 */

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

  // `winMain_on_config_change` — 契约归类 (A)：设置变更广播，Android 侧必须由原生桥补上。
  const rSetConfig = subscribeSkippable(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, 'A', () => onSettingChanged(({ params: setting }) => {
    // console.log(config)
    mergeSetting(setting)
    window.app_event.configUpdate(setting)
  }))

  // `winMain_focus` — 契约归类 (B)：窗口聚焦是桌面专有语义（Android 是单窗口 WebView）。
  const rFocus = subscribeSkippable(WIN_MAIN_RENDERER_EVENT_NAME.focus, 'B', () => onFocus(() => {
    clearDownKeys()
  }))
  // `winMain_fullscreen_state` — 契约归类 (B)：桌面专有（`ipc-contract.md` §4.2「窗口按钮 / 全屏 / 尺寸」）。
  const rFullscreen = subscribeSkippable(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen_state, 'B', () => onFullscreenChanged(fullscreen => { isFullscreen.value = fullscreen }))
  void getFullScreen().then(fullscreen => { isFullscreen.value = fullscreen }).catch(console.error)

  // `common_theme_change` — 契约归类 (C)：Android 侧改为渲染层自监听
  // `matchMedia('(prefers-color-scheme: dark)')`，桥接层仍需保留同名广播（`ipc-contract.md` §4.3）。
  const rThemeChange = subscribeSkippable(CMMON_EVENT_NAME.theme_change, 'C', () => onThemeChange(({ params: setting }) => {
    themeShouldUseDarkColors.value = setting.shouldUseDarkColors
    themeId.value = setting.theme.id
    // The main process resolves auto/custom themes and sends their final colors.
    // Apply every notification, including edits that keep the same theme ID.
    document.documentElement.classList.toggle('dark', setting.theme.isDark)
    document.documentElement.style.colorScheme = setting.theme.isDark ? 'dark' : 'light'
    window.setTheme(setting.theme.colors)
  }))

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
