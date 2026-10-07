const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const load = require('./load-ts.cjs')
const constants = { LIST_IDS: { DEFAULT: 'default', TEMP: 'temp' } }
const common = { arrPush: (target, rows) => target.push(...rows), arrUnshift: (target, rows) => target.unshift(...rows), arrPushByPosition: (target, rows, at) => target.splice(at, 0, ...rows) }
const song = (id, name = '晴天', singer = '周杰伦', source = 'tx') => ({ id, name, singer, source, interval: '04:20', meta: { songId: id, albumName: '叶惠美', qualitys: [{ type: '320k', size: '8M' }], _qualitys: { '320k': { size: '8M' } } } })
const fixture = t => {
  const native = new DatabaseSync(':memory:')
  native.exec(Array.from(load('src/main/worker/dbService/tables.ts').default.values()).join('\n'))
  t.after(() => native.close())
  // 阶段 2：dbService 内部改成异步（SQL 适配器），夹具的 db 桩同步改为异步 ——
  // prepare 依旧同步返回 statement，get / all / run 与 transaction 都返回 Promise。
  const db = { prepare: sql => { const stmt = native.prepare(sql); stmt.setAllowUnknownNamedParameters(true); const clean = args => args.map(arg => arg && typeof arg === 'object' ? Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, v ?? null])) : arg); return { all: async(...a) => stmt.all(...clean(a)), get: async(...a) => stmt.get(...clean(a)), run: async(...a) => stmt.run(...clean(a)) } }, transaction: fn => async(...a) => { native.exec('BEGIN'); try { const result = await fn(...a); native.exec('COMMIT'); return result } catch (error) { native.exec('ROLLBACK'); throw error } } }
  const statements = load('src/main/worker/dbService/modules/list/statements.ts', { '../../db': { getDB: () => db } })
  const helper = load('src/main/worker/dbService/modules/list/dbHelper.ts', { '../../db': { getDB: () => db }, './statements': statements })
  const createService = () => load('src/main/worker/dbService/modules/list/index.ts', { '@common/constants': constants, '@common/utils/common': common, './dbHelper': helper, '@common/utils/playbackQueue': require('node:fs').existsSync('src/common/utils/playbackQueue.ts') ? load('src/common/utils/playbackQueue.ts') : {} })
  return { native, helper, createService, service: createService() }
}

test('adding songs merges same title and artist across sources only in the playback queue', async t => {
  const { service: s, createService } = fixture(t)
  await s.musicsAdd('default', [song('tx-1'), song('wy-1', '晴天', '周杰伦', 'wy'), song('other-singer', '晴天', '孙燕姿')], 'bottom')
  assert.deepEqual(Array.from(await s.getListMusics('default'), x => x.id), ['tx-1', 'other-singer'])
  assert.equal((await s.getListMusics('default'))[0].meta.songId, 'tx-1')
  assert.equal((await s.getListMusics('default'))[0].meta._qualitys['320k'].size, '8M')
  await s.musicsAdd('user-a', [song('tx-1'), song('wy-1', '晴天', '周杰伦', 'wy')], 'bottom')
  assert.equal((await createService().getListMusics('user-a')).length, 2)
  assert.equal((await createService().getListMusics('default')).length, 2)
})

test('overwrite and backup import merge queue duplicates while retaining custom list versions', async t => {
  const { service: s, createService } = fixture(t)
  const rows = [song('first'), song('duplicate'), song('live', '晴天 (Live)')]
  await s.musicOverwrite('default', rows)
  assert.deepEqual(Array.from(await s.getListMusics('default'), x => x.id), ['first', 'live'])
  await s.listDataOverwrite({ defaultList: rows, userList: [{ id: 'user-a', name: '我的歌单', list: rows }] })
  const fresh = createService()
  assert.equal((await fresh.getListMusics('default')).length, 2)
  assert.equal((await fresh.getListMusics('user-a')).length, 3)
})

test('existing queue duplicates merge on load and persist without changing custom lists', async t => {
  const { helper, createService } = fixture(t)
  const rows = [song('first'), song('duplicate'), song('last', '稻香')]
  const dbRows = listId => rows.map((r, order) => ({ ...r, listId, order, meta: JSON.stringify(r.meta) }))
  await helper.overwriteMusicInfo('default', dbRows('default'))
  await helper.overwriteMusicInfo('user-a', dbRows('user-a'))
  assert.deepEqual(Array.from(await createService().getListMusics('default'), x => x.id), ['first', 'last'])
  assert.equal((await helper.queryMusicInfoByListId('default')).length, 2)
  assert.equal((await helper.queryMusicInfoByListId('user-a')).length, 3)
})

test('top insert keeps existing order and moving into queue respects title-artist identity', async t => {
  const { service: s, createService } = fixture(t)
  await s.musicsAdd('default', [song('first'), song('second', '稻香')], 'bottom')
  await s.musicsAdd('default', [song('dup'), song('new', '七里香')], 'top')
  assert.deepEqual(Array.from(await s.getListMusics('default'), x => x.id), ['new', 'first', 'second'])
  await s.musicsAdd('user-a', [song('move-dup'), song('move-new', '花海')], 'bottom')
  await s.musicsMove('user-a', 'default', [song('move-dup'), song('move-new', '花海')], 'bottom')
  assert.deepEqual(Array.from(await createService().getListMusics('default'), x => x.id), ['new', 'first', 'second', 'move-new'])
  assert.equal((await createService().getListMusics('user-a')).length, 0)
})

test('identity normalizes surrounding whitespace and width but never merges blank artists', () => {
  const { dedupePlaybackQueue } = load('src/common/utils/playbackQueue.ts')
  const rows = [song('a', ' Rain ', ' Artist '), song('b', 'Ｒａｉｎ', 'artist'), song('c', 'Rain', ''), song('d', 'Rain', '')]
  assert.deepEqual(Array.from(dedupePlaybackQueue(rows), x => x.id), ['a', 'c', 'd'])
})

test('drag reorder persists exact IDs in queue and custom lists after reopening', async t => {
  const { service: s, createService } = fixture(t)
  for (const listId of ['default', 'user-a']) {
    await s.musicsAdd(listId, [song('a', 'A'), song('b', 'B'), song('c', 'C')], 'bottom')
    await s.musicsPositionUpdate(listId, 2, ['a'])
    assert.deepEqual(Array.from(await createService().getListMusics(listId), x => x.id), ['b', 'c', 'a'])
  }
})

test('renderer queue events use the same merge rule as SQLite and retain custom versions', () => {
  const queue = load('src/common/utils/playbackQueue.ts')
  const allMusicList = new Map(), userLists = []
  const actions = load('src/renderer/store/list/listManage/action.ts', {
    '@common/utils/vueTools': { markRaw: x => x, markRawList: x => x, toRaw: x => x },
    './state': { allMusicList, userLists, defaultList: { id: 'default' }, tempList: { id: 'temp' } },
    '@renderer/utils/data': { overwriteListPosition() {}, overwriteListUpdateInfo() {} },
    '@common/constants': constants, '@common/utils/common': common, '@common/utils/playbackQueue': queue,
  })
  for (const id of ['default', 'user-a']) {
    actions.setMusicList(id, [song('first')])
    actions.listMusicAdd(id, [song('duplicate'), song('next', '七里香')], 'bottom')
  }
  assert.deepEqual(Array.from(allMusicList.get('default'), s => s.id), ['first', 'next'])
  assert.deepEqual(Array.from(allMusicList.get('user-a'), s => s.id), ['first', 'duplicate', 'next'])
  actions.listMusicOverwrite('default', [song('first'), song('duplicate')])
  assert.equal(allMusicList.get('default').length, 1)
})

test('queue merge keeps current playback position and elapsed progress without switching source', () => {
  const playInfo = { playerListId: 'default', playerPlayIndex: 1, playIndex: 1, nowPlayTime: 42 }
  const playing = song('duplicate', '晴天', '周杰伦', 'wy')
  const lists = { default: [song('first'), song('next', '七里香')], 'user-a': [song('first')] }
  const playMusicInfo = { listId: 'default', musicInfo: playing, isTempPlay: false }
  const actions = load('src/renderer/store/player/action.ts', {
    './state': { musicInfo: {}, playInfo, playMusicInfo },
    '@renderer/store/list/action': { getListMusicsFromCache: id => lists[id] ?? [] },
    '@renderer/store/download/state': { downloadList: [] }, './playProgress': {}, '@renderer/core/player': {},
    '@common/constants': constants, '@common/utils/vueTools': { toRaw: x => x }, '@common/utils/common': common,
    '@common/utils/playbackQueue': load('src/common/utils/playbackQueue.ts'),
  })
  assert.equal(actions.updatePlayIndex().playIndex, 0)
  assert.equal(playInfo.nowPlayTime, 42)
  assert.equal(playMusicInfo.musicInfo.id, 'duplicate')
  assert.equal(playMusicInfo.musicInfo.source, 'wy')
  assert.equal(actions.getPlayIndex('user-a', playing, false).playIndex, -1)
})

test('online play after merge resolves the existing queue entry instead of silently ignoring it', async() => {
  const rows = [song('first')], called = []
  const queue = load('src/common/utils/playbackQueue.ts')
  const usePlay = load('src/renderer/components/material/OnlineList/usePlay.ts', {
    '@renderer/store/list/state': { defaultList: { id: 'default' } },
    '@renderer/store/list/action': { getListMusics: async() => rows, addListMusics: async(id, incoming) => rows.push(...queue.filterPlaybackQueueAdditions(rows, incoming)) },
    '@renderer/store/player/action': {}, '@renderer/core/player': { playList: (...args) => called.push(args) },
    '@renderer/core/player/playbackQueue': {},
    '@common/constants': constants, '@common/utils/playbackQueue': queue,
  }).default
  await usePlay({ selectedList: { value: [] }, props: { list: [song('duplicate')] }, removeAllSelect() {}, emit() {} }).handlePlayMusic(0, true)
  assert.equal(rows.length, 1)
  assert.deepEqual(called, [['default', 0]])
})

test('search result double-click resolves the merged queue identity and still rejects unsupported sources', async() => {
  const rows = [song('first')], called = []
  const queue = load('src/common/utils/playbackQueue.ts')
  let supported = true
  const useList = load('src/renderer/views/Search/MusicList/useList.ts', {
    '@common/constants': constants, '@common/utils/vueTools': { ref: value => ({ value }) },
    '@renderer/core/player/action': { playList: (...args) => called.push(args) },
    '@renderer/store/list/action': { getListMusics: async() => rows, addListMusics: async(id, incoming) => rows.push(...queue.filterPlaybackQueueAdditions(rows, incoming)) },
    '@renderer/store/search/action': {}, '@renderer/store/search/music': {},
    '@renderer/store/utils': { assertApiSupport: () => supported }, '@common/utils/playbackQueue': queue,
  }).default
  const list = useList()
  list.listInfo.value.list = [song('duplicate')]
  await list.handlePlayList(0)
  assert.equal(rows.length, 1)
  assert.deepEqual(called, [['default', 0]])
  supported = false
  await list.handlePlayList(0)
  assert.equal(called.length, 1)
})

test('legacy saved playback follows song identity through startup queue merge with progress intact', async t => {
  const { helper, service: s } = fixture(t)
  const rows = [song('a', 'A'), song('a-copy', 'A'), song('b', 'B')]
  await helper.overwriteMusicInfo('default', rows.map((r, order) => ({ ...r, listId: 'default', order, meta: JSON.stringify(r.meta) })))
  // The initial view is allowed to read/migrate the queue before playback restoration.
  await s.getListMusics('default')
  let saved = { listId: 'default', index: 2, time: 81, maxTime: 240 }
  let handle
  load('src/main/modules/winMain/rendererEvent/data.ts', {
    '@common/constants': { ...constants, STORE_NAMES: { DATA: 'data' }, DATA_KEYS: { playInfo: 'playInfo' } },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { get_data: 'get', save_data: 'save' } },
    '@common/mainIpc': { mainHandle: (event, fn) => { handle = fn }, mainOn() {} },
    '@main/platform/storage/adapter': () => ({ get: () => saved, set: (key, value) => { saved = value } }),
  }, { rain: { worker: { dbService: s } } }).default()
  const result = await handle({ params: 'playInfo' })
  assert.equal(result.index, 1)
  assert.equal((await s.getListMusics('default'))[result.index].id, 'b')
  assert.equal(result.time, 81)
  assert.equal(result.maxTime, 240)
})

test('legacy duplicate restores survivor and new music IDs restore correctly after reorder', async t => {
  const { helper, service: s } = fixture(t)
  const rows = [song('a', 'A'), song('a-copy', 'A'), song('b', 'B')]
  await helper.overwriteMusicInfo('default', rows.map((r, order) => ({ ...r, listId: 'default', order, meta: JSON.stringify(r.meta) })))
  assert.equal(await s.resolvePlaybackQueueRestoreIndex(1), 0)
  await s.musicsPositionUpdate('default', 0, ['b'])
  assert.equal(await s.resolvePlaybackQueueRestoreIndex(1, 'b'), 0)
  assert.equal(await s.resolvePlaybackQueueRestoreIndex(0, 'a-copy', 'A', '周杰伦'), 1)
})

test('interrupted migration restores the original song after a new database worker starts', async t => {
  const { helper, service: first, createService } = fixture(t)
  const rows = [song('a', 'A'), song('a-copy', 'A'), song('b', 'B'), song('c', 'C')]
  await helper.overwriteMusicInfo('default', rows.map((r, order) => ({ ...r, listId: 'default', order, meta: JSON.stringify(r.meta) })))
  await first.getListMusics('default') // Persisted merge succeeds; process exits before getPlayInfo.
  const restarted = createService()
  const index = await restarted.resolvePlaybackQueueRestoreIndex(2)
  assert.equal((await restarted.getListMusics('default'))[index].id, 'b')
  assert.equal(index, 1)
})

test('failed playback-state write keeps the durable migration identity available for retry', async t => {
  const { helper, service: s, createService } = fixture(t)
  const rows = [song('a', 'A'), song('copy', 'A'), song('b', 'B'), song('c', 'C')]
  await helper.overwriteMusicInfo('default', rows.map((r, order) => ({ ...r, listId: 'default', order, meta: JSON.stringify(r.meta) })))
  await s.getListMusics('default')
  let handle
  load('src/main/modules/winMain/rendererEvent/data.ts', {
    '@common/constants': { ...constants, STORE_NAMES: { DATA: 'data' }, DATA_KEYS: { playInfo: 'playInfo' } },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { get_data: 'get', save_data: 'save' } },
    '@common/mainIpc': { mainHandle: (event, fn) => { handle = fn }, mainOn() {} },
    '@main/platform/storage/adapter': () => ({ get: () => ({ listId: 'default', index: 2, time: 81, maxTime: 240 }), set() { throw new Error('write interrupted') } }),
  }, { rain: { worker: { dbService: s } } }).default()
  await assert.rejects(handle({ params: 'playInfo' }), /write interrupted/)
  assert.equal(await createService().resolvePlaybackQueueRestoreIndex(2), 1)
})

test('failed queue transaction rolls back both merge and restoration metadata', async t => {
  const { helper, service: s, native } = fixture(t)
  const rows = [song('a', 'A'), song('copy', 'A'), song('b', 'B')]
  await helper.overwriteMusicInfo('default', rows.map((r, order) => ({ ...r, listId: 'default', order, meta: JSON.stringify(r.meta) })))
  native.exec(`CREATE TRIGGER reject_merge BEFORE DELETE ON my_list_music_info WHEN OLD.listId='default' BEGIN SELECT RAISE(ABORT, 'merge interrupted'); END;`)
  await assert.rejects(s.getListMusics('default'), /merge interrupted/)
  assert.equal((await helper.queryMusicInfoByListId('default')).length, 3)
  assert.equal(await helper.getPlaybackQueueRestoreSnapshot(), null)
})

test('restart after corrected file write but before acknowledgment uses the saved ID and clears mapping only on success', async t => {
  const { helper, service: first, createService } = fixture(t)
  const rows = [song('a', 'A'), song('a-copy', 'A'), song('b', 'B'), song('c', 'C')]
  await helper.overwriteMusicInfo('default', rows.map((r, order) => ({ ...r, listId: 'default', order, meta: JSON.stringify(r.meta) })))
  await first.getListMusics('default')
  let saved = { listId: 'default', index: 2, time: 81, maxTime: 240 }
  const connect = service => {
    let handle
    load('src/main/modules/winMain/rendererEvent/data.ts', {
      '@common/constants': { ...constants, STORE_NAMES: { DATA: 'data' }, DATA_KEYS: { playInfo: 'playInfo' } },
      '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { get_data: 'get', save_data: 'save' } },
      '@common/mainIpc': { mainHandle: (event, fn) => { handle = fn }, mainOn() {} },
      '@main/platform/storage/adapter': () => ({ get: () => saved, set: (key, value) => { saved = value } }),
    }, { rain: { worker: { dbService: service } } }).default()
    return handle
  }
  await assert.rejects(connect({ ...first, completePlaybackQueueRestore() { throw new Error('ack interrupted') } })({ params: 'playInfo' }), /ack interrupted/)
  assert.equal(saved.index, 1)
  assert.equal(saved.musicId, 'b')
  assert.ok(await helper.getPlaybackQueueRestoreSnapshot())
  const result = await connect(createService())({ params: 'playInfo' })
  assert.equal(result.musicId, 'b')
  assert.equal(result.index, 1)
  assert.equal(result.time, 81)
  assert.equal(result.maxTime, 240)
  assert.equal(await helper.getPlaybackQueueRestoreSnapshot(), null)
})
