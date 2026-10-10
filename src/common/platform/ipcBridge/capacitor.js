/**
 * Capacitor（Android WebView）IPC 传输适配器 —— **真实原生桥**（Android 移植 · P0-1）。
 *
 * ## 它在链条里的位置
 *
 * ```
 * 渲染层 (utils/ipc.ts …)
 *   → @common/rendererIpc              ← 全部 IPC 的唯一咽喉
 *     → @common/platform/ipcBridge      ← 构建期选择适配器（本文件是 web/Android 侧）
 *       → Capacitor 插件 "RainMusicIpc" ← 单一原生入口 post(...) / 单一原生事件 ipcMessage
 *         → android RainMusicIpcPlugin.java → 各通道 handler（P0-2 填）
 * ```
 *
 * `./desktop.js`（Electron `ipcRenderer` 透传）与 `./web.js`（占位实现，调用即抛错）都还在；
 * web / Capacitor 构建由 `build-config/renderer/webpack.config.web.js` 的"关键差异 4.7"
 * 在**构建期**指向本文件 —— 桌面两个构建完全不知道本文件存在
 * （证据：桌面 `dist/renderer.js` 里不含 `RainMusicIpc` / `ipcMessage` / `__RAIN_CAPACITOR_IPC__`）。
 *
 * ## 为什么是"单入口 + 单事件"的信封协议
 *
 * 契约里有 **128 条通道**（`src/common/ipcNames.ts`），原生侧不可能为每条通道写一个
 * `@PluginMethod`。所以传输层只暴露**一个**方法 `post`，通道名是信封里的一个字段；
 * 反向也只有一个**原生事件** `ipcMessage`，应答、广播、取消都从它进来。这样：
 * - JS 侧只需要 `plugin.post(...)` + `plugin.addListener('ipcMessage', ...)` 两件事；
 * - 原生侧只需要一个 `@PluginMethod post` + 一张 `channel → handler` 表（P0-2 填）。
 *
 * ## 信封（与 `RainMusicIpcPlugin.java` 逐字一致，改一处必须同时改两处）
 *
 * JS → 原生（`post` 的参数）：
 * ```jsonc
 * { "id": "ipc-<会话标签>-<序号>", "kind": "invoke" | "send" | "cancel",
 *   "channel": "player_list_get", "args": [ ... ], "reason": "timeout" }   // reason 仅 kind=cancel
 * ```
 * 原生 → JS（`notifyListeners("ipcMessage", …)`）：
 * ```jsonc
 * { "id": "…", "kind": "response", "ok": true,  "result": … }
 * { "id": "…", "kind": "response", "ok": false, "error": { "message": "…", "code": "…" } }
 * { "kind": "event",  "channel": "winMain_on_config_change", "args": [ … ] }
 * { "id": "…", "kind": "cancel", "reason": "native 侧主动放弃" }
 * ```
 * `args` **恒为数组**：Electron 的 `ipcRenderer.send(channel, ...args)` 本来就是变参，
 * 这里沿用它（`rendererSend(name, params)` 传一个参数 ⇒ `args = [params]`）。
 *
 * ## 四条语义 + 配对 + 超时 + 取消（逐条）
 *
 * | 语义 | 桌面（`./desktop.js`） | 本适配器 |
 * | --- | --- | --- |
 * | `send(channel, ...args)` | `ipcRenderer.send` | `post({kind:'send'})`，不等应答。**投递失败不静默**：`console.error`（`send` 的签名是 `void`，没有可 reject 的对象） |
 * | `sendSync(channel, ...args)` | `ipcRenderer.sendSync` | **抛错**：Capacitor 没有同步 IPC（会死锁 WebView 主线程），消息里带通道名 |
 * | `invoke(channel, ...args)` | `ipcRenderer.invoke` | `post({kind:'invoke', id})` + 在 `pending` 表里等应答，返回 Promise |
 * | `on` / `once` | `ipcRenderer.on` / `once` | 本地订阅表；原生 `kind:'event'` 到达时派发 `{ event, params: args[0] }` |
 * | `off(channel, listener)` | `removeListener`（**原始 listener**） | 用原始 listener 作 map key 真正退订 —— 桌面上"包装函数删不掉"的老毛病在这里**不存在** |
 * | `offAll(channel)` | `removeAllListeners` | 清空该通道的订阅表 |
 *
 * **请求应答配对**：`id` 由本适配器生成（`ipc-<每次加载随机的会话标签>-<自增序号>`，
 * 会话标签是为了避免 WebView 重建后新会话的 `1` 撞上原生侧上一会话的 `1`）。
 * 应答**只按 id 配对**，与到达顺序无关 ⇒ **乱序回包**天然正确（单测覆盖）。
 * 原生若回了未知 id，或应答里的 `channel` 与在途请求不一致，一律 `console.error` 点名，
 * **绝不静默丢弃**（迟到/重复的应答降级为 `console.warn`，因为那可能是超时/取消的正常后果）。
 *
 * **原生侧回了错误**：`ok:false` ⇒ 该请求的 Promise **reject** 一个带
 * `code` / `channel` / `requestId` / `remote` 的 `Error`（原生 `message` 原样带上）。
 * 注意这里**不**吞掉异常、也**不** resolve 成 `undefined` —— 调用方（或它的降级层
 * `@renderer/platform/ipcFallback`）必须自己决定怎么处理。
 *
 * **超时**：默认 **15000 ms**（与仓库既有惯例一致：`src/renderer/utils/musicSdk/options.js:7`
 * 的 `export const timeout = 15000`、`src/renderer/utils/request.js:125`），可通过
 * `capacitorIpc.timeoutMs` / 运行期 `globalThis.__RAIN_CAPACITOR_IPC__` 覆盖。
 * 超时 ⇒ reject `code:'IPC_TIMEOUT'`，**并且**向原生补发 `{kind:'cancel', id, reason:'timeout'}`。
 *
 * **取消**（契约里的"取消"语义，形状在此明确）：
 * 1. **JS 主动**：只发生在超时之后（见上）。之所以不提供公开的"按 id 取消"API ——
 *    `bridge` 的 7 个成员是两端共用契约（`./index.js`、`./web.js`、`./desktop.js` 同一个表），
 *    而 `invoke` 的返回值必须是纯 Promise（`rendererInvoke` 是 `async`，会把它拆成裸值），
 *    调用方**拿不到** id。等真有调用方需要时再加，形状就是本文件的 `postCancel(channel, id, reason)`。
 * 2. **原生主动**：原生随时可以推 `{kind:'cancel', id, reason}`（例如用户切换音源导致
 *    `winMain_request_user_api` 作废）⇒ 在途 `invoke` **reject** `code:'IPC_CANCELLED'`
 *    （`error.cancelled = true`）。
 * 3. ⚠️ 已知缺陷**不在本轮修**：`winMain_request_user_api_cancel` 在桌面端用 `rendererSend`
 *    打到 `ipcMain.handle` 注册的通道上，所以桌面端的取消从来不生效。Android 侧正确形状是
 *    **把它当普通 invoke 通道**（原生 `post` 里 `kind:'invoke'`，`args=[params]`）——
 *    本适配器不特殊处理任何通道名，也不替它做兼容。
 *
 * ## 为什么**不** import 任何 `@capacitor/*`
 *
 * 与 `src/renderer/platform/http/web.js` 同一条约定：桌面产物、纯浏览器、Node 单测都要能加载
 * 本文件。接入方式是**注入点**（`globalThis.__RAIN_CAPACITOR_IPC__`，形状见 `capacitorIpc`），
 * 真实解析顺序：
 * 1. `capacitorIpc.plugin`（单测 / 真机 `chrome://inspect` 调试注入）；
 * 2. `globalThis.Capacitor.Plugins["RainMusicIpc"]` —— **Android 原生桥注入的那个对象**。
 *    证据（本机读到的本地源码）：`node_modules/@capacitor/android@8.5.2` 的
 *    `capacitor/src/main/java/com/getcapacitor/JSExport.java:59-92` 为**每个已注册插件**注入
 *    `window.Capacitor.Plugins[<id>]`，其中 `addListener` 直通 `Capacitor.addListener`
 *    （`:72-76`），每个 `@PluginMethod` 直通 `Capacitor.nativePromise(<id>, <method>, options)`
 *    （`:184`）。也就是说 **页面上根本不需要 `@capacitor/core` 参与**。
 * 3. `globalThis.Capacitor.registerPlugin("RainMusicIpc")` —— 万一 `@capacitor/core` 已经被
 *    别的模块加载过（`@capacitor/core/dist/index.js:190` 把 `registerPlugin` 挂到
 *    `window.Capacitor` 上），就用它。
 * 4. 都没有 ⇒ **大声抛错**（消息里含"尚未实现"，与 `./web.js` 的占位实现同一句判定文本，
 *    这样 `@renderer/platform/ipcFallback` 仍然把它归类成 `reason=unsupported`）。
 *
 * ## 时机（为什么是懒接入，而不是模块加载时就订阅）
 *
 * `src/common/rendererIpc.ts` 在 `main.ts` 的模块求值期就被 import。如果在模块顶层就去拿插件，
 * 纯浏览器 / 本机 strict 探针（只有最小 `window.Capacitor` mock、没有插件）里会**加载即抛错**
 * —— 那正是阻塞点 #1/#2 的形状，页面会全白。所以这里**只在第一次真正用到桥的时候**
 * 才解析插件并订阅 `ipcMessage`；在此之前模块求值零副作用。
 *
 * ⚠️ **未验证**：本机没有 Android SDK、没有真机，本文件与原生插件只经过
 * `node --test` 的 mock 插件 + `npm run build:web`；真机行为（插件可见性、事件时机、
 * `notifyListeners` 的数据形状）只能由 CI 的 Android 构建 + 真机运行来证伪。
 */

/**
 * 与 `./desktop.js` / `./web.js` 共用的接口形状（有意重复声明：三个文件必须逐条对齐，
 * 交叉 import 一个 JSDoc typedef 会让 `checkJs` 的解析依赖路径，不值得）。
 *
 * 与另外两个适配器的**唯一**差别：`send` / `invoke` 写成变参 `(channel, ...args)`。
 * `rendererIpc.ts` 的调用形状 `(name, params)` 对变参函数完全兼容，所以契约没变。
 *
 * @typedef {object} IpcBridge
 * @property {(channel: string, ...args: unknown[]) => void} send
 * @property {(channel: string, ...args: unknown[]) => never} sendSync
 * @property {(channel: string, ...args: unknown[]) => Promise<any>} invoke
 * @property {(channel: string, listener: (payload: { event: any, params: any }) => void) => void} on
 * @property {(channel: string, listener: (payload: { event: any, params: any }) => void) => void} once
 * @property {(channel: string, listener: (...args: any[]) => any) => void} off
 * @property {(channel: string) => void} offAll
 */

/** `Error.code` 的取值集合（原生侧的错误信封用同一套字符串）。 */
export const IPC_ERROR_CODES = {
  /** 页面上根本找不到原生插件（web 构建跑在没有原生桥的环境：纯浏览器 / 占位替代）。 */
  BRIDGE_UNAVAILABLE: 'IPC_BRIDGE_UNAVAILABLE',
  /** 超时（默认 15000 ms）。 */
  TIMEOUT: 'IPC_TIMEOUT',
  /** 原生侧主动取消。 */
  CANCELLED: 'IPC_CANCELLED',
  /** 请求连原生侧都没送到（`plugin.post` 抛错 / reject）。 */
  TRANSPORT: 'IPC_TRANSPORT_ERROR',
  /** 原生 handler 报错但没有给 `code`。 */
  NATIVE: 'IPC_NATIVE_ERROR',
  /** `sendSync` —— Capacitor 结构性不支持。 */
  SYNC_UNSUPPORTED: 'IPC_SYNC_UNSUPPORTED',
}

/** 默认超时（ms）。与 `src/renderer/utils/musicSdk/options.js:7` 的既有惯例一致。 */
export const DEFAULT_TIMEOUT_MS = 15000

/**
 * 接入点 + 可配置项。**默认值 = 真实原生桥**（不是 no-op）。
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `pluginName` | 原生插件 id，必须与 `RainMusicIpcPlugin.java` 的 `@CapacitorPlugin(name=…)` 一致 |
 * | `eventName` | 原生 → JS 的**唯一**事件名，必须与原生 `notifyListeners` 用的一致 |
 * | `timeoutMs` | `invoke` 的超时；`<=0` 表示不超时（不推荐） |
 * | `plugin` | 注入的插件实现（单测 / 真机调试）；非 null 时**不**看 `globalThis.Capacitor` |
 *
 * 运行期覆盖（真机用 chrome://inspect 调，不用重新打包）：
 * ```js
 * globalThis.__RAIN_CAPACITOR_IPC__ = { plugin: myPlugin, timeoutMs: 30000 }
 * ```
 */
export const capacitorIpc = {
  pluginName: 'RainMusicIpc',
  eventName: 'ipcMessage',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  plugin: null,
}

// 模块初始化时读一次运行期覆盖（与 `src/renderer/platform/http/web.js:173` 同款）。
// 用属性访问而不是裸标识符：Android WebView 里 `globalThis` 一定有，但注入点不一定。
const scope = /** @type {any} */ (globalThis)
if (scope.__RAIN_CAPACITOR_IPC__) Object.assign(capacitorIpc, scope.__RAIN_CAPACITOR_IPC__)

/** 信封里的 `kind`（JS → 原生）。 */
const KIND_INVOKE = 'invoke'
const KIND_SEND = 'send'
const KIND_CANCEL = 'cancel'
/** 信封里的 `kind`（原生 → JS）。 */
const KIND_RESPONSE = 'response'
const KIND_EVENT = 'event'

/** 每次加载一个随机标签，只用于让 id 在"WebView 重建"后不与上一会话相撞。 */
const SESSION_TAG = Math.random().toString(36).slice(2, 8) || 'session'
let requestSeq = 0
const nextRequestId = () => `ipc-${SESSION_TAG}-${++requestSeq}`

/** 在途请求：id → { channel, resolve, reject, timer }。 */
const pending = new Map()
/** 已了结的 id → 原因（'responded' | 'timeout' | 'cancelled' | 'transport-failed'），只用于把"迟到应答"与"未知 id"区分开。 */
const settled = new Map()
const SETTLED_MEMORY = 128
/** 通道 → (原始 listener → { once })。用原始 listener 当 key，`off` 才是有效的。 */
const listeners = new Map()
/** 已经提示过"没有监听者"的通道（避免刷屏）。 */
const warnedUnhandledChannels = new Set()

/** 非 null = 原生事件已订阅（true 或订阅句柄的 Promise）。 */
let transportAttached = null
/** 已解析出的插件对象（`capacitorIpc.plugin` 的注入不经这里，见 `resolvePlugin`）。 */
let resolvedPlugin = null

const isThenable = value => value != null && typeof value.then === 'function'

const describe = error => {
  if (error == null) return String(error)
  if (typeof error === 'string') return error
  const message = error instanceof Error ? error.message : /** @type {any} */ (error).message
  if (typeof message === 'string' && message !== '') return message
  return safeStringify(error)
}

/** `JSON.stringify` 在循环引用 / BigInt 上会抛，这里兜底成 `String(value)`（日志路径不能反噬调用方）。 */
const safeStringify = value => {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(value)
  }
}

const rememberSettled = (id, reason) => {
  settled.set(id, reason)
  while (settled.size > SETTLED_MEMORY) settled.delete(settled.keys().next().value)
}

/**
 * 把 `send` / `invoke` 的变参归一化为信封里的 `args` 数组。
 *
 * 去掉**尾部**的 `undefined`：Capacitor 的信封要过 JSON 序列化，`undefined` 会变成 `null`
 * 或被丢掉，`[null]` 会让原生侧把"没传参数"读成"传了 null"。
 * （`rendererSend(name)` / `rendererInvoke(name)` 不带参数时就是这种情况，很常见。）
 */
const normalizeArgs = args => {
  let end = args.length
  while (end > 0 && args[end - 1] === undefined) end--
  return args.slice(0, end)
}

/**
 * 找不到原生插件时的错误。文案里含 **"尚未实现"** 是有意的：
 * `src/renderer/platform/ipcFallback/web.js:61` 靠这个子串把失败归类成 `reason=unsupported`
 * （"桥没接上"）而不是 `failed`（"handler 报错"）。本地 strict 探针的告警文案因此不变。
 */
const BRIDGE_UNAVAILABLE_TEXT =
  'Rain Music Android: Capacitor IPC 传输桥尚未实现 —— 页面上找不到原生插件。' +
  '需要 android 侧注册 RainMusicIpcPlugin 并由 Capacitor 注入 window.Capacitor.Plugins' +
  '（src/common/platform/ipcBridge/capacitor.js 的接入点见文件头；契约见 docs/android/ipc-contract.md）。'

const bridgeUnavailableError = (channel, method) => Object.assign(
  new Error(`${BRIDGE_UNAVAILABLE_TEXT} 被调用的通道：${method}("${channel}")`),
  { code: IPC_ERROR_CODES.BRIDGE_UNAVAILABLE, channel, method },
)

/** 解析原生插件（顺序与文件头"为什么**不** import 任何 `@capacitor/*`"一致）。没有时返回 null。 */
const resolvePlugin = () => {
  if (capacitorIpc.plugin) return capacitorIpc.plugin
  if (resolvedPlugin) return resolvedPlugin

  const Capacitor = scope.Capacitor
  if (Capacitor == null) return null

  const plugins = Capacitor.Plugins
  const injected = plugins == null ? null : plugins[capacitorIpc.pluginName]
  if (injected != null && typeof injected.post === 'function') {
    resolvedPlugin = injected
    return resolvedPlugin
  }

  if (typeof Capacitor.registerPlugin === 'function') {
    resolvedPlugin = Capacitor.registerPlugin(capacitorIpc.pluginName)
    return resolvedPlugin
  }

  return null
}

/** 拿到可用插件，或**大声抛错**（绝不返回空实现 —— 那会让"缺桥"变成"静默失效"）。 */
const requirePlugin = (channel, method) => {
  const plugin = resolvePlugin()
  if (plugin == null || typeof plugin.post !== 'function') throw bridgeUnavailableError(channel, method)
  return plugin
}

/**
 * 懒订阅原生事件（整个页面只订阅一次）。
 *
 * ⚠️ 两种 `addListener` 形状都要吃下：
 * - Android 原生桥注入的 `Plugins.X.addListener` 返回 `{ remove }`（**同步**，
 *   `JSExport.java:72-76` → `native-bridge.js:183-194`）；
 * - `@capacitor/core` 的 `registerPlugin(X).addListener` 返回 `Promise<{ remove }>`。
 * 注入路径是同步的，所以"`invoke` 里先 `attachTransport()` 再 `post`"不存在丢应答的竞态。
 */
const attachTransport = () => {
  if (transportAttached) return
  const plugin = requirePlugin(capacitorIpc.eventName, 'addListener')
  if (typeof plugin.addListener !== 'function') {
    throw bridgeUnavailableError(capacitorIpc.eventName, 'addListener')
  }

  let handle
  try {
    handle = plugin.addListener(capacitorIpc.eventName, onNativeMessage)
  } catch (error) {
    console.error(`[ipcBridge/capacitor] 订阅原生事件 "${capacitorIpc.eventName}" 失败：${describe(error)}`)
    return
  }

  if (isThenable(handle)) {
    // ⚠️ 必须把 catch 接在**同一个** Promise 上：`Promise.resolve(handle)` 单独存下来、
    // 再另接一条 `.catch`，会让第一个 Promise 的 rejection 变成未处理 rejection
    // （strict 探针里会被 `unhandledrejection` 计数，见 docs/android/web-runtime-blockers.md §4.5）。
    transportAttached = Promise.resolve(handle).catch(error => {
      transportAttached = null // 允许下一次调用重试（并且**不静默**）
      console.error(`[ipcBridge/capacitor] 订阅原生事件 "${capacitorIpc.eventName}" 失败：${describe(error)}`)
      return null
    })
  } else {
    transportAttached = true
  }
}

/** 原生事件里真正承担信息的那个对象（容忍 `{ data: {...} }` 包装）。 */
const unwrapMessage = payload => {
  if (payload == null || typeof payload !== 'object') return null
  if (typeof payload.kind === 'string') return payload
  const inner = payload.data
  if (inner != null && typeof inner === 'object' && typeof inner.kind === 'string') return inner
  return null
}

/** 原生侧回了一个错误 ⇒ 造一个**带结构**的 Error（绝不吞、绝不 resolve 成 undefined）。 */
const nativeError = (message, channel) => {
  const remote = message.error != null && typeof message.error === 'object' ? message.error : {}
  const text = typeof remote.message === 'string' && remote.message !== ''
    ? remote.message
    : `原生侧返回了失败但没有给出 message（${safeStringify(message)}）`
  const code = typeof remote.code === 'string' && remote.code !== ''
    ? remote.code
    : IPC_ERROR_CODES.NATIVE
  return Object.assign(
    new Error(`原生 handler 报错（channel="${String(channel)}", code=${code}）：${text}`),
    {
      code,
      channel: channel ?? message.channel ?? null,
      requestId: typeof message.id === 'string' ? message.id : null,
      remote,
    },
  )
}

const clearEntryTimer = entry => {
  if (entry != null && entry.timer != null) clearTimeout(entry.timer)
}

/** 应答到达：**只按 id 配对**（与到达顺序无关 ⇒ 乱序回包天然正确）。 */
const onNativeResponse = message => {
  const id = message.id
  if (typeof id !== 'string' || id === '') {
    console.error(`[ipcBridge/capacitor] 原生应答缺少 id，无法配对，已丢弃：${safeStringify(message)}`)
    return
  }

  const entry = pending.get(id)
  if (entry == null) {
    const reason = settled.get(id)
    if (reason != null) {
      console.warn(
        `[ipcBridge/capacitor] 忽略迟到/重复的应答（id=${id}, channel=${String(message.channel)}, ` +
        `该请求已 ${reason}）：${safeStringify(message)}`,
      )
    } else {
      console.error(`[ipcBridge/capacitor] 收到未知 id 的应答，已丢弃（id=${id}）：${safeStringify(message)}`)
    }
    return
  }

  // 配对正确、但通道名对不上 = 原生侧串包了，必须点名（仍然按 id 交付，不丢结果）。
  if (typeof message.channel === 'string' && message.channel !== '' && message.channel !== entry.channel) {
    console.error(
      `[ipcBridge/capacitor] 应答的 channel 与在途请求不一致（id=${id}）：` +
      `请求 "${entry.channel}"，应答 "${message.channel}"。按 id 交付，但这是原生侧的串包。`,
    )
  }

  clearEntryTimer(entry)
  pending.delete(id)
  rememberSettled(id, 'responded')

  // 明确失败 = `ok === false`；另外容忍原生侧"带了 error 却忘了 ok"的情况 ——
  // 那种信封如果按成功 resolve，就是一个**静默吞掉的错误**，正是本层要防的事。
  const failed = message.ok === false || (message.ok == null && message.error != null)
  if (failed) entry.reject(nativeError(message, entry.channel))
  else entry.resolve(message.result)
}

/** 原生主动取消（取消语义 2/2）：在途请求必须以 `IPC_CANCELLED` reject，不是静默消失。 */
const onNativeCancel = message => {
  const id = message.id
  if (typeof id !== 'string' || id === '') {
    console.error(`[ipcBridge/capacitor] 原生取消通知缺少 id，已丢弃：${safeStringify(message)}`)
    return
  }

  const entry = pending.get(id)
  if (entry == null) {
    console.warn(
      `[ipcBridge/capacitor] 收到原生的取消通知，但该请求已不在途（id=${id}, ` +
      `reason=${String(message.reason)}）：${safeStringify(message)}`,
    )
    return
  }

  clearEntryTimer(entry)
  pending.delete(id)
  rememberSettled(id, 'cancelled')

  entry.reject(Object.assign(
    new Error(
      `平台通道 "${entry.channel}" 的请求被原生侧取消（id=${id}, reason=${String(message.reason)}）`,
    ),
    {
      code: IPC_ERROR_CODES.CANCELLED,
      cancelled: true,
      channel: entry.channel,
      requestId: id,
      reason: message.reason ?? null,
    },
  ))
}

/** 原生广播（`kind:'event'`）→ 派发 `{ event, params: args[0] }`，与桌面 `ipcRenderer.on` 的包装同形。 */
const dispatchChannelEvent = message => {
  const channel = message.channel
  if (typeof channel !== 'string' || channel === '') {
    console.error(`[ipcBridge/capacitor] 原生广播缺少 channel，已丢弃：${safeStringify(message)}`)
    return
  }

  const bucket = listeners.get(channel)
  if (bucket == null || bucket.size === 0) {
    // 广播没有监听者：桌面端 Electron 也是静默丢弃的，但"静默"正是最难查的一类失败，
    // 所以这里每条通道**提示一次**（不是每次）。
    if (!warnedUnhandledChannels.has(channel)) {
      warnedUnhandledChannels.add(channel)
      console.warn(
        `[ipcBridge/capacitor] 原生广播 "${channel}" 到达时渲染层没有监听者，已丢弃` +
        '（同一通道只提示一次；这条广播不会重放）。',
      )
    }
    return
  }

  const args = Array.isArray(message.args) ? message.args : []
  const event = { channel, kind: KIND_EVENT, source: 'capacitor-ipc-bridge', id: message.id ?? null }

  // 快照派发：监听器里 `off` / `once` 都不会影响本次派发。
  for (const [listener, meta] of [...bucket.entries()]) {
    if (meta.once) bucket.delete(listener)
    try {
      listener({ event, params: args[0] })
    } catch (error) {
      // 一个监听器抛错不能打断整条桥（Electron 下会变成 window.onerror，这里没有那个宿主钩子）。
      console.error(`[ipcBridge/capacitor] 监听器抛错（channel="${channel}"）：${describe(error)}`)
    }
  }
  if (bucket.size === 0) listeners.delete(channel)
}

/** 原生事件入口（唯一的 `addListener` 回调）。任何形状不对的消息都会**被点名**，不会静默。 */
const onNativeMessage = payload => {
  const message = unwrapMessage(payload)
  if (message == null) {
    console.error(`[ipcBridge/capacitor] 收到无法解析的原生消息，已丢弃：${safeStringify(payload)}`)
    return
  }

  switch (message.kind) {
    case KIND_RESPONSE: return onNativeResponse(message)
    case KIND_EVENT: return dispatchChannelEvent(message)
    case KIND_CANCEL: return onNativeCancel(message)
    default:
      console.error(
        `[ipcBridge/capacitor] 未知的原生消息 kind=${safeStringify(message.kind)}，已丢弃：${safeStringify(message)}`,
      )
  }
}

/** 超时（取消语义 1/2）：reject 调用方 + 通知原生停止这次请求。 */
const onRequestTimeout = id => {
  const entry = pending.get(id)
  if (entry == null) return

  pending.delete(id)
  rememberSettled(id, 'timeout')

  const timeoutMs = Number(capacitorIpc.timeoutMs)
  entry.reject(Object.assign(
    new Error(
      `平台通道 "${entry.channel}" 在 ${timeoutMs} ms 内没有应答（IPC 超时, id=${id}）。` +
      '原生侧很可能还没有注册这条通道的 handler（见 docs/android/web-runtime-blockers.md 的 P0-2），' +
      '或 handler 卡住了。桥已向原生发出取消通知。',
    ),
    { code: IPC_ERROR_CODES.TIMEOUT, timeoutMs, timedOut: true, channel: entry.channel, requestId: id },
  ))

  postCancel(entry.channel, id, 'timeout')
}

/** 向原生发一条取消通知。失败只 warn：调用方已经拿到超时错误了，这里不是新的正确性来源。 */
const postCancel = (channel, id, reason) => {
  const plugin = resolvePlugin()
  if (plugin == null || typeof plugin.post !== 'function') return

  const envelope = { id, kind: KIND_CANCEL, channel, args: [], reason }
  try {
    const result = plugin.post(envelope)
    if (isThenable(result)) {
      Promise.resolve(result).catch(error => {
        console.warn(`[ipcBridge/capacitor] 取消通知没有送达原生侧（id=${id}, reason=${reason}）：${describe(error)}`)
      })
    }
  } catch (error) {
    console.warn(`[ipcBridge/capacitor] 取消通知没有送达原生侧（id=${id}, reason=${reason}）：${describe(error)}`)
  }
}

/** `send` 的投递：`send` 的签名是 `void`，所以投递失败只能 `console.error`（**不静默**）。 */
const deliver = (plugin, envelope) => {
  try {
    const result = plugin.post(envelope)
    if (isThenable(result)) {
      Promise.resolve(result).catch(error => {
        console.error(
          `[ipcBridge/capacitor] send("${envelope.channel}") 投递失败（id=${envelope.id}）：${describe(error)}`,
        )
      })
    }
  } catch (error) {
    console.error(
      `[ipcBridge/capacitor] send("${envelope.channel}") 投递失败（id=${envelope.id}）：${describe(error)}`,
    )
  }
}

const subscribe = (channel, listener, once) => {
  if (typeof listener !== 'function') {
    throw Object.assign(
      new TypeError(`[ipcBridge/capacitor] on/once("${channel}") 的 listener 必须是函数，收到 ${typeof listener}`),
      { channel },
    )
  }
  attachTransport()

  let bucket = listeners.get(channel)
  if (bucket == null) {
    bucket = new Map()
    listeners.set(channel, bucket)
  }
  bucket.set(listener, { once: once === true })
}

/** @type {IpcBridge} */
export const bridge = {
  send(channel, ...args) {
    const plugin = requirePlugin(channel, 'send')
    attachTransport()
    deliver(plugin, { id: nextRequestId(), kind: KIND_SEND, channel, args: normalizeArgs(args) })
  },

  sendSync(channel) {
    // Capacitor 只有异步桥：同步等待原生回应会把 WebView 的 JS 线程锁死，结构性不可实现。
    // 不返回假值 —— 立刻、点名地抛。
    throw Object.assign(
      new Error(
        `Rain Music Android: Capacitor IPC 桥不支持同步 IPC（sendSync("${channel}")）。` +
        '原生桥只有异步通道，请改用 invoke（请求/应答）或 send（单向）。',
      ),
      { code: IPC_ERROR_CODES.SYNC_UNSUPPORTED, channel },
    )
  },

  invoke(channel, ...args) {
    const plugin = requirePlugin(channel, 'invoke')
    attachTransport()

    const id = nextRequestId()
    const envelope = { id, kind: KIND_INVOKE, channel, args: normalizeArgs(args) }
    const timeoutMs = Number(capacitorIpc.timeoutMs)

    return new Promise((resolve, reject) => {
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => onRequestTimeout(id), timeoutMs) : null
      pending.set(id, { channel, resolve, reject, timer })

      // `plugin.post` 可能**同步抛**（缺方法、原生侧立刻拒绝）也可能 reject。
      // 两种都必须让调用方马上 reject，而不是干等到超时。
      Promise.resolve()
        .then(() => plugin.post(envelope))
        .catch(error => {
          const entry = pending.get(id)
          if (entry == null) return // 已经应答/超时/被取消：那条路径已经给过结论了
          clearEntryTimer(entry)
          pending.delete(id)
          rememberSettled(id, 'transport-failed')
          entry.reject(Object.assign(
            new Error(`平台通道 "${entry.channel}" 的请求没有送达原生侧（id=${id}）：${describe(error)}`),
            { code: IPC_ERROR_CODES.TRANSPORT, channel: entry.channel, requestId: id, cause: error },
          ))
        })
    })
  },

  on(channel, listener) {
    subscribe(channel, listener, false)
  },

  once(channel, listener) {
    subscribe(channel, listener, true)
  },

  off(channel, listener) {
    const bucket = listeners.get(channel)
    if (bucket == null) return
    // 用**原始 listener** 作 key（与 `rendererOff(name, listener)` 的调用约定一致）。
    bucket.delete(listener)
    if (bucket.size === 0) listeners.delete(channel)
  },

  offAll(channel) {
    listeners.delete(channel)
  },
}
