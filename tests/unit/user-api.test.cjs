const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

test('batch deletion removes every requested source regardless of id ordering', async() => {
  let saved
  const module = load('src/main/modules/userApi/utils.ts', {
    './config': { userApis: [] }, '@common/constants': { STORE_NAMES: {} },
    '@main/platform/storage/adapter': () => ({
      get: () => ['A', 'B', 'C'].map(id => ({ id, name: id, version: '1', script: `script-${id}` })),
      set: (_, value) => { saved = value },
    }),
  })
  module.getUserApis()
  const ids = ['C', 'A', 'B']
  module.removeApi(ids)
  assert.equal(module.getUserApis().length, 0)
  assert.equal(saved.length, 0)
  assert.deepEqual(ids, ['C', 'A', 'B'])
  assert.equal(await module.getScript('A'), '')
})

test('deleting missing ids preserves other sources', () => {
  const module = load('src/main/modules/userApi/utils.ts', {
    './config': { userApis: [] }, '@common/constants': { STORE_NAMES: {} },
    '@main/platform/storage/adapter': () => ({ get: () => [{ id: 'A', version: '1', script: 'a' }], set() {} }),
  })
  module.getUserApis()
  module.removeApi(['missing'])
  assert.equal(module.getUserApis()[0].id, 'A')
})
