const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')
const vue = { computed: fn => ({ get value() { return fn() } }), ref: value => ({ value }), reactive: value => value, shallowReactive: value => value, nextTick: fn => fn() }
const create = module => {
  const calls = []
  const handlers = Object.fromEntries(['handleShowDownloadModal', 'handlePlayMusic', 'handlePlayMusicLater', 'handleSearch', 'handleShowMusicToggleModal', 'handleShowMusicAddModal', 'handleShowMusicMoveModal', 'handleShowSortModal', 'handleOpenMusicDetail', 'handleCopyName', 'handleDislikeMusic', 'handleRemoveMusic'].map(name => [name, index => calls.push({ name, index })]))
  const useMenu = load(module, { '@common/utils/vueTools': vue, '@renderer/utils/musicSdk': {}, '@renderer/plugins/i18n': { useI18n: () => key => key }, '@renderer/core/dislikeList': { hasDislike: () => false } }).default
  return { calls, menu: useMenu({ ...handlers, props: { checkApiSource: false }, assertApiSupport: () => true, emit() {} }) }
}
for (const [type, module] of [['library', 'src/renderer/views/List/MusicList/useMenu.js'], ['online', 'src/renderer/components/material/OnlineList/useMenu.js']]) {
  test(`${type} song menu exposes only playback, collection, download and removal actions`, () => {
    const { menu } = create(module)
    const expected = ['play', 'download', 'playLater', 'addTo', 'dislike']
    if (type === 'library') expected.push('remove')
    assert.deepEqual(Array.from(menu.menus.value, m => m.action), expected)
  })
  test(`${type} removed actions cannot dispatch hidden source, copy, search, or move operations`, () => {
    const { menu, calls } = create(module)
    for (const action of ['toggleSource', 'copyName', 'sourceDetail', 'search', 'sort', 'moveTo']) menu.menuClick({ action }, 3)
    assert.deepEqual(calls, [])
    menu.menuClick({ action: 'play' }, 3)
    assert.deepEqual(calls, [{ name: 'handlePlayMusic', index: 3 }])
  })
}
