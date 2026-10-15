import { createUserApiHost } from './host'
import { invokeUserApiChannel } from './contract'
import { transport } from '../http/web'

const STORAGE_KEY = 'rain-music.user-api.v1'

/** A single localStorage write is atomic. Quota/security/corruption failures propagate. */
export const createUserApiStorage = storage => ({
  async read() {
    const value = storage.getItem(STORAGE_KEY)
    return value == null ? null : JSON.parse(value)
  },
  async write(value) { storage.setItem(STORAGE_KEY, JSON.stringify(value)) },
})

export const createUserApiSession = (onMessage, onError) => {
  // webpack recognizes this syntax and emits a dedicated browser Worker chunk.
  // eslint-disable-next-line no-undef
  const worker = new Worker(new URL('./worker.js', import.meta.url))
  const channel = new MessageChannel()
  channel.port1.onmessage = event => onMessage(event.data)
  worker.onerror = event => { event.preventDefault(); onError(new Error(event.message || 'User API Worker failed')) }
  worker.onmessageerror = () => onError(new Error('User API Worker message could not be deserialized'))
  channel.port1.onmessageerror = () => onError(new Error('User API private message could not be deserialized'))
  worker.postMessage({ kind: 'connect', port: channel.port2 }, [channel.port2])
  return {
    post: message => channel.port1.postMessage(message),
    terminate() { channel.port1.close(); worker.terminate() },
  }
}

// Runs in the WebView so CapacitorHttp's injected fetch transport is reachable.
// No plugin object or callable bridge ever crosses into the Worker.
export const userApiHttpRequest = (url, options, callback) => {
  // 与桌面 `src/main/modules/userApi/renderer/preload.js:172-188` 逐条对齐。
  // 社区脚本只能给 `body` / `form` / `formData` —— **给不了 `json`**（桌面那份解构里就没有它），
  // 所以这里也不转发脚本的 json：
  //   - `body` ⇒ **不置** json，由 `Content-Type` 推导（needle 规则，见 `platform/http/web.js`）；
  //   - `form` ⇒ 显式 `json: false`（表单序列化）。
  // 原来这里把 `json: false` **写死**，于是"对象 body + `Content-Type: application/json`"会被
  // **表单序列化**、而头仍然是 json ⇒ 服务端按 JSON 解析直接失败。**一整类社区音源脚本因此不可用。**
  let data
  const requestOptions = {
    headers: options.headers,
    response_timeout: options.timeout,
  }
  if (options.body) {
    data = options.body
  } else if (options.form) {
    data = options.form
    requestOptions.json = false
  }
  // ⚠️ `formData`（桌面走 needle 的 multipart）**目前没有等价实现**：这里既不传数据也不置 json，
  // 等于发一个没有 body 的请求。**已登记**在 `docs/android/handoff.md` §6.4 的 W10，
  // 不要以为它已经能用。
  const request = transport.request(options.method || 'get', url, data, requestOptions, (error, response) => {
    if (error) { callback(error, null, null); return }
    let body = response.raw.toString()
    try { body = JSON.parse(body) } catch (_) {}
    callback(null, {
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: response.headers,
      raw: new Uint8Array(response.raw),
      bytes: response.raw.length,
      body,
    }, body)
  })
  return () => request.abort()
}

export const createDefaultUserApiHost = emit => {
  const host = createUserApiHost({
    storage: createUserApiStorage(globalThis.localStorage),
    createSession: createUserApiSession,
    httpRequest: userApiHttpRequest,
    emit,
  })
  return { invoke: (channel, params) => invokeUserApiChannel(host, channel, params), host }
}
