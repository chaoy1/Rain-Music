import { appSetting, setTogglePlayMode } from '@renderer/store/setting'
import {
  computed,
} from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'

const playNextModes = ['list', 'listLoop', 'singleLoop', 'random'] as const

export default () => {
  const t = useI18n()
  const nextTogglePlayName = computed(() => {
    switch (appSetting['player.togglePlayMethod']) {
      case 'listLoop': return t('player__play_toggle_mode_list_loop')
      case 'random': return t('player__play_toggle_mode_random')
      case 'singleLoop': return t('player__play_toggle_mode_single_loop')
      case 'list': return t('player__play_toggle_mode_list')
      default: return t('player__play_toggle_mode_list_loop')
    }
  })

  const toggleNextPlayMode = (mode?: typeof playNextModes[number]) => {
    const index = playNextModes.findIndex(mode => mode === appSetting['player.togglePlayMethod'])
    const next = mode ?? playNextModes[(index + 1) % playNextModes.length]
    if (next === appSetting['player.togglePlayMethod']) return
    // Advance immediately so successive clicks do not depend on IPC latency.
    appSetting['player.togglePlayMethod'] = next
    setTogglePlayMode(next)
  }

  return {
    nextTogglePlayName,
    toggleNextPlayMode,
  }
}
