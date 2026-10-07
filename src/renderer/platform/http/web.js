/**
 * Web / Capacitor（Android WebView）HTTP 传输适配器 —— 原生 `fetch`（Android 移植 · 阶段 3）。
 *
 * 本文件**只**使用 Web 平台原语（`fetch` / `AbortController` / `URLSearchParams` / `Buffer` polyfill），
 * 不 import 任何 `@capacitor/*`：Android 侧由 Capacitor 的 `CapacitorHttp` **patch 全局 fetch**
 * 走原生网络栈（`docs/android/native-bridge-needs.md` §2.6.4），因此这里只要用 fetch 就自动受益。
 * 本机没有 Android SDK / 真机，**这一段没有真机验证过**（见文件末尾"未验证"）。
 *
 * 契约与 `./desktop.js` 完全一致（`transport.request` → `{ abort() }`，`raw` 是真正的 Buffer）。
 *
 * ## 与 needle 的语义对齐（逐条）
 *
 * | 语义 | needle（桌面） | 本适配器 |
 * | --- | --- | --- |
 * | 请求体 | `data` 是 string 就用原样，否则 `json ? JSON.stringify(data) : 表单序列化` | 同（`URLSearchParams` 做表单序列化） |
 * | Content-Type | 未显式给出时：json → `application/json; charset=utf-8`，否则 `application/x-www-form-urlencoded` | 同 |
 * | Accept | `json` 请求且未显式给出 accept → `application/json` | 同 |
 * | GET + 非 json 数据 | 拼到 URL 的 query 上 | 同 |
 * | 超时 | `response_timeout`（到**响应头**为止） | 计时器在响应头到达时清除，语义相同 |
 * | 超时错误码 | Node `ETIMEDOUT` | 抛出的 error 带 `code = 'ETIMEDOUT'` |
 * | 连不上 | Node `ENOTFOUND` / `ECONNREFUSED` | 抛出的 error 带 `code = 'ENOTFOUND'` |
 * | 取消 | `.request.abort()` | `AbortController.abort()` |
 * | 重定向 | `follow_max` 默认 **0**：不跟随 | ⚠️ **有差异，见下** |
 *
 * 这样 `src/renderer/utils/request.js` 里的错误码映射（`ETIMEDOUT`/`ENOTFOUND`）与
 * `cancelHttp()` 两条既有语义**一行都不用改**，两端拿到的是同一套 `requestMsg`。
 *
 * ## ⚠️ 重定向：web 侧只能"跟随"，并把最终 URL 当 `location` 暴露
 *
 * needle 默认不跟随重定向，三个歌单分享链接解析点靠读取 3xx 的 `location` 工作
 * （`kg/songList.js:694`、`wy/songList.js:40`、`tx/songList.js:220`）。
 * 浏览器里这条路**读不到 `Location`**：
 * 1. `redirect: 'manual'` 得到的是 `opaqueredirect` 响应 —— `status === 0`、headers 全空；
 * 2. 即使能拿到响应对象，跨域下 `Location` 不是 CORS 安全列表头，没有
 *    `Access-Control-Expose-Headers: Location` 就一律被隐藏；
 * 3. `fetch` 也没有"最多跟随 N 次"的开关（`follow_max` 无法映射）。
 *
 * 因此本适配器统一 `redirect: 'follow'`，并在**确实发生过重定向**时把最终 URL
 * （`response.url`）放进 `headers.location`。三个解析点因此仍走原来的分支：
 * 读到的是"落地后的链接"而不是"第一跳的 Location"——对 `wy`/`tx` 的
 * `location == null ? link : location` 与 `kg` 的 `location.includes('chain=')` 判断，
 * 这是**信息量相同或更多**的那个 URL，但确实是行为差异，必须真机复核。
 *
 * ## ⚠️ 未验证 / 已知限制（真机验证清单）
 *
 * 1. **明文流量**：本适配器只是把请求交出去；`http://` 端点在 Android 9+ 会不会被
 *    Network Security Config 拦掉，与本文件无关（`docs/android-port-plan.md` §5，仍未验证）。
 * 2. **CORS**：纯浏览器里跨域 `fetch` 会失败；Android 侧依赖 `CapacitorHttp` 的 patch。
 * 3. **请求头**：`User-Agent` / `Referer` / `Origin` / `Cookie` 都是 fetch 的**禁止头**，
 *    纯浏览器里会被静默丢弃（不报错）。SDK 里这三个头用得很多，Android 侧必须靠
 *    `CapacitorHttp` 的原生实现带上（cap 的 patch 走原生栈，不受禁止头限制）——
 *    **没有真机验证**。
 * 4. **Cookie**：`wy` 的 `Cookie: this.cookie` 同理（`credentials` 保持默认值，
 *    needle 本身也不做跨请求 cookie 存储，语义一致）。
 * 5. **响应体编码**：`raw` 按 UTF-8 解码（`Buffer.from(bytes).toString()`）。
 *    needle 会用 iconv-lite 按 `Content-Type: charset` 解码，而 `buffer` polyfill
 *    只支持 utf8/hex/base64/latin1 等少数编码。内置音源端点都是 UTF-8
 *    （`kg/lyric.js` 显式带 `charset=utf8`），非 UTF-8 的第三方接口不保证一致。
 * 6. **表单序列化**：`URLSearchParams` 把空格编成 `+`，needle 的 `stringify` 编成 `%20`；
 *    本工程实际载荷是 base64 / hex / JSON，不含空格，**已核对**为等价。
 *
 * ## CapacitorHttp 接入点（Android 移植 · 阶段 3 / 线 B）
 *
 * 本文件**不 import 任何 `@capacitor/*`**（桌面产物、纯浏览器、Node 单测都要能加载它），
 * 接入点以"配置位 + 注入点"的形式存在。下面每一条都标了证据等级：
 * **[官方文档]** = 从 capacitorjs.com 读到的原文；**[本地源码]** = 从已安装的
 * `@capacitor/*@8.5.2` 里读到的代码；**[推测·未验证]** = 没有真机验证。
 *
 * ### 1) 怎么启用
 *
 * `CapacitorHttp` **内置于 `@capacitor/core`**，不需要装 `@capacitor/http`
 * （那个名字不是官方包；社区版是 `@capacitor-community/http`）。
 * **[官方文档]** https://capacitorjs.com/docs/apis/http 原文：
 * "This plugin is bundled with `@capacitor/core`."；
 * "By default, the patching of `window.fetch` and `XMLHttpRequest` to use native libraries is
 * disabled."
 * **[本地源码]** `node_modules/@capacitor/core/types/index.d.ts:4` 从 `./core-plugins` 导出
 * `CapacitorHttp`；`node_modules/@capacitor/cli/src/declarations.ts` 的 `PluginsConfig` 里有
 * `CapacitorHttp?: { enabled?: boolean }`（`@since 4.3.0`、`@default false`）。
 *
 * 启用方式是**配置项**，不是调用：
 *
 * ```jsonc
 * // capacitor.config.json
 * { "plugins": { "CapacitorHttp": { "enabled": true } } }
 * ```
 *
 * ### 2) 与现有 fetch 实现的关系：是 patch，不是显式调用
 *
 * **[本地源码]** `@capacitor/android@8.5.2` 的
 * `capacitor/src/main/assets/native-bridge.js:448-467` 在**原生注入的脚本**里读
 * `CapacitorHttpAndroidInterface.isEnabled()`，为 `true` 时才 `doPatchHttp`；
 * `:469` 直接把 `window.fetch` 整个替换掉，`:562` 替换 `window.XMLHttpRequest`。
 * 也就是说：
 * - **本文件一行都不用改** —— 它只用全局 `fetch`，patch 生效后自动走原生栈；
 * - patch 是**原生侧**装的，所以**纯浏览器 / Electron 里 `enabled: true` 是 no-op**
 *   （没有 `CapacitorHttpAndroidInterface`）。这一点对桌面产物正好是"零影响"；
 * - **[本地源码]** `native-bridge.js:480-482` 对**本应用自身 origin**
 *   （`cap.getServerUrl()`，即 `https://localhost`）的请求走原始 fetch，不拦；
 * - **[本地源码]** `native-bridge.js:484-510`：**GET / HEAD / OPTIONS / TRACE 不走
 *   `CapacitorHttp.request`**，而是把 URL 改写成代理 URL 后仍用原始 `fetch`
 *   （`createProxyUrl`）；只有 POST / PUT / PATCH / DELETE 才走
 *   `cap.nativePromise('CapacitorHttp', 'request', ...)`。
 *   → 本工程主要是 GET 与 POST，两种路径**都要真机验证**。
 *
 * 如果不想用 patch，也可以显式调 `CapacitorHttp.request/get/post(...)`
 * （**[官方文档]** 给的 `import { CapacitorHttp } from '@capacitor/core'`）。
 * 本文件为这种用法留了 `capacitorHttp.requestImplementation` 注入点：
 * 由 Capacitor 宿主（阶段 4/5）在启动时把一个 fetch 兼容函数塞进来，
 * 这里不写死 import。
 *
 * ### 3) UA / Referer / Origin / Cookie 这些 fetch 禁止头，启用后能带上吗？
 *
 * **分情况，且比"能"更微妙** —— 这是对阶段 3a 记录的差异 2 的细化：
 *
 * | 走法 | User-Agent | Referer / Origin / Cookie |
 * | --- | --- | --- |
 * | `fetch`（未启用 patch） | 丢弃（浏览器禁止头） | 丢弃 |
 * | `fetch`（patch 后，非 GET） | **有**：`native-bridge.js:518-525` 在 Android 上专门把 `User-Agent` 从原始 Headers（guard 为 `none`）重新捞回 `nativeHeaders` | **[本地源码] 会丢**：`:515` 用的是 `Object.fromEntries(request.headers.entries())`，而 `new Request(...)`（`:479`）的 headers guard 是 `request`，禁止头在这一步已被过滤；代码只为 UA 做了补救 |
 * | `fetch`（patch 后，GET/HEAD） | **有**：`:492-497` 改写为 `x-cap-user-agent` 再交给代理 | 同 patch 的 fetch 语义（仍是 WebView 的 fetch + 代理 URL）**[推测·未验证]** |
 * | `XMLHttpRequest`（patch 后，非 GET） | **有**：`:627-629` 改写为 `x-cap-user-agent` | **[本地源码] 有**：`:622-634` 的 `setRequestHeader` 只是存进 `this._headers`，从不调用真实 XHR，因此不受禁止头过滤 |
 * | `CapacitorHttp.request(...)` 直接调用 | **有** | **[本地源码] 有**：JS 侧把 `headers` 原样塞进 `nativePromise`，原生 `HttpRequestHandler.java:388` 取 `call.getObject("headers")` → `CapacitorHttpUrlConnection.java:153-159` 对每个 key 调 `connection.setRequestProperty(key, value)`；`HttpRequestHandler.java:404-411` 只额外处理 `x-cap-user-agent` → `User-Agent` |
 *
 * 结论：**`kg`/`wy`/`tx` 大量依赖 `User-Agent` / `Referer` / `Cookie`，而它们几乎全是 POST
 * （`form` / `data`）——这一档 `User-Agent` 有、`Referer`/`Cookie` 在 patched-fetch 路径会丢。**
 * 两个可行动作（都要真机确认）：(a) 优先验证 `CapacitorHttp.request(...)` 显式路径或
 * patched XHR 路径（两者的头都完整）；(b) 若必须用 patched fetch，把 `Cookie` / `Referer`
 * 提前并进 `Referer` 之外的可用头，或改为显式注入 `requestImplementation`。
 * ⚠️ Java 的 `HttpURLConnection` 对少数头名（`Host` / `Connection` / `Content-Length` 一类）
 * 有内置限制，`setRequestProperty` 可能静默忽略 —— **[推测·未验证]**，不在上表结论内。
 *
 * ### 4) 明文流量：CapacitorHttp 绕不过
 *
 * `CapacitorHttp` 走应用进程的原生网络栈，因此**不受 WebView 的 CORS 限制**，但**同样受
 * Android 明文流量策略约束**（API 28+ 默认禁止明文）。**[官方文档]** 本工程的
 * `capacitor.config.ts` 没有 `server` 段，而 `server.cleartext` 的官方默认值是 `false`
 * （`@capacitor/cli` 的 `declarations.ts`：`@default false`；注释原文 "Allow cleartext traffic
 * in the Web View. On Android, all cleartext traffic is disabled by default as of API 28."）。
 * 完整真机验证步骤见 `docs/android/cleartext-verification.md`。
 *
 * ### 5) 顺带纠正一条旧结论：Android 页面默认是 **https** origin
 *
 * **[本地源码]** `declarations.ts` 的 `server.androidScheme` 注释写 `@default https`
 * （`@since 1.2.0`）。既然默认 origin 是 `https://localhost`，从页面里直接 `fetch('http://…')`
 * 除了明文策略之外**还会撞混合内容（mixed content）拦截**；`android.allowMixedContent`
 * 的默认值同样是 `false`。`docs/android/native-bridge-needs.md` §2.6.4 末段
 * "源不是 HTTPS，所以 `http://` 子请求不构成混合内容拦截"的推断**对本版本不成立**，
 * 已在新文档里按实测口径改写。
 */
const DEFAULT_TIMEOUT = 15000

/**
 * `CapacitorHttp` 的接入点。**默认值 = 现状**（什么都不变，纯浏览器/桌面行为不动）。
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `mode` | `'patched-fetch'`（默认）依赖 `capacitor.config` 的原生 patch，本文件不用改；`'explicit'` 用 `requestImplementation`；`'off'` 明确声明"本平台没有原生栈"（纯浏览器调试） |
 * | `requestImplementation` | `'explicit'` 模式下使用的 **fetch 兼容函数** `(url, init) => Promise<Response>`。由 Capacitor 宿主在启动时注入，本文件不 import `@capacitor/*` |
 * | `warnOnForbiddenHeaders` | 命中 fetch 禁止头时在控制台 warn **一次**（每个头名一次）。这是差异 2 唯一的可观测信号，默认开 |
 *
 * 运行时覆盖（真机用 `chrome://inspect` 调，不用重新打包）：
 * ```js
 * globalThis.__RAIN_CAPACITOR_HTTP__ = { mode: 'explicit', requestImplementation: myAdapter }
 * ```
 */
export const capacitorHttp = {
  mode: 'patched-fetch',
  requestImplementation: null,
  warnOnForbiddenHeaders: true,
}

// 模块初始化时读一次运行期覆盖（见上面的注释）。
if (globalThis.__RAIN_CAPACITOR_HTTP__) Object.assign(capacitorHttp, globalThis.__RAIN_CAPACITOR_HTTP__)

/**
 * fetch 规范里的**禁止头**（forbidden header name）。纯浏览器里 `fetch` 会**静默丢弃**
 * 它们，不抛错 —— 这正是阶段 3a 记录的"差异 2"，也是最难查的一类失败。
 * `docs/android/native-bridge-needs.md` §2.6.4 与文件头的对照表都靠这份名单。
 */
export const FORBIDDEN_FETCH_HEADERS = [
  'user-agent', 'referer', 'referrer', 'origin', 'cookie', 'host', 'content-length',
  'connection', 'expect', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]

/** 返回 `headers` 里命中的禁止头名（小写，去重，保持出现顺序）。纯函数，便于单测。 */
export const findForbiddenHeaders = (headers) => {
  const found = []
  for (const key of Object.keys(headers || {})) {
    const name = key.toLowerCase()
    if (FORBIDDEN_FETCH_HEADERS.includes(name) && !found.includes(name)) found.push(name)
  }
  return found
}

const warnedForbiddenHeaders = new Set()

/**
 * 选出生效的 fetch 实现。
 * - `'explicit'` 且注入了实现 → 用注入的；
 * - 其它一律用全局 `fetch`（patch 生效时，全局 fetch 本身就是原生实现）。
 */
const resolveFetch = () => {
  if (capacitorHttp.mode === 'explicit' && typeof capacitorHttp.requestImplementation === 'function') {
    return capacitorHttp.requestImplementation
  }
  return globalThis.fetch
}

const hasHeader = (headers, name) => Object.keys(headers).some(key => key.toLowerCase() === name)

const toFormBody = data => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(data)) params.append(key, value == null ? '' : String(value))
  return params.toString()
}

/** 把 needle 风格的 (method, data, options) 折算出真正的 url / body / headers。 */
const buildRequest = (method, rawUrl, data, options) => {
  const headers = Object.assign({}, options.headers)
  const json = options.json === true
  let url = rawUrl
  let body

  // needle 侧是 `if (data) {...}`（真值判定），这里保持同样的判定。
  if (data) {
    if (method.toLowerCase() === 'get' && !json) {
      // needle: `uri.replace(/\?.*|$/, '?' + stringify(data))`，其中 `stringify` 是 needle
      // 自带的 `vendor/needle/lib/querystring.js`（基于 qs 的简化版）。
      url = url.replace(/\?.*|$/, '?' + toFormBody(data))
    } else {
      body = typeof data === 'string' ? data : (json ? JSON.stringify(data) : toFormBody(data))
      if (!hasHeader(headers, 'content-type')) {
        headers['Content-Type'] = json ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded'
      }
    }
  }
  // needle: `if (options.json && !options.accept && !options.headers.accept) config.headers.accept = 'application/json'`
  if (json && !hasHeader(headers, 'accept')) headers.Accept = 'application/json'

  return { url, body, headers }
}

/** 响应头 → 普通对象（与 needle 的 `resp.headers` 一样是小写键）。 */
const headersToObject = headers => {
  const out = {}
  headers.forEach((value, key) => { out[key.toLowerCase()] = value })
  return out
}

export const transport = {
  request(method, url, data, options, callback) {
    const { url: requestUrl, body, headers } = buildRequest(method, url, data, options)
    const controller = new AbortController()
    const timeout = Number(options.response_timeout) > 0 ? Number(options.response_timeout) : DEFAULT_TIMEOUT
    let timedOut = false
    let timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)

    const clear = () => {
      if (timer == null) return
      clearTimeout(timer)
      timer = null
    }

    // 差异 2 的可观测信号：纯浏览器 / 未经原生 patch 时，这些头会被**静默**丢掉。
    // 只 warn 一次（每个头名一次），并且不改变任何行为。
    if (capacitorHttp.warnOnForbiddenHeaders) {
      for (const name of findForbiddenHeaders(headers)) {
        if (warnedForbiddenHeaders.has(name)) continue
        warnedForbiddenHeaders.add(name)
        console.warn(`[http/web] 请求头 "${name}" 是 fetch 禁止头，未经原生栈（CapacitorHttp patch）时会静默丢弃：${method} ${requestUrl}`)
      }
    }

    resolveFetch()(requestUrl, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    }).then(async(res) => {
      // needle 的 response_timeout 只覆盖"到响应头为止"，拿到头就停表（见文件头对照表）。
      clear()
      const raw = Buffer.from(await res.arrayBuffer())
      const respHeaders = headersToObject(res.headers)
      if (res.redirected && res.url && !respHeaders.location) {
        // 见文件头"重定向"一节：浏览器读不到 Location，用最终 URL 顶上。
        respHeaders.location = res.url
      }
      callback(null, {
        status: res.status,
        statusText: res.statusText,
        headers: respHeaders,
        raw,
      }, raw.toString())
    }).catch((err) => {
      clear()
      const error = new Error(timedOut ? `response timeout ${timeout}ms` : (err?.message ?? String(err)))
      // 与 Node 侧同名错误码对齐，request.js 的映射表因此不用改。
      error.code = timedOut ? 'ETIMEDOUT' : 'ENOTFOUND'
      error.cause = err
      callback(error, null, null)
    })

    return {
      abort() {
        clear()
        controller.abort()
      },
    }
  },
}
