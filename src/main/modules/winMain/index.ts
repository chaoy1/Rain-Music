import initRendererEvent, { handleKeyDown, hotKeyConfigUpdate } from './rendererEvent'

import { APP_EVENT_NAMES } from '@common/constants'
import { createWindow, autoCleanResourceCache, setThumbarButtons, toggleHide } from './main'
import { HOTKEY_COMMON } from '@common/hotKey'

export default () => {
  initRendererEvent()

  global.rain.event_app.on('hot_key_down', ({ type, key }) => {
    let info = global.rain.hotKey.config.global.keys[key]
    if (info?.type != APP_EVENT_NAMES.winMainName) return
    switch (info.action) {
      // 可配置的动作只剩四项，这里只处理需要在主进程本地响应的「显示/隐藏程序」
      case HOTKEY_COMMON.hide_toggle.action:
        toggleHide()
        break
      default:
        handleKeyDown(type, key)
        break
    }
  })
  global.rain.event_app.on('hot_key_config_update', (config) => {
    hotKeyConfigUpdate(config)
  })

  global.rain.event_app.on('app_inited', () => {
    createWindow()
    // 资源缓存自动清理（common.resourceCacheAutoCleanSize，0 表示关闭）：
    // 启动时检查一次缓存大小，超过阈值就执行与设置页「清理资源缓存」相同的清理。
    void autoCleanResourceCache().catch(err => { console.error(err) })
  })

  const taskBarButtonFlags: Rain.TaskBarButtonFlags = {
    empty: true,
    play: false,
    next: true,
    prev: true,
  }
  // 「在任务栏上显示当前歌曲播放进度」设置项已移除，行为固定为不显示（SHOW_TASK_PROGRESS = false），
  // 因此这里不再调用 setProgressBar，也不再监听配置变更。
  global.rain.event_app.on('player_status', (status) => {
    if (status.status) {
      switch (status.status) {
        case 'paused':
          taskBarButtonFlags.play = false
          taskBarButtonFlags.empty &&= false
          break
        case 'error':
          taskBarButtonFlags.play = false
          taskBarButtonFlags.empty &&= false
          break
        case 'playing':
          taskBarButtonFlags.play = true
          taskBarButtonFlags.empty &&= false
          break
        case 'stoped':
          taskBarButtonFlags.play &&= false
          taskBarButtonFlags.empty = true
          break
      }
    }
    if (status.status != null) {
      setThumbarButtons(taskBarButtonFlags)
    }
  })
}

export * from './main'
export * from './rendererEvent'

