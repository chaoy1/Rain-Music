const assert = require('node:assert/strict')
const { test } = require('node:test')
const Vue = require('vue')
const load = require('./load-ts.cjs')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { parse } = require('@vue/compiler-sfc')

const fixture = () => {
  let now = 0, nextId = 0, pauses = 0
  const timers = new Map()
  const window = {
    rain: { isPlayedStop: false },
    setInterval: callback => { const id = ++nextId; timers.set(id, { callback, interval: true }); return id },
    clearInterval: id => timers.delete(id),
  }
  const timer = load('src/renderer/core/player/timeoutStop.ts', {
    '@common/utils/vueTools': Vue,
    '@renderer/store/player/state': { isPlay: Vue.ref(true) },
    '@renderer/store/setting': { appSetting: { 'player.waitPlayEndStop': true } },
    './action': { pause: () => { pauses++ } },
  }, {
    window, performance: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, deadline: now + delay }); return id },
    clearTimeout: id => timers.delete(id),
  })
  const advance = milliseconds => {
    now += milliseconds
    for (const [id, task] of Array.from(timers)) {
      if (!timers.has(id)) continue
      if (task.interval) task.callback()
      else if (task.deadline <= now) { timers.delete(id); task.callback() }
    }
  }
  return { timer, window, advance, pauses: () => pauses }
}

test('custom duration accepts whole minutes and rejects incomplete, fractional or excessive values', () => {
  const { timer } = fixture()
  assert.equal(typeof timer.minutesToTimeoutSeconds, 'function', 'custom duration validation is missing')
  for (const [input, expected] of [['1', 60], ['45', 2700], [' 90 ', 5400], ['1440', 86400], ['', null], ['0', null], ['-1', null], ['1.5', null], ['1441', null], ['abc', null], ['Infinity', null]]) {
    assert.equal(timer.minutesToTimeoutSeconds(input), expected, String(input))
  }
})

test('countdown pauses at the selected deadline even when an older finish-current preference exists', () => {
  const f = fixture(), { time, timeLabel } = f.timer.useTimeout()
  f.timer.startTimeoutStop(90)
  assert.equal(timeLabel.value, '01:30')
  f.advance(30000)
  assert.equal(time.value, 60)
  assert.equal(timeLabel.value, '01:00')
  assert.equal(f.pauses(), 0)
  f.advance(60000)
  assert.equal(f.pauses(), 1)
  assert.equal(timeLabel.value, '')
  assert.equal(f.window.rain.isPlayedStop, true)
})

test('cancel and replacement clear old deadlines without leaving a stop-after-current flag', () => {
  const f = fixture()
  f.timer.startTimeoutStop(60)
  f.advance(30000)
  f.timer.startTimeoutStop(120)
  f.advance(30000)
  assert.equal(f.pauses(), 0)
  assert.equal(f.timer.useTimeout().timeLabel.value, '01:30')
  f.timer.stopTimeoutStop()
  f.advance(180000)
  assert.equal(f.pauses(), 0)
  assert.equal(f.timer.useTimeout().timeLabel.value, '')
  assert.equal(f.window.rain.isPlayedStop, false)
})

test('invalid timer requests preserve an existing countdown instead of expiring immediately', () => {
  const f = fixture()
  f.timer.startTimeoutStop(120)
  for (const invalid of [0, -1, NaN, Infinity, 86401]) f.timer.startTimeoutStop(invalid)
  f.advance(30000)
  assert.equal(f.timer.useTimeout().timeLabel.value, '01:30')
  assert.equal(f.pauses(), 0)
})

test('custom input starts its real countdown and keeps its value when reopening the panel', () => {
  const f = fixture()
  const descriptor = parse(fs.readFileSync(path.join(__dirname, '../../src/renderer/components/layout/PlayBar/SleepTimerBtn.vue'), 'utf8')).descriptor
  const code = ts.transpileModule(descriptor.script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name.includes('vueTools') ? Vue : f.timer })
  const control = module.exports.default.setup()
  control.handleShowPopup()
  control.customMinutes.value = '22'
  control.handleCustomStart()
  assert.equal(control.visible.value, false)
  assert.equal(control.isActive.value, true)
  assert.equal(f.timer.useTimeout().timeLabel.value, '22:00')
  control.handleShowPopup()
  assert.equal(control.customMinutes.value, '22')
  control.customMinutes.value = '1441'
  control.handleCustomStart()
  assert.equal(control.customError.value, true)
  assert.equal(control.visible.value, true)
  assert.equal(f.timer.useTimeout().timeLabel.value, '22:00')
  control.handleStop()
  assert.equal(control.isActive.value, false)
  assert.equal(control.visible.value, false)
})
