import { globalShortcut } from 'electron'
import { log } from '@common/utils'

export const handleKeyDown = (key: string) => {
  if (!global.rain.hotKey.enable) return
  global.rain.event_app.hot_key_down({ type: 'global', key })
}

const transformedKeyRxp = /(^|\+)[a-z]/g

export const transformedKey = (key: string): string => {
  if (key.includes('arrow')) key = key.replace(/arrow/g, '')
  return key.replace('mod', 'CommandOrControl').replace(transformedKeyRxp, l => l.toUpperCase())
}

export const registerHotkey = ({ key, info }: Rain.RegisterKeyInfo): boolean => {
  let targetKey = global.rain.hotKey.state.get(key)
  if (targetKey?.status) return true
  const transKey = transformedKey(key)
  // console.log('Register key:', transKey)
  if (targetKey) {
    targetKey.info = info
  } else {
    targetKey = {
      status: false,
      info,
    }
    global.rain.hotKey.state.set(key, targetKey)
  }
  const status = targetKey.status = globalShortcut.isRegistered(transKey)
    ? false
    : globalShortcut.register(transKey, () => {
      handleKeyDown(key)
    })
  return status
}

export const unRegisterHotkey = (key: string) => {
  let transKey = transformedKey(key)
  // console.log('Unregister key:', transKey)
  globalShortcut.unregister(transKey)
  global.rain.hotKey.state.delete(key)
}

export const unRegisterHotkeyAll = () => {
  global.rain.hotKey.state.clear()
  globalShortcut.unregisterAll()
}


const handleRegisterHotkey = (data: Rain.RegisterKeyInfo) => {
  let ret = registerHotkey(data)
  if (!ret) log.info('Register hot key failed:', data.key)
}


export const init = (isForce = false) => {
  unRegisterHotkeyAll()
  if (!isForce && !global.rain.hotKey.config.global.enable) return
  // global.rain.hotKey.state = {}
  // console.log(global.rain.hotKey.config.global.keys)
  for (const key of Object.keys(global.rain.hotKey.config.global.keys)) {
    try {
      handleRegisterHotkey({ key, info: global.rain.hotKey.config.global.keys[key] })
    } catch (err) {
      log.info(err)
    }
  }
}

/**
 * 获取最近一次注册后仍处于注册失败的全局快捷键列表
 * （init() 会重建 global.rain.hotKey.state，status 为 false 即注册失败，
 * 通常是该按键已被系统或其它程序占用）
 */
export const getHotKeyRegisterFailList = (): Rain.HotKeyRegisterFailInfo[] => {
  const failList: Rain.HotKeyRegisterFailInfo[] = []
  for (const [key, item] of global.rain.hotKey.state) {
    if (item.status) continue
    failList.push({
      key,
      name: item.info?.name ?? '',
      action: item.info?.action ?? '',
    })
  }
  return failList
}
