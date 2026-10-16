const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const load = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
test('Android renderer logs through the browser build, never through the Node build that needs a filesystem', () => {
  // `src/common/utils/index.ts:1` 顶层是 `import log from 'electron-log/node'`；web 构建按
  // `webpack.config.web.js` 的「关键差异 4.11」把它换成这个接入点。三条断言各对应一个
  // **真机上具体的坏结果**，而不是风格检查：
  const log = load('src/common/platform/log/web.js').default
  // 1) Node 构建带 File 传输（`fs` + `AppData/Roaming` 目录推算）。在 web 产物里 `fs` 是空模块，
  //    写盘抛错会被 electron-log 自己的 errorHandler 吞掉 ⇒ **日志静默消失**。
  assert.equal(log.transports.file, undefined, '渲染层不能有 File 传输')
  // 2) 渲染层构建的 ipc 传输要把日志转给主进程；Android 没有主进程，它每次都退回打一条
  //    "logger isn't initialized in the main process" ⇒ 每条日志多一行噪声。
  assert.equal(log.transports.ipc.level, false, 'ipc 传输必须关掉（没有主进程可转发）')
  // 3) 留下的 console 传输才是真机取证看的：WebView 的 console 会进 logcat。
  assert.equal(typeof log.transports.console, 'function', 'console 传输必须在')
  for (const level of ['info', 'error']) assert.equal(typeof log[level], 'function', level)
})

test('Android file URLs use Capacitor mapping; desktop paths keep Node URL escaping', () => {
  const calls = []
  const android = load('src/common/platform/fileUrl/web.js', { '@capacitor/core': { Capacitor: { convertFileSrc: value => { calls.push(value); return `mapped:${value}` } } } })
  assert.equal(android.localFileUrl('/data/a b#.mp3'), 'mapped:file:///data/a%20b%23.mp3')
  assert.equal(android.localFileUrl('content://media/1'), 'mapped:content://media/1')
  assert.equal(android.localFileUrl('https://localhost/_capacitor_file_/a'), 'https://localhost/_capacitor_file_/a')
  assert.equal(android.localFileUrl('data:image/png;base64,A'), 'data:image/png;base64,A')
  assert.throws(() => android.localFileUrl(''), /required/)
  assert.equal(calls.length, 2)
  const desktop = load('src/common/platform/fileUrl/index.js')
  assert.match(desktop.localFileUrl('D:\\a b#.mp3'), /^file:\/\/\/D:\/a%20b%23\.mp3$/)
})
test('Android web build replaces actual worker/file URL imports, and native plugin registers each new family', () => {
  const config = require('../../build-config/renderer/webpack.config.web')
  for (const [specifier, expected] of [['@renderer/worker', '@renderer/platform/workers/web'], ['@renderer/worker/utils', '@renderer/platform/workers/utils'], ['@common/platform/fileUrl', '@common/platform/fileUrl/web'], ['electron-log/node', '@common/platform/log/web']]) {
    const replacement = config.plugins.find(p => p.resourceRegExp?.test(specifier))
    assert.ok(replacement, specifier)
    const resource = { request: specifier }; replacement.newResource(resource)
    assert.equal(resource.request, expected)
  }
  const plugin = read('android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  for (const code of ['RainMusicListMutationChannels.register(this)', 'RainMusicDownloadChannels.register(this)', 'RainMusicMediaCacheChannels.register(this)', 'new RainMusicDownloadTaskChannels(getContext()).register()']) assert.ok(plugin.includes(code), code)
})
test('Android native HTTP and cleartext policy are wired to shipped config, without trusting user CAs', () => {
  const config = load('capacitor.config.ts').default
  assert.equal(config.plugins.CapacitorHttp.enabled, true)
  assert.equal(config.android.allowMixedContent, true)
  assert.match(read('android/app/src/main/AndroidManifest.xml'), /android:networkSecurityConfig="@xml\/network_security_config"/)
  const policy = read('android/app/src/main/res/xml/network_security_config.xml')
  assert.match(policy, /base-config cleartextTrafficPermitted="true"/)
  assert.match(policy, /certificates src="system"/)
  assert.doesNotMatch(policy, /src="user"/)
})
test('Android file access distinguishes missing files from failures and reads exact binary bytes', async() => {
  const requests = []
  const file = load('src/common/platform/fs/web.js', { '../fileUrl/web': { localFileUrl: value => `mapped:${value}` }, '../selectedFiles': { findSelectedFile: () => undefined } }, {
    fetch: async(url, options) => {
      requests.push([url, options.method])
      if (url.endsWith('missing')) return { status: 404, ok: false }
      if (url.endsWith('denied')) return { status: 403, ok: false }
      return { status: 200, ok: true, headers: new Headers(url.endsWith('no-length') ? {} : { 'content-length': '4' }), arrayBuffer: async() => Uint8Array.from([0, 255, 65, 66]).buffer }
    },
  }).default
  await file.promises.access('/audio')
  assert.equal((await file.promises.stat('/audio')).size, 4)
  assert.deepEqual([...await file.promises.readFile('/audio')], [0, 255, 65, 66])
  await assert.rejects(file.promises.access('/missing'), { code: 'ENOENT' })
  await assert.rejects(file.promises.access('/denied'), /403/)
  await assert.rejects(file.promises.writeFile('/audio', 'bad'), /document picker/)
  assert.deepEqual(requests.slice(0, 3), [['mapped:/audio', 'HEAD'], ['mapped:/audio', 'HEAD'], ['mapped:/audio', 'GET']])
  assert.equal((await file.promises.stat('/no-length')).size, 4)
})
test('Android metadata parser reads bytes instead of calling Node parseFile; read and parse errors propagate', async() => {
  const calls = []
  const mod = load('src/renderer/platform/musicMetadata/web.js', {
    'music-metadata': { parseBuffer: async(bytes, options) => { calls.push({ bytes: [...bytes], options }); if (options.path === 'bad') throw Error('invalid audio'); return { common: { title: 'test' } } } },
    '@common/platform/fs/web': { promises: { readFile: async path => { if (path === 'missing') throw Error('missing'); return Buffer.from([0, 255, 65]) } } },
  })
  assert.equal((await mod.parseFile('/audio')).common.title, 'test')
  assert.equal(JSON.stringify(calls), JSON.stringify([{ bytes: [0, 255, 65], options: { path: '/audio', size: 3 } }]))
  await assert.rejects(mod.parseFile('missing'), /missing/)
  await assert.rejects(mod.parseFile('bad'), /invalid audio/)
})
