/**
 * Web / Capacitor（Android WebView）IPC 传输适配器的**占位实现**（Android 移植 · 阶段 3 / 线 D）。
 *
 * ## 为什么是"抛错"而不是"空实现"
 *
 * Capacitor WebView 里**没有 IPC**：既没有 Electron 主进程，也没有 `ipcRenderer`。
 * Android 侧的等价物是原生桥（`@capacitor/*` 插件 + WebView → Java 的 MessageChannel，
 * 见 `docs/android/ipc-contract.md`），本轮（阶段 3 / 线 D）**只做加载可行性排查**，
 * 不实现任何原生处理器 —— 见 `docs/android/web-runtime-blockers.md` 的
 * "Android 首版必须重写的最小集合"（本文件是那一节 P0 项的一半）。
 *
 * 于是这里有两个选择：
 * 1. 返回 `undefined` / 空对象 / 假的 Promise ⇒ 调用方那句 `ipcRenderer.send(...)`
 *    变成静默 no-op，`getSetting()` 永远 pending，页面**看起来加载成功了但什么都不显示**；
 * 2. 显式抛错 ⇒ 加载期就能看到"这里必须重写"。
 *
 * 选 2，而且刻意**做成 Property 逐个抛**（不是 Proxy 的 `get` 抛）：
 * - 保留具名导出，`tsc` / eslint / IDE 跳转仍然可用；
 * - 抛出的消息里带通道名与调用点，方便阶段 3-5 直接照着这份清单去补原生处理器。
 *
 * ⚠️ 本文件**只存在于 web / Capacitor 产物**（构建期 `NormalModuleReplacementPlugin` 替换，
 * 见 `build-config/renderer/webpack.config.web.js` 的"关键差异 4.7"）。
 * 桌面 bundle 里既没有本文件，也没有任何 `@capacitor/*`。
 */

/**
 * 与 `./desktop.js` 共用的接口形状（有意重复声明：两个文件必须逐条对齐，
 * 交叉 import 一个 JSDoc typedef 会让 `checkJs` 的解析依赖路径，不值得）。
 * @typedef {object} IpcBridge
 * @property {(channel: string, params?: unknown) => void} send
 * @property {(channel: string, params?: unknown) => unknown} sendSync
 * @property {(channel: string, params?: unknown) => Promise<any>} invoke
 * @property {(channel: string, listener: (payload: { event: any, params: any }) => void) => void} on
 * @property {(channel: string, listener: (payload: { event: any, params: any }) => void) => void} once
 * @property {(channel: string, listener: (...args: any[]) => any) => void} off
 * @property {(channel: string) => void} offAll
 */

const NOT_IMPLEMENTED =
  'Rain Music Android: 渲染层 IPC 桥（src/common/platform/ipcBridge/web.js）尚未实现。' +
  'Capacitor WebView 没有 Electron 的 ipcRenderer，需要原生侧提供等价通道（见 docs/android/ipc-contract.md）。'

/**
 * @param {string} channel
 * @param {string} method
 * @returns {never}
 */
function notImplemented(channel, method) {
  throw new Error(`${NOT_IMPLEMENTED} 被调用的通道：${method}("${channel}")`)
}

/** @type {IpcBridge} */
export const bridge = {
  send(channel) {
    notImplemented(channel, 'send')
  },
  sendSync(channel) {
    notImplemented(channel, 'sendSync')
  },
  invoke(channel) {
    notImplemented(channel, 'invoke')
  },
  on(channel) {
    notImplemented(channel, 'on')
  },
  once(channel) {
    notImplemented(channel, 'once')
  },
  off(channel) {
    notImplemented(channel, 'off')
  },
  offAll(channel) {
    notImplemented(channel, 'offAll')
  },
}
