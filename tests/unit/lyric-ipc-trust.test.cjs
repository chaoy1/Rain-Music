const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

function fixture() {
  const handlers = new Map()
  const calls = []
  const frame = { postMessage: (...args) => calls.push(['postMessage', ...args]) }
  let activeFrame = frame
  const api = load('src/main/modules/winLyric/rendererEvent.ts', {
    '@main/modules/commonRenderers/common': { registerRendererEvents() {} },
    '@common/mainIpc': {
      mainOn: (name, callback) => handlers.set(name, callback),
      mainHandle: (name, callback) => handlers.set(name, callback),
    },
    '@common/ipcNames': load('src/common/ipcNames.ts'),
    './utils': { buildLyricConfig: config => config, getLyricWindowBounds: (bounds, options) => ({ ...bounds, ...options }) },
    '@main/modules/winMain': { sendNewDesktopLyricClient: port => calls.push(['client', port]) },
    './main': {
      getMainFrame: () => activeFrame,
      getBounds: () => ({ x: 0, y: 0, width: 360, height: 116 }),
      setBounds: bounds => calls.push(['bounds', bounds]),
      setResizeable: value => calls.push(['resizable', value]),
      sendEvent() {},
    },
    electron: { MessageChannelMain: class { constructor() { this.port1 = {}; this.port2 = {}; calls.push(['channel']) } } },
    './mouseCheckTools': { mouseCheckTools: {
      setMouseInWindow: value => calls.push(['mouse', value]),
      runCheck: () => calls.push(['runCheck']),
      cacnelCheck: () => calls.push(['cancelCheck']),
    } },
  }, { rain: { appSetting: { 'desktopLyric.enable': true }, event_app: { update_config: config => calls.push(['config', config]) } } })
  api.default()
  return { handlers, calls, frame, clearFrame: () => { activeFrame = null } }
}

test('only the current lyric main frame may read or control the lyric window', async() => {
  const f = fixture()
  for (const senderFrame of [undefined, null, {}, { parent: f.frame }]) {
    for (const [name, handler] of f.handlers) {
      const result = await handler({ event: { senderFrame }, params: { 'desktopLyric.enable': false, x: 1, y: 1, w: 360, h: 116 } })
      assert.equal(result, undefined, `${name} must reject foreign frames`)
    }
  }
  assert.deepEqual(f.calls, [])
  const invoke = (name, params) => f.handlers.get(`winLyric_${name}`)({ event: { senderFrame: f.frame }, params })
  assert.equal((await invoke('get_config'))['desktopLyric.enable'], true)
  await invoke('set_config', { 'desktopLyric.enable': false })
  invoke('set_win_bounds', { x: 1, y: 1, w: 360, h: 116 })
  invoke('set_win_resizeable', true)
  invoke('mouse_enter_leave', true)
  invoke('mouse_enter_leave', false)
  invoke('request_main_window_channel')
  assert.deepEqual(f.calls.map(call => call[0]), ['config', 'bounds', 'resizable', 'mouse', 'runCheck', 'mouse', 'cancelCheck', 'channel', 'client', 'postMessage'])
})

test('lyric IPC rejects events when the lyric window has no main frame', async() => {
  const f = fixture()
  f.clearFrame()
  for (const [name, handler] of f.handlers) {
    await handler({ event: { senderFrame: null }, params: { 'desktopLyric.enable': false, x: 1, y: 1, w: 360, h: 116 } })
    assert.deepEqual(f.calls, [], `${name} must reject a missing lyric window`)
  }
})
