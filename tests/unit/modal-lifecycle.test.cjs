const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { parse } = require('@vue/compiler-sfc')

const harness = () => {
  const source = parse(fs.readFileSync(path.join(__dirname, '../../src/renderer/components/material/Modal.vue'), 'utf8')).descriptor.script.content
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const callbacks = []
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name.includes('vueTools') ? { nextTick: fn => callbacks.push(fn) } : { getRandom: () => 0 } })
  const component = module.exports.default
  const classes = new Set()
  const root = { classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) } }
  const create = () => ({ ...component.data(), ...component.methods, show: false, teleport: '#root', $refs: { dom_container: { parentNode: root } }, $emit() {} })
  const setShow = (instance, value) => { instance.show = value; instance.handleShowChange(value) }
  const flush = () => { while (callbacks.length) callbacks.shift()() }
  return { create, setShow, flush, classes, component }
}

test('closing before the render tick cannot reopen the modal or leave its parent locked', () => {
  const h = harness(), modal = h.create()
  h.setShow(modal, true)
  h.setShow(modal, false)
  h.flush()
  assert.equal(h.classes.has('show-modal'), false)
  assert.equal(modal.showContent, false)
})

test('overlapping modals keep the parent locked until the last modal closes', () => {
  const h = harness(), first = h.create(), second = h.create()
  h.setShow(first, true); h.flush()
  h.setShow(second, true); h.flush()
  h.setShow(first, false)
  assert.equal(h.classes.has('show-modal'), true)
  h.setShow(second, false)
  assert.equal(h.classes.has('show-modal'), false)
})

test('unmount releases the parent even after the container reference is detached', () => {
  const h = harness(), modal = h.create()
  h.setShow(modal, true); h.flush()
  modal.$refs.dom_container = undefined
  h.component.beforeUnmount.call(modal)
  assert.equal(h.classes.has('show-modal'), false)
})
