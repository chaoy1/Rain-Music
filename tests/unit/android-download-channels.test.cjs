const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const load = require('./load-ts.cjs')

const ROOT = path.resolve(__dirname, '../..')
const JAVA = path.join(ROOT, 'android/app/src/main/java/com/rainmusic/mobile/ipc')
const SHARED = path.join(__dirname, 'fixtures/android-music-add')
const FIXTURES = path.join(__dirname, 'fixtures/android-download')
const temporary = []
after(() => { for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true }) })
const skip = spawnSync('javac', ['-version'], { stdio: 'ignore' }).status === 0 ? false : 'Requires JDK for real Java handler / SQLite probe'
const music = { id: 'song', name: '原始歌曲', singer: '歌手', source: 'wy', interval: null, meta: { songId: 'song', nested: { lyric: ['一', '二'] } } }
const task = (id, extra = {}) => ({ id, isComplate: false, status: 'pause', statusText: '已暂停', downloaded: 25, total: 200, progress: 999, speed: '2 MB/s', writeQueue: 7, metadata: { musicInfo: music, url: null, quality: '128k', ext: 'mp3', fileName: '保留.mp3', filePath: '/music/保留.mp3', listId: 'transient' }, ...extra })
// Literal schema order: all thirteen persisted fields, deliberately noncompact positions.
const row = (id, position = 9) => [id, 0, 'pause', '已暂停', 25, 200, null, '128k', 'mp3', '保留.mp3', '/music/保留.mp3', JSON.stringify(music), position]
const assertRows = (actual, expected, message) => {
  // JSON object property order is not part of the IPC/storage contract.
  const decode = rows => rows.map(columns => columns.map((value, index) => index === 11 ? JSON.parse(value) : value))
  assert.deepEqual(decode(actual), decode(expected), message)
}
const add = (list, addMusicLocationType = 'bottom') => ({ op: 'add', payload: { list, addMusicLocationType } })
const get = { op: 'get' }
const changed = task('a', { isComplate: true, status: 'completed', statusText: '完成', downloaded: 301, total: 300, metadata: { musicInfo: { id: 'WRONG' }, url: 'https://example.test/new', quality: 'flac', ext: 'flac', fileName: 'WRONG.flac', filePath: '/music/new.mp3' } })
const bad = task('bad', { metadata: { ...task('bad').metadata, musicInfo: 'invalid' } })
const cases = [
  { name: 'get', seed: [row('a', 8), ['b', 1, 'completed', '', 1, 0, 'https://x', 'flac', 'flac', 'b.flac', '/b', JSON.stringify({ id: 'b' }), 2]], operations: [get] },
  { name: 'fraction', seed: [row('a').map((value, i) => i === 4 ? 0.5 : i === 5 ? 2 : value)], operations: [get] },
  { name: 'append', seed: [row('a', 9)], operations: [add([task('b'), task('c')]), get] },
  { name: 'top', seed: [row('a', 9)], operations: [add([task('b'), task('c')], 'top'), get] },
  { name: 'empty-top', seed: [row('a', 9)], operations: [add([], 'top')] },
  { name: 'legacy-bottom', seed: [], operations: [add([task('a')], 'legacy-value')] },
  { name: 'update', seed: [row('a', 9)], operations: [{ op: 'update', payload: [changed, task('missing')] }, get] },
  { name: 'remove', seed: [row('a', 9), row('b', 10)], operations: [{ op: 'remove', payload: ['a', 'missing', 'a'] }, get] },
  { name: 'clear', seed: [row('a')], operations: [{ op: 'clear' }, get] },
  { name: 'sentinel-remove', seed: [row('a')], sentinel: true, operations: [{ op: 'remove', payload: ['a'] }] },
  { name: 'sentinel-clear', seed: [row('a')], sentinel: true, operations: [{ op: 'clear' }] },
  { name: 'duplicate', seed: [row('a')], operations: [add([task('b'), task('a')], 'top')] },
  { name: 'rollback-add', seed: [row('a')], failAfter: 2, operations: [add([task('b'), task('c')], 'top')] },
  { name: 'rollback-position', seed: [row('a')], failAfter: 2, operations: [add([task('b')], 'top')] },
  { name: 'rollback-update', seed: [row('a'), row('b', 10)], failAfter: 2, operations: [{ op: 'update', payload: [changed, task('b', { status: 'error' })] }] },
  { name: 'rollback-remove', seed: [row('a'), row('b', 10)], failAfter: 2, operations: [{ op: 'remove', payload: ['a', 'b'] }] },
  { name: 'rollback-clear', seed: [row('a')], failAfter: 1, operations: [{ op: 'clear' }] },
  { name: 'invalid-add', seed: [], operations: [add([task('a'), bad])] },
  { name: 'invalid-update', seed: [row('a')], operations: [{ op: 'update', payload: [changed, bad] }] },
  { name: 'invalid-remove', seed: [row('a')], operations: [{ op: 'remove', payload: ['a', 42] }] },
  { name: 'invalid-args', seed: [], operations: [{ op: 'add' }] },
  ...['get', 'add', 'update', 'remove', 'clear'].map(op => ({ name: `missing-${op}`, seed: [], missingTable: true, operations: [op === 'add' ? add([]) : { op, ...(['update', 'remove'].includes(op) ? { payload: [] } : {}) }] })),
  ...['get', 'add'].map(op => ({ name: `bad-json-${op}`, seed: [row('a').map((v, i) => i === 11 ? '{broken' : v)], operations: [op === 'get' ? get : add([task('b')])] })),
  { name: 'concurrent', seed: [], concurrent: true, operations: [add([task('a')]), add([task('b')])] },
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-download-')); temporary.push(dir)
  const out = path.join(dir, 'out'); const stubs = path.join(dir, 'stub'); fs.mkdirSync(out)
  // Read-only reuse of the checked-exception JSON double and real SQLite bridge.
  const text = fs.readFileSync(path.join(__dirname, 'android-playback-queue-merge.test.cjs'), 'utf8')
  const ast = ts.createSourceFile('stubs.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let initializer
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(ast) === 'STUBS') initializer = declaration.initializer.getText(ast)
  }
  assert.ok(initializer, 'Missing checked org.json fixture')
  const sources = Object.fromEntries(Object.entries(vm.runInNewContext(`(${initializer})`)).filter(([file]) => file.startsWith('org/json/')))
  Object.assign(sources, {
    'android/content/Context.java': 'package android.content; public class Context {}',
    'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': 'package com.rainmusic.mobile.ipc; public class RainMusicIpcPlugin { public android.content.Context getContext(){return new android.content.Context();} }',
  })
  for (const [name, target] of [['Cursor', 'android/database'], ['SQLiteDatabase', 'android/database/sqlite'], ['RainMusicDatabase', 'com/rainmusic/mobile/ipc'], ['ProbeJson', 'org/json']]) {
    sources[`${target}/${name}.java`] = fs.readFileSync(path.join(SHARED, `${name}.java`), 'utf8')
  }
  sources['android/database/Cursor.java'] = fs.readFileSync(path.join(FIXTURES, 'Cursor.java'), 'utf8')
  sources['com/rainmusic/mobile/ipc/RainMusicDatabase.java'] = fs.readFileSync(path.join(FIXTURES, 'RainMusicDatabase.java'), 'utf8')
  // Optional local probe mode: run the same behavior tests using a real AOSP JSON jar.
  const jsonJar = process.env.RAIN_DOWNLOAD_JSON_JAR
  if (jsonJar) {
    for (const file of Object.keys(sources)) if (file.startsWith('org/json/')) delete sources[file]
    sources['org/json/ProbeJson.java'] = 'package org.json; public class ProbeJson { public static JSONObject parse(String text) throws JSONException { return new JSONObject(text); } }'
  }
  sources['com/rainmusic/mobile/ipc/DownloadProbe.java'] = fs.readFileSync(path.join(FIXTURES, 'DownloadProbe.java'), 'utf8')
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(stubs, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source)
  }
  const source = process.env.RAIN_DOWNLOAD_SOURCE || path.join(JAVA, 'RainMusicDownloadChannels.java')
  run('javac', ['-encoding', 'UTF-8', ...(jsonJar ? ['-cp', jsonJar] : []), '-sourcepath', stubs, '-d', out, path.join(stubs, 'com/rainmusic/mobile/ipc/DownloadProbe.java'), source, path.join(JAVA, 'RainMusicIpcHandlers.java'), path.join(JAVA, 'RainMusicListWriteLock.java')], path.join(dir, 'compile.log'))
  const schema = path.join(dir, 'schema.json'); const input = path.join(dir, 'cases.json'); const output = path.join(dir, 'report.json')
  fs.writeFileSync(schema, JSON.stringify([...load('src/main/worker/dbService/tables.ts', {}, {}).default.values()]))
  fs.writeFileSync(input, JSON.stringify({ cases }))
  run('java', ['-cp', jsonJar ? out + path.delimiter + jsonJar : out, 'com.rainmusic.mobile.ipc.DownloadProbe', process.execPath, path.join(SHARED, 'sql-bridge.cjs'), schema, input, output], path.join(dir, 'run.log'))
  report = Object.fromEntries(JSON.parse(fs.readFileSync(output, 'utf8')).map(value => [value.name, value]))
  return report
}

// Each test names its realistic production mutation; mutation runs use a TEMP source copy.
test('Android 下载：get 恢复完整记录，按 position 排序，重算进度并清空瞬时字段', { skip }, () => {
  const result = probe().get
  assert.equal(result.error, undefined)
  const [b, a] = result.returned[0]
  assert.deepEqual(b, { id: 'b', isComplate: true, status: 'completed', statusText: '', downloaded: 1, total: 0, progress: 0, speed: '', writeQueue: 0, metadata: { musicInfo: { id: 'b' }, url: 'https://x', quality: 'flac', ext: 'flac', fileName: 'b.flac', filePath: '/b' } })
  assert.deepEqual(a, { id: 'a', isComplate: false, status: 'pause', statusText: '已暂停', downloaded: 25, total: 200, progress: 13, speed: '', writeQueue: 0, metadata: { musicInfo: music, url: null, quality: '128k', ext: 'mp3', fileName: '保留.mp3', filePath: '/music/保留.mp3' } })
  assert.equal(probe().fraction.returned[0][0].downloaded, 0.5)
  assert.equal(probe().fraction.returned[0][0].progress, 25)
})
test('Android 下载：append 使用记录数，top 批次保序并重排旧行，保留十三列', { skip }, () => {
  assert.equal(probe().append.error, undefined)
  assertRows(probe().append.rows, [row('b', 1), row('c', 2), row('a', 9)])
  assertRows(probe().top.rows, [row('b', 0), row('c', 1), row('a', 2)])
  assertRows(probe()['empty-top'].rows, [row('a', 0)])
  assertRows(probe()['legacy-bottom'].rows, [row('a', 0)])
})
test('Android 下载：update 仅写七个可变字段，未知 ID 不插入且元数据和 position 保留', { skip }, () => {
  const expected = row('a', 9)
  expected.splice(1, 6, 1, 'completed', '完成', 301, 300, 'https://example.test/new')
  expected[10] = '/music/new.mp3'
  assert.equal(probe().update.error, undefined)
  assertRows(probe().update.rows, [expected])
  assert.equal(probe().update.returned[1][0].progress, 100)
})
test('Android 下载：remove 只删指定记录且不重排，clear 清空，下次 get 读取持久化结果', { skip }, () => {
  assert.equal(probe().remove.error, undefined)
  assertRows(probe().remove.rows, [row('b', 10)])
  assert.deepEqual(probe().remove.returned[1].map(item => item.id), ['b'])
  assert.equal(probe().clear.error, undefined)
  assert.deepEqual(probe().clear.rows, [])
  assert.deepEqual(probe().clear.returned, [null, []])
  for (const name of ['sentinel-remove', 'sentinel-clear']) {
    assert.equal(probe()[name].error, undefined)
    assert.equal(probe()[name].filePreserved, true)
  }
})
test('Android 下载：重复主键拒绝整批，写入及排序失败回滚', { skip }, () => {
  for (const name of ['duplicate', 'rollback-add', 'rollback-position']) {
    assert.ok(probe()[name].error, name)
    assertRows(probe()[name].rows, [row('a')], name)
    assert.equal(probe()[name].commits, 0, name)
    assert.equal(probe()[name].rollbacks, 1, name)
  }
})
test('Android 下载：update/remove/clear 写失败传播，批次内先前写入回滚', { skip }, () => {
  for (const name of ['rollback-update', 'rollback-remove', 'rollback-clear']) {
    assert.match(probe()[name].error, /Injected SQL write failure/)
    assertRows(probe()[name].rows, name === 'rollback-clear' ? [row('a')] : [row('a'), row('b', 10)])
    assert.equal(probe()[name].commits, 0)
    assert.equal(probe()[name].rollbacks, 1)
  }
})
test('Android 下载：坏输入整批拒绝，不把 JSONObject/JSONArray 当 Map/List', { skip }, () => {
  for (const name of ['invalid-add', 'invalid-update', 'invalid-remove', 'invalid-args']) {
    assert.ok(probe()[name].error, name)
    assert.equal(probe()[name].commits, 0, name)
    assertRows(probe()[name].rows, ['invalid-update', 'invalid-remove'].includes(name) ? [row('a')] : [], name)
  }
})
test('Android 下载：缺表及已存 musicInfo 坏 JSON 大声失败，add 不修改坏库', { skip }, () => {
  for (const name of ['missing-get', 'missing-add', 'missing-update', 'missing-remove', 'missing-clear', 'bad-json-get', 'bad-json-add']) {
    assert.ok(probe()[name].error, name)
    assert.equal(probe()[name].commits, 0, name)
  }
  assert.equal(probe()['bad-json-add'].rows.length, 1)
})
test('Android 下载：共享写锁串行化并发追加，不丢记录也不重复 position', { skip }, () => {
  assert.equal(probe().concurrent.error, undefined)
  assert.deepEqual(probe().concurrent.rows.map(item => item[0]).sort(), ['a', 'b'])
  assert.deepEqual(probe().concurrent.rows.map(item => item[12]), [0, 1])
  for (const result of Object.values(probe())) assert.equal(result.unlockedOpens, 0, result.name)
})
test('Android 下载：成功写入返回 void/null，任何通道都不广播', { skip }, () => {
  for (const name of ['append', 'top', 'update', 'remove', 'clear', 'legacy-bottom', 'empty-top']) {
    assert.equal(probe()[name].returned[0], null, name)
  }
  for (const result of Object.values(probe())) assert.deepEqual(result.events, [], result.name)
})
