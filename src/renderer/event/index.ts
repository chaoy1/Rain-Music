import { rendererInvoke } from '@common/rendererIpc'
import { onFocus, onKeyDown, onUpdateHotkey } from '@renderer/utils/ipc'
import { invokeSkippable, subscribeSkippable } from '@renderer/platform/ipcFallback/subscribe'
import { registerKeyEvent, createKeyEventHub } from './keyEvent'
// import { registerRendererEvents, unregisterRendererEvents } from './rendererEvent'
import { createAppEventHub } from './appEvent'

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
 * 3. **不把订阅动作推迟到微任务之后**：`subscribeSkippable(channel, grade, register)` 里的
 *    `register()` 是在 `async` 箭头函数的**同步段**里调用的，`invokeWithFallback` 只是给它
 *    套了一层 `.catch`。
 * 4. **不在 `ipcBridge/web.js` 里加空实现**：那是上一轮**刻意**做成的"调用即抛错"
 *    （避免"看起来好了其实全是空"）。桥保持严格 = 缺哪条通道仍然能一眼看见；
 *    而"注册阶段允许某条通道缺失"是**注册点的局部策略**，写在
 *    `platform/ipcFallback/subscribe.ts` 最窄、最好审。
 *
 * ⚠️ 上面这几条论证的**实现**（`invokeSkippable` / `subscribeSkippable` /
 * `reportChannelSkipped`）在阻塞点 #8 的修复里已从本文件**收敛**到
 * `src/renderer/platform/ipcFallback/subscribe.ts`：`useEventListener.ts`、`core/lyric.ts`、
 * `usePlayer/usePlayStatus.ts`、`useInitUserApi.ts`、`useDeeplink/index.ts` 有**同一类**
 * "setup 期同步抛错"的调用点，共用一份实现比各写一份同构拷贝更好审。
 * **本文件的调用序列、时机、参数逐字未变。**
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
  const config = await invokeSkippable(() => rendererInvoke<Rain.HotKeyConfigAll>('winMain_get_hot_key'), 'winMain_get_hot_key', 'B', '已跳过该取值')
  if (config) setHotkeyConfig(config)

  // `winMain_set_hot_key_config` — (B) 同上（配置变更广播）。
  subscribeSkippable('winMain_set_hot_key_config', 'B', () => onUpdateHotkey(({ params }) => {
    setHotkeyConfig(params)
  }))

  // `winMain_key_down` — (B) 同上（主进程全局热键按下通知）。
  subscribeSkippable('winMain_key_down', 'B', () => onKeyDown(({ params: { key } }) => {
    const keyInfo = window.rain.appHotKeyConfig.global.keys[key]
    if (keyInfo) window.key_event.emit(keyInfo.action)
  }))

  // `winMain_focus` — (B) 窗口聚焦事件（`ipc-contract.md` §4.2 的"窗口按钮/全屏/尺寸"组）。
  // Android 是单窗口 WebView，没有"窗口重新聚焦"这个语义；
  // 真机上若要用 `App.addListener('appStateChange')` 表达，那是**另一层**（原生桥）的事。
  subscribeSkippable('winMain_focus', 'B', () => onFocus(() => {
    window.app_event.focus()
  }))

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
