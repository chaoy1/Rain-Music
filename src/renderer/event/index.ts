import { rendererInvoke } from '@common/rendererIpc'
import { onFocus, onKeyDown, onUpdateHotkey } from '@renderer/utils/ipc'
import { invokeWithFallback } from '@renderer/platform/ipcFallback'
import { registerKeyEvent, createKeyEventHub } from './keyEvent'
// import { registerRendererEvents, unregisterRendererEvents } from './rendererEvent'
import { createAppEventHub } from './appEvent'

/**
 * `@renderer/platform/ipcFallback` 的降级回调信息。
 *
 * 形状与那边两个适配器里的 JSDoc `@typedef {object} InvokeFallbackInfo` **逐条一致**。
 * 之所以在这里重声明而不是 import：那两个文件是 `.js`，JSDoc typedef 没有运行时导出，
 * 也无法从 `.js` 里转发（`export type` 写在 `.js` 里是 `TS8008`，已实测）。
 * 契约只改一处就要同时改这里 —— 见 `platform/ipcFallback/index.js` 头注释。
 */
interface FallbackInfo {
  reason: 'unsupported' | 'failed'
  channel: string
  error: unknown
}

/**
 * 这一段（阶段 3 / 线 E）要解决的问题：
 *
 * `registerEvents()` 是**模块求值即执行**的（文件末尾 `registerEvents()`，由 `main.ts:6`
 * 的顶层 `import '@renderer/event'` 拉起）。而它注册的 4 条通道在 Android 上**根本没有桥**：
 * `src/common/platform/ipcBridge/web.js` 是"调用即抛错"的占位实现，于是
 * `onUpdateHotkey()` 在**顶层 import 期间同步抛错** ⇒ `main.ts` 的模块求值中断 ⇒
 * `getSetting().then(...)` 与 `app.mount('#root')` 一行都跑不到 ⇒ 页面全白。
 * （复现见 `docs/android/web-runtime-blockers.md` 阻塞点 #3。）
 *
 * ## 为什么是"逐条容错"，而不是别的方案
 *
 * 1. **不把注册推迟到 `app.mount()` 之后**：`main.ts` 的挂载在 `getSetting()` 的
 *    `.then()` 里，而 `getSetting()` 本身就是 (A) 类通道；一旦它被原生桥拒绝/挂起，
 *    "推迟注册"就退化成"永不注册"。反而会**新增**一种失败模式（桌面端也一样）。
 * 2. **不把"注册"整体搬进 `await`/`.then`**：`onFocus` / `onKeyDown` / `onUpdateHotkey`
 *    的调用（以及 `bridge.on` 的订阅动作）都在 `registerEvents()` 的**同步段**里执行完，
 *    顺序、时机、参数与改动前一致。**只有 `winMain_get_hot_key` 那一次取值是 `await` 的**
 *    （它本来就是请求/应答，改动前也是 `.then`），所以 `registerEvents()` 现在是
 *    `async`、返回值变成 Promise；调用方只有 `main.ts:6` 的 `import '@renderer/event'`
 *    （副作用 import，不看返回值），文件末尾用 `void registerEvents()` 显式丢弃。
 *    **注意**：`await` 只用来"取值"，**不拿它的返回值去链式 `.then`** ——
 *    `fallback` 返回的是 `undefined`，接 `.then` 会把 `undefined` 塞进 `setHotkeyConfig`。
 * 3. **不把 `subscribe` 的订阅动作推迟到微任务之后**：`resolveAfterRegister(register)`
 *    里的 `register()` 是**同步调用**的，`invokeWithFallback` 只是给它套了一层 `.catch`。
 * 4. **不在 `ipcBridge/web.js` 里加空实现**：那是上一轮**刻意**做成的"调用即抛错"
 *    （避免"看起来好了其实全是空"）。桥保持严格 = 缺哪条通道仍然能一眼看见；
 *    而"注册阶段允许某条通道缺失"是**注册点的局部策略**，写在 `ipcFallback` 最窄、最好审。
 *
 * ## 桌面行为是否有变化
 *
 * 桌面桥（`ipcBridge/desktop.js`）是 `ipcRenderer` 逐字透传，**同步不抛错**；
 * `ipcFallback` 的桌面实现（`platform/ipcFallback/desktop.js`）同样是 `invoke(channel)`
 * **逐字透传**（`fallback` 参数在桌面端根本不读）⇒ `registerEvents()` 做的调用序列、
 * 时机、参数与改动前一致，下面所有容错分支在桌面端**一次都不会命中**。
 *
 * 桌面语义**唯一**变化的地方：`getHotKeyConfig()`（即 `winMain_get_hot_key`）若真的 reject，
 * 改动前是"未处理的 rejection"（会被 `unhandledrejection` 采集到），现在会多打一条
 * `console.warn` 并保持 `window.rain.appHotKeyConfig` 的默认空配置 ——
 * **不是**改成"静默成功"，也不再是"未处理"。除此之外每条通道的调用点、时机、
 * 参数与异常传播都没变（见 `invokeSkippable` 的注释）。
 *
 * ## 同步抛错和异步 reject 为什么走同一条路
 *
 * `winMain_set_hot_key_config` / `winMain_key_down` / `winMain_focus` 走的是 `bridge.on`，
 * 它在 web 桥上是**同步抛错**；`winMain_get_hot_key` 走 `rendererInvoke`（`async`），
 * 表现为 **reject 的 Promise**。两者在 `ipcFallback` 里被归一化成同一件事
 * （见 `platform/ipcFallback/web.js` 头注释），所以这里不需要两套写法。
 */

/**
 * 桌面专有 / (B) 类通道的缺失是**预期**，打 `warn`；
 * (A) 类通道的缺失说明原生桥还没接上，打 `error`（进入错误采集，但不再中断挂载）。
 * 依据：`docs/android/ipc-contract.md` §4.2（B 可直接移除）与 §4.1（A 必须重写）。
 */
const reportChannelSkipped = (channel: string, grade: 'A' | 'B', detail = '已跳过该注册') => {
  const text = `[renderer/event] 平台通道 "${channel}" 不可用（契约归类 ${grade} 类），${detail}`
  if (grade === 'B') console.warn(text)
  else console.error(text)
}

/**
 * 一条降级路径 = 调 `ipcFallback.invokeWithFallback` + 承接 `fallback` 自己抛出的异常。
 *
 * **桌面路径是 `await invokeWithFallback(...)`**：桌面端 `invokeWithFallback` 就是
 * `invoke(channel)` 逐字透传，所以桌面端 rejection 会**原样**传出来（调用方不接的话
 * 仍是未处理的 rejection，与改动前一致），不会被这里悄悄吃掉。
 *
 * `fallback` 返回 `undefined` = **"这条取值/订阅没有发生"**：调用方一律
 * `await` 取值 + `if (value)` 判断，**不许**给它接链式 `.then`。
 * 末尾那个 `.catch` 只兜住"`fallback` 自己抛错"这种不该发生的情况（桌面端永远命中不到）。
 */
const invokeSkippable = async <T>(invoke: () => Promise<T>, channel: string): Promise<T | undefined> =>
  invokeWithFallback(invoke, channel, (info: FallbackInfo) => {
    reportChannelSkipped(channel, 'B', `已跳过（reason=${info.reason}）`)
    return undefined
  }).catch((err: unknown) => {
    reportChannelSkipped(channel, 'B', `降级处理本身失败：${String(err)}`)
    return undefined
  })

/**
 * `bridge.on` 是同步订阅，但降级入口的 `invoke` 契约是"返回 Promise"。
 * 这一个包装把"同步注册"塞进 Promise：`register()` 在 `async` 函数的同步段里
 * **立即执行**，不会推迟到微任务。
 *
 * ⚠️ 写成**具名 async 函数**而不是内联箭头函数，纯粹是为了同时满足
 * `@typescript-eslint/promise-function-async`、`@typescript-eslint/no-floating-promises`
 * 与 `space-before-function-paren` 三条既有规则 —— 不含任何行为差异。
 */
async function resolveAfterRegister(register: () => void): Promise<void> {
  register()
}

/**
 * 注册一条**主进程 → 渲染层**的广播订阅，通道不可用时只跳过它自己、不向外抛。
 *
 * ⚠️ 不要在这里 catch 之后去动 `window.key_event` / `window.app_event` —— 那会导致
 * "注册了一半、状态不一致"。失败就是"这条订阅没有建立"，与"事件永远不来"等价。
 *
 * **为什么不是直接 `try { onXxx(...) } catch`**：这三条通道在 `ipc-contract.md` §4.2
 * 里都是 **(B) 桌面专有、Android 直接移除**（全局快捷键 + 窗口聚焦）。用
 * `ipcFallback` 表达"这条通道我不强求"，语义上是**一条降级路径**而不是"碰巧撞上异常"；
 * 同时把"桌面 = 逐字透传"的保证收在同一个适配器里，审查时只需要看
 * `platform/ipcFallback/`。仍然**只降级这一条**，且失败时
 * **不假装注册成功**（不调 `onXxx` 的空实现、不写假 listener）。
 */
const subscribe = (channel: string, register: () => void) => {
  // 这里的 `void` 是"显式表示故意丢弃返回值"（`no-floating-promises` 认这个写法）；
  // `invokeSkippable` 内部已经 `.catch` 过，不会留下未处理 rejection。
  // 注意 `async()` 不能写成 `async ()`：仓库的 `space-before-function-paren` 要求如此。
  void invokeSkippable(async() => resolveAfterRegister(register), channel)
}

export async function registerEvents(): Promise<void> {
  window.rain.isEditingHotKey = false
  window.app_event = createAppEventHub()
  window.key_event = createKeyEventHub()

  const setHotkeyConfig = ({ local, global }: Rain.HotKeyConfigAll) => {
    window.rain.appHotKeyConfig = {
      local,
      global,
    }
  }

  // `winMain_get_hot_key` — (B) 全局快捷键，Android 无全局热键（`ipc-contract.md` §4.2）。
  // 桌面端：这条 `await` 拿到的一定是主进程返回的真实配置；reject 会原样抛出来。
  // web/Android：`fallback` 生效 ⇒ `undefined` ⇒ **这条取值没有发生**，
  // `window.rain.appHotKeyConfig` 保持 `core/globalData.ts:8-17` 的默认空配置 ——
  // 而不是让"快捷键配置"变成 undefined（下一个使用者是 `onKeyDown` 回调里的
  // `window.rain.appHotKeyConfig.global.keys[key]`，会把它变成运行期 TypeError）。
  const config = await invokeSkippable(() => rendererInvoke<Rain.HotKeyConfigAll>('winMain_get_hot_key'), 'winMain_get_hot_key')
  if (config) setHotkeyConfig(config)

  // `winMain_set_hot_key_config` — (B) 同上（配置变更广播）。
  subscribe('winMain_set_hot_key_config', () => {
    onUpdateHotkey(({ params }) => {
      setHotkeyConfig(params)
    })
  })

  // `winMain_key_down` — (B) 同上（主进程全局热键按下通知）。
  subscribe('winMain_key_down', () => {
    onKeyDown(({ params: { key } }) => {
      const keyInfo = window.rain.appHotKeyConfig.global.keys[key]
      if (keyInfo) window.key_event.emit(keyInfo.action)
    })
  })

  // `winMain_focus` — (B) 窗口聚焦事件（`ipc-contract.md` §4.2 的"窗口按钮/全屏/尺寸"组）。
  // Android 是单窗口 WebView，没有"窗口重新聚焦"这个语义；
  // 真机上若要用 `App.addListener('appStateChange')` 表达，那是**另一层**（原生桥）的事。
  subscribe('winMain_focus', () => {
    onFocus(() => {
      window.app_event.focus()
    })
  })

  registerKeyEvent()
  // registerRendererEvents()
}

// export const unregisterEvents = () => {
//   unregisterKeyEvent()
//   // unregisterRendererEvents()
// }

export { clearDownKeys } from './keyEvent'

export type { AppEventTypes } from './appEvent'
export type { KeyEventTypes } from './keyEvent'

void registerEvents()
