const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const load = require('./load-ts.cjs')

// 阶段 2（Android 移植 · 数据层）新增：验证 SQL 适配器的异步外形、事务语义
// （COMMIT / ROLLBACK / SAVEPOINT 嵌套）以及 dbService 入口的串行化。
// 驱动层用 node:sqlite，不依赖 better-sqlite3 原生二进制。
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const { SerializedSQLAdapter } = load('src/main/worker/dbService/adapter/serialize.ts')

const setup = () => {
  const native = new DatabaseSync(':memory:')
  native.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, note TEXT)')
  const rows = () => native.prepare('SELECT note FROM t ORDER BY id').all().map(row => row.note)
  const driver = {
    prepare: sql => { const statement = native.prepare(sql); return { get: async(...args) => statement.get(...args), all: async(...args) => statement.all(...args), run: async(...args) => statement.run(...args) } },
    exec: async sql => { native.exec(sql) },
    pragma: async pragma => { native.exec(`PRAGMA ${pragma}`) },
    close: async () => { native.close() },
  }
  return { native, rows, adapter: new SerializedSQLAdapter(driver, 'desktop') }
}

test('prepared statements keep the better-sqlite3 shape while executing asynchronously', async() => {
  const { adapter, rows } = setup()
  const insert = adapter.prepare('INSERT INTO t (note) VALUES (?)')
  const select = adapter.prepare('SELECT note FROM t WHERE note = ?')
  // 跨 realm 断言：load-ts 在独立 vm context 里跑，`instanceof Promise` 会因 realm 不同为 false。
  assert.equal(typeof insert.run('a').then, 'function')
  assert.deepEqual(await insert.run('b'), { changes: 1, lastInsertRowid: 2 })
  // node:sqlite 返回 null 原型对象，这里只比较字段值。
  assert.equal((await select.get('a')).note, 'a')
  assert.deepEqual((await select.all('b')).map(row => row.note), ['b'])
  assert.deepEqual(rows(), ['a', 'b'])
  await adapter.close()
})

test('a failing transaction rolls back every write it made', async() => {
  const { adapter, rows } = setup()
  const insert = adapter.prepare('INSERT INTO t (note) VALUES (?)')
  await assert.rejects(adapter.transaction(async() => {
    await insert.run('first')
    await insert.run('second')
    throw new Error('merge interrupted')
  })(), /merge interrupted/)
  assert.deepEqual(rows(), [])
  await adapter.close()
})

test('a successful transaction commits all of its writes', async() => {
  const { adapter, rows } = setup()
  const insert = adapter.prepare('INSERT INTO t (note) VALUES (?)')
  await adapter.transaction(async() => {
    await insert.run('first')
    await insert.run('second')
  })()
  assert.deepEqual(rows(), ['first', 'second'])
  await adapter.close()
})

test('a failing nested transaction only rolls back to its own savepoint', async() => {
  const { adapter, rows } = setup()
  const insert = adapter.prepare('INSERT INTO t (note) VALUES (?)')
  await adapter.transaction(async() => {
    await insert.run('outer')
    await assert.rejects(adapter.transaction(async() => {
      await insert.run('inner')
      throw new Error('inner failed')
    })(), /inner failed/)
    await insert.run('after inner')
  })()
  assert.deepEqual(rows(), ['outer', 'after inner'])
  await adapter.close()
})

test('an operation issued while a transaction is in flight waits for its outcome', async() => {
  const { adapter, rows } = setup()
  const insert = adapter.prepare('INSERT INTO t (note) VALUES (?)')
  const events = []
  const transaction = adapter.transaction(async() => {
    events.push('transaction')
    await insert.run('inside')
    await sleep(20)
  })()
  const other = insert.run('outside').then(() => events.push('outside'))
  await Promise.all([transaction, other])
  assert.deepEqual(events, ['transaction', 'outside'])
  assert.deepEqual(rows(), ['inside', 'outside'])
  await adapter.close()
})

test('worker entry points are serialized so composite operations cannot interleave', async() => {
  // 这是适配器"事务回调期间直接放行内部语句"的前提：dbService 入口一次只跑一个业务调用。
  const events = []
  let exposed
  load('src/main/worker/dbService/index.ts', {
    './db': { init: async() => true },
    '../utils/worker': { exposeWorker: service => { exposed = service } },
    './modules/index': {
      list: {
        slow: async() => { events.push('slow-start'); await sleep(20); events.push('slow-end') },
        fast: async() => { events.push('fast') },
      },
      lyric: {}, music_url: {}, music_other_source: {}, download: {}, dislike_list: {},
    },
  })
  assert.equal(typeof exposed.init, 'function')
  await Promise.all([exposed.slow(), exposed.fast()])
  assert.deepEqual(events, ['slow-start', 'slow-end', 'fast'])
})
