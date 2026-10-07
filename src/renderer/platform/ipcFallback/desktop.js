/**
 * 桌面侧实现 —— **逐字透传**（Android 移植 · 阶段 3 / 线 E）。
 *
 * 桌面端 `invokeWithFallback(invoke, channel, fallback)` 就是 `invoke(channel)`：
 * 不捕获、不兜底、不改时序、不改异常传播。第三个 `fallback` 参数**桌面端根本不使用**，
 * 正因为如此，桌面端"通道坏了"仍然表现为 Promise reject，能被现有 UI 测试与
 * `unhandledrejection` 采集到，不会被悄悄换成默认设置。
 *
 * ⚠️ 这个参数**必须留在签名里**（哪怕桌面侧不读它）：三个平台实现
 * （`./desktop.js` / `./web.js`，以及构建期替换后 `index.js` 的转发）
 * **必须签名一致**，否则 TS 调用方按统一契约传三个参数时会拿到
 * `TS2554: Expected 2 arguments, but got 3`。
 *
 * ⚠️ 桌面 bundle 里不存在 `./web.js`；web bundle 里不存在本文件 + `./index.js` 的转发。
 *
 * @typedef {(channel: string) => Promise<any>} RendererInvoke
 * @typedef {{ reason: 'unsupported' | 'failed', channel: string, error: unknown }} InvokeFallbackInfo
 */

/**
 * @param {RendererInvoke} invoke
 * @param {string} channel
 * @param {(info: InvokeFallbackInfo) => any} fallback 桌面端**不使用**：桌面路径没有降级
 * @returns {Promise<any>}
 */
// eslint-disable-next-line no-unused-vars -- 三平台签名必须一致，见文件头注释
export const invokeWithFallback = (invoke, channel, fallback) => invoke(channel)
