/**
 * 挂载期"可跳过"的 IPC 取值 / 订阅 —— 渲染层降级路径的**唯一实现**
 * （Android 移植 · 阶段 3，阻塞点 #3 与 #8）。
 *
 * ## 它解决什么
 *
 * `App.vue` 的 `setup()` 是**同步**执行的。它的同步调用图里只要有一处**无条件**地调用了
 * `@renderer/utils/ipc` 中走 `rendererOn` / `rendererSend` / 裸 `ipcRenderer` 的那些通道，
 * web / Capacitor 侧就会**同步抛错**：那两处桥是**刻意**做成"调用/访问即抛错"的占位实现
 * （`src/common/platform/ipcBridge/web.js`、`src/renderer/platform/ipcRenderer/web.js`），
 * 为的是"缺哪条通道一眼可见"。
 *
 * 异常一路穿出 `setup()` 之后，Vue 拿不到根组件的 setup 结果 ⇒ `instance.render` 停在
 * `NOOP` ⇒ 返回空注释 vnode ⇒ `#root` 全白（`childElementCount = 0` / `display: none`）。
 * 两个真实案例：阻塞点 **#3**（`registerEvents()` 的顶层同步注册）与阻塞点 **#8**
 * （`useApp()` 的同步调用图）。完整因果链见 `docs/android/web-runtime-blockers.md`。
 *
 * ## 为什么是"逐条容错"，而不是别的方案
 *
 * 1. **不把注册推迟到 `app.mount()` 之后**：挂载本身就在 `getSetting()` 的 `.then` 里，
 *    而 `common_get_app_setting` 也是 (A) 类通道；一旦被桥拒绝/挂起，"推迟注册"就退化成
 *    "永不注册"，反而**新增**一种失败模式（桌面端也一样）。
 * 2. **不把注册整体搬进 `await` / `.then`**：`register()` 在 `async` 函数的**同步段**里
 *    立即执行（本文件的 `async()` 箭头函数体内没有 `await`），所以桌面端的调用时机、
 *    通道名、监听器与改动前逐字一致。
 * 3. **不在 `web.js` 里加空实现**：那会让"缺通道"变成"静默失效"，正是这两个占位实现
 *    刻意避免的。桥保持严格，降级只发生在**明确知道自己要什么**的调用点。
 * 4. **不静默**：每次降级都留下 `console.warn` / `console.error`，且带通道名与归类，
 *    并注明"原因"是"通道未实现"还是"调用报错"。
 *
 * ## 桌面语义（没有变化）
 *
 * `@renderer/platform/ipcFallback` 的桌面适配器是 `invoke(channel)` **逐字透传**，
 * 第三个 `fallback` 参数桌面端**根本不读**。于是：
 * - 桌面端 `register()` 仍在本文件唯一的同步段里执行 ⇒ 订阅时机、通道、监听器与改动前一致；
 * - 桌面端通道真的坏掉时，仍然是**未处理的 rejection（大声失败）**，不会变成"默认值凑合"。
 *
 * ⚠️ 唯一的桌面差异：若桌面端 `bridge.on` 自己抛错，改动前会**同步穿出 `setup()`**，
 * 现在会变成一条 `console.error`（不静默、不假装成功）。与阻塞点 #3 的既有改动是同一个取舍。
 *
 * ## 为什么这个文件本身**不做**构建期替换
 *
 * `build-config/renderer/webpack.config.web.js` 的"关键差异 4.10"只把**裸说明符**
 * `@renderer/platform/ipcFallback`（及 `…/index.js`）替换成 `…/web`；本文件的名字不在
 * 那条正则里（正则以 `$` 结尾），所以两端共用同一份实现 —— 它只依赖
 * `invokeWithFallback` 这个**已经被替换过**的适配器，平台差异仍然收在 `./desktop.js` /
 * `./web.js` 两个文件里。
 */
import { invokeWithFallback } from '@renderer/platform/ipcFallback'

/**
 * 通道归类，取值来自 `docs/android/ipc-contract.md` §4.1 / §4.2 / §4.3：
 * - `A` 必须重写、`C` 需降级 ⇒ 缺失说明**原生桥还没接上** ⇒ `console.error`；
 * - `B` 桌面专有（Android 侧不注册）⇒ `console.warn`。
 */
export type ChannelGrade = 'A' | 'B' | 'C'

/**
 * 与 `./desktop.js` / `./web.js` 的 JSDoc `@typedef {object} InvokeFallbackInfo` 形状逐条一致。
 *
 * 之所以在这里**重声明**而不是 import：那两个文件是 `.js`，JSDoc typedef 没有运行时导出，
 * 也无法从 `.js` 里转发（`export type` 写在 `.js` 里是 `TS8008`，已实测）。
 * 契约只改一处就要同时改这里 —— 见 `./index.js` 头注释。
 */
export interface FallbackInfo {
  reason: 'unsupported' | 'failed'
  channel: string
  error: unknown
}

/** 逐条容错的统一告警。**不假装成功**：降级一定留下痕迹。 */
export const reportChannelSkipped = (channel: string, grade: ChannelGrade, detail: string) => {
  const text = `[renderer/platform/ipcFallback] 平台通道 "${channel}" 不可用（契约归类 ${grade} 类），${detail}`
  if (grade === 'B') console.warn(text)
  else console.error(text)
}

/**
 * 一条降级路径 = 调 `invokeWithFallback` + 承接 `fallback` 自己抛出的异常。
 *
 * **桌面路径是 `await invokeWithFallback(...)`**：桌面端它就是 `invoke(channel)` 逐字透传，
 * 所以桌面端 rejection 会**原样**传出来（调用方不接的话仍是未处理的 rejection，与改动前一致），
 * 不会被这里悄悄吃掉。
 *
 * 返回 `undefined` = **"这条取值/订阅没有发生"**：调用方一律 `await` 取值 + `if (value)` 判断，
 * **不许**给它接链式 `.then`。末尾那个 `.catch` 只兜住"`fallback` 自己抛错"这种不该发生的情况
 * （桌面端永远命中不到）。
 */
export const invokeSkippable = async <T>(
  invoke: () => Promise<T>,
  channel: string,
  grade: ChannelGrade,
  detail: string,
): Promise<T | undefined> =>
  invokeWithFallback(invoke, channel, (info: FallbackInfo) => {
    reportChannelSkipped(channel, grade, `${detail}（reason=${info.reason}）`)
    return undefined
  }).catch((err: unknown) => {
    reportChannelSkipped(channel, grade, `降级处理本身失败：${String(err)}`)
    return undefined
  })

/**
 * 注册一条**主进程 → 渲染层**的广播订阅；通道不可用时只跳过它自己、不向外抛。
 *
 * ⚠️ 失败 = "这条订阅没有建立"，与"事件永远不来"等价；**不假装注册成功**
 * （不写假 listener、不动 store）。仍然**只降级这一条**。
 *
 * `register` 返回的是**取消订阅函数**（`onSettingChanged` / `onFocus` / `onThemeChange` /
 * `onFullscreenChanged` / `onDeeplink` / `onUserApiStatus` / `onShowUserApiUpdateAlert` /
 * `onPlayerAction` / `onNewDesktopLyricProcess` 都返回它）。调用点写成
 * **表达式体箭头函数**即可：`subscribeSkippable(CH, 'B', () => onXxx(handler))`。
 *
 * 返回值是**一定可以调用**的取消订阅函数：订阅被跳过时它是空操作 —— 不能返回 `undefined`，
 * 因为调用点的 `onBeforeUnmount` 会直接调用它，而 web 侧的 `rendererOff` / `removeListener`
 * 同样会抛错。调用点若不关心取消，忽略返回值即可。
 *
 * ⚠️ `async()` 不能写成 `async ()`：仓库的 `space-before-function-paren` 要求如此。
 */
export const subscribeSkippable = (
  channel: string,
  grade: ChannelGrade,
  register: () => () => void,
): (() => void) => {
  let remove: (() => void) | undefined
  // 这里的 `void` 是"显式表示故意丢弃返回值"（`no-floating-promises` 认这个写法）；
  // `invokeSkippable` 内部已经 `.catch` 过，不会留下未处理 rejection。
  //
  // `register()` 在这个 `async` 箭头函数的**同步段**里执行（函数体内没有 `await`）：
  // 桌面端 `invokeWithFallback` 是同步透传 ⇒ 订阅动作同步发生，与改动前逐字一致。
  void invokeSkippable(async() => {
    remove = register()
  }, channel, grade, '已跳过该订阅')
  return () => {
    if (remove) remove()
  }
}
