/**
 * Android 移植 · 阶段 3 / 线 B 的单测：**web/Android HTTP 适配器 + CapacitorHttp 接入点**。
 *
 * `src/renderer/platform/http/web.js` 是 Android 侧真正跑的那份传输层（webpack 用
 * `NormalModuleReplacementPlugin` 把 `platform/http/index.js` 换成它），但桌面单测一直
 * 只覆盖 `desktop.js`（`tests/unit/request-transport.test.cjs`）。本文件把它补上：
 *
 * 1. **fetch 调用形状**：本文件只用全局 `fetch`，所以这里用假 fetch 钉住
 *    `method / headers / body / redirect / signal` 的形状，以及 needle 语义的
 *    "GET + 非 json 数据拼 query"、"json → Content-Type + Accept"、"form → urlencoded"；
 * 2. **错误码映射**：超时 → `ETIMEDOUT`，其余 → `ENOTFOUND`（`request.js` 的映射表依赖它）；
 * 3. **CapacitorHttp 接入点**：默认 `mode: 'patched-fetch'` 时走全局 fetch；
 *    `mode: 'explicit'` + `requestImplementation` 注入时走注入实现（真机调试路径）；
 *    运行期覆盖 `globalThis.__RAIN_CAPACITOR_HTTP__` 生效；
 * 4. **禁止头诊断**（阶段 3a 的"差异 2"）：`findForbiddenHeaders` 是纯函数，
 *    命中时只 warn 一次（每个头名一次），且**不改变**请求头的实际内容。
 *
 * 没有真机、没有 `@capacitor/*` 运行时 import —— 本文件测的是"接入点的形状"，不是原生行为。
 */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const MODULE = 'src/renderer/platform/http/web.js'

/** 造一个够用的 `Response` 替身（本适配器只用到这几个成员）。 */
const makeResponse = (text, init = {}) => ({
  status: init.status ?? 200,
  statusText: init.statusText ?? 'OK',
  redirected: init.redirected ?? false,
  url: init.url ?? 'http://example.test/',
  headers: {
    forEach(cb) {
      for (const [key, value] of Object.entries(init.headers ?? { 'content-type': 'application/json' })) cb(value, key)
    },
  },
  arrayBuffer: async() => new TextEncoder().encode(text).buffer,
})

/** 记录调用的假 fetch。`handler` 可自定义行为（返回 Response、抛错、或挂起直到 abort）。 */
const makeFetch = (handler) => {
  const calls = []
  const fetchImpl = (url, init) => {
    calls.push({ url, init })
    return handler ? handler(url, init, calls.length) : Promise.resolve(makeResponse('ok'))
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/** 在隔离的 VM 里加载模块（`globals` 可覆盖 `fetch` / `console` / 运行期配置）。 */
const loadModule = (globals = {}) => load(MODULE, {}, {
  fetch: makeFetch(),
  AbortController,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  // 默认把禁止头 warn 静音（只有诊断相关的用例才收集它），保持 `node --test` 输出干净
  console: { log: console.log, error: console.error, warn: () => {} },
  ...globals,
})

const requestOnce = (transport, method, url, data, options) => new Promise(resolve => {
  transport.request(method, url, data, options, (err, resp, body) => resolve({ err, resp, body }))
})

test('默认配置即现状：patched-fetch + 无注入实现 + 禁止头告警开', () => {
  const mod = loadModule()
  assert.equal(mod.capacitorHttp.mode, 'patched-fetch')
  assert.equal(mod.capacitorHttp.requestImplementation, null)
  assert.equal(mod.capacitorHttp.warnOnForbiddenHeaders, true)
  // 禁止头名单必须覆盖 SDK 真正用到的四个
  for (const name of ['user-agent', 'referer', 'origin', 'cookie']) {
    assert.ok(mod.FORBIDDEN_FETCH_HEADERS.includes(name), `名单缺少 ${name}`)
  }
})

test('调用形状：GET + 非 json 数据拼到 query，POST + 对象 → JSON body 与默认头', async() => {
  const fetchImpl = makeFetch()
  const { transport } = loadModule({ fetch: fetchImpl })

  await requestOnce(transport, 'get', 'http://a.test/path?x=1', { q: '周杰伦', page: 2 }, { headers: { Referer: 'http://y.test/' } })
  await requestOnce(transport, 'post', 'http://a.test/api', { appid: 1001, data: [1, 2] }, { json: true, headers: {} })

  const [get, post] = fetchImpl.calls
  assert.equal(get.url, 'http://a.test/path?q=%E5%91%A8%E6%9D%B0%E4%BC%A6&page=2')
  assert.equal(get.init.method, 'get')
  assert.equal(get.init.body, undefined)
  assert.equal(get.init.redirect, 'follow')
  assert.ok(get.init.signal instanceof AbortSignal, 'signal 必须是 AbortSignal（cancelHttp 契约）')

  assert.equal(post.url, 'http://a.test/api')
  assert.equal(post.init.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(post.init.headers.Accept, 'application/json')
  assert.equal(post.init.body, JSON.stringify({ appid: 1001, data: [1, 2] }))
})

test('form → application/x-www-form-urlencoded，且不改动 needle 的 URLSearchParams 语义', async() => {
  const fetchImpl = makeFetch()
  const { transport } = loadModule({ fetch: fetchImpl })
  await requestOnce(transport, 'post', 'http://a.test/echo', { params: 'a+b/c=', encSecKey: '0f' }, { headers: {} })
  const { init } = fetchImpl.calls[0]
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(init.body, 'params=a%2Bb%2Fc%3D&encSecKey=0f')
})

test('响应：raw 是 Buffer、body 是 UTF-8 文本、status/headers 原样、重定向时补 location', async() => {
  const fetchImpl = makeFetch(() => Promise.resolve(makeResponse('{"code":200}', {
    status: 302,
    statusText: 'Found',
    redirected: true,
    url: 'http://a.test/final',
    headers: { 'content-type': 'application/json' },
  })))
  const { transport } = loadModule({ fetch: fetchImpl })
  const { err, resp, body } = await requestOnce(transport, 'get', 'http://a.test/redirect', null, { headers: {} })
  assert.equal(err, null)
  assert.equal(resp.status, 302)
  assert.equal(resp.statusText, 'Found')
  assert.equal(resp.headers['content-type'], 'application/json')
  assert.equal(resp.headers.location, 'http://a.test/final', '浏览器读不到 Location，用最终 URL 顶上')
  assert.ok(Buffer.isBuffer(resp.raw))
  assert.equal(body, '{"code":200}')
})

test('错误码映射：超时 → ETIMEDOUT；其它失败 → ENOTFOUND（request.js 的映射表依赖它）', async() => {
  // 挂起直到 signal abort（模拟真实 fetch 在 abort 时以 AbortError 拒绝）
  const hanging = makeFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const mod1 = loadModule({ fetch: hanging })
  const timedOut = await requestOnce(mod1.transport, 'get', 'http://a.test/slow', null, { headers: {}, response_timeout: 30 })
  assert.equal(timedOut.err.code, 'ETIMEDOUT')
  assert.match(timedOut.err.message, /response timeout/)
  assert.equal(timedOut.resp, null)

  const failing = makeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
  const mod2 = loadModule({ fetch: failing })
  const failed = await requestOnce(mod2.transport, 'get', 'http://a.test/down', null, { headers: {} })
  assert.equal(failed.err.code, 'ENOTFOUND')
  assert.equal(failed.err.message, 'Failed to fetch')
})

test('cancelHttp：abort() 清掉计时器并中止 signal，promise 以 ENOTFOUND 结束', async() => {
  const hanging = makeFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  // 记录 clearTimeout：证明 abort() 真的把 10s 的计时器清掉了（不是靠超时结束）。
  // ⚠️ 计时器是 VM 里创建的，但 setTimeout/clearTimeout 用的是宿主函数，所以 id 可比。
  const cleared = []
  const mod = loadModule({
    fetch: hanging,
    clearTimeout: id => { cleared.push(id); clearTimeout(id) },
  })

  let settle
  const done = new Promise(resolve => { settle = resolve })
  const handle = mod.transport.request('get', 'http://a.test/slow', null, { headers: {}, response_timeout: 10000 }, (err, resp, body) => settle({ err, resp, body }))
  handle.abort()
  const cancelled = await done

  assert.equal(cancelled.err.code, 'ENOTFOUND', 'abort 不是超时，错误码必须是 ENOTFOUND')
  assert.equal(cancelled.err.message, 'aborted')
  assert.ok(cleared.length >= 1, 'abort() 必须 clearTimeout')
})

test('findForbiddenHeaders：大小写不敏感、去重、按出现顺序；普通头不误报', () => {
  const { findForbiddenHeaders, FORBIDDEN_FETCH_HEADERS } = loadModule()
  // 注意：返回值是 VM 里创建的数组，跨 realm 的 deepStrictEqual 会因原型不同而失败，
  // 所以统一用 JSON 序列化比较（同 `request-transport.test.cjs` 的处理口径）。
  assert.equal(JSON.stringify(findForbiddenHeaders({})), '[]')
  assert.equal(JSON.stringify(findForbiddenHeaders(null)), '[]')
  assert.equal(JSON.stringify(findForbiddenHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' })), '[]')
  assert.equal(
    JSON.stringify(findForbiddenHeaders({ 'User-Agent': 'QQMusic 14090508(android 12)', Referer: 'https://y.qq.com/', cookie: 'a=1', Cookie: 'b=2', Origin: 'https://y.qq.com' })),
    JSON.stringify(['user-agent', 'referer', 'cookie', 'origin']),
  )
  assert.ok(FORBIDDEN_FETCH_HEADERS.every(name => name === name.toLowerCase()), '名单必须全小写，便于比较')
})

test('接入点 · 默认 patched-fetch：用全局 fetch（不注入任何东西）', async() => {
  const fetchImpl = makeFetch()
  const mod = loadModule({ fetch: fetchImpl })
  assert.equal(mod.capacitorHttp.mode, 'patched-fetch')
  await requestOnce(mod.transport, 'get', 'http://a.test/x', null, { headers: {} })
  assert.equal(fetchImpl.calls.length, 1)
})

test('接入点 · explicit + requestImplementation：走注入实现，全局 fetch 一次都不调', async() => {
  const globalFetch = makeFetch()
  const injected = makeFetch(() => Promise.resolve(makeResponse('{"from":"native-bridge"}', { headers: { 'content-type': 'application/json' } })))
  const mod = loadModule({
    fetch: globalFetch,
    // 运行期覆盖发生在模块初始化时（见 web.js 顶部注释），所以必须走 globals 注入
    __RAIN_CAPACITOR_HTTP__: { mode: 'explicit', requestImplementation: (url, init) => injected(url, init) },
  })
  assert.equal(mod.capacitorHttp.mode, 'explicit')
  assert.equal(typeof mod.capacitorHttp.requestImplementation, 'function')

  const { body } = await requestOnce(mod.transport, 'post', 'http://interface.music.163.com/eapi/batch', 'params=x', { headers: {} })
  assert.equal(body, '{"from":"native-bridge"}')
  assert.equal(injected.calls.length, 1)
  assert.equal(globalFetch.calls.length, 0, 'explicit 模式下不应回落到全局 fetch')
})

test('接入点 · explicit 但注入实现缺失/非函数：安全回落全局 fetch', async() => {
  const globalFetch = makeFetch()
  const mod = loadModule({ fetch: globalFetch, __RAIN_CAPACITOR_HTTP__: { mode: 'explicit', requestImplementation: 'not-a-function' } })
  await requestOnce(mod.transport, 'get', 'http://a.test/y', null, { headers: {} })
  assert.equal(globalFetch.calls.length, 1)
})

test('禁止头诊断：每个头名只 warn 一次；且请求里 headers 原样送进 fetch（诊断不改行为）', async() => {
  const fetchImpl = makeFetch()
  const warnings = []
  const mod = loadModule({ fetch: fetchImpl, console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {}, error: () => {} } })

  // 三次请求都带 User-Agent（SDK 的真实写法），另有一次带 Cookie
  await requestOnce(mod.transport, 'post', 'http://u.y.qq.com/cgi-bin/musics.fcg', { comm: {} }, { headers: { 'User-Agent': 'QQMusic 14090508(android 12)' } })
  await requestOnce(mod.transport, 'post', 'http://u.y.qq.com/cgi-bin/musics.fcg', { comm: {} }, { headers: { 'User-Agent': 'QQMusic 14090508(android 12)' } })
  await requestOnce(mod.transport, 'post', 'http://u.y.qq.com/cgi-bin/musics.fcg', { comm: {} }, { headers: { 'User-Agent': 'QQMusic 14090508(android 12)', Cookie: 'MUSIC_U=abc' } })

  assert.equal(warnings.filter(w => w.includes('"user-agent"')).length, 1, 'user-agent 应当只 warn 一次')
  assert.equal(warnings.filter(w => w.includes('"cookie"')).length, 1, 'cookie 应当只 warn 一次')
  assert.equal(warnings.length, 2)

  // 诊断不改行为：头仍然原样传给了 fetch（浏览器会自己丢，那是另一层的事）
  assert.equal(fetchImpl.calls[0].init.headers['User-Agent'], 'QQMusic 14090508(android 12)')
  assert.equal(fetchImpl.calls[2].init.headers.Cookie, 'MUSIC_U=abc')
})

test('warnOnForbiddenHeaders=false：完全静默（真机日志需要干净时可以关）', async() => {
  const fetchImpl = makeFetch()
  const warnings = []
  const mod = loadModule({
    fetch: fetchImpl,
    console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {}, error: () => {} },
    __RAIN_CAPACITOR_HTTP__: { warnOnForbiddenHeaders: false },
  })
  await requestOnce(mod.transport, 'post', 'http://u.y.qq.com/x', { a: 1 }, { headers: { 'User-Agent': 'x', Referer: 'y' } })
  assert.deepEqual(warnings, [])
})
