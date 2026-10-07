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
 */
const DEFAULT_TIMEOUT = 15000

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

    fetch(requestUrl, {
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
