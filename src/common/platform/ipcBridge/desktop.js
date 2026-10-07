/**
 * 桌面（Electron 渲染进程）IPC 传输适配器 —— `ipcRenderer` 逐字透传（Android 移植 · 阶段 3）。
 *
 * ## 契约
 *
 * 逐条见 `./index.js` 的表。本文件唯一的职责是**保持行为完全不变**：
 * `src/common/rendererIpc.ts` 改动前就是在这里直接调 `ipcRenderer.*`，
 * 唯一差别是现在多了一次模块间接层（`rendererIpc` → `ipcBridge` → `ipcRenderer`）。
 * 没有任何参数整理、没有异常包装、没有时机变化：
 * - `on` / `once` 仍然**每次订阅都新建一个包装函数**（与改动前一样，`off` 依赖调用方
 *   传入**原始** listener 这一点也照旧 —— 包装函数在 `ipcRenderer.removeListener`
 *   里是删不掉的，这是既有行为，不在本轮修正范围内）。
 * - `sendSync` 保留（渲染层目前没人调用它，但契约里必须有，删掉等于悄悄改接口）。
 *
 * ## 为什么用 `require` 而不是 `import`
 *
 * 本文件是**共用目录**（`src/common/`）里唯一碰 `electron` 的地方，`src/common/tsconfig.json`
 * 的 `typeRoots` 只指向 `./types`（没有 `node_modules/@types`），所以这里拿到的是**显式声明的
 * 接口**而不是 Electron 的类型。桌面产物行为不变：webpack 在 `target: 'electron-renderer'`
 * 下把 `require('electron')` 当外部依赖处理，运行时拿到的就是 Electron 内建的同一个对象。
 */

/**
 * 两个适配器共用的接口形状（`./web.js` 里逐条重写同样的形状，杜绝两边悄悄长歪）。
 * `event` 类型故意留宽：`src/common/rendererIpc.ts` 会把整个 `{ event, params }` 交给调用方。
 * @typedef {object} IpcBridge
 * @property {(channel: string, params?: unknown) => void} send
 * @property {(channel: string, params?: unknown) => unknown} sendSync
 * @property {(channel: string, params?: unknown) => Promise<any>} invoke
 * @property {(channel: string, listener: (payload: { event: any, params: any }) => void) => void} on
 * @property {(channel: string, listener: (payload: { event: any, params: any }) => void) => void} once
 * @property {(channel: string, listener: (...args: any[]) => any) => void} off
 * @property {(channel: string) => void} offAll
 */

const { ipcRenderer } = require('electron')

/** @type {IpcBridge} */
export const bridge = {
  send(channel, params) {
    ipcRenderer.send(channel, params)
  },
  sendSync(channel, params) {
    return ipcRenderer.sendSync(channel, params)
  },
  invoke(channel, params) {
    return ipcRenderer.invoke(channel, params)
  },
  on(channel, listener) {
    ipcRenderer.on(channel, (event, params) => {
      listener({ event, params })
    })
  },
  once(channel, listener) {
    ipcRenderer.once(channel, (event, params) => {
      listener({ event, params })
    })
  },
  off(channel, listener) {
    ipcRenderer.removeListener(channel, listener)
  },
  offAll(channel) {
    ipcRenderer.removeAllListeners(channel)
  },
}
