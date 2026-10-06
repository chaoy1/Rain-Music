const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const task = id => ({ id, isComplate: false, status: 'pause', statusText: '', downloaded: 50, total: 100, metadata: {musicInfo:{name:id}} })
const initial = id => ({ id, isComplate: 0, status: 'pause', statusText: '', progress_downloaded: 50, progress_total: 100, musicInfo: JSON.stringify({name:id}), position:0 })
const setup = () => {
  let rows = [initial('A'), {...initial('B'),position:1}]
  const module = load('src/main/worker/dbService/modules/download/index.ts', {
    '@common/utils/common': { arrPush: (a,b) => a.push(...b), arrUnshift: (a,b) => a.unshift(...b) },
    './dbHelper': {
      queryDownloadList: () => rows.toSorted((a,b) => a.position-b.position),
      insertDownloadList: (added, positions) => { rows.push(...added); for (const position of positions) Object.assign(rows.find(item=>item.id===position.id),position) },
      clearDownloadList: () => { rows = [] },
    },
  })
  return { module, rows: () => rows.toSorted((a,b)=>a.position-b.position) }
}

test('restored download progress keeps the fractional percentage', () => {
  assert.equal(setup().module.getDownloadList()[0].progress, 50)
})
test('batch prepend preserves the same order in memory and persisted positions', () => {
  const { module, rows } = setup()
  module.downloadInfoSave(['N1','N2','N3'].map(task), 'top')
  const expected = ['N1','N2','N3','A','B']
  assert.deepEqual(Array.from(module.getDownloadList(),item=>item.id),expected)
  assert.deepEqual(rows().map(item=>item.id),expected)
})
test('clearing downloads empties both persistent and cached lists', () => {
  const { module, rows } = setup()
  module.getDownloadList()
  module.downloadInfoClear()
  assert.equal(module.getDownloadList().length, 0)
  assert.equal(rows().length, 0)
})
