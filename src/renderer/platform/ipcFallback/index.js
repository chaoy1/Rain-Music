/**
 * 渲染层"挂载期必需通道"降级入口 —— 默认路径 = **桌面**（Android 移植 · 阶段 3 / 线 E）。
 *
 * 与 `src/renderer/platform/http/` 完全同构：默认 `export { ... } from './desktop'`，
 * web / Android 侧由构建期 `NormalModuleReplacementPlugin` 换成同目录的 `./web.js`
 * （`build-config/renderer/webpack.config.web.js` 的"关键差异 4.10"）。
 *
 * 契约（两个适配器必须逐条一致）：
 * ```
 * invokeWithFallback(invoke, channel, fallback) -> Promise<any>
 * ```
 * - `invoke`：调用方注入的 `rendererInvoke`（不在这里 import `@renderer/utils/ipc`，避免循环依赖）；
 * - `fallback(info)`：**只有** web / Android 侧会调用，`info.reason` ∈ `'unsupported' | 'failed'`；
 * - 桌面侧 = `invoke(channel)` 逐字透传，不捕获、不改时序、不改异常传播。
 *
 * ⚠️ `InvokeFallbackInfo` 在两个适配器里都是 JSDoc `@typedef`，**没有运行时导出**，
 * 也无法从 `.js` 里 `export type` 转发（`TS8008: Type aliases can only be used in TypeScript files`
 * —— 已实测）。TS 调用方（如 `event/index.ts`）自己声明形状即可，见那边 `FallbackInfo`。
 *
 * 为什么需要这一层、以及它和阻塞点 #3 的区别，见 `./web.js` 的头注释。
 */
export { invokeWithFallback } from './desktop'
