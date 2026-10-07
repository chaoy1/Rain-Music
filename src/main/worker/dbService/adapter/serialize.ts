import {
  type SQLAdapter,
  type SQLAdapterType,
  type SQLBindParameters,
  type SQLDriver,
  type SQLStatement,
} from './types'

const ignore = () => {}

/**
 * 连接锁 + 事务语义的共享实现（桌面 / Android 通用）。
 *
 * ## 为什么需要连接锁
 *
 * 改造前 `dbService` 里的 SQL 调用是**同步**的，JS 单线程 + 无 await 意味着一次业务调用
 * 从头跑到尾，不可能被别的调用插进来 —— 31 处 `db.transaction()` 的原子性是"免费"的。
 * 异步化之后每个 `await` 都是让出点，如果两个 IPC 调用同时进来，B 的语句就可能落进
 * A 已经 BEGIN、还没 COMMIT 的事务里：A 一旦回滚，B 的写入会被一起回滚。
 * 所以这里把"同一连接上的操作"排成一条队列（连接锁）：**事务在 COMMIT / ROLLBACK 之前
 * 一直持有连接**，其它操作排队等待。
 *
 * ## 事务等价性（对应 better-sqlite3 的 `db.transaction(fn)`）
 *
 * | better-sqlite3 | 这里 |
 * | --- | --- |
 * | 默认 `BEGIN`（deferred，锁在第一次写时获取） | 同样的 `BEGIN`，busy 处理仍由 SQLite 自己完成 |
 * | 抛错即回滚 | `ROLLBACK` 后**重新抛出原始错误**（回滚失败不掩盖真实原因） |
 * | 嵌套调用用 SAVEPOINT | 同样的 `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` |
 * | 同步回调 | `async` 回调，内部语句顺序执行（都在同一把锁里） |
 *
 * ## 为什么 `depth > 0` 时直接执行（不再排队）
 *
 * 31 处调用点都是**先在事务外** `createXxxStatement()`，再把这些 statement 传进
 * `db.transaction((...) => { stmt.run() })` 的回调。如果事务体内的语句也去抢锁，就会自己把自己
 * 锁死。因此事务回调执行期间（`depth > 0`）语句直接跑。
 *
 * 这一点的安全性依赖 `dbService` 入口的整体串行化（`../index.ts` 的 `serializeCalls`）：
 * worker 里同一时刻只会有一个业务调用在跑，不存在"另一个调用的事务体插进来"的情况。
 */
export class SerializedSQLAdapter implements SQLAdapter {
  readonly type: SQLAdapterType
  private readonly driver: SQLDriver
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0
  private depth = 0
  private savepointId = 0

  constructor(driver: SQLDriver, type: SQLAdapterType) {
    this.driver = driver
    this.type = type
  }

  prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(sql: string): SQLStatement<BindParameters, Result> {
    const statement: SQLStatement<BindParameters, Result> = this.driver.prepare(sql)
    return {
      get: async(...params: SQLBindParameters<BindParameters>) => await this.run(async() => await statement.get(...params)),
      all: async(...params: SQLBindParameters<BindParameters>) => await this.run(async() => await statement.all(...params)),
      run: async(...params: SQLBindParameters<BindParameters>) => await this.run(async() => await statement.run(...params)),
    }
  }

  async exec(sql: string): Promise<void> {
    await this.run(async() => { await this.driver.exec(sql) })
  }

  async pragma(pragma: string): Promise<unknown> {
    return await this.run(async() => await this.driver.pragma(pragma))
  }

  /**
   * 关库。连接空闲时走**同步**快路径：`driver.close()` 的方法体在第一次 await 之前是同步执行的，
   * 所以 `process.on('exit', () => db.close())` 仍然能在进程退出前真正关掉连接
   * （与改造前 `better-sqlite3` 的同步 `close()` 等价，WAL 会被 checkpoint）。
   * 只有在还有操作在跑时才排队等待。
   */
  async close(): Promise<void> {
    if (this.depth === 0 && this.pending === 0) {
      await this.driver.close()
      return
    }
    await this.run(async() => { await this.driver.close() })
  }

  transaction<Args extends any[], Result>(fn: (...args: Args) => Promise<Result> | Result): (...args: Args) => Promise<Result> {
    return async(...args: Args) => await this.run(async() => {
      const outermost = this.depth === 0
      const savepoint = `rain_sp_${++this.savepointId}`
      await this.driver.exec(outermost ? 'BEGIN' : `SAVEPOINT "${savepoint}"`)
      this.depth++
      try {
        const result = await fn(...args)
        this.depth--
        await this.driver.exec(outermost ? 'COMMIT' : `RELEASE "${savepoint}"`)
        return result
      } catch (error) {
        this.depth--
        try {
          await this.driver.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO "${savepoint}"`)
          if (!outermost) await this.driver.exec(`RELEASE "${savepoint}"`)
        } catch {
          // 回滚本身失败（例如连接已断开）时不掩盖原始错误：抛出的必须是真正的失败原因。
        }
        throw error
      }
    })
  }

  /** 连接锁：事务回调执行期间直接放行（见类注释最后一节）。 */
  private async run<Result>(task: () => Promise<Result> | Result): Promise<Result> {
    if (this.depth > 0) return await Promise.resolve().then(task)
    this.pending++
    const result = this.queue.then(task)
    this.queue = result.then(ignore, ignore)
    result.then(() => { this.pending-- }, () => { this.pending-- })
    return await result
  }
}
