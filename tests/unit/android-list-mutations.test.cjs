const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const { spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const load = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const java = path.join(root, 'android/app/src/main/java/com/rainmusic/mobile/ipc')
const fixture = path.join(__dirname, 'fixtures/android-music-add')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-list-mutations-'))
after(() => fs.rmSync(work, { recursive: true, force: true }))
const song = (id, listId = 'u', order = 0, name = id) => ({ id, listId, order, name, singer: 'Singer', source: 'wy', interval: null, meta: { nested: ['元数据', id] } })
const seed = [song('a', 'u', 4), song('b', 'u', 9), song('c', 'u', 12), song('x', 'v', 8)]
const operation = (name, suffix, payload, extra = {}) => ({ name, channel: `player_list_${suffix}`, payload, seed, lists: [{ id: 'u', name: 'U' }, { id: 'v', name: 'V' }, { id: 'w', name: 'W' }], ...extra })
const cases = [
  operation('remove', 'music_remove', { listId: 'u', ids: ['b', 'missing'] }),
  operation('clear', 'music_clear', ['u']),
  operation('overwrite', 'music_overwrite', { listId: 'default', musicInfos: [song('n', 'default', 0, 'Ｓｏｎｇ'), song('m', 'default', 1, 'song')] }),
  operation('update', 'music_update', [{ id: 'u', musicInfo: song('b', 'u', 0, 'Updated') }, { id: 'v', musicInfo: song('missing') }]),
  operation('position', 'music_update_position', { listId: 'u', position: 0, ids: ['c', 'a'] }),
  operation('negative', 'music_update_position', { listId: 'u', position: -1, ids: ['c'] }),
  operation('invalid-position', 'music_update_position', { listId: 'u', position: 0, ids: ['missing'] }),
  operation('duplicate-position', 'music_update_position', { listId: 'u', position: 0, ids: ['a', 'a'] }),
  operation('move-top', 'music_move', { fromId: 'u', toId: 'v', musicInfos: [song('b'), song('x')], addMusicLocationType: 'top' }),
  operation('move-bottom', 'music_move', { fromId: 'u', toId: 'v', musicInfos: [song('b')], addMusicLocationType: 'bottom' }),
  operation('list-position', 'update_position', { position: 0, ids: ['u', 'w'] }),
  operation('all', 'data_overwire', { defaultList: [song('n')], userList: [{ id: 'z', name: 'Z', locationUpdateTime: null, list: [song('q')] }] }, { seed: [...seed, song('t', 'temp')] }),
  operation('bad-meta', 'music_overwrite', { listId: 'u', musicInfos: [song('n', 'u', 0, 'New')] }, { badMeta: true }),
  operation('invalid-meta', 'music_update', [{ id: 'u', musicInfo: { ...song('a'), meta: 'bad' } }]),
  operation('duplicate-overwrite', 'music_overwrite', { listId: 'u', musicInfos: [song('n'), song('n')] }),
  operation('missing', 'music_remove', { listId: 'u', ids: ['a'] }, { missing: 'my_list_music_info_order' }),
]
for (const item of cases.filter(item => ['remove', 'clear', 'overwrite', 'update', 'position', 'move-top', 'move-bottom', 'list-position', 'all'].includes(item.name))) cases.push({ ...item, name: `${item.name}-rollback`, failAfter: 2 })
let result
function probe() {
  if (result) return result
  const ast = ts.createSourceFile('stub.cjs', fs.readFileSync(path.join(__dirname, 'android-playback-queue-merge.test.cjs'), 'utf8'), ts.ScriptTarget.Latest, true)
  let initializer
  for (const s of ast.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (d.name.getText(ast) === 'STUBS') initializer = d.initializer.getText(ast)
  const stubs = Object.fromEntries(Object.entries(vm.runInNewContext(`(${initializer})`)).filter(([name]) => name.startsWith('org/json/')))
  Object.assign(stubs, {
    'android/content/Context.java': 'package android.content; public class Context { public Context getApplicationContext(){return this;} }',
    'com/getcapacitor/Logger.java': 'package com.getcapacitor; public class Logger { public static void debug(String t,String m){} public static void info(String t,String m){} public static void warn(String t,String m){} public static void error(String t,String m){} }',
    'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': 'package com.rainmusic.mobile.ipc; public class RainMusicIpcPlugin { public android.content.Context getContext(){return new android.content.Context();} }',
  })
  for (const [name, target] of [['Cursor', 'android/database'], ['SQLiteDatabase', 'android/database/sqlite'], ['RainMusicDatabase', 'com/rainmusic/mobile/ipc'], ['ProbeJson', 'org/json']]) stubs[`${target}/${name}.java`] = fs.readFileSync(path.join(fixture, `${name}.java`), 'utf8')
  stubs['com/rainmusic/mobile/ipc/MutationProbe.java'] = fs.readFileSync(path.join(__dirname, 'fixtures/android-list-mutations/MutationProbe.java'), 'utf8')
  for (const [name, code] of Object.entries(stubs)) { const file = path.join(work, 'stubs', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, code) }
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 }); assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`) }
  run('javac', ['-encoding', 'UTF-8', '-sourcepath', path.join(work, 'stubs'), '-d', path.join(work, 'out'), path.join(work, 'stubs/com/rainmusic/mobile/ipc/MutationProbe.java'), ...['RainMusicListMutationChannels', 'RainMusicListMusicGetChannels', 'RainMusicListMusicAddChannels', 'RainMusicPlaybackQueueKey', 'RainMusicIpcHandlers', 'RainMusicListWriteLock', 'RainMusicLogThrottle'].map(name => path.join(java, `${name}.java`))])
  fs.writeFileSync(path.join(work, 'schema.json'), JSON.stringify([...load('src/main/worker/dbService/tables.ts', {}, {}).default.values()]))
  fs.writeFileSync(path.join(work, 'cases.json'), JSON.stringify({ cases }))
  run('java', ['-cp', path.join(work, 'out'), 'com.rainmusic.mobile.ipc.MutationProbe', process.execPath, path.join(fixture, 'sql-bridge.cjs'), path.join(work, 'schema.json'), path.join(work, 'cases.json'), path.join(work, 'results.json')])
  return result = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(work, 'results.json'), 'utf8')).map(r => [r.name, r]))
}
const order = r => r.orders.map(([list, id, n]) => [list, id, Number(n)])
test('Android list mutations remove/clear preserve other lists and sparse order', () => {
  assert.deepEqual(order(probe().remove), [['u', 'a', 4], ['u', 'c', 12], ['v', 'x', 8]])
  assert.deepEqual(order(probe().clear), [['v', 'x', 8]])
  assert.equal(probe().clear.events[0].channel, 'player_list_music_clear')
})
test('Android list mutations overwrite deduplicates default; update preserves order and ignores unknown songs', () => {
  assert.deepEqual(order(probe().overwrite).filter(r => r[0] === 'default'), [['default', 'n', 0]])
  assert.equal(probe().update.rows.find(r => r[1] === 'b')[2], 'Updated')
  assert.deepEqual(order(probe().update), order({ orders: seed.map(s => [s.listId, s.id, s.order]) }))
  assert.ok(probe()['duplicate-overwrite'].error)
  assert.deepEqual(probe()['duplicate-overwrite'].events, [])
})
test('Android song positioning preserves requested order and JS negative insertion; rejects unknown or duplicate IDs', () => {
  assert.deepEqual(order(probe().position).filter(r => r[0] === 'u'), [['u', 'c', 0], ['u', 'a', 1], ['u', 'b', 2]])
  assert.deepEqual(order(probe().negative).filter(r => r[0] === 'u'), [['u', 'a', 0], ['u', 'c', 1], ['u', 'b', 2]])
  for (const name of ['invalid-position', 'duplicate-position']) { assert.ok(probe()[name].error); assert.deepEqual(probe()[name].events, []) }
})
test('Android moving removes originals and deduplicates destination; top reorders and bottom uses last raw order', () => {
  assert.deepEqual(order(probe()['move-top']), [['u', 'a', 4], ['u', 'c', 12], ['v', 'b', 0], ['v', 'x', 1]])
  assert.deepEqual(order(probe()['move-bottom']), [['u', 'a', 4], ['u', 'c', 12], ['v', 'x', 8], ['v', 'b', 9]])
})
test('Android playlist positioning matches reverse selection order and persists timestamps', () => {
  assert.deepEqual(probe()['list-position'].lists.map(r => r[0]), ['w', 'u', 'v'])
  assert.ok(Number(probe()['list-position'].lists[0][2]) > 0)
  assert.equal(probe()['list-position'].lists[2][2], null)
})
test('Android full overwrite replaces all tables, retains omitted temp and nested source metadata', () => {
  assert.deepEqual(probe().all.lists.map(r => r[0]), ['z'])
  assert.deepEqual(order(probe().all), [['default', 'n', 0], ['temp', 't', 0], ['z', 'q', 0]])
  assert.deepEqual(JSON.parse(probe().all.rows.find(r => r[1] === 'q')[3]), song('q').meta)
})
test('Android list writes roll back every operation and never broadcast failures', () => {
  for (const item of cases.filter(c => c.name.endsWith('-rollback'))) {
    const r = probe()[item.name]; assert.match(r.error, /Injected SQL write failure/, item.name); assert.equal(r.rollbacks, 1); assert.deepEqual(r.events, [])
    assert.deepEqual(order(r), order({ orders: item.seed.map(s => [s.listId, s.id, s.order]).sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2]) }))
  }
  for (const name of ['bad-meta', 'invalid-meta', 'missing']) { assert.ok(probe()[name].error, name); assert.deepEqual(probe()[name].events, []) }
})
test('Android list mutations broadcast original payload after commit outside shared monitor', () => {
  for (const item of cases.filter(c => !c.name.includes('rollback') && !['invalid-position', 'duplicate-position', 'duplicate-overwrite', 'invalid-meta', 'bad-meta', 'missing'].includes(c.name))) {
    const r = probe()[item.name]; assert.equal(r.error, undefined, item.name); assert.equal(r.result, null); assert.equal(r.events.length, 1); assert.deepEqual(r.events[0].payload, item.payload); assert.equal(r.events[0].locked, false); assert.ok(r.events[0].commits > 0)
  }
})
