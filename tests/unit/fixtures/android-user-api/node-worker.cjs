const { parentPort } = require('node:worker_threads')
const load = require('./load.cjs')
const { installUserApiWorker } = load(require('node:path').join(process.env.RAIN_USER_API_TEST_ROOT || require('node:path').resolve(__dirname, '../../../..'), 'src/renderer/platform/userApi/worker-runtime.js'))
const { createUserApiUtils } = load(require('node:path').join(process.env.RAIN_USER_API_TEST_ROOT || require('node:path').resolve(__dirname, '../../../..'), 'src/renderer/platform/userApi/utils.js'))
// These globals model browser Worker capabilities, rather than giving scripts Node require/process.
const vm = require('node:vm')
const context = vm.createContext({ setTimeout, clearTimeout, console, URL, Uint8Array, TextEncoder, TextDecoder, crypto: require('node:crypto').webcrypto })
context.globalThis = context
context.fetch = () => { throw new Error('direct network used') }
const listeners = new Map()
context.addEventListener = (name, handler) => listeners.set(name, handler)
context.removeEventListener = name => listeners.delete(name)
context.postMessage = message => parentPort.postMessage(message)
context.Capacitor = undefined
parentPort.once('message', message => {
  installUserApiWorker(context, createUserApiUtils(context.crypto), script => vm.runInContext(script, context))
  listeners.get('message')({ data: message })
})
