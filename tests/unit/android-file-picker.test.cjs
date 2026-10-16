const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')
function setup() {
  const registered = []
  const handlers = new Map()
  let input
  const document = { body: { append: element => { input = element } }, createElement: () => ({ style: {}, files: [], addEventListener: (name, cb) => handlers.set(name, cb), remove() { this.removed = true }, click() { this.clicked = true } }) }
  const mod = load('src/common/platform/filePicker/web.js', { '../selectedFiles.js': { rememberSelectedFile: file => { registered.push(file); return `blob:${file.name}` } } }, { document })
  return { mod, handlers, registered, get input() { return input } }
}
test('Android file picker opens system chooser with extension/multiple options and returns readable file handles', async() => {
  const a = setup()
  const result = a.mod.showSelectDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Script', extensions: ['js'] }, { name: 'all', extensions: ['*'] }] })
  assert.equal(a.input.clicked, true)
  assert.equal(a.input.accept, '.js')
  assert.equal(a.input.multiple, true)
  a.input.files = [{ name: '音源.js' }, { name: 'second.js' }]
  a.handlers.get('change')()
  assert.equal(JSON.stringify(await result), JSON.stringify({ canceled: false, filePaths: ['blob:音源.js', 'blob:second.js'] }))
  assert.equal(a.input.removed, true)
})
test('Android file chooser cancellation and open failure settle without a native timeout; directory mode rejects', async() => {
  const a = setup()
  const result = a.mod.showSelectDialog({})
  a.handlers.get('cancel')()
  assert.equal(JSON.stringify(await result), JSON.stringify({ canceled: true, filePaths: [] }))
  await assert.rejects(a.mod.showSelectDialog({ properties: ['openDirectory'] }), /directory/i)
})
// `focus` 回退路径要能**手工推进**：真机上"focus 早于 WebView 填 input.files"是常态，
// 所以这里注入假计时器，把轮询变成确定性的步骤（也避免用例真等 1.2 秒）。
function setupWithFocus() {
  const handlers = new Map()
  const timers = []
  let input
  const document = { body: { append: element => { input = element } }, createElement: () => ({ style: {}, files: [], addEventListener: (name, cb) => handlers.set(name, cb), remove() { this.removed = true }, click() { this.clicked = true } }) }
  const window = { addEventListener: (name, cb) => handlers.set(`window:${name}`, cb), removeEventListener: () => {} }
  const mod = load('src/common/platform/filePicker/web.js', { '../selectedFiles.js': { rememberSelectedFile: file => `blob:${file.name}` } }, {
    document,
    window,
    setTimeout: callback => { timers.push(callback); return timers.length },
    clearTimeout: () => {},
  })
  return { mod, handlers, timers, get input() { return input } }
}
test('Android picker: focus arriving before the WebView fills input.files must not be reported as a cancellation', async() => {
  const a = setupWithFocus()
  const result = a.mod.showSelectDialog({})
  // 选择器关掉了（focus 回来了），但**文件还没被填进 input.files** —— 真机上 focus 早于 change。
  a.handlers.get('window:focus')()
  assert.equal(a.timers.length, 1, '没有文件时应该安排下一次轮询，而不是立刻结算')
  a.timers.shift()()
  assert.equal(a.timers.length, 1, '文件还没到 ⇒ 必须继续等（"固定延时查一次"的老实现会在这里判取消、把用户选的文件静默丢掉）')
  // WebView 补齐文件之后，下一次轮询必须按"选到了"结算。
  a.input.files = [{ name: 'a.js' }]
  a.timers.shift()()
  // 断言用 JSON 比较：返回值来自 vm 里另一个 realm，`deepStrictEqual` 会因为原型不同而失败
  // （本文件其它用例也是这个写法）。
  assert.equal(JSON.stringify(await result), JSON.stringify({ canceled: false, filePaths: ['blob:a.js'] }))
})
test('Android picker: the focus fallback still reports cancellation once the polling window is exhausted', async() => {
  const a = setupWithFocus()
  const result = a.mod.showSelectDialog({})
  a.handlers.get('window:focus')()
  // 文件一直不出现 ⇒ 走完整个窗口后判取消。老 WebView 不发 cancel 事件，靠的就是这条路径。
  let guard = 0
  while (a.timers.length && guard++ < 20) a.timers.shift()()
  assert.equal(JSON.stringify(await result), JSON.stringify({ canceled: true, filePaths: [] }))
})
test('Android picked file byte reads bypass patched HTTP fetch and preserve source text', async() => {
  const released = []
  const registry = load('src/common/platform/selectedFiles.js', {}, { URL: { createObjectURL: () => 'blob:source', revokeObjectURL: path => released.push(path) } })
  const bytes = Buffer.from('/* 中文音源 */')
  const path = registry.rememberSelectedFile({ size: bytes.length, arrayBuffer: async() => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })
  const fs = load('src/common/platform/fs/web.js', { '../fileUrl/web': { localFileUrl: () => { throw Error('must not map selected file') } }, '../selectedFiles': registry }, { fetch: () => { throw Error('must not send blob to native HTTP') } }).default
  await fs.promises.access(path)
  assert.equal((await fs.promises.stat(path)).size, bytes.length)
  assert.equal((await fs.promises.readFile(path)).toString(), bytes.toString())
  registry.releaseSelectedFile(path)
  assert.equal(registry.findSelectedFile(path), undefined)
  assert.deepEqual(released, [path])
})
test('Android picker IPC is local even with no native plugin', async() => {
  const calls = []
  const mod = require('./load-capacitor.cjs')('src/common/platform/ipcBridge/capacitor.js', {}, { __RAIN_CAPACITOR_IPC__: { selectFiles: async options => { calls.push(options); return { canceled: true, filePaths: [] } } } })
  assert.equal((await mod.bridge.invoke('winMain_show_select_dialog', { title: 'Pick' })).canceled, true)
  assert.equal(calls[0].title, 'Pick')
})
test('Android source import shows picker/read errors and releases handles on success and failure', async() => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
  const file = path.resolve(__dirname, '../../src/renderer/views/Setting/components/UserApiModal.vue')
  const script = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  const compiled = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const failure of [null, 'picker', 'read', 'import']) {
    const errors = [], released = []
    const exports = {}
    vm.runInNewContext(compiled, { exports, require: name => {
      if (name === '@renderer/utils/ipc') return { showSelectDialog: async() => { if (failure === 'picker') throw Error('picker failed'); return { canceled: false, filePaths: ['blob:script'] } } }
      if (name === '@common/utils/nodejs') return { readFile: async() => { if (failure === 'read') throw Error('read failed'); return Buffer.from('script') } }
      if (name === '@common/platform/filePicker') return { releaseSelectedFiles: paths => released.push(...paths) }
      if (name === '@renderer/plugins/Dialog') return { dialog: message => errors.push(message) }
      return {}
    } })
    await exports.default.methods.handleImport.call({ userApi: { list: [] }, $t: (key, params) => params?.message ?? key, importUserApi: async value => { assert.equal(value, 'script'); if (failure === 'import') throw Error('import failed') } })
    assert.deepEqual(released, failure === 'picker' ? [] : ['blob:script'])
    assert.deepEqual(errors, failure ? [`${failure} failed`] : [])
  }
})
