const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('SVG loader preserves viewBox and mounts each trusted icon once', () => {
  const loader = require('../../build-config/loaders/svg-symbol.cjs')
  const code = loader.call({ resourcePath: '/assets/help-circle.svg' }, '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M1 2h3"/></svg>')
  const icons = new Set()
  let markup = ''
  const sprite = { insertAdjacentHTML: (_, html) => { markup += html; icons.add('icon-help-circle') } }
  const document = { getElementById: id => id === 'rain-svg-sprite' ? sprite : icons.has(id), createElementNS() { throw new Error('existing sprite should be reused') } }
  vm.runInNewContext(code, { document, module: { exports: {} } })
  vm.runInNewContext(code, { document, module: { exports: {} } })
  assert.match(markup, /id="icon-help-circle"/)
  assert.match(markup, /viewBox="0 0 24 24"/)
  assert.equal((markup.match(/<symbol/g) || []).length, 1)
})

test('build cleanup removes compiled output while preserving packages and portable data', () => {
  const clean = require('../../build-config/clean-output.cjs')
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rain-build-'))
  try {
    for (const name of ['dist', 'build/win-unpacked/portable/userData', 'source']) { fs.mkdirSync(path.join(root, name), { recursive: true }); fs.writeFileSync(path.join(root, name, 'keep.txt'), 'fixture') }
    clean(root)
    assert.equal(fs.existsSync(path.join(root, 'dist')), false)
    assert.equal(fs.readFileSync(path.join(root, 'build/win-unpacked/portable/userData/keep.txt'), 'utf8'), 'fixture')
    assert.equal(fs.readFileSync(path.join(root, 'source/keep.txt'), 'utf8'), 'fixture')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
