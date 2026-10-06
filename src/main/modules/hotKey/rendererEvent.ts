import { HOTKEY_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { getHotKeyRegisterFailList, init, registerHotkey, unRegisterHotkey, unRegisterHotkeyAll } from './utils'


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

  // 导入设置时应用快捷键配置：
  // 1. 立即写入内存配置（saveAppHotKeyConfig 有 100ms 节流，不先写入的话后面 init() 会按旧配置注册）
  // 2. 沿用既有流程持久化到 hotKey store，并通知渲染进程更新 window.rain.appHotKeyConfig
  // 3. 复用既有 init() 重新注册全局快捷键，并把注册失败的按键列表回传渲染进程
  mainHandle<Rain.HotKeyConfigAll, Rain.HotKeyRegisterFailInfo[]>(HOTKEY_RENDERER_EVENT_NAME.apply_config, async({ params }) => {
    global.rain.hotKey.config.local = params.local
    global.rain.hotKey.config.global = params.global
    // 与设置页切换「启用快捷键」的行为保持一致（global.rain.hotKey.enable 控制按键是否响应）
    global.rain.hotKey.enable = params.global.enable
    global.rain.event_app.hot_key_config_update(params)
    init()
    return getHotKeyRegisterFailList()
  })

  init()
}
