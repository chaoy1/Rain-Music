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
const temporary = []
after(() => { for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true }) })
const skip = spawnSync('javac', ['-version'], { stdio: 'ignore' }).status === 0 ? false : 'Requires JDK for Java / SQLite probe'
const op = (channel, arg, extra = {}) => ({ channel, ...(arg === undefined ? {} : { arg }), ...extra })
const b64 = text => Buffer.from(text).toString('base64')
const cases = [
  { name: 'url', ops: [op('get_music_url', 'a'), op('save_music_url', { id: 'a', url: 'https://a/1' }), op('save_music_url', { id: 'b', url: 'https://b' }), op('save_music_url', { id: 'a', url: 'https://a/2' }), op('get_music_url', 'a'), op('get_music_url_count'), op('remove_music_url', 'a'), op('get_music_url', 'a'), op('get_music_url', 'b'), op('clear_music_url'), op('get_music_url_count')] },
  { name: 'raw', ops: [op('get_lyric_raw', '歌'), op('save_lyric_raw', { id: '歌', lyrics: { lyric: '[00:01]雨🎵', tlyric: '译词', rlyric: '', rainlyric: '{"lines":[]}', ignored: 'no' } }), op('get_lyric_raw', '歌'), op('get_lyric_raw_count'), op('save_lyric_raw', { id: '歌', lyrics: { lyric: '第二条', tlyric: null } }), op('get_lyric_raw', '歌'), op('get_lyric_raw_count')] },
  { name: 'edited', sql: [`INSERT INTO lyric VALUES('x','raw','lyric','${b64('原词')}')`, `INSERT INTO lyric VALUES('x','edited','lyric','${b64('旧编辑')}')`, `INSERT INTO lyric VALUES('x','edited','tlyric','${b64('旧翻译')}')`], ops: [op('get_lyric_edited', 'x'), op('get_lyric_edited_count'), op('get_palyer_lyric', 'x'), op('clear_lyric_raw'), op('get_lyric_raw_count'), op('get_lyric_edited_count'), op('clear_lyric_edited'), op('get_lyric_edited_count'), op('get_palyer_lyric', 'x')] },
  { name: 'fallback', sql: [`INSERT INTO lyric VALUES('x','raw','lyric','${b64('原词')}')`, `INSERT INTO lyric VALUES('x','edited','tlyric','${b64('仅编辑翻译')}')`], ops: [op('get_palyer_lyric', 'x')] },
  { name: 'rollback', ops: [op('save_music_url', { id: 'x', url: 'old' }), op('save_music_url', { id: 'x', url: 'new' }, { failAfter: 2 }), op('get_music_url', 'x'), op('save_lyric_raw', { id: 'x', lyrics: { lyric: 'a', tlyric: 'b' } }, { failAfter: 2 }), op('get_lyric_raw_count')] },
  { name: 'bad-args', ops: [op('get_music_url'), op('save_music_url', '{broken'), op('save_music_url', { id: 'a', url: 42 }), op('save_lyric_raw', { id: 'a', lyrics: { lyric: 42 } }), op('get_music_url_count'), op('get_lyric_raw_count')] },
  { name: 'missing-url', sql: ['DROP TABLE music_url'], ops: [op('get_music_url', 'x'), op('save_music_url', { id: 'x', url: 'x' }), op('remove_music_url', 'x'), op('clear_music_url'), op('get_music_url_count')] },
  { name: 'missing-lyric', sql: ['DROP TABLE lyric'], ops: [op('get_lyric_raw', 'x'), op('save_lyric_raw', { id: 'x', lyrics: { lyric: 'x' } }), op('clear_lyric_raw'), op('get_lyric_raw_count'), op('get_lyric_edited', 'x'), op('clear_lyric_edited'), op('get_lyric_edited_count'), op('get_palyer_lyric', 'x')] },
]
const run = (cmd, args, log) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 })
  fs.writeFileSync(log, `${result.stdout || ''}${result.stderr || ''}`)
  assert.ifError(result.error); assert.equal(result.status, 0, fs.readFileSync(log, 'utf8'))
}
let report
const probe = () => {
  if (report) return report
  assert.ok(fs.existsSync(path.join(JAVA, 'RainMusicMediaCacheChannels.java')), 'Android media cache handlers must be implemented')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-media-cache-')); temporary.push(dir)
  const stubs = path.join(dir, 'stub'), out = path.join(dir, 'out'); fs.mkdirSync(out)
  const text = fs.readFileSync(path.join(__dirname, 'android-playback-queue-merge.test.cjs'), 'utf8')
  const ast = ts.createSourceFile('stubs.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let initializer
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) if (item.name.getText(ast) === 'STUBS') initializer = item.initializer.getText(ast)
  const sources = Object.fromEntries(Object.entries(vm.runInNewContext(`(${initializer})`)).filter(([file]) => file.startsWith('org/json/')))
  sources['org/json/JSONObject.java'] = sources['org/json/JSONObject.java'].replace('public List<String> jsonKeySet()', 'public java.util.Iterator<String> keys() { return values.keySet().iterator(); } public List<String> jsonKeySet()')
  Object.assign(sources, {
    'android/content/Context.java': 'package android.content; public class Context {}',
    'android/util/Base64.java': 'package android.util; public class Base64 { public static final int NO_WRAP=2; public static final int DEFAULT=0; public static String encodeToString(byte[] bytes,int flags){return java.util.Base64.getEncoder().encodeToString(bytes);} public static byte[] decode(String text,int flags){return java.util.Base64.getMimeDecoder().decode(text);} }',
    'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': 'package com.rainmusic.mobile.ipc; public class RainMusicIpcPlugin { public android.content.Context getContext(){return new android.content.Context();} }',
  })
  for (const [name, target] of [['Cursor', 'android/database'], ['SQLiteDatabase', 'android/database/sqlite'], ['RainMusicDatabase', 'com/rainmusic/mobile/ipc'], ['ProbeJson', 'org/json']]) sources[`${target}/${name}.java`] = fs.readFileSync(path.join(SHARED, `${name}.java`), 'utf8')
  sources['com/rainmusic/mobile/ipc/MediaCacheProbe.java'] = fs.readFileSync(path.join(__dirname, 'fixtures/android-media-cache/MediaCacheProbe.java'), 'utf8')
  for (const [name, source] of Object.entries(sources)) { const file = path.join(stubs, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source) }
  run('javac', ['-encoding', 'UTF-8', '-sourcepath', stubs, '-d', out, path.join(stubs, 'com/rainmusic/mobile/ipc/MediaCacheProbe.java'), ...['RainMusicMediaCacheChannels', 'RainMusicIpcHandlers', 'RainMusicListWriteLock'].map(name => path.join(JAVA, `${name}.java`))], path.join(dir, 'compile.log'))
  const schema = path.join(dir, 'schema.json'), scenarios = path.join(dir, 'cases.json'), output = path.join(dir, 'report.json')
  fs.writeFileSync(schema, JSON.stringify([...load('src/main/worker/dbService/tables.ts', {}, {}).default.values()]))
  fs.writeFileSync(scenarios, JSON.stringify({ cases }))
  run('java', ['-cp', out, 'com.rainmusic.mobile.ipc.MediaCacheProbe', process.execPath, path.join(SHARED, 'sql-bridge.cjs'), schema, scenarios, output], path.join(dir, 'run.log'))
  report = Object.fromEntries(JSON.parse(fs.readFileSync(output, 'utf8')).map(result => [result.name, result])); return report
}
const values = name => probe()[name].responses.map(response => response.value)
test('Android URL cache persists and replaces URLs, removes only requested ID and clears/counts real rows', { skip }, () => {
  assert.deepEqual(values('url'), ['', null, null, null, 'https://a/2', 2, null, '', 'https://b', null, 0])
})
test('Android raw lyric stores UTF-8 base64 variants and matches desktop append/row-count semantics', { skip }, () => {
  const result = values('raw')
  assert.deepEqual(result[0], { lyric: '' })
  assert.deepEqual(result[2], { lyric: '[00:01]雨🎵', tlyric: '译词', rlyric: '', rainlyric: '{"lines":[]}' })
  assert.equal(result[3], 4); assert.equal(result[5].lyric, '第二条'); assert.equal(result[5].tlyric, '译词'); assert.equal(result[6], 5)
})
test('Android legacy edited lyric reads/counts/clears independently and player lyric includes raw source', { skip }, () => {
  const result = values('edited')
  assert.deepEqual(result[0], { lyric: '旧编辑', tlyric: '旧翻译' }); assert.equal(result[1], 2)
  assert.deepEqual(result[2], { lyric: '旧编辑', tlyric: '旧翻译', rawlrcInfo: { lyric: '原词' } })
  assert.deepEqual(result.slice(3, 8), [null, 0, 2, null, 0]); assert.deepEqual(result[8], { lyric: '', rawlrcInfo: { lyric: '' } })
})
test('Android player lyric falls back to full raw lyric when edited main lyric is absent', { skip }, () => {
  assert.deepEqual(values('fallback')[0], { lyric: '原词', rawlrcInfo: { lyric: '原词' } })
})
test('Android media cache write failure rolls back URL replacement and every lyric variant', { skip }, () => {
  const result = probe().rollback
  for (const i of [1, 3]) assert.match(result.responses[i].error, /Injected SQL write failure/)
  assert.equal(result.responses[2].value, 'old'); assert.equal(result.responses[4].value, 0); assert.equal(result.rollbacks, 2)
})
test('Android media cache rejects malformed payloads without inserting partial state', { skip }, () => {
  const result = probe()['bad-args']; for (const response of result.responses.slice(0, 4)) assert.ok(response.error)
  assert.deepEqual(values('bad-args').slice(4), [0, 0]); assert.equal(result.commits, 0)
})
test('Android every media cache operation propagates missing-table errors', { skip }, () => {
  for (const name of ['missing-url', 'missing-lyric']) for (const result of probe()[name].responses) assert.match(result.error, /Missing table:/)
})
