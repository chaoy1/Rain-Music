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
  const request = transport.request(options.method || 'get', url, options.body ?? options.form, {
    headers: options.headers,
    response_timeout: options.timeout,
    json: false,
  }, (error, response) => {
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
