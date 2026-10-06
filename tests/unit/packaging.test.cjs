const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('packager publishes to the repository declared by the project', () => {
  const filename = path.resolve(__dirname, '../../build-config/build-pack.js')
  let options
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'electron-builder'
      ? { build: value => { options = value; return Promise.resolve() } }
      : name === '../package.json' ? require('../../package.json') : () => {},
    process: { argv: ['node', filename, 'target=dir'], env: {} }, console, URL,
  }, { filename })
  assert.equal(options.config.publish[0].owner, 'chaoy1')
  assert.equal(options.config.publish[0].repo, 'Rain-Music')
  assert.equal(options.publish, 'never')
})
