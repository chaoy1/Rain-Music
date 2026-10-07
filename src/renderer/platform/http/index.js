/**
 * 渲染层 HTTP 传输层入口（Android 移植 · 阶段 3 / 线 A）。
 *
 * 契约（两个适配器必须逐条一致，细节见 `./desktop.js` 的头部注释）：
 *
 * ```
 * transport.request(method, url, data, options, callback) -> { abort() }
 * ```
 * - `method` 已归一化；`data` 是 `request.js` 归并后的请求体；
 * - `options` 是 needle 风格选项（`headers` / `json` / `response_timeout` / `follow_max` …）；
 * - `callback(err, response, body)`，`response = { status, statusText, headers, raw }`，
 *   其中 `raw` 必须是真正的 Buffer（`request.js` 会 `.toString()` 它）；
 * - 返回值必须带 `abort()`，供 `cancelHttp()` 使用。
 *
 * ## 为什么这里"默认 = 桌面"
 *
 * `docs/android/native-bridge-needs.md` §2.6.2 要求桌面行为零回归，所以**默认路径就是桌面**：
 * 本模块（以及它 import 的 `./desktop.js` → vendored needle）是 Electron 两个构建
 * （dev / prod）唯一会走到的实现，webpack 的 `resolve.alias`、`DefinePlugin` 一律没被改动。
 *
 * ## Android / Web 怎么换成 fetch
 *
 * `build-config/renderer/webpack.config.web.js` 里挂了一条 `NormalModuleReplacementPlugin`，
 * 把本文件的请求路径改写成同目录的 `./web.js`（`fetch` 实现）。因此：
 * - 桌面 bundle 里**不存在** `web.js`；
 * - web/Android bundle 里**不存在** `desktop.js` 与 `vendor/needle`（构建后核对 needle 模块数为 0）。
 *
 * 选择发生在**构建期**而不是运行期（按 `isDesktopShell` 三元选择会把两个实现都打进产物，
 * needle 就仍然留在 Android bundle 里）——这是阶段 3 "Node 残留减少"这条验收的落点。
 */
export { transport } from './desktop'
