const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')
const compareVer = (a, b) => (a || '0').localeCompare(b, undefined, { numeric: true })
const migrate = () => load('src/common/utils/migrateSetting.ts', { './index': { compareVer }, '../constants': {} }).default

test('obsolete favorite target is discarded without changing the selected window size', () => {
  const result = migrate()({ version: '2.12.9', 'common.favoriteListId': 'userlist_commute', 'common.windowSizeId': 3 })
  assert.equal('common.favoriteListId' in result, false)
  assert.equal(result['common.windowSizeId'], 3)
  assert.equal(result.version, '2.12.10')
})

test('backup imports cannot reintroduce a fixed favorite destination', () => {
  const result = migrate()({ version: '2.12.10', 'common.favoriteListId': 'removed_playlist' })
  assert.equal('common.favoriteListId' in result, false)
})
