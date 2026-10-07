/**
 * 渲染层 IPC 传输层入口（Android 移植 · 阶段 3 / 线 D）。
 *
 * ## 这一层为什么存在
 *
 * `src/common/rendererIpc.ts` 原来**直接** `import { ipcRenderer } from 'electron'`。在
 * Electron 目标下没问题（主窗口 `nodeIntegration: true`），但在 `target: 'web'` 的构建里，
 * `electron` 不是 webpack 外部依赖、也不在 `resolve.fallback`，于是 **npm 包
 * `node_modules/electron` 被整包打进了 `dist-web/renderer.js`**（`electron-log` 也一样，
 * 见 `docs/android/web-runtime-blockers.md`）。该包顶层第 6 行就是 `__dirname`，
 * 而 web 目标里 `node.__dirname = false` ⇒ **模块加载期直接 `ReferenceError: __dirname is not defined`**，
 * 整个 `renderer.js` 在 `src/common/rendererIpc.ts` 的 import 处就断了，`#root` 永远不挂载。
 *
 * 修法与 `src/renderer/platform/http/` 完全一致：把"用哪种 IPC 传输"收口成两个可替换实现，
 * 由构建期 `NormalModuleReplacementPlugin` 选择（见 `build-config/renderer/webpack.config.web.js`
 * 的"关键差异 4.7"）。
 * - 桌面 bundle：`./desktop.js`（electron 的 `ipcRenderer` **逐字透传**，桌面行为零变化）；
 * - web / Capacitor bundle：`./web.js`（**故意大声抛错**，见该文件说明）。
 *
 * ## 契约（两个适配器必须逐条一致）
 *
 * | 方法 | 语义 | 桌面实现 |
 * | --- | --- | --- |
 * | `bridge.send(channel, params?)` | 单向发送 | `ipcRenderer.send` |
 * | `bridge.sendSync(channel, params?)` | 同步发送（会阻塞渲染进程） | `ipcRenderer.sendSync` |
 * | `bridge.invoke(channel, params?)` | 请求 / 应答，返回 Promise | `ipcRenderer.invoke` |
 * | `bridge.on(channel, listener)` | 订阅，回调收到 `{ event, params }` | `ipcRenderer.on` + 包装 |
 * | `bridge.once(channel, listener)` | 只订阅一次，回调同上 | `ipcRenderer.once` + 包装 |
 * | `bridge.off(channel, listener)` | 退订（**listener 是原始函数**，不是包装后的） | `ipcRenderer.removeListener` |
 * | `bridge.offAll(channel)` | 退订该通道全部 | `ipcRenderer.removeAllListeners` |
 *
 * ⚠️ 默认路径是**桌面**：Electron 的两个构建（dev / prod）resolve 到这里后原样走 `./desktop.js`，
 * webpack 的 `resolve.alias` / `DefinePlugin` 一律没被动过，桌面产物逐字节同源。
 */
export { bridge } from './desktop'
