/** Install before loading untrusted code. The private MessagePort is never installed on globalThis. */
// Evaluating imported JavaScript is the purpose of this isolated Worker; never call in a WebView.
// eslint-disable-next-line no-new-func
export const installUserApiWorker = (scope, utils, evaluate = script => Function(script).call(scope)) => {
  const addEvent = scope.addEventListener.bind(scope)
  const removeEvent = scope.removeEventListener.bind(scope)
  const NativePromise = Promise
  let connected = false
  const connect = event => {
    if (connected || event.data?.kind !== 'connect' || !event.data.port) return
    connected = true
    removeEvent('message', connect)
    const port = event.data.port
    const post = port.postMessage.bind(port)
    let initialized = false
    let updateSent = false
    let requestHandler = null
    let httpSequence = 0
    const callbacks = new Map()
    const requests = new Map()
    const fatal = error => post({ kind: 'fatal', message: String(error?.message ?? error).substring(0, 1024) })
    // A Worker has no WebView's Capacitor object. Disable its independent network/storage
    // surfaces too, so normal script networking must use the validated parent HTTP route.
    // 必须是**普通函数**而不是箭头函数：清单里 `XMLHttpRequest` / `WebSocket` / `WebSocketStream` /
    // `Worker` / `EventSource` 都是**构造式**用法，箭头函数没有 [[Construct]]，于是 `new WebSocket(...)`
    // 会先抛 "unsupported is not a constructor"，把真正的原因（该走 `lx.request`）盖成一句让人看不懂的
    // TypeError（网络仍然拦住了，所以这是个"可诊断性"缺陷，不是洞 —— 由上面的构造式断言抓出来）。
    const unsupported = capability => function unsupportedCapability () {
      throw new Error(`Unsupported capability: ${capability}; use lx.request`)
    }
    for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts', 'Worker', 'SharedWorker']) {
      Object.defineProperty(scope, key, { value: unsupported(key), writable: false, configurable: false })
    }
    for (const key of ['Capacitor', 'RainMusicIpc', 'indexedDB', 'caches']) {
      Object.defineProperty(scope, key, { value: undefined, writable: false, configurable: false })
    }
    // `navigator` 不是普通全局，得单独处理。**实测**（Electron 42 / Chromium 148 的真 Worker）：
    // `typeof navigator.sendBeacon === 'undefined'` —— WorkerNavigator 今天并不暴露它，所以这一条是
    // **纵深防御**、不是当前活口；但 Android 上跑的是**系统 WebView**，其 Chromium 版本不归我们钉，
    // 所以和上面 `WebTransport` / `SharedWorker` 一样，能力不存在也照钉。
    // 同一次实测里真正**存在却没被拦住**的是 `WebSocketStream`（`typeof === 'function'`）—— 那才是
    // W5 想找的那类洞，已加进上面的清单。
    const workerNavigator = scope.navigator
    if (workerNavigator != null) {
      Object.defineProperty(workerNavigator, 'sendBeacon', { value: unsupported('navigator.sendBeacon'), writable: false, configurable: false })
    }
    addEvent('error', event => fatal(event.message || 'Worker script error'))
    addEvent('unhandledrejection', event => { event.preventDefault?.(); fatal(event.reason) })
    const EVENT_NAMES = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' })
    const onLoad = api => {
      const env = Object.freeze({
        EVENT_NAMES,
        version: '2.0.0',
        env: 'mobile',
        currentScriptInfo: Object.freeze({ name: api.name, description: api.description, version: api.version, author: api.author, homepage: api.homepage, rawScript: api.script }),
        utils,
        on(eventName, handler) {
          if (eventName !== EVENT_NAMES.request || typeof handler !== 'function') return NativePromise.reject(new Error('The event is not supported: ' + eventName))
          requestHandler = handler
          return NativePromise.resolve()
        },
        send(eventName, data) {
          switch (eventName) {
            case EVENT_NAMES.inited:
              if (initialized) return NativePromise.reject(new Error('Script is inited'))
              initialized = true
              post({ kind: 'init', info: data })
              return NativePromise.resolve()
            case EVENT_NAMES.updateAlert:
              if (updateSent) return NativePromise.reject(new Error('The update alert can only be called once.'))
              if (!data || typeof data.log !== 'string' || !data.log) return NativePromise.reject(new Error('log is required.'))
              updateSent = true
              post({ kind: 'update', info: { log: data.log, updateUrl: data.updateUrl } })
              return NativePromise.resolve()
            default: return NativePromise.reject(new Error('The event is not supported: ' + eventName))
          }
        },
        request(url, options = {}, callback) {
          if (typeof callback !== 'function') throw new Error('HTTP callback is required')
          const id = `http-${++httpSequence}`
          callbacks.set(id, callback)
          try {
            post({ kind: 'http', id, url, options: { method: options.method, headers: options.headers, timeout: options.timeout, body: options.body, form: options.form, formData: options.formData } })
          } catch (error) { callbacks.delete(id); throw error }
          return () => {
            if (!callbacks.delete(id)) return
            post({ kind: 'httpCancel', id })
          }
        },
      })
      Object.defineProperty(scope, 'lx', { value: env, writable: false, configurable: false })
      Object.defineProperty(scope, 'rain', { value: env, writable: false, configurable: false })
      try { evaluate(api.script) } catch (error) { fatal(error) }
    }
    port.onmessage = ({ data: message }) => {
      switch (message.kind) {
        case 'load': onLoad(message.api); break
        case 'request': {
          const { requestKey, data } = message
          const token = {}
          requests.set(requestKey, token)
          const respond = value => {
            if (requests.get(requestKey) !== token) return
            requests.delete(requestKey)
            post({ kind: 'response', requestKey, ...value })
          }
          NativePromise.resolve().then(() => {
            if (!requestHandler) throw new Error('Request event is not defined')
            return requestHandler.call(scope.lx, { source: data.source, action: data.action, info: data.info })
          }).then(response => respond({ status: true, response })).catch(error => respond({ status: false, message: String(error?.message ?? error) }))
          break
        }
        case 'cancel': requests.delete(message.requestKey); break
        case 'httpResult': {
          const callback = callbacks.get(message.id)
          if (!callback) return
          callbacks.delete(message.id)
          const response = message.response ? { ...message.response, raw: utils.buffer.from(message.response.raw || []) } : null
          try { callback.call(scope.lx, message.error ? new Error(message.error) : null, response, message.body ?? null) } catch (error) { fatal(error) }
          break
        }
        default: fatal(new Error('Unsupported host message'))
      }
    }
    port.start?.()
  }
  addEvent('message', connect)
}
