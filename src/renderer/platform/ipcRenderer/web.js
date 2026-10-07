/**
 * Web / Capacitor（Android WebView）"裸 `ipcRenderer`"的**占位实现**（Android 移植 · 阶段 3 / 线 D）。
 *
 * 与 `src/common/platform/ipcBridge/web.js` 同一策略：**访问属性即抛错**，
 * 而不是返回空实现 —— 空实现会让 `onFullscreenChanged()` 静默失效，
 * 页面看起来一切正常但全屏事件永远不来，这正是"把问题藏起来"。
 *
 * 为什么用 `Proxy` 而不是逐方法抛：`ipcRenderer` 是 **Electron 的类型**
 * （`Electron.IpcRenderer`，有 `send` / `sendSync` / `invoke` / `on` / `once` /
 * `removeListener` / `removeAllListeners` / `addListener` / `listenerCount` /
 * `postMessage` … 十几条），逐条重写只会让它和 Electron 的真实接口越漂越远。
 * `Proxy` 保证"任何一条被用到都会立刻、明确地报出同一句话"。
 *
 * ⚠️ 本文件**只存在于 web / Capacitor 产物**（构建期 `NormalModuleReplacementPlugin`
 * 替换，见 `build-config/renderer/webpack.config.web.js` 的"关键差异 4.8"）。
 */
'use strict'

/** @type {string} */
const NOT_IMPLEMENTED =
  'Rain Music Android: 渲染层仍在直接使用 Electron 的 ipcRenderer' +
  '（src/renderer/platform/ipcRenderer/web.js 占位实现）。' +
  'Capacitor WebView 没有 ipcRenderer，需要原生侧提供等价通道；' +
  '建议改为走 src/common/platform/ipcBridge 的收口契约（见 docs/android/ipc-contract.md）。'

export const rawIpcRenderer = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'then' || prop === 'toJSON' || prop === Symbol.toStringTag) return undefined
    throw new Error(`${NOT_IMPLEMENTED} 被访问的属性：ipcRenderer.${String(prop)}`)
  },
})
