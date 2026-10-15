import { filterSources, httpUrl, parseScriptInfo, requestResult } from './contract'

const STATUS = 'winMain_user_api_status'
const UPDATE = 'winMain_user_api_show_update_alert'
const errorText = error => String(error?.message ?? error).substring(0, 1024)
const publicApi = ({ script, ...info }) => ({ ...info })

/** Host owns storage and transport. Script execution and helpers live only in its Worker. */
export const createUserApiHost = ({ storage, createSession, httpRequest, emit = () => {}, requestTimeoutMs = 20000, initTimeoutMs = 15000 }) => {
  let snapshot = null
  let readPromise
  let mutations = Promise.resolve()
  let generation = 0
  let session = null
  let selected = null
  let status = { status: false, message: 'user api is not load' }
  let initPending = null
  const pending = new Map()
  const http = new Map()

  const publish = next => {
    status = next
    emit(STATUS, structuredClone(next))
  }
  const read = async() => {
    readPromise ??= Promise.resolve().then(() => storage.read()).then(value => {
      if (value == null) return { version: 1, apis: [], selectedId: '' }
      if (value.version !== 1 || !Array.isArray(value.apis) || typeof value.selectedId !== 'string') throw new Error('Invalid persisted user API data')
      const ids = new Set()
      for (const api of value.apis) {
        if (!api || typeof api.id !== 'string' || !/^user_api_/.test(api.id) || ids.has(api.id) || typeof api.allowShowUpdateAlert !== 'boolean') throw new Error('Invalid persisted user API entry')
        parseScriptInfo(api.script)
        ids.add(api.id)
      }
      return structuredClone(value)
    }).then(value => { snapshot = value; return value }).catch(error => { readPromise = null; throw error })
    return readPromise
  }
  // Serialize writes and install in-memory state only after a confirmed durable write.
  const mutate = operation => {
    const result = mutations.then(async() => {
      await read()
      const next = structuredClone(snapshot)
      const value = operation(next)
      await storage.write(next)
      // Writes execute exclusively on the mutations chain above.
      // eslint-disable-next-line require-atomic-updates
      snapshot = next
      return value
    })
    mutations = result.catch(() => {})
    return result
  }
  const settle = (key, error, value) => {
    const entry = pending.get(key)
    if (!entry) return
    pending.delete(key)
    clearTimeout(entry.timer)
    if (error) entry.reject(error)
    else entry.resolve(value)
  }
  const stop = (reason = 'source changed') => {
    generation++
    if (initPending) {
      clearTimeout(initPending.timer)
      initPending.reject(new Error(reason))
      initPending = null
    }
    for (const key of pending.keys()) settle(key, new Error(reason))
    for (const item of http.values()) { clearTimeout(item.timer); item.abort?.() }
    http.clear()
    session?.terminate()
    session = null
    selected = null
  }
  const fail = error => {
    const apiInfo = selected ? publicApi(selected) : undefined
    stop(errorText(error))
    publish({ status: false, apiInfo, message: errorText(error) })
  }
  const startHttp = (message, currentGeneration) => {
    const key = message.id
    const reply = (error, response, body) => {
      const entry = http.get(key)
      if (!entry || currentGeneration !== generation) return
      clearTimeout(entry.timer)
      http.delete(key)
      session.post({ kind: 'httpResult', id: key, error: error ? errorText(error) : null, response, body })
    }
    try {
      httpUrl(message.url)
      if (typeof key !== 'string' || http.has(key) || http.size >= 64) throw new Error('HTTP request limit exceeded')
      const options = message.options ?? {}
      if (options.formData != null) throw new Error('Unsupported capability: multipart formData')
      if (options.method && !/^(get|post|put|patch|delete|head|options)$/i.test(options.method)) throw new Error('Unsupported HTTP method')
      const timeout = Number(options.timeout) > 0 ? Math.min(Number(options.timeout), 60000) : 60000
      const entry = { abort: null, timer: null }
      http.set(key, entry)
      entry.timer = setTimeout(() => {
        entry.abort?.()
        reply(new Error('HTTP timeout'))
      }, timeout)
      entry.abort = httpRequest(message.url, { ...options, timeout }, reply)
    } catch (error) {
      if (http.has(key)) reply(error)
      else session?.post({ kind: 'httpResult', id: key, error: errorText(error) })
    }
  }
  const onMessage = (message, currentGeneration) => {
    if (generation !== currentGeneration || !message || !session) return
    switch (message.kind) {
      case 'init':
        if (!initPending) return
        try {
          const sources = filterSources(message.info)
          clearTimeout(initPending.timer)
          const resolve = initPending.resolve
          initPending = null
          publish({ status: true, apiInfo: { ...publicApi(selected), sources } })
          resolve()
        } catch (error) { fail(error) }
        break
      case 'fatal': fail(new Error(message.message)); break
      case 'response': {
        const request = pending.get(message.requestKey)
        if (!request) return
        try {
          if (!message.status) throw new Error(message.message || 'User API request failed')
          settle(message.requestKey, null, requestResult(request.data, message.response))
        } catch (error) { settle(message.requestKey, error) }
        break
      }
      case 'http': startHttp(message, currentGeneration); break
      case 'httpCancel': {
        const entry = http.get(message.id)
        if (!entry) return
        clearTimeout(entry.timer)
        http.delete(message.id)
        entry.abort?.()
        break
      }
      case 'update':
        if (!selected.allowShowUpdateAlert) return
        if (typeof message.info?.log !== 'string' || !message.info.log) return
        { // Update links are data for a later user action; invalid schemes are never forwarded.
          let updateUrl
          try { updateUrl = httpUrl(message.info.updateUrl) } catch (_) {}
          emit(UPDATE, { name: selected.name, description: selected.description, log: message.info.log.substring(0, 1024), updateUrl })
        }
        break
      default: fail(new Error(`Unsupported Worker message: ${message.kind}`))
    }
  }

  const host = {
    async importApi(script) {
      const info = parseScriptInfo(script)
      return mutate(next => {
        if (next.apis.some(api => api.script === script)) throw new Error('导入失败，脚本内容与已有的源相同')
        const api = { id: `user_api_${Date.now()}_${globalThis.crypto.randomUUID()}`, ...info, script, allowShowUpdateAlert: true }
        next.apis.push(api)
        return { apiInfo: publicApi(api), apiList: next.apis.map(publicApi) }
      })
    },
    async getApiList() { await read(); return structuredClone(snapshot.apis.map(publicApi)) },
    async removeApi(ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid user API ids')
      const list = await mutate(next => {
        next.apis = next.apis.filter(api => !ids.includes(api.id))
        if (ids.includes(next.selectedId)) next.selectedId = ''
        return next.apis.map(publicApi)
      })
      if (selected && ids.includes(selected.id)) { stop(); publish({ status: false, message: 'user api removed' }) }
      return list
    },
    async setApi(id) {
      if (typeof id !== 'string') throw new Error('Invalid user API id')
      const api = await mutate(next => {
        // Resolve the script within the serialized mutation, not an earlier snapshot:
        // a simultaneous removal/permission change may already have committed.
        const target = next.apis.find(api => api.id === id)
        if (!target && /^user_api/.test(id)) throw new Error('api not found')
        next.selectedId = target ? id : ''
        return target ? structuredClone(target) : null
      })
      stop()
      if (!api) { publish({ status: false, message: 'user api is not load' }); return }
      selected = structuredClone(api)
      // The renderer already marks this source as initializing. Its status
      // event handler treats false as a terminal failure and settles playback
      // readiness permanently, so only publish the final init result.
      status = { status: false, apiInfo: publicApi(selected), message: 'initing' }
      const currentGeneration = generation
      return new Promise((resolve, reject) => {
        initPending = { resolve, reject, timer: setTimeout(() => fail(new Error('User API init timeout')), initTimeoutMs) }
        try {
          session = createSession(message => onMessage(message, currentGeneration), error => { if (generation === currentGeneration) fail(error) })
          session.post({ kind: 'load', api: selected })
        } catch (error) { fail(error) }
      })
    },
    async restoreSelection() { await read(); if (snapshot.selectedId) await host.setApi(snapshot.selectedId) },
    async getStatus() { return structuredClone(status) },
    async setAllowShowUpdateAlert(id, enable) {
      if (typeof enable !== 'boolean') throw new Error('Invalid update alert permission')
      await mutate(next => {
        const api = next.apis.find(api => api.id === id)
        if (!api) throw new Error('api not found')
        api.allowShowUpdateAlert = enable
      })
      if (selected?.id === id) selected.allowShowUpdateAlert = enable
    },
    request({ requestKey, data } = {}) {
      if (!session || !status.status) return Promise.reject(new Error('user api is not ready'))
      if (typeof requestKey !== 'string' || !requestKey || !data) return Promise.reject(new Error('Invalid request'))
      const source = Object.hasOwn(status.apiInfo.sources, data.source) ? status.apiInfo.sources[data.source] : null
      if (!source || !source.actions.includes(data.action)) return Promise.reject(new Error('Unsupported source/action'))
      if (data.action === 'musicUrl' && data.source !== 'local' && !source.qualitys.includes(data.info?.type)) return Promise.reject(new Error('Unsupported quality'))
      if (pending.has(requestKey)) host.cancelRequest(requestKey)
      if (pending.size >= 128) return Promise.reject(new Error('User API request limit exceeded'))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          session?.post({ kind: 'cancel', requestKey })
          settle(requestKey, new Error('User API request timeout'))
        }, requestTimeoutMs)
        pending.set(requestKey, { resolve, reject, timer, data: structuredClone(data) })
        try { session.post({ kind: 'request', requestKey, data }) } catch (error) { settle(requestKey, error) }
      })
    },
    cancelRequest(requestKey) {
      session?.post({ kind: 'cancel', requestKey })
      settle(requestKey, new Error('Cancel request'))
    },
    dispose() { stop('Host disposed') },
  }
  return host
}
