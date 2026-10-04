import { HOTKEY_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { init, registerHotkey, unRegisterHotkey, unRegisterHotkeyAll } from './utils'


export default () => {
  mainHandle<Rain.HotKeyActions, boolean>(HOTKEY_RENDERER_EVENT_NAME.set_config, async({ params }) => {
    switch (params.action) {
      case 'config':
        // global.rain.event_app.saveConfig(data, source)
        global.rain.event_app.hot_key_config_update(params.data)
        return true
      case 'enable':
        global.rain.hotKey.enable = params.data
        params.data ? init(true) : unRegisterHotkeyAll()
        return true
      case 'register':
        return registerHotkey(params.data)
      case 'unregister':
        unRegisterHotkey(params.data)
        return true
    }
  })

  mainHandle<Rain.HotKeyState>(HOTKEY_RENDERER_EVENT_NAME.status, async() => global.rain.hotKey.state)

  mainHandle<boolean>(HOTKEY_RENDERER_EVENT_NAME.enable, async({ params: flag }) => {
    flag ? init() : unRegisterHotkeyAll()
  })

  init()
}
