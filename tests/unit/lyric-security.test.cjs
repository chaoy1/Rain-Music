const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const load = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')

test('lyric sources and build output are browser-only', () => {
  const sourceRoot = path.join(root, 'src/renderer-lyric')
  for (const filename of fs.readdirSync(sourceRoot, { recursive: true })) {
    if (!/\.(ts|js|vue)$/.test(filename)) continue
    const source = fs.readFileSync(path.join(sourceRoot, filename), 'utf8')
    assert.doesNotMatch(source, /\b(?:process\.|NodeJS\.|setImmediate\(|require\(['"](?:electron|node:))|from ['"]@common\/(?:rendererIpc|utils['"])/, filename)
  }
  const webpack = fs.readFileSync(path.join(root, 'build-config/renderer-lyric/webpack.config.base.js'), 'utf8')
  assert.match(webpack, /target: 'web'/)
  assert.doesNotMatch(webpack, /commonjs2|electron-renderer/)
})

test('desktop lyric uses isolated sandbox preferences and a preload', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/modules/winLyric/main.ts'), 'utf8')
  for (const [key, value] of Object.entries({ nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, webSecurity: true, sandbox: true })) {
    assert.match(source, new RegExp(`${key}: ${value}\\b`), `${key} must be ${value}`)
  }
  assert.match(source, /preload: path\.join\(__dirname, 'preload-lyric\.js'\)/)
})

test('lyric preload limits commands, strips events, cancels subscriptions and transfers ports', async() => {
  assert.ok(fs.existsSync(path.join(root, 'src/main/modules/winLyric/preload.ts')), 'lyric preload must exist')
  const ipcRenderer = new EventEmitter()
  const sent = []
  const invoked = []
  ipcRenderer.send = (...args) => sent.push(args)
  ipcRenderer.invoke = async(...args) => { invoked.push(args); return { 'desktopLyric.enable': true } }
  let bridge
  const transfers = []
  load('src/main/modules/winLyric/preload.ts', {
    electron: { ipcRenderer, contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'lyricBridge'); bridge = value } } },
    '@common/ipcNames': load('src/common/ipcNames.ts'),
  }, { window: { postMessage: (...args) => transfers.push(args) } })
  assert.deepEqual(Object.keys(bridge).sort(), ['getSetting', 'onMainWindowInited', 'onMouseEnterLeave', 'onSettingChanged', 'onThemeChange', 'requestMainWindowChannel', 'setMouseInWindow', 'setWindowBounds', 'updateSetting'].sort())
  assert.equal(bridge.send, undefined)
  assert.equal(bridge.invoke, undefined)
  await bridge.getSetting()
  await bridge.updateSetting({ 'desktopLyric.isLock': true, 'desktopLyric.enable': false })
  assert.equal(invoked[0][0], 'winLyric_get_config')
  assert.equal(invoked[1][0], 'winLyric_set_config')
  for (const value of [{ 'player.isMute': true }, { 'desktopLyric.isLock': 'true' }, { 'desktopLyric.style.fontSize': NaN }, { 'desktopLyric.style.opacity': 101 }]) {
    await assert.rejects(() => bridge.updateSetting(value), /Invalid/)
  }
  for (const value of [{ x: Infinity, y: 0, w: 360, h: 116 }, { x: 0, y: 0, w: -1, h: 116 }, { x: 0, y: 0, w: 360, h: 116, extra: 1 }]) assert.throws(() => bridge.setWindowBounds(value), /Invalid/)
  assert.throws(() => bridge.setMouseInWindow('yes'), /Invalid/)
  bridge.setWindowBounds({ x: 12, y: -2, w: 360, h: 116 })
  bridge.setMouseInWindow(true)
  bridge.requestMainWindowChannel()
  assert.deepEqual(sent.map(args => args[0]), ['winLyric_set_win_bounds', 'winLyric_mouse_enter_leave', 'winLyric_request_main_window_channel'])
  const received = []
  const stop = bridge.onSettingChanged(value => received.push(value))
  const fakeEvent = { sender: { dangerous: true } }
  const config = { 'desktopLyric.isLock': true }
  ipcRenderer.emit('winLyric_on_config_change', fakeEvent, config)
  assert.deepEqual(received, [config])
  stop(); stop()
  ipcRenderer.emit('winLyric_on_config_change', fakeEvent, config)
  assert.equal(received.length, 1)
  assert.equal(ipcRenderer.listenerCount('winLyric_on_config_change'), 0)
  const port = { marker: 'port' }
  ipcRenderer.emit('winLyric_provide_main_window_channel', { ports: [port] }, null)
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0][0].type, 'rain-lyric-main-window-channel')
  assert.equal(transfers[0][1], '*')
  assert.equal(transfers[0][2][0], port)
})
