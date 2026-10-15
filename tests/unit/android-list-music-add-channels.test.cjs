const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const load = require('./load-ts.cjs')

// Real Java handlers + the already checked org.json test implementation + real
// Node SQLite. Android connection/IPC hosting are replaced; ART is not exercised.
const ROOT = path.resolve(__dirname, '../..')
const JAVA = path.join(ROOT, 'android/app/src/main/java/com/rainmusic/mobile/ipc')
const FIXTURES = path.join(__dirname, 'fixtures/android-music-add')
const temporary = []
after(() => { for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true }) })
const available = spawnSync('javac', ['-version'], { stdio: 'ignore' }).status === 0
const skip = available ? false : 'Requires JDK for the Java/SQLite behavior probe'
const song = (id, name = id, extra = {}) => ({ id, name, singer: 'Singer', source: 'wy', interval: null, meta: { songId: id, nested: { value: '原始元数据' } }, ...extra })
const payload = (id, musicInfos, addMusicLocationType = 'bottom') => ({ id, musicInfos, addMusicLocationType })
const scenarios = [
  { name: 'bottom-holes', listId: 'u', seed: [song('a', 'A', { order: 7 })], orphan: true, payload: payload('u', [song('b')]) },
  { name: 'top', listId: 'u', seed: [song('a', 'A', { order: 9 })], payload: payload('u', [song('b'), song('c')], 'top') },
  { name: 'ordinary-dedupe', listId: 'u', seed: [song('a', 'Same', { order: 0 })], payload: payload('u', [song('a'), song('b', 'Same'), song('b', 'Other'), song('c')]) },
  { name: 'default-dedupe', listId: 'default', seed: [song('a', 'Ｓｏｎｇ', { order: 0 })], payload: payload('default', [song('a', 'Different'), song('b', '\u3000song\u00a0', { source: 'kg' }), song('c', 'Other'), song('d', 'other', { source: 'tx' })]) },
  { name: 'empty-fields', listId: 'default', seed: [], payload: payload('default', [song('a', ''), song('b', ''), song('c', 'Same', { singer: '' }), song('d', 'Same', { singer: '' })]) },
  { name: 'temp', listId: 'temp', seed: [], payload: payload('temp', [song('a', 'Same'), song('b', 'Same')]) },
  { name: 'fallback-position', listId: 'u', seed: [song('a')], payload: payload('u', [song('b')], 'legacy-value') },
  { name: 'empty-top', listId: 'u', seed: [song('a', 'A', { order: 9 })], payload: payload('u', [], 'top') },
  { name: 'rollback-bottom', listId: 'u', seed: [], failAfter: 2, payload: payload('u', [song('b')]) },
  { name: 'rollback-top', listId: 'u', seed: [song('a', 'A', { order: 9 })], failAfter: 3, payload: payload('u', [song('b')], 'top') },
  { name: 'missing-table', listId: 'u', seed: [], missingTable: true, payload: payload('u', [song('b')]) },
  { name: 'bad-existing-meta', listId: 'u', seed: [song('a', 'A', { order: 0 })], badMeta: true, payload: payload('u', [song('b')]) },
  { name: 'invalid-args', listId: 'u', seed: [], noArgs: true },
  { name: 'invalid-meta', listId: 'u', seed: [], payload: payload('u', [song('b', 'B', { meta: 'not an object' })]) },
  { name: 'concurrent', listId: 'u', seed: [], concurrent: true, payload: [payload('u', [song('a')]), payload('u', [song('b')])] },
  { name: 'broadcast-order', listId: 'u', seed: [], concurrent: true, delayEvent: true, payload: [payload('u', [song('a')]), payload('u', [song('b')])] },
  { name: 'default-repair', listId: 'default', seed: [song('a', 'Same', { order: 0 }), song('b', 'same', { order: 1 })], payload: payload('default', [song('c', 'New')]) },
  { name: 'default-repair-failure', listId: 'default', seed: [song('a', 'Same', { order: 0 }), song('b', 'same', { order: 1 })], failAfter: 2, payload: payload('default', [song('c', 'New')]) },
]
const run = (command, args, log) => {
  const fd = fs.openSync(log, 'w')
  let result
  try { result = spawnSync(command, args, { stdio: ['ignore', fd, fd], timeout: 60000 }) } finally { fs.closeSync(fd) }
  assert.ifError(result.error)
  assert.equal(result.status, 0, fs.readFileSync(log, 'utf8'))
}
let report
const probe = () => {
  if (report) return report
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-music-add-'))
  temporary.push(dir)
  const out = path.join(dir, 'out'); const stubs = path.join(dir, 'stub')
  fs.mkdirSync(out)
  // Reuse the strict JSON implementation without importing/running its test suite.
  const text = fs.readFileSync(path.join(__dirname, 'android-playback-queue-merge.test.cjs'), 'utf8')
  const ast = ts.createSourceFile('stubs.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let initializer
  for (const statement of ast.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(ast) === 'STUBS') initializer = declaration.initializer.getText(ast)
    }
  }
  assert.ok(initializer, 'Missing shared JSON test implementation')
  const json = vm.runInNewContext(`(${initializer})`)
  const sources = Object.fromEntries(Object.entries(json).filter(([file]) => file.startsWith('org/json/')))
  Object.assign(sources, {
    'android/content/Context.java': 'package android.content; public class Context { public Context getApplicationContext(){return this;} }',
    'com/getcapacitor/Logger.java': 'package com.getcapacitor; public class Logger { public static void debug(String t,String m){} public static void info(String t,String m){} public static void warn(String t,String m){} public static void error(String t,String m){} }',
    'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': 'package com.rainmusic.mobile.ipc; public class RainMusicIpcPlugin { public android.content.Context getContext(){return new android.content.Context();} }',
  })
  for (const [name, target] of [
    ['Cursor', 'android/database'], ['SQLiteDatabase', 'android/database/sqlite'],
    ['RainMusicDatabase', 'com/rainmusic/mobile/ipc'], ['MusicAddProbe', 'com/rainmusic/mobile/ipc'], ['ProbeJson', 'org/json'],
  ]) sources[`${target}/${name}.java`] = fs.readFileSync(path.join(FIXTURES, `${name}.java`), 'utf8')
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(stubs, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source, 'utf8')
  }
  const classes = ['RainMusicListMusicAddChannels', 'RainMusicListMusicGetChannels', 'RainMusicPlaybackQueueKey', 'RainMusicLogThrottle', 'RainMusicIpcHandlers', 'RainMusicListWriteLock']
  run('javac', ['-encoding', 'UTF-8', '-sourcepath', stubs, '-d', out, path.join(stubs, 'com/rainmusic/mobile/ipc/MusicAddProbe.java'), ...classes.map(name => path.join(JAVA, `${name}.java`))], path.join(dir, 'compile.log'))
  const schema = path.join(dir, 'schema.json'); const cases = path.join(dir, 'cases.json'); const output = path.join(dir, 'report.json')
  fs.writeFileSync(schema, JSON.stringify([...load('src/main/worker/dbService/tables.ts', {}, {}).default.values()]))
  fs.writeFileSync(cases, JSON.stringify({ cases: scenarios }))
  run('java', ['-cp', out, 'com.rainmusic.mobile.ipc.MusicAddProbe', process.execPath, path.join(FIXTURES, 'sql-bridge.cjs'), schema, cases, output], path.join(dir, 'run.log'))
  report = Object.fromEntries(JSON.parse(fs.readFileSync(output, 'utf8')).map(result => [result.name, result]))
  return report
}
const ids = result => result.rows.map(row => row[0])
const orders = result => result.orders.filter(row => row[1] !== 'orphan').map(row => [row[1], Number(row[2])])

test('Android 歌曲新增：追加保留序号空洞，忽略孤儿排序；缺排序用桌面回退值', { skip }, () => {
  assert.deepEqual(orders(probe()['bottom-holes']), [['a', 7], ['b', 8]])
  assert.deepEqual(orders(probe()['fallback-position']), [['b', 2]])
})
test('Android 歌曲新增：top 在原歌曲前插入并重排；空 top 也重排', { skip }, () => {
  assert.deepEqual(orders(probe().top), [['b', 0], ['c', 1], ['a', 2]])
  assert.deepEqual(orders(probe()['empty-top']), [['a', 0]])
})
test('Android 歌曲新增：普通 / temp 按 ID 去重，默认队列按 ID 或规范化曲名歌手去重', { skip }, () => {
  assert.deepEqual(ids(probe()['ordinary-dedupe']), ['a', 'b', 'c'])
  assert.deepEqual(ids(probe()['default-dedupe']), ['a', 'c'])
  assert.deepEqual(ids(probe().temp), ['a', 'b'])
  assert.deepEqual(ids(probe()['empty-fields']), ['a', 'b', 'c', 'd'])
})
test('Android 歌曲新增：保留首条完整源元数据；广播原始载荷，在提交后与锁外发出', { skip }, () => {
  for (const scenario of scenarios.filter(item => !item.name.startsWith('invalid') && !item.name.startsWith('rollback') && !['bad-existing-meta', 'missing-table', 'default-repair-failure'].includes(item.name))) {
    const result = probe()[scenario.name]
    assert.equal(result.error, undefined, scenario.name)
    assert.equal(result.result, null, scenario.name)
    for (const event of result.events) {
      assert.equal(event.channel, 'player_list_music_add')
      assert.equal(event.locked, false)
      assert.ok(event.commits >= 1)
    }
    if (!scenario.concurrent) assert.deepEqual(result.events.map(event => event.payload), [scenario.payload])
  }
  assert.deepEqual(JSON.parse(probe()['ordinary-dedupe'].rows[1][2]), song('b', 'Same').meta)
})
test('Android 歌曲新增：任一步写失败回滚信息与顺序，失败不广播', { skip }, () => {
  assert.deepEqual(ids(probe()['rollback-bottom']), [])
  assert.deepEqual(orders(probe()['rollback-top']), [['a', 9]])
  assert.deepEqual(probe()['rollback-top'].rows.map(([id, name, meta]) => [id, name, JSON.parse(meta)]), [['a', 'A', song('a').meta]])
  for (const name of ['rollback-bottom', 'rollback-top']) {
    assert.match(probe()[name].error, /Injected SQL write failure/)
    assert.equal(probe()[name].rollbacks, 1)
    assert.equal(probe()[name].commits, 0)
    assert.deepEqual(probe()[name].events, [])
  }
})
test('Android 歌曲新增：缺表、坏 JSON、非法参数不能伪装成功', { skip }, () => {
  for (const name of ['missing-table', 'bad-existing-meta', 'invalid-args', 'invalid-meta']) {
    assert.ok(probe()[name].error, name)
    assert.deepEqual(probe()[name].events, [], name)
    assert.equal(probe()[name].commits, 0, name)
  }
})
test('Android 歌曲新增：并发新增不会丢歌或生成相同末尾排序', { skip }, () => {
  const result = probe().concurrent
  assert.equal(result.error, undefined)
  assert.deepEqual(ids(result).sort(), ['a', 'b'])
  assert.deepEqual(orders(result).map(row => row[1]), [0, 1])
  assert.equal(result.events.length, 2)
})

test('Android 歌曲新增：延迟首条广播时，事件重放顺序仍与 SQLite 提交顺序一致', { skip }, () => {
  const result = probe()['broadcast-order']
  assert.equal(result.error, undefined)
  assert.deepEqual(result.events.map(event => event.payload.musicInfos[0].id), orders(result).map(row => row[0]))
})
test('Android 歌曲新增：default 先修复再新增；修复失败回滚快照且不广播', { skip }, () => {
  assert.deepEqual(ids(probe()['default-repair']), ['a', 'c'])
  assert.deepEqual(orders(probe()['default-repair']), [['a', 0], ['c', 1]])
  assert.equal(probe()['default-repair'].snapshots.length, 1)
  const failed = probe()['default-repair-failure']
  assert.ok(failed.error)
  assert.deepEqual(ids(failed), ['a', 'b'])
  assert.deepEqual(orders(failed), [['a', 0], ['b', 1]])
  assert.deepEqual(failed.snapshots, [])
  assert.deepEqual(failed.events, [])
})

test('Android 列表广播：B 代发 A 的失败事件时，错误只返回给 A，B 事件继续发出', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-list-publish-'))
  temporary.push(dir)
  const out = path.join(dir, 'out')
  fs.mkdirSync(out)
  run('javac', ['-encoding', 'UTF-8', '-d', out, path.join(FIXTURES, 'QueueFailureProbe.java'), path.join(JAVA, 'RainMusicListWriteLock.java')], path.join(dir, 'compile.log'))
  const log = path.join(dir, 'run.log')
  run('java', ['-cp', out, 'com.rainmusic.mobile.ipc.QueueFailureProbe'], log)
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split(/\r?\n/), ['B=success', 'A=A publish failed', 'EVENTS=B'])
})

test('Android 歌曲新增：插件 load 注册真实新增 handler', () => {
  const code = fs.readFileSync(path.join(JAVA, 'RainMusicIpcPlugin.java'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.match(code, /RainMusicListMusicAddChannels\.register\(this\);/)
})
