import { HOTKEY_PLAYER, HOTKEY_COMMON } from './hotKey'

const local: Rain.HotKeyConfig = {
  enable: true,
  keys: {
    'mod+f5': {
      type: HOTKEY_PLAYER.toggle_play.type,
      name: HOTKEY_PLAYER.toggle_play.name,
      action: HOTKEY_PLAYER.toggle_play.action,
    },
    'mod+arrowleft': {
      type: HOTKEY_PLAYER.prev.type,
      name: HOTKEY_PLAYER.prev.name,
      action: HOTKEY_PLAYER.prev.action,
    },
    'mod+arrowright': {
      type: HOTKEY_PLAYER.next.type,
      name: HOTKEY_PLAYER.next.name,
      action: HOTKEY_PLAYER.next.action,
    },
  },
}

const global: Rain.HotKeyConfig = {
  enable: false,
  keys: {
    'mod+alt+f5': {
      type: HOTKEY_PLAYER.toggle_play.type,
      name: HOTKEY_PLAYER.toggle_play.name,
      action: HOTKEY_PLAYER.toggle_play.action,
    },
    'mod+alt+arrowleft': {
      type: HOTKEY_PLAYER.prev.type,
      name: HOTKEY_PLAYER.prev.name,
      action: HOTKEY_PLAYER.prev.action,
    },
    'mod+alt+arrowright': {
      type: HOTKEY_PLAYER.next.type,
      name: HOTKEY_PLAYER.next.name,
      action: HOTKEY_PLAYER.next.action,
    },
    'mod+alt+arrowup': {
      type: HOTKEY_COMMON.hide_toggle.type,
      name: HOTKEY_COMMON.hide_toggle.name,
      action: HOTKEY_COMMON.hide_toggle.action,
    },
  },
}

export default {
  local,
  global,
}
