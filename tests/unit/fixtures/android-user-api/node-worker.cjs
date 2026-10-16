const { parentPort } = require('node:worker_threads')
const load = require('./load.cjs')
const { installUserApiWorker } = load(require('node:path').join(process.env.RAIN_USER_API_TEST_ROOT || require('node:path').resolve(__dirname, '../../../..'), 'src/renderer/platform/userApi/worker-runtime.js'))
const { createUserApiUtils } = load(require('node:path').join(process.env.RAIN_USER_API_TEST_ROOT || require('node:path').resolve(__dirname, '../../../..'), 'src/renderer/platform/userApi/utils.js'))
// These globals model browser Worker capabilities, rather than giving scripts Node require/process.
const vm = require('node:vm')
const context = vm.createContext({ setTimeout, clearTimeout, console, URL, Uint8Array, TextEncoder, TextDecoder, crypto: require('node:crypto').webcrypto })
context.globalThis = context
context.fetch = () => { throw new Error('direct network used') }
// 这两个是"真 Worker 有、夹具也必须先有"的能力：`WebSocketStream` 在 Chromium 148 的真 Worker 里
// `typeof === 'function'`（实测），而 `navigator.sendBeacon` 是 `worker-runtime.js` 的纵深防御项。
// 夹具不预先放上它们，断言就会**空过**（守卫把不存在的属性 defineProperty 出来也能"成功"拦截）。
context.WebSocketStream = function WebSocketStream () { throw new Error('direct socket stream used') }
context.navigator = { userAgent: 'rain-user-api-fixture', sendBeacon: () => { throw new Error('direct beacon used') } }
const listeners = new Map()
context.addEventListener = (name, handler) => listeners.set(name, handler)
context.removeEventListener = name => listeners.delete(name)
context.postMessage = message => parentPort.postMessage(message)
context.Capacitor = undefined
parentPort.once('message', message => {
  installUserApiWorker(context, createUserApiUtils(context.crypto), script => vm.runInContext(script, context))
  listeners.get('message')({ data: message })
})
