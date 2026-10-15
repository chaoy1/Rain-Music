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
