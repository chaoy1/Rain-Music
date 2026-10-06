const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const load = require('./load-ts.cjs')

const md5 = text => createHash('md5').update(text).digest('hex')
const fixture = t => {
  const db = new DatabaseSync(':memory:')
  db.exec(load('src/main/worker/dbService/tables.ts').default.get('my_list'))
  t.after(() => db.close())
  const statements = load('src/main/worker/dbService/modules/list/statements.ts', { '../../db': { getDB: () => db } })
  const lists = [], calls = { fetch: 0, create: 0, confirm: 0, sync: 0 }
  const options = { confirm: false, fetch: async() => [], sync: async() => {} }
  const insert = info => {
    statements.createListInsertStatement().run({ id: info.id, name: info.name ?? 'list', source: info.source ?? null, sourceListId: info.sourceListId ?? null, position: lists.length, locationUpdateTime: null })
    lists.push(info)
  }
  const actions = load('src/renderer/views/songList/Detail/action.ts', {
    '@renderer/store/list/state': { userLists: lists, tempListMeta: {} },
    '@renderer/plugins/Dialog': { dialog: { confirm: async() => { calls.confirm++; return options.confirm } } },
    '@renderer/store/list/syncSourceList': async info => { calls.sync++; await options.sync(info) },
    '@renderer/store/songList/action': { getListDetailAll: async(...args) => { calls.fetch++; return options.fetch(...args) } },
    '@renderer/store/list/action': {
      createUserList: async info => { calls.create++; await new Promise(resolve => setImmediate(resolve)); insert(info) },
      removeUserList: async ids => { for (const id of ids) { db.prepare('DELETE FROM my_list WHERE id = ?').run(id); lists.splice(lists.findIndex(l => l.id === id), 1) } },
    },
    '@renderer/core/player/action': {}, '@common/constants': {}, '@renderer/utils': { toMD5: md5 },
  }, { window: { i18n: { t: key => key } } })
  return { ...actions, db, lists, calls, options, insert }
}

test('collecting the same playlist twice keeps one SQLite row without a dialog', async t => {
  const f = fixture(t)
  await f.addSongListDetail('123', 'kw', 'Original name')
  await f.addSongListDetail('123', 'kw', 'New name')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM my_list').get().count, 1)
  assert.equal(f.calls.confirm, 0)
  assert.equal(f.calls.fetch, 1)
  assert.equal(f.lists[0].name, 'Original name')
})

test('an already saved source identity with a custom local ID is recognized', async t => {
  const f = fixture(t)
  f.insert({ id: 'user-custom', name: 'Saved', source: 'kw', sourceListId: '123' })
  await f.addSongListDetail('123', 'kw')
  assert.equal(f.calls.create, 0)
  assert.equal(f.calls.confirm, 0)
})

test('a deterministic local ID remains recognizable if source metadata is missing', async t => {
  const f = fixture(t)
  f.insert({ id: `kw_${md5('kw__123')}`, name: 'Saved', source: null, sourceListId: null })
  await f.addSongListDetail('123', 'kw')
  assert.equal(f.calls.create, 0)
  assert.equal(f.calls.confirm, 0)
})

test('simultaneous clicks share one fetch and one SQLite insert', async t => {
  const f = fixture(t)
  await Promise.all(Array.from({ length: 8 }, () => f.addSongListDetail('123', 'kw')))
  assert.equal(f.calls.fetch, 1)
  assert.equal(f.calls.create, 1)
  assert.equal(f.lists.length, 1)
})

test('matching source IDs from different providers do not collide', async t => {
  const f = fixture(t)
  await Promise.all([f.addSongListDetail('123', 'kw'), f.addSongListDetail('123', 'wy')])
  assert.equal(f.lists.length, 2)
  assert.notEqual(f.lists[0].id, f.lists[1].id)
})

test('a playlist added during a fetch is recognized before inserting', async t => {
  const f = fixture(t)
  f.options.fetch = async() => {
    f.insert({ id: 'added-elsewhere', name: 'Saved', source: 'kw', sourceListId: '123' })
    return []
  }
  await f.addSongListDetail('123', 'kw')
  assert.equal(f.calls.create, 0)
  assert.equal(f.calls.confirm, 0)
})

test('failed fetch releases the pending operation so the user can retry', async t => {
  const f = fixture(t)
  f.options.fetch = async() => { throw new Error('offline') }
  await assert.rejects(f.addSongListDetail('123', 'kw'), /offline/)
  f.options.fetch = async() => []
  await f.addSongListDetail('123', 'kw')
  assert.equal(f.calls.fetch, 2)
  assert.equal(f.lists.length, 1)
})

test('the heart toggles a saved playlist off and on without dialogs', async t => {
  const f = fixture(t)
  f.insert({ id: 'saved', name: 'Saved', source: 'kw', sourceListId: '123' })
  await f.toggleSongListCollection('123', 'kw', 'Saved')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM my_list').get().count, 0)
  await f.toggleSongListCollection('123', 'kw', 'Saved')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM my_list').get().count, 1)
  assert.equal(f.calls.confirm, 0)
  assert.equal(f.calls.sync, 0)
})

test('simultaneous heart clicks share one removal rather than re-adding a playlist', async t => {
  const f = fixture(t)
  f.insert({ id: 'saved', name: 'Saved', source: 'kw', sourceListId: '123' })
  await Promise.all(Array.from({ length: 8 }, () => f.toggleSongListCollection('123', 'kw')))
  assert.equal(f.lists.length, 0)
  assert.equal(f.calls.create, 0)
})

test('source sync persists songs before publishing the update time', async() => {
  const events = []
  const sync = load('src/renderer/store/list/syncSourceList.ts', {
    '@renderer/utils/data': { setListUpdateTime: async() => { events.push('time saved') } },
    './action': {
      setFetchingListStatus() {},
      overwriteListMusics: async() => { await new Promise(resolve => setImmediate(resolve)); events.push('songs saved') },
      setUpdateTime: () => events.push('time displayed'),
    },
    '@renderer/store/songList/action': { getListDetailAll: async() => [] },
    '@renderer/store/leaderboard/action': {}, '@common/utils/common': { dateFormat: () => '' },
  }).default
  await sync({ id: 'saved', source: 'kw', sourceListId: '123' })
  assert.deepEqual(events, ['songs saved', 'time saved', 'time displayed'])
})

test('source sync does not mark a failed database write as updated', async() => {
  const sync = load('src/renderer/store/list/syncSourceList.ts', {
    '@renderer/utils/data': { setListUpdateTime: () => assert.fail('must not publish a failed update') },
    './action': { setFetchingListStatus() {}, overwriteListMusics: async() => { throw new Error('database unavailable') }, setUpdateTime: () => assert.fail('must not display a failed update') },
    '@renderer/store/songList/action': { getListDetailAll: async() => [] },
    '@renderer/store/leaderboard/action': {}, '@common/utils/common': {},
  }).default
  await assert.rejects(sync({ id: 'saved', source: 'kw', sourceListId: '123' }), /database unavailable/)
})
