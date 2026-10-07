const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@vue/compiler-sfc')
const load = require('./load-ts.cjs')
const queueUtils = load('src/common/utils/playbackQueue.ts')
const song = (id, name = id, singer = '测试歌手') => ({ id, name, singer, source: 'tx', interval: '03:20', meta: { songId: id, albumName: '测试专辑', qualitys: [], _qualitys: {} } })

for (const [name, file] of [
  ['online', 'src/renderer/components/material/OnlineList/usePlay.ts'],
  ['custom playlist', 'src/renderer/views/List/MusicList/usePlay.js'],
  ['downloads', 'src/renderer/views/Download/usePlay.js'],
]) {
  test(`${name}: play later uses the persistent playback queue, including multi-select`, async () => {
    const calls = [], rows = [song('a'), song('b')]
    const usePlay = load(file, {
      '@renderer/store/list/state': { defaultList: { id: 'default' } },
      '@renderer/store/list/action': {}, '@renderer/store/player/action': { addTempPlayList() {} },
      '@common/utils/vueTools': {}, '@renderer/core/player': {},
      '@common/constants': { LIST_IDS: { DEFAULT: 'default', DOWNLOAD: 'download', PLAY_LATER: null } },
      '@common/utils/playbackQueue': queueUtils,
      '@renderer/core/player/playbackQueue': { addToPlaybackQueue: async rows => { calls.push(rows) } },
    }).default
    const selectedList = { value: [] }
    const actions = usePlay({ props: { listId: 'custom', list: rows }, list: { value: rows }, listAll: { value: rows }, selectedList, removeAllSelect: () => { selectedList.value = [] } })
    await actions.handlePlayMusicLater(0, true)
    selectedList.value = [...rows]
    await actions.handlePlayMusicLater(1, false)
    assert.deepEqual(calls.map(items => Array.from(items, s => s.id)), [['a'], ['a', 'b']])
    assert.equal(selectedList.value.length, 0)
  })
}

// 换源弹窗（MusicToggleModal.vue）是 SFC，load-ts.cjs 无法加载 .vue 文件，
// 因此这条路径改用源码级断言（用仓库既有的 @vue/compiler-sfc 取 <script> 块，
// 见 modal-lifecycle.test.cjs）。局限：只证明入口调用的目标与形状，不执行组件方法。
const toggleModalScript = () => parse(fs.readFileSync(path.join(__dirname, '../../src/renderer/views/List/MusicList/components/MusicToggleModal.vue'), 'utf8')).descriptor.script.content

test('the source-toggle preview enqueues into the visible playback queue and no longer uses the hidden temp list', () => {
  const script = toggleModalScript()
  assert.match(script, /import \{ addToPlaybackQueue \} from '@renderer\/core\/player\/playbackQueue'/)
  assert.match(script, /async handlePlay\(musicInfo\) \{[\s\S]*?await addToPlaybackQueue\(\[musicInfo\]\)[\s\S]*?\n {4}\},/)
  for (const removed of ['addTempPlayList', 'tempPlayList', 'PLAY_LATER', 'isTop', "'@renderer/store/player/action'", 'playNext']) {
    assert.equal(script.includes(removed), false, `MusicToggleModal.vue should no longer reference ${removed}`)
  }
})

const fixture = ({ rows = [], playing = null, listId = 'custom', temp = [], writeFailure = false, onWrite = () => {} } = {}) => {
  const persisted = [...rows], cached = [...rows], playedList = [song('old-history')]
  const playMusicInfo = { musicInfo: playing, listId: playing ? listId : null, isTempPlay: false }
  const playInfo = { playerListId: playing ? listId : null, playerPlayIndex: 0, playIndex: 0, nowPlayTime: 42 }
  const tempPlayList = [...temp]
  let starts = 0, resets = 0
  const actions = load('src/renderer/core/player/playbackQueue.ts', {
    '@renderer/store/list/action': {
      getListMusics: async () => cached,
      addListMusics: async (_, incoming, location) => {
        await new Promise(resolve => setTimeout(resolve, 1))
        if (writeFailure) throw new Error('disk write failed')
        onWrite()
        const additions = queueUtils.filterPlaybackQueueAdditions(persisted, incoming)
        location === 'top' ? persisted.unshift(...additions) : persisted.push(...additions)
        cached.splice(0, cached.length, ...persisted)
      },
    },
    '@renderer/store/player/state': { playMusicInfo, playInfo, tempPlayList },
    '@renderer/store/player/action': {
      setPlayListId: id => { playInfo.playerListId = id },
      updatePlayIndex: () => { playInfo.playIndex = playInfo.playerPlayIndex = queueUtils.findPlaybackQueueMusicIndex(cached, playMusicInfo.musicInfo) },
      clearPlayedList: () => { playedList.length = 0 },
      clearTempPlayeList: () => { tempPlayList.length = 0 },
    },
    '@renderer/core/player/action': { resetRandomNextMusicInfo: () => { resets++ }, playList: () => { starts++ } },
    '@renderer/store/setting': { appSetting: { 'download.savePath': 'D:/music' } },
    '@renderer/utils/music': { getDownloadFilePath: async item => item.metadata.filePath },
    '@common/utils/vueTools': { toRaw: x => x },
    '@common/constants': { LIST_IDS: { DEFAULT: 'default' } },
    '@common/utils/playbackQueue': queueUtils,
  })
  return { ...actions, persisted, cached, playMusicInfo, playInfo, tempPlayList, playedList, starts: () => starts, resets: () => resets, allowWrites: () => { writeFailure = false } }
}

test('play later persists at the tail and preserves current audio, time, and custom playlist', async () => {
  const current = song('current'), f = fixture({ rows: [song('past')], playing: current })
  await f.addToPlaybackQueue([song('later')])
  assert.deepEqual(f.persisted.map(s => s.id), ['past', 'current', 'later'])
  assert.equal(f.playMusicInfo.musicInfo, current)
  assert.equal(f.playInfo.nowPlayTime, 42)
  assert.equal(f.playInfo.playerListId, 'default')
  assert.equal(f.playMusicInfo.listId, 'default')
  assert.equal(f.playInfo.playerPlayIndex, 1)
  assert.equal(f.playMusicInfo.isTempPlay, false)
  assert.equal(f.playedList.length, 0)
  assert.equal(f.starts(), 0)
})

test('repeated clicks and simultaneous batches merge title and artist, preserving FIFO and full metadata', async () => {
  const first = song('first', '晴天'), f = fixture()
  await Promise.all([f.addToPlaybackQueue([first, song('second')]), f.addToPlaybackQueue([song('other-source', '晴天'), song('third'), song('other-artist', '晴天', '另一歌手')])])
  assert.deepEqual(f.persisted.map(s => s.id), ['first', 'second', 'third', 'other-artist'])
  assert.equal(f.persisted[0].meta.songId, 'first')
  assert.equal(f.starts(), 0)
})

test('an existing canonical current song is used without interrupting its actual source', async () => {
  const current = song('other-source', '晴天'), f = fixture({ rows: [song('canonical', '晴天')], playing: current })
  await f.addToPlaybackQueue([song('later')])
  assert.deepEqual(f.persisted.map(s => s.id), ['canonical', 'later'])
  assert.equal(f.playMusicInfo.musicInfo.id, 'other-source')
  assert.equal(f.playInfo.playerPlayIndex, 0)
})

test('downloads become persistent local tracks with the actual file path', async () => {
  const f = fixture(), downloaded = { id: 'task-1', progress: 100, metadata: { musicInfo: song('online'), filePath: 'D:/music/track.flac', ext: 'flac' } }
  await f.addToPlaybackQueue([downloaded])
  assert.equal(f.persisted[0].source, 'local')
  assert.equal(f.persisted[0].name, 'online')
  assert.equal(f.persisted[0].meta.filePath, 'D:/music/track.flac')
  assert.equal(f.persisted[0].meta.ext, 'flac')
  assert.equal('progress' in f.persisted[0], false)
})

test('legacy pending songs are migrated to the visible queue without hidden priority', async () => {
  const f = fixture({ playing: song('current'), temp: [{ musicInfo: song('pending'), listId: 'custom', isTempPlay: true }] })
  await f.addToPlaybackQueue([song('later')])
  assert.deepEqual(f.persisted.map(s => s.id), ['current', 'pending', 'later'])
  assert.equal(f.tempPlayList.length, 0)
})

test('a failed write changes no playback state and does not poison later requests', async () => {
  const f = fixture({ playing: song('current'), writeFailure: true })
  await assert.rejects(f.addToPlaybackQueue([song('later')]), /disk write failed/)
  assert.equal(f.playInfo.playerListId, 'custom')
  assert.equal(f.playInfo.nowPlayTime, 42)
  assert.equal(f.starts(), 0)
  f.allowWrites()
  await f.addToPlaybackQueue([song('retry')])
  assert.deepEqual(f.persisted.map(s => s.id), ['current', 'retry'])
})

test('a playing download maps to the existing title-artist queue row', () => {
  const downloaded = { id: 'task', progress: 100, metadata: { musicInfo: song('remote', '晴天') } }
  const playInfo = { playerListId: 'default', playerPlayIndex: 1, playIndex: 1 }
  const actions = load('src/renderer/store/player/action.ts', {
    './state': { musicInfo: {}, playInfo, playMusicInfo: { listId: 'default', musicInfo: downloaded, isTempPlay: false } },
    '@renderer/store/list/action': { getListMusicsFromCache: () => [song('canonical', '晴天'), song('later')] },
    '@renderer/store/download/state': { downloadList: [] }, './playProgress': {}, '@renderer/core/player': {},
    '@common/constants': { LIST_IDS: { DEFAULT: 'default', DOWNLOAD: 'download' } },
    '@common/utils/vueTools': { toRaw: x => x }, '@common/utils/common': {}, '@common/utils/playbackQueue': queueUtils,
  })
  assert.equal(actions.updatePlayIndex().playIndex, 0)
  assert.equal(playInfo.playerPlayIndex, 0)
})

test('changing the paused playback list at the same index persists its new queue identity and progress', () => {
  const watches = [], saves = [], playInfo = { playIndex: 0 }, musicInfo = song('current')
  const playMusicInfo = { listId: 'custom', musicInfo, isTempPlay: false }
  const progress = { nowPlayTime: 42, maxPlayTime: 200 }
  const useProgress = load('src/renderer/core/useApp/usePlayer/usePlayProgress.ts', {
    '@common/utils/vueTools': { onBeforeUnmount() {}, watch: (source, callback) => watches.push({ source, callback }) },
    '@common/utils/common': {}, '@common/utils': { throttle: fn => fn },
    '@renderer/utils/ipc': { savePlayInfo: info => saves.push(info) },
    '@renderer/plugins/player': { onTimeupdate: () => () => {}, onVisibilityChange: () => () => {} },
    '@renderer/store/player/playProgress': { playProgress: progress },
    '@renderer/store/player/state': { musicInfo, playMusicInfo, playInfo },
    '@common/constants': { SAVE_PLAY_TIME: true }, '@renderer/core/player': {}, '@renderer/store/list/action': {},
  }, { window: { app_event: { on() {}, off() {} } } }).default
  useProgress()
  const before = watches.map(w => JSON.stringify(w.source()))
  playMusicInfo.listId = 'default'
  watches.forEach((w, i) => { if (JSON.stringify(w.source()) !== before[i]) w.callback(w.source()) })
  assert.equal(saves.length, 1)
  assert.equal(saves[0].listId, 'default')
  assert.equal(saves[0].musicId, 'current')
  assert.equal(saves[0].time, 42)
})

const loadNext = (state, lists, filterList, method = 'listLoop') => load('src/renderer/core/player/action.ts', {
  '@renderer/plugins/player': {}, '@renderer/store/player/state': state,
  '@renderer/store/player/action': { getList: id => lists[id] ?? [] },
  '@renderer/store/setting': { appSetting: { 'player.togglePlayMethod': method } },
  '@common/constants': {}, '../music/index': {}, './utils': { filterList },
  '@renderer/utils/message': {}, '@renderer/utils/index': { getRandom: () => 1 }, '@renderer/core/dislikeList': {},
})

test('a pending random preload cannot put the original custom playlist back into the queue', async () => {
  const lists = { custom: [song('current'), song('custom-next')], default: [song('current'), song('queued-next')] }
  const state = { playInfo: { playerListId: 'custom', playerPlayIndex: 0 }, playMusicInfo: { musicInfo: lists.custom[0], listId: 'custom' }, tempPlayList: [], playedList: [] }
  let finishFilter
  const next = loadNext(state, lists, async ({ listId, list }) => listId === 'custom' ? new Promise(resolve => { finishFilter = () => resolve({ filteredList: list, playerIndex: 0 }) }) : { filteredList: list, playerIndex: 0 }, 'random')
  const preload = next.getNextPlayMusicInfo()
  state.playInfo.playerListId = state.playMusicInfo.listId = 'default'
  next.resetRandomNextMusicInfo()
  finishFilter()
  const result = await preload
  assert.equal(result.listId, 'default')
  assert.equal(result.musicInfo.id, 'queued-next')
  assert.equal((await next.getNextPlayMusicInfo()).listId, 'default')
})

test('the next song follows the visible queue after deletion and drag sorting', async () => {
  const current = song('current'), f = fixture({ playing: current })
  await f.addToPlaybackQueue([song('remove-me'), song('first'), song('second')])
  f.cached.splice(1, 1)
  f.cached.splice(1, 2, f.cached[2], f.cached[1])
  const next = loadNext({ playInfo: f.playInfo, playMusicInfo: f.playMusicInfo, tempPlayList: f.tempPlayList, playedList: f.playedList }, { default: f.cached }, async({ list, playerMusicInfo }) => ({ filteredList: list, playerIndex: list.indexOf(playerMusicInfo) }))
  const result = await next.getNextPlayMusicInfo()
  assert.equal(result.musicInfo.id, 'second')
  assert.equal(result.isTempPlay, false)
})

test('a newer explicit song choice wins over an in-flight enqueue operation', async () => {
  const f = fixture({ playing: song('old'), onWrite: () => {
    f.playMusicInfo.musicInfo = song('new')
    f.playMusicInfo.listId = f.playInfo.playerListId = 'new-custom'
  } })
  await f.addToPlaybackQueue([song('later')])
  assert.deepEqual(f.persisted.map(s => s.id), ['old', 'later'])
  assert.equal(f.playMusicInfo.musicInfo.id, 'new')
  assert.equal(f.playInfo.playerListId, 'new-custom')
})

test('deep-link play awaits persistent enqueue and plays the canonical merged queue song', async () => {
  const calls = [], canonical = song('canonical')
  const handle = load('src/renderer/core/useApp/useDeeplink/useMusicAction.js', {
    '@common/utils/vueTools': { markRaw: x => x }, '@common/utils/vueRouter': { useRouter: () => ({}) },
    '@renderer/utils': { decodeName: x => x }, '@renderer/store/player/state': { isShowPlayerDetail: { value: false } },
    '@renderer/store/player/action': {}, '@renderer/core/player/playbackQueue': { addToPlaybackQueue: async () => { await new Promise(resolve => setTimeout(resolve, 5)); calls.push('saved'); return [canonical] } },
    './utils': { dataVerify: (_, value) => value, qualityFilter: (_, value) => value, sources: [] },
    '@renderer/utils/ipc': {}, '@renderer/core/player/action': { playListById: (id, musicId) => calls.push(`${id}/${musicId}`) },
    '@common/utils/tools': { toNewMusicInfo: x => x }, '@common/constants': { LIST_IDS: { DEFAULT: 'default' } }, '@renderer/core/music/utils': {},
  }).default()
  await handle('play', { data: { ...song('requested'), types: [], typeUrl: {} } })
  assert.deepEqual(calls, ['saved', 'default/canonical'])
})

test('deleting a preloaded random song invalidates the cached next track', async () => {
  const rows = [song('current'), song('removed-next'), song('remaining-next')]
  const state = { playInfo: { playerListId: 'default', playerPlayIndex: 0 }, playMusicInfo: { musicInfo: rows[0], listId: 'default', isTempPlay: false }, tempPlayList: [], playedList: [] }
  const next = loadNext(state, { default: rows }, async ({ list }) => ({ filteredList: [...list], playerIndex: 0 }), 'random')
  assert.equal((await next.getNextPlayMusicInfo()).musicInfo.id, 'removed-next')
  const listeners = {}
  const useWatchList = load('src/renderer/core/useApp/usePlayer/useWatchList.ts', {
    '@common/utils/vueTools': { onBeforeUnmount() {} }, '@renderer/store/player/state': state,
    '@renderer/store/player/action': { updatePlayIndex: () => ({ playIndex: 0 }) },
    '@common/utils': { throttle: fn => fn }, '@renderer/core/player': next,
  }, { window: { app_event: { on: (name, fn) => { listeners[name] = fn } } } }).default
  useWatchList()
  rows.splice(1, 1)
  listeners.myListUpdate(['default'])
  assert.equal((await next.getNextPlayMusicInfo()).musicInfo.id, 'remaining-next')
})
