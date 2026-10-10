/**
 * Android 移植 · **P0-1** 的单测：Capacitor IPC 传输桥（`src/common/platform/ipcBridge/capacitor.js`）。
 *
 * 被测对象是 web / Capacitor 构建里**真正跑的那一份** IPC 传输层（webpack 的"关键差异 4.7"
 * 把 `@common/platform/ipcBridge` 换成它），它此前完全没有单测覆盖。
 *
 * 原则（与 `tests/unit/web-http-transport.test.cjs` 同款）：
 * - **不加载任何 `@capacitor/*`**：插件通过模块的注入点
 *   `globalThis.__RAIN_CAPACITOR_IPC__` 塞进去，本文件里的"原生侧"就是一个普通对象；
 * - 每个用例都 `load()` 一份**全新的模块实例**（pending 表 / 订阅表 / id 序号都是模块级的），
 *   用例之间零串扰；
 * - 断言只用 `err.code` / JSON 字符串比较：VM 里造出来的对象与宿主不同 realm，
 *   `instanceof Error` 与 `deepStrictEqual` 的 `[[Prototype]]` 比较会假失败；
 * - **不留下未结算的 invoke**：否则 15 秒的默认超时计时器会把进程吊住、最后变成
 *   unhandled rejection（会让整套 `node --test` 变红）。
 *
 * 覆盖：`invoke` 正常 / 原生报错 / 超时、`send`（含投递失败）、`on` / `once` / `off` / `offAll`、
 * 请求应答**乱序配对**、**取消**（超时补发 cancel 信封 + 原生主动 cancel）、错误与协议异常
 * **不会被静默吞掉**。
 */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const MODULE = 'src/common/platform/ipcBridge/capacitor.js'

const json = value => JSON.stringify(value)

/** 等一个宏任务：`invoke` 的 `post` 是在 microtask 里发的，等完它一定已经发出。 */
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * 造一个"原生侧"：`post` 收到 JS 的信封，`notify` 往页面推原生事件
 * （与 Android 侧 `notifyListeners("ipcMessage", …)` 等价）。
 */
const makeNative = (options = {}) => {
  const posts = []
  const nativeListeners = new Map()
  const native = {
    /** JS → 原生：每一个信封都会进这里。 */
    postCalls: posts,
    addListenerCalls: 0,
    post(envelope) {
      posts.push(envelope)
      return options.onPost ? options.onPost(envelope) : Promise.resolve({ accepted: true })
    },
    addListener(eventName, listener) {
      native.addListenerCalls++
      if (!nativeListeners.has(eventName)) nativeListeners.set(eventName, new Set())
      nativeListeners.get(eventName).add(listener)
      return { remove: () => nativeListeners.get(eventName).delete(listener) }
    },
  }
  /** 原生 → JS：推一条 ipcMessage。 */
  native.notify = payload => {
    for (const listener of [...(nativeListeners.get('ipcMessage') ?? [])]) listener(payload)
  }
  return native
}

/** 记录 warn / error，让"不静默"这件事可断言，同时保持 `node --test` 输出干净。 */
const makeConsole = () => {
  const warns = []
  const errors = []
  return {
    warns,
    errors,
    console: {
      log: () => {},
      warn: (...args) => warns.push(args.join(' ')),
      error: (...args) => errors.push(args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(' ')),
    },
  }
}

/** 加载一份全新的桥 + 原生侧替身（注入点见被测文件头）。 */
const setup = (options = {}) => {
  const native = makeNative(options)
  const logs = makeConsole()
  const mod = load(MODULE, {}, {
    console: logs.console,
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native, timeoutMs: options.timeoutMs ?? 15000 },
    ...(options.globals ?? {}),
  })
  return { mod, native, posts: native.postCalls, warns: logs.warns, errors: logs.errors }
}

const lastOfKind = (posts, kind) => [...posts].reverse().find(post => post.kind === kind)
/** 让一条在途 invoke 正常结束（避免用例结束时留下挂着的超时计时器）。 */
const respond = (native, envelope, result) => native.notify({
  id: envelope.id,
  kind: 'response',
  channel: envelope.channel,
  ok: true,
  result,
})

test('模块加载期零副作用：不解析插件、不订阅原生事件（否则纯浏览器/探针会加载即炸）', () => {
  const { native } = setup()
  assert.equal(native.addListenerCalls, 0, 'import 时不应该订阅 ipcMessage')
  assert.equal(native.postCalls.length, 0, 'import 时不应该发任何信封')
})

test('找不到原生插件：invoke/send/on 立刻抛错，文案含"尚未实现"（ipcFallback 归类为 unsupported 的前提）', () => {
  const logs = makeConsole()
  const mod = load(MODULE, {}, { console: logs.console, setTimeout, clearTimeout })
  const { bridge, IPC_ERROR_CODES } = mod

  for (const call of [
    () => bridge.invoke('player_list_get'),
    () => bridge.send('winMain_player_status', {}),
    () => bridge.on('winMain_on_config_change', () => {}),
  ]) {
    assert.throws(call, err => {
      assert.equal(err.code, IPC_ERROR_CODES.BRIDGE_UNAVAILABLE)
      assert.match(err.message, /尚未实现/)
      assert.match(err.message, /docs\/android\/ipc-contract\.md/)
      return true
    })
  }
})

test('sendSync：Capacitor 结构性不支持 ⇒ 抛 IPC_SYNC_UNSUPPORTED（不是静默 no-op）', () => {
  const { mod } = setup()
  assert.throws(
    () => mod.bridge.sendSync('winMain_get_data'),
    err => {
      assert.equal(err.code, mod.IPC_ERROR_CODES.SYNC_UNSUPPORTED)
      assert.match(err.message, /winMain_get_data/)
      return true
    },
  )
})

test('invoke 正常：信封形状正确 + 按 id 解析出结果', async() => {
  const { mod, native, posts } = setup()
  const promise = mod.bridge.invoke('player_list_get')

  await tick()
  assert.equal(posts.length, 1)
  const envelope = posts[0]
  assert.match(envelope.id, /^ipc-[a-z0-9]+-\d+$/, 'id 必须是"会话标签 + 序号"')
  assert.equal(envelope.kind, 'invoke')
  assert.equal(envelope.channel, 'player_list_get')
  assert.equal(json(envelope.args), json([]), '不带参数时 args 归一化为空数组')

  respond(native, envelope, [{ id: 'list-1' }])
  assert.equal(json(await promise), json([{ id: 'list-1' }]))
})

test('invoke 参数：多参数按数组透传，尾部 undefined 归一化掉（JSON 会把 undefined 变成 null）', async() => {
  const { mod, native, posts } = setup()
  const first = mod.bridge.invoke('a_channel', { x: 1 }, 'second')
  const second = mod.bridge.invoke('b_channel', undefined)
  await tick()

  assert.equal(json(posts[0].args), json([{ x: 1 }, 'second']))
  assert.equal(json(posts[1].args), json([]))

  respond(native, posts[0], 'a')
  respond(native, posts[1], 'b')
  assert.equal(await first, 'a')
  assert.equal(await second, 'b')
})

test('invoke 原生报错：Promise reject，且 code / message / channel / requestId / remote 全都在（不吞错）', async() => {
  const { mod, native, posts } = setup()
  let settledWith = 'pending'
  const promise = mod.bridge.invoke('player_list_get').then(
    value => { settledWith = value },
    error => { settledWith = error },
  )

  await tick()
  const { id } = posts[0]
  native.notify({
    id,
    kind: 'response',
    channel: 'player_list_get',
    ok: false,
    error: { message: '数据库还没准备好', code: 'DB_NOT_READY' },
  })
  await promise

  assert.notEqual(settledWith, 'pending')
  assert.equal(settledWith.code, 'DB_NOT_READY', '原生给的 code 必须原样传出')
  assert.equal(settledWith.channel, 'player_list_get')
  assert.equal(settledWith.requestId, id)
  assert.match(settledWith.message, /数据库还没准备好/)
  assert.equal(settledWith.remote.code, 'DB_NOT_READY')
})

test('invoke 原生报错但**忘了带 ok 字段**：仍按失败处理（不能 resolve 成 undefined 把错吞掉）', async() => {
  const { mod, native, posts } = setup()
  const promise = mod.bridge.invoke('dislike_get_dislike_music_infos')
  await tick()

  native.notify({ id: posts[0].id, kind: 'response', channel: 'dislike_get_dislike_music_infos', error: { message: '表还没建' } })
  const error = await promise.then(
    () => { throw new Error('不应该 resolve') },
    err => err,
  )

  assert.equal(error.code, mod.IPC_ERROR_CODES.NATIVE, '没给 code 时用兜底码，但必须 reject')
  assert.match(error.message, /表还没建/)
})

test('invoke 超时：reject IPC_TIMEOUT + **向原生补发 cancel 信封**（取消语义 1/2）', async() => {
  const { mod, native, posts } = setup({ timeoutMs: 20 })
  assert.equal(mod.DEFAULT_TIMEOUT_MS, 15000, '默认超时必须与仓库既有惯例（options.js:7）一致')

  const error = await mod.bridge.invoke('winMain_request_user_api', { requestKey: 'x' }).then(
    () => { throw new Error('不应该 resolve') },
    err => err,
  )

  assert.equal(error.code, mod.IPC_ERROR_CODES.TIMEOUT)
  assert.equal(error.timeoutMs, 20)
  assert.equal(error.timedOut, true)
  assert.match(error.message, /winMain_request_user_api/)

  const cancel = lastOfKind(posts, 'cancel')
  assert.ok(cancel, '超时必须补发一条 kind=cancel 信封')
  assert.equal(cancel.reason, 'timeout')
  assert.equal(cancel.id, error.requestId, '取消信封必须带同一个 id')
  assert.equal(native.postCalls.filter(post => post.kind === 'invoke').length, 1)
})

test('超时之后的迟到应答：只 warn、不会二次结算、不抛（不静默）', async() => {
  const { mod, native, posts, warns } = setup({ timeoutMs: 20 })
  let settleCount = 0
  await mod.bridge.invoke('winMain_request_user_api').then(
    () => { settleCount++ },
    () => { settleCount++ },
  )

  const invokeEnvelope = lastOfKind(posts, 'invoke')
  native.notify({ id: invokeEnvelope.id, kind: 'response', channel: 'winMain_request_user_api', ok: true, result: 'late' })
  await tick()

  assert.equal(settleCount, 1, '迟到的应答不能让 Promise 二次结算')
  assert.equal(warns.filter(w => w.includes('迟到/重复的应答')).length, 1)
})

test('未知 id 的应答：console.error 点名（协议异常不被静默吞掉）', async() => {
  const { mod, native, posts, errors } = setup()
  const promise = mod.bridge.invoke('player_list_get')
  await tick()

  native.notify({ id: 'ipc-nobody-1', kind: 'response', channel: 'player_list_get', ok: true, result: null })
  assert.equal(errors.filter(e => e.includes('未知 id 的应答')).length, 1)

  respond(native, posts[0], 'done')
  assert.equal(await promise, 'done')
})

test('应答的 channel 与在途请求不一致：点名 console.error，但仍按 id 交付结果', async() => {
  const { mod, native, posts, errors } = setup()
  const promise = mod.bridge.invoke('player_list_get')
  await tick()

  native.notify({ id: posts[0].id, kind: 'response', channel: 'another_channel', ok: true, result: 42 })
  assert.equal(await promise, 42)
  assert.equal(errors.filter(e => e.includes('串包')).length, 1)
})

test('send：单向投递（kind=send）、不注册 pending；原生若回包会被当作未知 id 点名', async() => {
  const { mod, native, posts, errors } = setup()
  mod.bridge.send('winMain_player_status', { status: 'playing' })

  assert.equal(posts.length, 1)
  assert.equal(posts[0].kind, 'send')
  assert.equal(posts[0].channel, 'winMain_player_status')
  assert.equal(json(posts[0].args), json([{ status: 'playing' }]))

  native.notify({ id: posts[0].id, kind: 'response', channel: 'winMain_player_status', ok: true, result: null })
  assert.equal(errors.filter(e => e.includes('未知 id 的应答')).length, 1, '原生不该对 send 回包；真回了要能看见')
})

test('send 投递失败：console.error（send 的签名是 void，没有可 reject 的对象，但绝不静默）', async() => {
  const { mod, errors } = setup({
    onPost: envelope => (envelope.kind === 'send'
      ? Promise.reject(new Error('原生侧没响应'))
      : Promise.resolve({ accepted: true })),
  })

  assert.doesNotThrow(() => mod.bridge.send('winMain_player_status', {}))
  await tick()
  assert.equal(errors.filter(e => e.includes('send("winMain_player_status") 投递失败')).length, 1)
  assert.match(errors.join('\n'), /原生侧没响应/)
})

test('invoke 投递失败（post reject）：立刻 reject IPC_TRANSPORT_ERROR，不干等到超时', async() => {
  const { mod } = setup({
    timeoutMs: 60000,
    onPost: () => Promise.reject(new Error('androidBridge.postMessage 抛了')),
  })

  const error = await mod.bridge.invoke('player_list_get').then(
    () => { throw new Error('不应该 resolve') },
    err => err,
  )
  assert.equal(error.code, mod.IPC_ERROR_CODES.TRANSPORT)
  assert.match(error.message, /androidBridge\.postMessage 抛了/)
})

test('invoke 投递时**同步抛错**同样立刻 reject（不会变成未处理异常，也不等超时）', async() => {
  const { mod } = setup({
    timeoutMs: 60000,
    onPost: () => { throw new Error('同步炸') },
  })

  const error = await mod.bridge.invoke('player_list_get').then(
    () => { throw new Error('不应该 resolve') },
    err => err,
  )
  assert.equal(error.code, mod.IPC_ERROR_CODES.TRANSPORT)
  assert.match(error.message, /同步炸/)
})

test('on / off：原始 listener 真的能退订（桌面端"包装函数删不掉"的老毛病在这里不存在）', () => {
  const { mod, native } = setup()
  const first = []
  const second = []
  const listenerA = payload => first.push(payload.params)
  const listenerB = payload => second.push(payload.params)

  mod.bridge.on('winMain_on_config_change', listenerA)
  mod.bridge.on('winMain_on_config_change', listenerB)
  assert.equal(native.addListenerCalls, 1, '多条订阅只应订阅一次原生事件（懒接入 + 单入口）')

  native.notify({ kind: 'event', channel: 'winMain_on_config_change', args: [{ a: 1 }] })
  assert.equal(json(first), json([{ a: 1 }]))
  assert.equal(json(second), json([{ a: 1 }]))

  mod.bridge.off('winMain_on_config_change', listenerA)
  native.notify({ kind: 'event', channel: 'winMain_on_config_change', args: [{ a: 2 }] })

  assert.equal(json(first), json([{ a: 1 }]), 'off 之后 listenerA 不应再被调用')
  assert.equal(json(second), json([{ a: 1 }, { a: 2 }]), 'listenerB 不受影响')
})

test('once：只派发一次，之后自动退订', () => {
  const { mod, native } = setup()
  const seen = []
  mod.bridge.once('common_deeplink', payload => seen.push(payload.params))

  native.notify({ kind: 'event', channel: 'common_deeplink', args: ['rainmusic://a'] })
  native.notify({ kind: 'event', channel: 'common_deeplink', args: ['rainmusic://b'] })
  assert.equal(json(seen), json(['rainmusic://a']))
})

test('offAll：清空该通道的全部订阅，其它通道不受影响', () => {
  const { mod, native } = setup()
  const a = []
  const b = []
  const c = []
  mod.bridge.on('ch.a', payload => a.push(payload.params))
  mod.bridge.on('ch.a', payload => b.push(payload.params))
  mod.bridge.on('ch.b', payload => c.push(payload.params))

  mod.bridge.offAll('ch.a')
  native.notify({ kind: 'event', channel: 'ch.a', args: [1] })
  native.notify({ kind: 'event', channel: 'ch.b', args: [2] })

  assert.equal(json(a), json([]))
  assert.equal(json(b), json([]))
  assert.equal(json(c), json([2]))
})

test('on 的载荷形状与桌面同构：{ event, params }，params = args[0]', () => {
  const { mod, native } = setup()
  const seen = []
  mod.bridge.on('winMain_key_down', payload => seen.push(payload))

  native.notify({ kind: 'event', channel: 'winMain_key_down', args: [{ action: 'play' }, 'extra'] })

  assert.equal(json(seen[0].params), json({ action: 'play' }))
  assert.equal(seen[0].event.channel, 'winMain_key_down')
  assert.equal(seen[0].event.kind, 'event')
  assert.equal(seen[0].event.source, 'capacitor-ipc-bridge')
})

test('请求应答配对：三个并发请求乱序回包，各归各家', async() => {
  const { mod, native, posts } = setup()
  const results = {}

  const promises = [
    mod.bridge.invoke('player_list_get').then(value => { results.list = value }),
    mod.bridge.invoke('dislike_get_dislike_music_infos').then(value => { results.dislike = value }),
    mod.bridge.invoke('winMain_get_data', 'playInfo').then(value => { results.data = value }),
  ]
  await tick()
  assert.equal(posts.length, 3)
  assert.equal(new Set(posts.map(post => post.id)).size, 3, 'id 必须唯一')

  const byChannel = channel => posts.find(post => post.channel === channel)
  // 故意**反序**回包
  respond(native, byChannel('winMain_get_data'), { index: 0 })
  respond(native, byChannel('dislike_get_dislike_music_infos'), { rules: [] })
  respond(native, byChannel('player_list_get'), ['list-1'])
  await Promise.all(promises)

  assert.equal(json(results.list), json(['list-1']))
  assert.equal(json(results.dislike), json({ rules: [] }))
  assert.equal(json(results.data), json({ index: 0 }))
})

test('取消 · 原生主动：在途 invoke 以 IPC_CANCELLED reject（error.cancelled = true）', async() => {
  const { mod, native, posts } = setup()
  const promise = mod.bridge.invoke('winMain_request_user_api', { requestKey: 'k' })
  await tick()

  native.notify({ id: posts[0].id, kind: 'cancel', reason: '用户切换了音源' })
  const error = await promise.then(
    () => { throw new Error('不应该 resolve') },
    err => err,
  )

  assert.equal(error.code, mod.IPC_ERROR_CODES.CANCELLED)
  assert.equal(error.cancelled, true)
  assert.equal(error.channel, 'winMain_request_user_api')
  assert.match(error.message, /用户切换了音源/)
})

test('取消 · 原生主动但请求已不在途：只 warn，不抛', () => {
  const { mod, native, warns } = setup()
  // 先订阅一次，让原生事件通道被接上（否则 notify 根本没有落点）。
  mod.bridge.on('winMain_request_user_api', () => {})

  assert.doesNotThrow(() => native.notify({ id: 'ipc-nobody-2', kind: 'cancel', reason: '晚了一步' }))
  assert.equal(warns.filter(w => w.includes('已不在途')).length, 1)
})

test('原生广播没有监听者：只提示一次（不刷屏），也不抛', () => {
  const { mod, native, warns } = setup()
  mod.bridge.on('player_list_data_overwire', () => {})

  native.notify({ kind: 'event', channel: 'winMain_key_down', args: [1] })
  native.notify({ kind: 'event', channel: 'winMain_key_down', args: [2] })

  assert.equal(warns.filter(w => w.includes('没有监听者')).length, 1)
})

test('监听器抛错：被隔离 + console.error，其它监听器照常收到事件', () => {
  const { mod, native, errors } = setup()
  const seen = []
  mod.bridge.on('ch.bad', () => { throw new Error('监听器自己炸了') })
  mod.bridge.on('ch.bad', payload => seen.push(payload.params))

  assert.doesNotThrow(() => native.notify({ kind: 'event', channel: 'ch.bad', args: ['ok'] }))
  assert.equal(json(seen), json(['ok']))
  assert.equal(errors.filter(e => e.includes('监听器抛错')).length, 1)
  assert.match(errors.join('\n'), /监听器自己炸了/)
})

test('协议异常：非法载荷 / 未知 kind 全部 console.error 点名，不抛、不吞', () => {
  const { mod, native, errors } = setup()
  // 先订阅一次，让原生事件通道被接上（否则 notify 根本没有落点）。
  mod.bridge.on('probe', () => {})

  // ① 连信封都不是（没有 kind，也没有 data.kind）
  for (const payload of [null, 'not-an-object', 42, { kind: 5 }]) {
    assert.doesNotThrow(() => native.notify(payload))
  }
  assert.equal(errors.filter(e => e.includes('无法解析的原生消息')).length, 4)

  // ② 是信封，但 kind 不认识（含被 `{data:{…}}` 包一层的情况）
  for (const payload of [{ kind: 'nope' }, { data: { kind: 'nope' } }]) {
    assert.doesNotThrow(() => native.notify(payload))
  }
  assert.equal(errors.filter(e => e.includes('未知的原生消息 kind')).length, 2)

  // ③ event 没有 channel
  assert.doesNotThrow(() => native.notify({ kind: 'event', args: [] }))
  assert.equal(errors.filter(e => e.includes('原生广播缺少 channel')).length, 1)
})

test('插件解析：走 Android 原生桥注入的 Capacitor.Plugins[pluginName]（不需要 @capacitor/core）', async() => {
  const native = makeNative()
  const logs = makeConsole()
  const mod = load(MODULE, {}, {
    console: logs.console,
    setTimeout,
    clearTimeout,
    Capacitor: {
      getPlatform: () => 'android',
      isNativePlatform: () => true,
      Plugins: { RainMusicIpc: native },
      registerPlugin: () => { throw new Error('不应该走到 registerPlugin') },
    },
  })

  const promise = mod.bridge.invoke('player_list_get')
  await tick()
  assert.equal(native.postCalls.length, 1)
  respond(native, native.postCalls[0], 'via-plugins')
  assert.equal(await promise, 'via-plugins')
})

test('插件解析：只有 Capacitor.registerPlugin 时也能拿到插件（@capacitor/core 已加载的情形）', async() => {
  const native = makeNative()
  const logs = makeConsole()
  const mod = load(MODULE, {}, {
    console: logs.console,
    setTimeout,
    clearTimeout,
    Capacitor: {
      getPlatform: () => 'android',
      isNativePlatform: () => true,
      registerPlugin: name => {
        assert.equal(name, 'RainMusicIpc')
        return native
      },
    },
  })

  const promise = mod.bridge.invoke('player_list_get')
  await tick()
  respond(native, native.postCalls[0], 'via-registerPlugin')
  assert.equal(await promise, 'via-registerPlugin')
})

test('插件名 / 事件名 / 超时 / 错误码必须与原生侧一致（改一处要同时改 RainMusicIpcPlugin.java）', () => {
  const { mod } = setup()
  assert.equal(mod.capacitorIpc.pluginName, 'RainMusicIpc')
  assert.equal(mod.capacitorIpc.eventName, 'ipcMessage')
  assert.equal(mod.capacitorIpc.timeoutMs, 15000)
  assert.equal(json(mod.IPC_ERROR_CODES), json({
    BRIDGE_UNAVAILABLE: 'IPC_BRIDGE_UNAVAILABLE',
    TIMEOUT: 'IPC_TIMEOUT',
    CANCELLED: 'IPC_CANCELLED',
    TRANSPORT: 'IPC_TRANSPORT_ERROR',
    NATIVE: 'IPC_NATIVE_ERROR',
    SYNC_UNSUPPORTED: 'IPC_SYNC_UNSUPPORTED',
  }))
})
