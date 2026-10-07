const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const load = require('./load-ts.cjs')

/**
 * Rain Music Android 移植 · 阶段 2 / 线 B 的回归网。
 *
 * 目的：证明「存储适配器重构」对桌面端**没有行为变化**。
 * 这里断言的是 `src/main/utils/store.ts` 重构前那些**可观察的落盘特征**：
 *
 * 1. `getStore(name)` → `<rainDataPath>/<name>.json`（`store.ts:81`）
 * 2. 写入内容 = `JSON.stringify(store, null, '\t')`，utf8（`store.ts:20,24`）
 * 3. 原子写：临时文件 `<file>.<rand>.temp` 先落盘，再 `rename` 覆盖（`store.ts:18,27`）
 * 4. 目标目录不存在时先 `mkdirSync(recursive)`（`store.ts:22-24`）
 * 5. 非法 JSON → 同步抛出；`getStore()` 备份成 `<file>.bak` 后回退到空 store（`store.ts:42,91-103`）
 * 6. `getStore()` 同名第二次调用返回**同一个**实例（`store.ts:79`）
 * 7. 首次写入后磁盘上不再残留 `.temp` 文件
 *
 * 这些性质一旦被破坏，桌面端用户会丢配置，而 UI 测试（10 个 `.electron.cjs` 直接手写
 * `config_v2.json`）也会开始失败。
 */

const electronStub = () => ({
  dialog: { showMessageBoxSync() {} },
  shell: { showItemInFolder() {} },
})

const withTempStore = (t, prepare) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-storage-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  return prepare(folder)
}

/**
 * 注意加载方式：不能用 `load('src/main/platform/storage/adapter.ts')`。
 *
 * `tests/unit/load-ts.cjs:17` 只会拦截**被加载那个文件自己**的顶层 require；
 * `adapter.ts:56` 的 `export ... from './electron'` 会被 TypeScript 转成
 * `require('./electron')`，绕过依赖表、按 Node 原生规则解析 —— 而磁盘上是 `.ts`，
 * 于是抛 `Cannot find module './electron'`。
 *
 * 因此这里按「adapter.ts 的默认导出到底做了什么」自己组装一遍：
 *   `createGetStore(electronStoreAdapter, { resolvePath: n => path.join(global.rainDataPath, n + '.json'), ... })`
 * 与 `src/main/platform/storage/electron.ts:165-176` 的默认导出逐字同构，
 * 这样测的就是**真正会跑在桌面端的那份实现**（两个模块本身都被真实加载）。
 */
const loadAdapter = (folder, name = 'config_v2') => {
  const globals = { rainDataPath: folder }
  globals.global = globals
  const core = load('src/main/platform/storage/core.ts')
  const electron = load('src/main/platform/storage/electron.ts', {
    'electron': electronStub(),
    '@common/utils': { log: { error() {} } },
    // `electron.ts:29` 的 `import { createGetStore } from './core'` 会被转成
    // `require('./core')`。磁盘上是 `.ts`，Node 原生解析必然失败
    // （`load-ts.cjs` 只拦截顶层 require，不拦截模块内部的相对 require）。
    // 这里注入上方已经真实加载过的 `core` 模块 —— 实现本身没有被替换。
    './core': core,
  }, globals)
  const getStore = core.createGetStore(electron.electronStoreAdapter, {
    resolvePath: storeName => path.join(folder, storeName + '.json'),
    logError() {},
    showErrorAlert() {},
  })
  return { getStore, storePath: path.join(folder, name + '.json') }
}

test('store file lands on <rainDataPath>/<name>.json with tab-indented utf8 JSON', t => {
  withTempStore(t, folder => {
    const { getStore, storePath } = loadAdapter(folder)
    getStore('config_v2').set('setting', { name: '雨声', version: '2.12.8' })

    const raw = fs.readFileSync(storePath, 'utf8')
    assert.equal(raw, JSON.stringify({ setting: { name: '雨声', version: '2.12.8' } }, null, '\t'))
    assert.ok(raw.includes('\n\t"setting"'), 'must keep the tab indent contract shared with the UI tests')
    // 往返读：同一个实例的 get 与重新建 Store 都要拿到同一份数据
    assert.equal(getStore('config_v2').get('setting').version, '2.12.8')
    assert.equal(JSON.parse(raw).setting.name, '雨声')
  })
})

test('directory is created on demand and no .temp file survives the atomic rename', t => {
  withTempStore(t, folder => {
    const nested = path.join(folder, 'userData', 'RainDatas')
    const { getStore, storePath } = loadAdapter(nested)
    assert.equal(fs.existsSync(nested), false, 'precondition: data directory must not exist yet')

    getStore('config_v2').set('version', '2.12.8')

    assert.ok(fs.existsSync(storePath))
    assert.deepEqual(
      fs.readdirSync(nested).filter(file => file.endsWith('.temp')),
      [],
      'temporary write files must be renamed away, not left behind',
    )
    assert.deepEqual(fs.readdirSync(nested), ['config_v2.json'])
  })
})

test('invalid JSON throws on first read, then recovers by renaming the file to .bak', t => {
  withTempStore(t, folder => {
    const { getStore, storePath } = loadAdapter(folder)
    fs.writeFileSync(storePath, '{ not json', 'utf8')

    const store = getStore('config_v2')

    assert.equal(fs.existsSync(storePath + '.bak'), true, 'damaged store must be backed up')
    assert.equal(fs.readFileSync(storePath + '.bak', 'utf8'), '{ not json')
    assert.equal(store.get('setting'), undefined, 'recovered store starts empty')
    store.set('setting', { ok: true })
    assert.equal(JSON.parse(fs.readFileSync(storePath, 'utf8')).setting.ok, true)
  })
})

test('isIgnoredError=false surfaces the parse failure instead of backing up', t => {
  withTempStore(t, folder => {
    const { getStore, storePath } = loadAdapter(folder)
    fs.writeFileSync(storePath, '{ not json', 'utf8')

    // 注意：不能断言 `SyntaxError` 构造器 —— `load-ts.cjs` 用 `vm.runInNewContext`
    // 加载模块，JSON.parse 抛出的 SyntaxError 来自另一个 realm，`instanceof` 不成立。
    assert.throws(() => getStore('config_v2', false), /JSON|position/)
    assert.equal(fs.existsSync(storePath + '.bak'), false)
  })
})

test('a store name resolves to one cached instance with override() replacing the whole object', t => {
  withTempStore(t, folder => {
    const { getStore, storePath } = loadAdapter(folder)
    const first = getStore('config_v2')
    assert.equal(getStore('config_v2'), first, 'same name must reuse the instance')

    first.override({ version: '2.12.8', setting: { 'theme.id': 'mono' } })
    assert.deepEqual(JSON.parse(fs.readFileSync(storePath, 'utf8')), { version: '2.12.8', setting: { 'theme.id': 'mono' } })
    // override 之后旧键必须消失（整份替换，不是合并）
    assert.equal(first.has('setting'), true)
    first.override({ version: '2.12.9' })
    assert.equal(first.has('setting'), false)
  })
})

test('separate store names stay separate files', t => {
  withTempStore(t, folder => {
    const { getStore } = loadAdapter(folder)

    getStore('data').set('playInfo', { index: 1 })
    getStore('sound_effect').set('eqPreset', [{ id: 'a' }])

    assert.deepEqual(fs.readdirSync(folder).sort(), ['data.json', 'sound_effect.json'])
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'data.json'), 'utf8')), { playInfo: { index: 1 } })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'sound_effect.json'), 'utf8')), { eqPreset: [{ id: 'a' }] })
  })
})

test('async write path (setAsync/overrideAsync/flush) writes the identical bytes', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-storage-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const { getStore, storePath } = loadAdapter(folder)

  const store = getStore('config_v2')
  await store.setAsync('setting', { name: '雨声' })
  assert.equal(fs.readFileSync(storePath, 'utf8'), JSON.stringify({ setting: { name: '雨声' } }, null, '\t'))

  await store.overrideAsync({ version: '2.12.8' })
  await store.flush()
  assert.deepEqual(JSON.parse(fs.readFileSync(storePath, 'utf8')), { version: '2.12.8' })
})

test('a write failure rejects the async path and does not poison the in-memory snapshot', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-storage-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const { getStore } = loadAdapter(folder)
  const store = getStore('config_v2')

  // 把目标目录换成一个文件，让临时文件的写入必然 ENOENT/ENOTDIR
  const blocker = path.join(folder, 'blocker')
  fs.writeFileSync(blocker, 'x')
  const nested = loadAdapter(path.join(blocker, 'nested'))
  const blocked = nested.getStore('config_v2')

  assert.throws(() => blocked.set('a', 1), /ENOTDIR|ENOENT/)
  await assert.rejects(blocked.setAsync('a', 1), /ENOTDIR|ENOENT/)
  // 内存快照仍然可读（原实现同样是"先改内存、再写盘"）
  assert.equal(blocked.get('a'), 1)
  assert.equal(store.get('a'), undefined)
})
