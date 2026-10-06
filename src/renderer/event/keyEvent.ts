import keyBind from '../utils/keyBind'
import Event from './Event'

declare class keyEventTypes extends Event {
  on(event: string, listener: (event: Rain.KeyDownEevent) => any): void
  off(event: string, listener: (event: Rain.KeyDownEevent) => any): void
}

export type KeyEventTypes = keyEventTypes

export const createKeyEventHub = (): keyEventTypes => {
  return new Event()
}

window.rain.isEditingHotKey = false
// let appHotKeyConfig: Rain.HotKeyConfigAll = window.rain.appHotKeyConfig

export const registerKeyEvent = () => {
  keyBind.bindKey((key, eventKey, type, event, keys, isEditing) => {
    // console.log(`key_${key}_${type}`)
    window.app_event.keyDown({ event, keys, key, eventKey, type })
    // console.log(event, key)
    // console.log(key, eventKey, type, event, keys)
    if (window.rain.isEditingHotKey || (isEditing && type == 'down') || event?.rain_handled) return
    if (event && window.rain.appHotKeyConfig.local.enable && window.rain.appHotKeyConfig.local.keys[key] && (key != 'escape' || !((event.target as HTMLElement).classList.contains('ignore-esc')))) {
      // console.log(key, eventKey, type, keys, isEditing)
      event.preventDefault()
      if (type == 'up') return

      // 注：原先「软件内快捷键的最小化触发时改为隐藏程序」的特判已随
      // common_min 动作一并移除（可配置动作只剩四项，见 src/common/hotKey.ts）

      window.key_event.emit(window.rain.appHotKeyConfig.local.keys[key].action)
      return
    }
    // console.log(`key_${key}_${type}`)
    window.key_event.emit(`key_${key}_${type}`, { event, keys, key, eventKey, type })
    if (key != eventKey) window.key_event.emit(`key_${eventKey}_${type}`, { event, keys, key, eventKey, type })
  })
}

export const unregisterKeyEvent = () => {
  keyBind.unbindKey()
}

export const clearDownKeys = () => {
  keyBind.clearDownKeys()
}
