const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const helper = path.resolve(__dirname, '../../src/renderer/plugins/Tips/policy.ts')
const getTipText = fs.existsSync(helper)
  ? require('./load-ts.cjs')('src/renderer/plugins/Tips/policy.ts').getTipText
  : vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/renderer/plugins/Tips/index.js'), 'utf8').match(/const getTipText = el => \{[\s\S]*?\n\}/)[0] + '\ngetTipText')
const element = (label, options = {}) => ({
  nodeType: 1, textContent: options.text ?? '', scrollWidth: options.width ?? 100, clientWidth: 100,
  getAttribute(name) { return name === 'aria-label' ? label : options[name] ?? null },
  matches(selector) { return options.button && selector.includes('button') },
  querySelector(selector) { return selector === 'svg, img' && options.icon ? {} : null },
  querySelectorAll() { return options.children ?? [] },
})
test('visible button labels and generic groups do not repeat as hover tips', () => {
  assert.equal(getTipText(element('月白', { button: true, text: '月白', icon: true })), null)
  assert.equal(getTipText(element('Window controls', { icon: true })), null)
  assert.equal(getTipText(element('长按拖动调整列表顺序', { text: '播放列表' })), null)
})
test('icon-only actions remain discoverable and ignore-tip remains authoritative', () => {
  assert.equal(getTipText(element('播放', { button: true, icon: true })), '播放')
  assert.equal(getTipText(element('歌曲详情', { button: true, icon: true, 'ignore-tip': '' })), null)
})
test('only truncated text exposes its complete accessible name', () => {
  assert.equal(getTipText(element('短歌名', { text: '短歌名' })), null)
  assert.equal(getTipText(element('很长的歌曲名', { text: '很长的歌曲名', width: 220 })), '很长的歌曲名')
  assert.equal(getTipText(element('完整歌名', { text: '完整歌名', children: [{ scrollWidth: 200, clientWidth: 90 }] })), '完整歌名')
})
