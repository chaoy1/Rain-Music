import { APP_EVENT_NAMES } from './constants'


const keyName = {
  common: APP_EVENT_NAMES.winMainName,
  player: APP_EVENT_NAMES.winMainName,
}

// 可配置的快捷键动作已收窄为四个：
//   播放/暂停（player_toggle_play）、上一曲（player_prev）、下一曲（player_next）、
//   显示/隐藏程序（common_toggle_hide）
// 其余动作（最小化、退出、聚焦搜索框、快进/快退、音量、不喜欢、
// 桌面歌词相关）已从设置页移除，主进程与渲染进程里对应的处理分支也一并删除。
const hotKey = {
  common: {
    hide_toggle: {
      name: 'toggle_hide',
      action: 'toggle_hide',
      type: '',
    },
  },
  player: {
    toggle_play: {
      name: 'toggle_play',
      action: 'toggle_play',
      type: '',
    },
    next: {
      name: 'next',
      action: 'next',
      type: '',
    },
    prev: {
      name: 'prev',
      action: 'prev',
      type: '',
    },
  },
}

for (const type of Object.keys(hotKey) as Array<keyof typeof hotKey>) {
  let keys = hotKey[type]
  for (const key of Object.keys(keys) as Array<keyof typeof keys>) {
    const keyInfo: Rain.HotKey = keys[key]
    keyInfo.action = `${type}_${keyInfo.action}`
    keyInfo.name = `${type}_${keyInfo.name}`
    keyInfo.type = keyName[type] as keyof typeof hotKey
  }
}

export const HOTKEY_COMMON = hotKey.common
export const HOTKEY_PLAYER = hotKey.player
