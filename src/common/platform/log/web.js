/**
 * 渲染层（Web / Android）的日志入口 —— **构建期**替换 `electron-log/node`
 * （见 `build-config/renderer/webpack.config.web.js` 的「关键差异 4.11」）。
 *
 * ## 这一层为什么存在
 *
 * `src/common/utils/index.ts:1` 写的是 `import log from 'electron-log/node'`。
 * 桌面**主进程**确实要那一份（`src/main/utils/logInit.ts` 用它做 File 传输、
 * 并从 `process.env.APPDATA` 推日志目录），但**渲染层**在 web/Android 产物里
 * 拿到的是**同一个 Node 构建**：它带 File 传输（`fs` —— 在 web 产物里是空模块）、
 * `os`、`child_process`，还会用 `AppData/Roaming` / `Library/Logs` / `xdg-open`
 * 去算日志目录（`electron-log/src/node/NodeExternalApi.js`）。
 *
 * 后果**不是崩溃，而是日志静默消失**：写盘抛错被 electron-log 自己的
 * `errorHandler`（`processInternalErrorFn`）吞掉，于是真机上 `log.*` 什么都不留下 ——
 * 而真机验收正要靠 logcat 看应用自己的日志（见 `docs/android/acceptance.md`）。
 * 实测证据（2026-10-16，`dist-web` 里 **`renderer.*.js` 与主 Worker chunk 都有**）：
 * `AppData/Roaming`、`Library/Logs`、`xdg-open` 三个字面量都能搜到。
 *
 * ## 为什么换成 `electron-log/renderer`
 *
 * 那是**同一个包**的浏览器构建（`node_modules/electron-log/package.json` 的
 * `exports["./renderer"]`）：只带 `console` 与 `ipc` 两个传输，
 * 并且**完全不 require `electron`** —— 唯一 require 它的 `electron-log-preload.js`
 * 不在这条 import 链上（已逐文件核过 `src/renderer/**`）。
 * 级别、格式化、作用域与桌面一致，所以**不需要改任何调用点**。
 *
 * ## 为什么还要关掉 `ipc` 传输
 *
 * 渲染层构建的 ipc 传输负责"把日志转给主进程"。Android **没有主进程**，
 * 它每次都会退回打一条 `electron-log: logger isn't initialized in the main process`
 * （见 `src/renderer/lib/transports/ipc.js` 的 `if (!window.__electronLog)` 分支）
 * ⇒ **每条日志多一行噪声**，正是真机 logcat 里最不该有的东西。
 * 所以在接入点把它关掉：`Logger.js:167` 对 `level === false` 的传输直接跳过。
 *
 * 留下来的 `console` 传输会把日志写进 WebView 的 console，而 WebView 的 console
 * **会进 logcat** —— 那才是真机取证要看的地方。
 */
import log from 'electron-log/renderer'

if (log?.transports?.ipc) log.transports.ipc.level = false

export default log
