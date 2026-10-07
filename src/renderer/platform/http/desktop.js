/**
 * 桌面（Electron 渲染进程）HTTP 传输适配器 —— needle 直通（Android 移植 · 阶段 3）。
 *
 * ## 为什么要有这一层
 *
 * `src/renderer/utils/request.js` 原来**直接** `import needle from 'needle'`，于是
 * "桌面能用 needle"这件事被写死在了音源网络层里：Android WebView 没有 Node 的
 * `http`/`https`/`net`/`tls`（`docs/android/native-bridge-needs.md` §2.6.1），
 * 整层就没法换实现。阶段 3 把"用什么发请求"收口成本文件 + `./web.js` 两个可替换实现。
 *
 * ## 契约（两个适配器必须逐条一致）
 *
 * ```
 * transport.request(method, url, data, options, callback) -> { abort() }
 * ```
 * - `method`：**已归一化**的方法名（`request.js` 保证非空，形如 `'get'`/`'post'`）。
 * - `data`：`request.js` 归并后的请求体（来自 `options.body` / `form` / `formData`）。
 * - `options`：needle 风格选项对象（`headers` / `json` / `response_timeout` / `follow_max` …）。
 * - `callback(err, response, body)`。
 * - `response`：`{ status, statusText, headers, raw }`。
 *   ⚠️ `raw` 必须是**真正的 Buffer**：`request.js` 照旧执行 `resp.raw.toString()` 得到文本，
 *   再试着 `JSON.parse`。这也是 `lx.utils.buffer` 那条对外契约所依赖的编码语义
 *   （`docs/android/native-bridge-needs.md` §2.6.3）。
 * - 返回值必须带 `abort()`：`cancelHttp()` 依赖它（契约原文是 needle 的 `.request.abort`）。
 *
 * ## 桌面为什么是"逐字等价"而不是"等价实现"
 *
 * 桌面路径仍然**原样调用 vendored needle**：同一个 `needle.request(method, url, data, options, cb)`、
 * 同一份 `options`、同一个回调时机、同一个 `.request` 取消句柄。唯一的差别是回调里把
 * needle 的 `Response`（`statusCode`/`statusMessage`/`raw`/`headers`）**投影**成上面那个形状
 * ——`status` 是阶段 3 约定的字段名（`statusCode` → `status`），`body` 仍由 `request.js`
 * 用 `raw.toString()` + `JSON.parse` 生成，与改动前完全同一行代码。
 *
 * 注意 `follow_max` 的默认值是 **0**（`vendor/needle/lib/needle.js:98`）：桌面 needle
 * **默认不跟随重定向**，3xx 的 `location` 会原样回到调用方 —— 三个歌单分享链接解析点
 * （`kg/songList.js:694`、`wy/songList.js:40`、`tx/songList.js:220`）正是靠这个行为工作的。
 * 这条语义在桌面侧**必须保持**，web 适配器读不到跨域 `Location`（见 `./web.js` 的说明）。
 */
import needle from 'needle'

export const transport = {
  request(method, url, data, options, callback) {
    return needle.request(method, url, data, options, (err, resp, body) => {
      if (err) return callback(err, null, null)
      callback(null, {
        status: resp.statusCode,
        statusText: resp.statusMessage,
        headers: resp.headers,
        raw: resp.raw,
      }, body)
    }).request
  },
}
