const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const load = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const modulePath = process.env.RAIN_DOWNLOAD_JS_SOURCE || 'src/renderer/platform/download/android.ts'
const purePath = process.env.RAIN_DOWNLOAD_PURE_SOURCE || 'src/renderer/platform/download/pure.ts'
const setup = () => {
  const calls = []; let listener
  const bridge = { on: (name, callback) => { listener = callback }, off() {}, invoke: async(name, value) => {
    calls.push([name, value]); return { filePath: '/private/downloads/a.mp3', savePath: '/private/downloads' }
  } }
  const pure = load(purePath, { '@common/constants': load('src/common/constants.ts'), '@common/utils/tools': load('src/common/utils/tools.ts') })
  const lyric = load('src/renderer/worker/download/lrcTool.ts')
  const facade = load(modulePath, { '@common/platform/ipcBridge': { bridge }, './pure': pure, '../../worker/download/lrcTool': lyric }).createAndroidDownloadFacade(bridge)
  return { facade, calls, emit: payload => listener({ params: payload }) }
}
test('Android download façade exists independently of Node filesystem or metadata modules', () => {
  assert.ok(fs.existsSync(path.resolve(root, modulePath)), 'Android download façade must exist')
  const { facade } = setup()
  assert.equal(Object.keys(facade).length, 8)
  // These files are the browser entry and its helper. Native-only modules must
  // remain out of their import graph, rather than merely being left uncalled.
  const ts = require('typescript')
  for (const file of [modulePath, purePath]) {
    const ast = ts.createSourceFile(file, fs.readFileSync(path.resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
    for (const node of ast.statements.filter(ts.isImportDeclaration)) {
      assert.doesNotMatch(node.moduleSpecifier.text, /^(?:node:|fs$|node-id3$|iconv-lite$)|musicMeta|worker\/download\/(?:common|utils|download)$/)
    }
  }
})
test('façade preserves task naming/quality fallback and duplicate contract', () => {
  const { facade } = setup()
  const music = { id: 'wy_1', name: 'A/B', singer: 'Singer', source: 'wy', meta: { _qualitys: { '320k': {} } } }
  const [task] = facade.createDownloadTasks([music], 'flac', '歌手 - 歌名', { wy: ['320k'] }, 'list')
  assert.equal(task.id, 'wy_1_320k_mp3'); assert.equal(task.metadata.fileName, 'Singer - AB.mp3')
  assert.equal(facade.checkList([task], { id: task.id }, '320k', 'mp3'), true)
})
test('façade starts with original signature and routes native action to matching live task', async() => {
  const { facade, calls, emit } = setup(); const events = []
  const task = { id: 'a', metadata: { url: 'http://localhost/a', fileName: 'a.mp3', filePath: '' } }
  await facade.startTask(task, '', false, action => events.push(action))
  assert.equal(calls[0][0], 'winMain_download_task_start'); assert.equal(task.metadata.filePath, '/private/downloads/a.mp3')
  emit({ id: 'other', action: { action: 'complete' } }); emit({ id: 'a', action: { action: 'start' } })
  assert.deepEqual(events, [{ action: 'start' }])
  await facade.pauseTask('a'); emit({ id: 'a', action: { action: 'complete' } }); assert.equal(events.length, 1)
})
test('lyric and metadata writes await native IO and forward composed lyric', async() => {
  const { facade, calls } = setup()
  await facade.saveLrc({ lyric: '[00:01.00]hello' }, { filePath: '/private/downloads/a.lrc', format: 'utf8', downloadRainlrc: false, downloadTlrc: false, downloadRlrc: false })
  assert.equal(calls[0][0], 'winMain_download_task_save_lyric'); assert.equal(calls[0][1].text, '[00:01.00]hello')
  await facade.writeMeta({ filePath: 'a.mp3', title: 'Hello', isEmbedLyricRain: false, isEmbedLyricT: false, isEmbedLyricR: false }, { lyric: 'hello' })
  assert.equal(calls[1][0], 'winMain_download_task_write_meta'); assert.equal(calls[1][1].lyrics, 'hello')
})
test('queued native complete waits for filePath and stale generation events cannot reach replacement callback', async() => {
  let listener; let acknowledge
  let invoked; const didInvoke = new Promise(resolve => { invoked = resolve })
  const ipc = { on: (_name, callback) => { listener = callback }, invoke: (_name, value) => new Promise(resolve => { acknowledge = () => resolve({ filePath: '/private/downloads/a.mp3' }); listener({ params: { id: value.downloadInfo.id, token: value.token, action: { action: 'complete' } } }); invoked() }) }
  const pure = load(purePath, { '@common/constants': load('src/common/constants.ts'), '@common/utils/tools': load('src/common/utils/tools.ts') })
  const facade = load(modulePath, { '@common/platform/ipcBridge': { bridge: ipc }, './pure': pure, '../../worker/download/lrcTool': load('src/renderer/worker/download/lrcTool.ts') }).createAndroidDownloadFacade(ipc)
  const task = { id: 'a', metadata: { filePath: '' } }; const paths = []
  const pending = facade.startTask(task, '', false, () => paths.push(task.metadata.filePath))
  await didInvoke; assert.equal(paths.length, 0); acknowledge(); await pending
  assert.deepEqual(paths, ['/private/downloads/a.mp3'])
  listener({ params: { id: 'a', token: 'stale', action: { action: 'complete' } } }); assert.equal(paths.length, 1)
})
test('Android private root is independent of imported Windows download directory preference', async() => {
  const { facade, calls } = setup()
  await facade.startTask({ id: 'a', metadata: {} }, 'C:\\Users\\user\\Music', false, () => {})
  assert.equal(calls[0][1].savePath, '')
})
test('pause/update carry the current generation token so delayed commands cannot affect a replacement task', async() => {
  const { facade, calls } = setup()
  await facade.startTask({ id: 'a', metadata: {} }, '', false, () => {})
  await facade.updateUrl('a', 'http://localhost/new'); await facade.pauseTask('a')
  assert.equal(calls[1][1].token, calls[0][1].token)
  assert.equal(calls[2][1].token, calls[0][1].token)
})
test('rejected stale start cannot turn a replacement generation into an error', async() => {
  let rejectOld; let invoked; const started = new Promise(resolve => { invoked = resolve })
  let count = 0
  const ipc = { on() {}, invoke: async() => {
    if (++count === 1) return await new Promise((_resolve, reject) => { rejectOld = reject; invoked() })
    return { filePath: '/private/downloads/new.mp3' }
  } }
  const pure = load(purePath, { '@common/constants': load('src/common/constants.ts'), '@common/utils/tools': load('src/common/utils/tools.ts') })
  const facade = load(modulePath, { '@common/platform/ipcBridge': { bridge: ipc }, './pure': pure, '../../worker/download/lrcTool': load('src/renderer/worker/download/lrcTool.ts') }).createAndroidDownloadFacade(ipc)
  const task = { id: 'a', metadata: { filePath: '' } }
  const old = facade.startTask(task, '', false, () => {})
  await started
  const replacement = facade.startTask(task, '', false, () => {})
  rejectOld(new Error('late old failure'))
  await Promise.all([old, replacement])
  assert.equal(task.metadata.filePath, '/private/downloads/new.mp3')
})
test('store observes metadata and sidecar write rejections without changing completed audio status', async() => {
  const source = fs.readFileSync(process.env.RAIN_DOWNLOAD_ACTION_SOURCE || path.join(root, 'src/renderer/store/download/action.ts'), 'utf8')
  const ts = require('typescript'); const vm = require('node:vm')
  const ast = ts.createSourceFile('action.ts', source, ts.ScriptTarget.Latest, true)
  const selected = ast.statements.filter(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ['saveMeta', 'downloadLyric', 'fixKgLyric'].includes(declaration.name.getText(ast))))
  const code = selected.map(statement => statement.getText(ast)).join('\n') + '\nexports.saveMeta = saveMeta; exports.downloadLyric = downloadLyric'
  const errors = []; const exports = {}
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, console: { error: (...args) => errors.push(args), log() {} }, Promise,
    getLyricInfo: async() => ({ lyric: 'lyrics' }), getPicUrl: async() => null,
    EMBED_LYRIC_ROMA: false, DOWNLOAD_LYRIC_ROMA: false, LRC_FORMAT: 'utf8',
    window: { rain: { worker: { download: { writeMeta: async() => { throw new Error('tag failed') }, saveLrc: async() => { throw new Error('lyric failed') } } } } },
  })
  const task = { status: 'completed', metadata: { quality: '320k', filePath: 'a.mp3', musicInfo: { name: 'A', singer: 'B', meta: {} } } }
  exports.saveMeta(task); exports.downloadLyric(task)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors.length, 2); assert.equal(task.status, 'completed')
})
