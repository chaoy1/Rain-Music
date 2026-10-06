const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const load = require('./load-ts.cjs')

const tables = load('src/main/worker/dbService/tables.ts')
const migrate = load('src/main/worker/dbService/migrate.ts', { './tables': tables }).default
const verify = load('src/main/worker/dbService/verifyDB.ts', { './tables': tables }).default

const create = (initialSQL, existing = true) => {
  let closed = false
  class Adapter {
    constructor() {
      this.native = new DatabaseSync(':memory:')
      if (initialSQL) this.native.exec(initialSQL)
    }
    exec(sql) { this.native.exec(sql) }
    pragma(sql) { this.native.exec(`PRAGMA ${sql}`) }
    prepare(sql) {
      const statement = this.native.prepare(sql)
      return { get: (...args) => statement.get(...args), all: (...args) => statement.all(...args), run: (...args) => statement.run(...args) }
    }
    close() { this.native.close(); closed = true }
  }
  const module = load('src/main/worker/dbService/db.ts', {
    'better-sqlite3': Adapter, fs: { existsSync: () => existing },
    './tables': tables, './verifyDB': verify, './migrate': migrate,
  }, { __dirname: '/test', process: { on() {} }, console: { log() {} } })
  return { module, closed: () => closed }
}

for (const [name, sql] of [
  ['empty existing database', ''],
  ['missing schema version', tables.default.get('db_info')],
  ['unknown schema version', `${tables.default.get('db_info')} INSERT INTO db_info (field_name, field_value) VALUES ('version', '999');`],
]) {
  test(`${name} returns recovery signal and releases the connection`, () => {
    const { module, closed } = create(sql)
    assert.equal(module.init('/data'), null)
    assert.equal(closed(), true)
  })
}

test('first startup initializes a new valid database', () => {
  const { module } = create('', false)
  assert.equal(module.init('/data'), false)
  assert.equal(module.getDB().prepare('SELECT field_value FROM db_info WHERE field_name = ?').get('version').field_value, tables.DB_VERSION)
  module.getDB().close()
})

test('valid existing database opens without invoking recovery', () => {
  const sql = `${Array.from(tables.default.values()).join('\n')} INSERT INTO db_info (field_name, field_value) VALUES ('version', '${tables.DB_VERSION}');`
  const { module } = create(sql)
  assert.equal(module.init('/data'), true)
  module.getDB().close()
})

test('upgrading from schema version 2 deletes the removed favorite list and its songs', () => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '2');
    INSERT INTO my_list (id, name, position) VALUES ('love', '我的收藏', 0);
    INSERT INTO my_list (id, name, position) VALUES ('user-1', '自建歌单', 1);
    INSERT INTO my_list_music_info (id, listId, name, singer, source, interval, meta) VALUES ('song-loved', 'love', '歌', '手', 'kw', null, '{}');
    INSERT INTO my_list_music_info (id, listId, name, singer, source, interval, meta) VALUES ('song-kept', 'user-1', '歌', '手', 'kw', null, '{}');
    INSERT INTO my_list_music_info_order (listId, musicInfoId, "order") VALUES ('love', 'song-loved', 0);
    INSERT INTO my_list_music_info_order (listId, musicInfoId, "order") VALUES ('user-1', 'song-kept', 0);
  `
  const { module } = create(sql)
  assert.equal(module.init('/data'), true)
  const db = module.getDB()
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM my_list WHERE id = ?').get('love').count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM my_list_music_info WHERE listId = ?').get('love').count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM my_list_music_info_order WHERE listId = ?').get('love').count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM my_list WHERE id = ?').get('user-1').count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM my_list_music_info WHERE listId = ?').get('user-1').count, 1)
  assert.equal(db.prepare('SELECT field_value FROM db_info WHERE field_name = ?').get('version').field_value, tables.DB_VERSION)
  db.close()
})

test('user list order is read back by the persisted position column', () => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '${tables.DB_VERSION}');
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-a', 'A', 2, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-b', 'B', 0, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-c', 'C', 1, null);
  `
  const { module } = create(sql)
  assert.equal(module.init('/data'), true)
  const db = module.getDB()
  const statement = load('src/main/worker/dbService/modules/list/statements.ts', {
    '../../db': { getDB: () => db },
  })
  const names = statement.createListQueryStatement().all().map(list => list.name)
  assert.deepEqual(names, ['B', 'C', 'A'])
  db.close()
})

test('upgrading from schema version 3 normalizes list positions and keeps their display order', () => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '3');
    INSERT INTO my_list (id, name, position) VALUES ('list-a', 'A', 0);
    INSERT INTO my_list (id, name, position) VALUES ('list-b', 'B', 0);
    INSERT INTO my_list (id, name, position) VALUES ('list-c', 'C', 0);
  `
  const { module } = create(sql)
  assert.equal(module.init('/data'), true)
  const db = module.getDB()
  assert.deepEqual(
    db.prepare('SELECT id, position FROM my_list ORDER BY position ASC').all().map(row => [row.id, row.position]),
    [['list-a', 0], ['list-b', 1], ['list-c', 2]],
  )
  assert.equal(db.prepare('SELECT field_value FROM db_info WHERE field_name = ?').get('version').field_value, tables.DB_VERSION)
  db.close()
})

test('upgrading from schema version 3 leaves an already normalized order untouched', () => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '3');
    INSERT INTO my_list (id, name, position) VALUES ('list-b', 'B', 0);
    INSERT INTO my_list (id, name, position) VALUES ('list-c', 'C', 1);
    INSERT INTO my_list (id, name, position) VALUES ('list-a', 'A', 2);
  `
  const { module } = create(sql)
  assert.equal(module.init('/data'), true)
  const db = module.getDB()
  assert.deepEqual(
    db.prepare('SELECT id, position FROM my_list ORDER BY position ASC').all().map(row => [row.id, row.position]),
    [['list-b', 0], ['list-c', 1], ['list-a', 2]],
  )
  db.close()
})

test('reopening the database still returns lists in the persisted sorted order', () => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '${tables.DB_VERSION}');
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-a', 'A', 0, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-b', 'B', 1, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-c', 'C', 2, null);
  `
  const first = create(sql)
  assert.equal(first.module.init('/data'), true)
  const db = first.module.getDB()
  // 模拟一次拖拽排序后落库的写法（与 modules/list/index.ts 的 updateUserListsPosition 一致）
  db.exec(`
    DELETE FROM my_list;
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-c', 'C', 0, 1);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-a', 'A', 1, 1);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-b', 'B', 2, 1);
  `)
  const statement = load('src/main/worker/dbService/modules/list/statements.ts', {
    '../../db': { getDB: () => db },
  })
  assert.deepEqual(statement.createListQueryStatement().all().map(list => list.name), ['C', 'A', 'B'])
  db.close()
})
