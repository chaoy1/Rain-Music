/**
 * 渲染层"挂载期必需通道"的降级入口（Android 移植 · 阶段 3 / 线 E）。
 *
 * ## 为什么需要它
 *
 * `src/renderer/main.ts:42` 的 `getSetting().then(...)` 是**唯一**通往 `app.mount('#root')`
 * 的路径（`main.ts:89`）。而 `getSetting()` 走的 `common_get_app_setting` 是 (A) 类通道
 * （`docs/android/ipc-contract.md` §4.1「设置 / 环境 / 初始化握手」）—— Android 原生桥落地之前，
 * 这个 Promise 一定会 reject，于是 **`app.mount()` 永远执行不到**，页面依旧全白。
 *
 * 这与阻塞点 #3（`registerEvents()` 顶层同步抛错）是**两类问题**：
 * - #3 是"同步抛错打断模块求值"，在**注册点**逐条容错即可（现在 `event/index.ts` 的
 *   `invokeSkippable` / `subscribe` 也走这一层）；
 * - 这一条是"异步通道拿不到数据，而挂载**依赖**这份数据"，只能在**取值点**决定"拿不到时怎么办"。
 *
 * ## 为什么不是"在 `ipcBridge/web.js` 里给空实现"
 *
 * 那会让 `common_get_app_setting` 静默返回 `undefined` —— 挂载是能过，但每个读设置的地方
 * 都会拿到 `undefined`，问题从"全白"变成"到处都是 undefined 的怪行为"，更难查。
 * 桥继续保持"调用即抛错"（缺哪条通道一眼可见），降级只发生在**明确知道自己需要什么**的取值点。
 *
 * ## 桌面行为
 *
 * `./index.js` 是**逐字透传**：`invokeWithFallback(invoke, channel, fallback)` 桌面端就是
 * `invoke(channel)` —— 不捕获、不兜底、不改变时序与异常传播（`fallback` 参数在桌面端
 * **根本不读**，但**必须留在签名里**，三个平台实现签名一致才能通过 TS 检查）。
 * 桌面侧万一 `common_get_app_setting` 真的坏了，仍然应该**大声失败**
 * （未处理的 rejection），不是拿默认设置凑合。
 *
 * ## 同步抛错与异步 reject 是同一件事
 *
 * 本文件**归一化**两种失败形状：
 * - 通道不存在时 `ipcBridge/web.js` 是**同步抛错**（`notImplemented`）；
 * - 通道存在但原生 handler 报错时，`invoke` 返回 **reject 的 Promise**。
 *
 * 两者都必须在 `fallback` 里收敛，否则"注册期同步抛错"会绕过 `.catch` 直接打断
 * 调用方（阻塞点 #3 就是这么发生的）。调用方注入的 `invoke` 按契约返回 Promise
 * （`rendererInvoke` 是 `async`，同步 throw 也会变成 reject），所以这里先
 * `Promise.resolve().then(...)` 把"非 Promise 的同步 throw"也变成 rejection，
 * 统一由下面那条 `.catch` 处理。
 */

/**
 * 请求一条"挂载期必需"的平台通道；失败时返回调用方给的降级值。
 *
 * @typedef {(channel: string) => Promise<any>} RendererInvoke
 * @typedef {{ reason: 'unsupported' | 'failed', channel: string, error: unknown }} InvokeFallbackInfo
 */

/**
 * @param {RendererInvoke} invoke 真正的 `rendererInvoke`（由调用方注入，避免本模块依赖 `@renderer/utils/ipc`）
 * @param {string} channel 通道名
 * @param {(info: InvokeFallbackInfo) => any} fallback 失败时提供降级值；`info.reason` 只有两种取值
 * @returns {Promise<any>}
 */
export const invokeWithFallback = (invoke, channel, fallback) => {
  return Promise.resolve().then(() => invoke(channel)).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    // 只对"桥明确说没有这条通道"（含 `ipcBridge/web.js` 的占位实现抛出的那句）做降级提示，
    // 其它异常同样降级，但文案不同 —— 避免把"原生桥已接上但 handler 内部报错"误报成"通道没有"。
    const unsupported = message.includes('尚未实现') || message.includes('not implemented')
    console.warn(
      `[renderer/platform/ipcFallback] 平台通道 "${channel}" 取值失败（${unsupported ? '通道未实现' : '调用报错'}），` +
      `已使用渲染层默认值继续挂载；真正的数据要等 Android 原生桥落地。原因：${message}`,
    )
    return fallback({ reason: unsupported ? 'unsupported' : 'failed', channel, error })
  })
}
