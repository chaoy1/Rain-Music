const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/components/material/SearchInput.vue'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'module.exports =')
const makeComponent = () => {
  const timers = new Map()
  let nextTimer = 0
  const context = { module: { exports: {} }, setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer }, clearTimeout: id => timers.delete(id) }
  vm.runInNewContext(source, context)
  const options = context.module.exports
  const events = []
  const component = { ...options.data.call({ modelValue: '' }), ...options.methods, sendEvent: action => events.push(action), handleRegisterEvent() {} }
  return { component, options, events, flush: () => { for (const [id, fn] of timers) { timers.delete(id); fn() } } }
}

test('a delayed blur cannot cancel a newer search focus', () => {
  const { component, events, flush } = makeComponent()
  component.handleFocus()
  component.handleBlur()
  component.handleFocus()
  flush()
  assert.equal(component.focus, true)
  assert.deepEqual(events, ['focus', 'focus'])
})

test('unmount cancels pending search blur callbacks', () => {
  const { component, options, events, flush } = makeComponent()
  component.handleBlur()
  options.beforeUnmount.call(component)
  flush()
  assert.deepEqual(events, [])
})
