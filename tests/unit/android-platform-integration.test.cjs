const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const load = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
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
  for (const [specifier, expected] of [['@renderer/worker', '@renderer/platform/workers/web'], ['@renderer/worker/utils', '@renderer/platform/workers/utils'], ['@common/platform/fileUrl', '@common/platform/fileUrl/web']]) {
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
