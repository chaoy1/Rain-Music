/**
 * 应用初始化主体
 *
 * 由 `index.ts` 在完成「数据目录重定向 + 日志路径固定」之后**动态加载**，
 * 保证这里的模块副作用（尤其是 electron-log、数据库 worker）
 * 不会早于重定向发生。
 */

import '@common/error'
import { isPreviewNoProtocol } from './utils/previewMode'
import {
  initGlobalData,
  initSingleInstanceHandle,
  applyElectronEnvParams,
  registerDeeplink,
  listenerAppEvent,
} from './app'
import { isLinux } from '@common/utils'
import { initAppSetting } from '@main/app'
import registerModules from '@main/modules'

// 初始化应用
const init = () => {
  console.log('init')
  if (process.env.BUILD_WIN7 == 'true') import('./utils/winLegacy')
  void initAppSetting().then(() => {
    registerModules()
    global.rain.event_app.app_inited()
  })
}

export default () => {
  initGlobalData()
  initSingleInstanceHandle()
  applyElectronEnvParams()
  // 预览构建不注册 rainmusic:// 协议，避免向系统注册表写入协议关联
  // （实测该键原本指向官方版安装目录，注册会把对方的协议关联劫持过来）
  if (!isPreviewNoProtocol()) registerDeeplink(init)
  listenerAppEvent(init)

  // https://github.com/electron/electron/issues/16809
  isLinux ? setTimeout(init, 300) : init()
}
