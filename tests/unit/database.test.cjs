const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const load = require('./load-ts.cjs')

const tables = load('src/main/worker/dbService/tables.ts')
const migrate = load('src/main/worker/dbService/migrate.ts', { './tables': tables }).default
const verify = load('src/main/worker/dbService/verifyDB.ts', { './tables': tables }).default

const create = (initialSQL, existing = true) => {
  let closed = false
  // 阶段 2：dbService 内部改为异步（SQL 适配器），因此夹具的 Adapter 也改成异步版：
  // prepare 仍同步返回 statement，get / all / run / exec / pragma / transaction / close 都是 Promise。
  // 断言全部保持原样，只是加上了 await。
  class Adapter {
    constructor(options) {
      this.options = options
      this.native = new DatabaseSync(':memory:')
      if (initialSQL) this.native.exec(initialSQL)
    }
    exec(sql) { this.native.exec(sql); return Promise.resolve() }
    pragma(sql) { this.native.exec(`PRAGMA ${sql}`); return Promise.resolve() }
    prepare(sql) {
      const statement = this.native.prepare(sql)
      return { get: async(...args) => statement.get(...args), all: async(...args) => statement.all(...args), run: async(...args) => statement.run(...args) }
    }
    transaction(fn) {
      return async(...args) => {
        this.native.exec('BEGIN')
        try {
          const result = await fn(...args)
          this.native.exec('COMMIT')
          return result
        } catch (error) {
          this.native.exec('ROLLBACK')
          throw error
        }
      }
    }
    close() { this.native.close(); closed = true; return Promise.resolve() }
  }
  const module = load('src/main/worker/dbService/db.ts', {
    './adapter': { createSQLAdapter: options => new Adapter(options) }, fs: { existsSync: () => existing },
    './tables': tables, './verifyDB': verify, './migrate': migrate,
  }, { __dirname: '/test', process: { on() {} }, console: { log() {} } })
  return { module, closed: () => closed }
}

for (const [name, sql] of [
  ['empty existing database', ''],
  ['missing schema version', tables.default.get('db_info')],
  ['unknown schema version', `${tables.default.get('db_info')} INSERT INTO db_info (field_name, field_value) VALUES ('version', '999');`],
]) {
  test(`${name} returns recovery signal and releases the connection`, async() => {
    const { module, closed } = create(sql)
    assert.equal(await module.init('/data'), null)
    assert.equal(closed(), true)
  })
}

test('first startup initializes a new valid database', async() => {
  const { module } = create('', false)
  assert.equal(await module.init('/data'), false)
  assert.equal((await module.getDB().prepare('SELECT field_value FROM db_info WHERE field_name = ?').get('version')).field_value, tables.DB_VERSION)
  await module.getDB().close()
})

test('valid existing database opens without invoking recovery', async() => {
  const sql = `${Array.from(tables.default.values()).join('\n')} INSERT INTO db_info (field_name, field_value) VALUES ('version', '${tables.DB_VERSION}');`
  const { module } = create(sql)
  assert.equal(await module.init('/data'), true)
  await module.getDB().close()
})

test('upgrading from schema version 2 deletes the removed favorite list and its songs', async() => {
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
  assert.equal(await module.init('/data'), true)
  const db = module.getDB()
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM my_list WHERE id = ?').get('love')).count, 0)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM my_list_music_info WHERE listId = ?').get('love')).count, 0)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM my_list_music_info_order WHERE listId = ?').get('love')).count, 0)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM my_list WHERE id = ?').get('user-1')).count, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM my_list_music_info WHERE listId = ?').get('user-1')).count, 1)
  assert.equal((await db.prepare('SELECT field_value FROM db_info WHERE field_name = ?').get('version')).field_value, tables.DB_VERSION)
  await db.close()
})

test('user list order is read back by the persisted position column', async() => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '${tables.DB_VERSION}');
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-a', 'A', 2, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-b', 'B', 0, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-c', 'C', 1, null);
  `
  const { module } = create(sql)
  assert.equal(await module.init('/data'), true)
  const db = module.getDB()
  const statement = load('src/main/worker/dbService/modules/list/statements.ts', {
    '../../db': { getDB: () => db },
  })
  const names = (await statement.createListQueryStatement().all()).map(list => list.name)
  assert.deepEqual(names, ['B', 'C', 'A'])
  await db.close()
})

test('upgrading from schema version 3 normalizes list positions and keeps their display order', async() => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '3');
    INSERT INTO my_list (id, name, position) VALUES ('list-a', 'A', 0);
    INSERT INTO my_list (id, name, position) VALUES ('list-b', 'B', 0);
    INSERT INTO my_list (id, name, position) VALUES ('list-c', 'C', 0);
  `
  const { module } = create(sql)
  assert.equal(await module.init('/data'), true)
  const db = module.getDB()
  assert.deepEqual(
    (await db.prepare('SELECT id, position FROM my_list ORDER BY position ASC').all()).map(row => [row.id, row.position]),
    [['list-a', 0], ['list-b', 1], ['list-c', 2]],
  )
  assert.equal((await db.prepare('SELECT field_value FROM db_info WHERE field_name = ?').get('version')).field_value, tables.DB_VERSION)
  await db.close()
})

test('upgrading from schema version 3 leaves an already normalized order untouched', async() => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '3');
    INSERT INTO my_list (id, name, position) VALUES ('list-b', 'B', 0);
    INSERT INTO my_list (id, name, position) VALUES ('list-c', 'C', 1);
    INSERT INTO my_list (id, name, position) VALUES ('list-a', 'A', 2);
  `
  const { module } = create(sql)
  assert.equal(await module.init('/data'), true)
  const db = module.getDB()
  assert.deepEqual(
    (await db.prepare('SELECT id, position FROM my_list ORDER BY position ASC').all()).map(row => [row.id, row.position]),
    [['list-b', 0], ['list-c', 1], ['list-a', 2]],
  )
  await db.close()
})

test('reopening the database still returns lists in the persisted sorted order', async() => {
  const sql = `${Array.from(tables.default.values()).join('\n')}
    INSERT INTO db_info (field_name, field_value) VALUES ('version', '${tables.DB_VERSION}');
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-a', 'A', 0, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-b', 'B', 1, null);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-c', 'C', 2, null);
  `
  const first = create(sql)
  assert.equal(await first.module.init('/data'), true)
  const db = first.module.getDB()
  // 模拟一次拖拽排序后落库的写法（与 modules/list/index.ts 的 updateUserListsPosition 一致）
  await db.exec(`
    DELETE FROM my_list;
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-c', 'C', 0, 1);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-a', 'A', 1, 1);
    INSERT INTO my_list (id, name, position, locationUpdateTime) VALUES ('list-b', 'B', 2, 1);
  `)
  const statement = load('src/main/worker/dbService/modules/list/statements.ts', {
    '../../db': { getDB: () => db },
  })
  assert.deepEqual((await statement.createListQueryStatement().all()).map(list => list.name), ['C', 'A', 'B'])
  await db.close()
})
