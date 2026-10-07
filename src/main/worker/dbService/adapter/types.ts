/**
 * SQL 适配器抽象（Android 移植 · 阶段 2 / 线 A）。
 *
 * ## 为什么需要这一层
 *
 * 桌面版数据库是 `better-sqlite3`（`src/main/worker/dbService/db.ts`），它是**同步** API；
 * Android 侧的等价能力是 `@capacitor-community/sqlite`（见 `docs/android/native-bridge-needs.md`
 * §2.7），它是**异步** API，而且没有 `prepare()` 返回的 statement 对象。为了让同一份
 * `dbService` 业务代码（`dbHelper.ts` × 6、各模块的 `index.ts` × 6、`migrate.ts`、`verifyDB.ts`）
 * 两端都能跑，这里把"SQL 怎么执行"收口成一个接口，用它替代直接 import `better-sqlite3`。
 *
 * ## 形状约定（刻意贴着 better-sqlite3，把改动压到最小）
 *
 * 1. `prepare()` 保持**同步**，只有 `get` / `all` / `run` 是 Promise —— 与 `better-sqlite3` 的
 *    `db.prepare(...)` 用法同形（连泛型个数都一样），因此 6 个 `statements.ts` **一行都不用改**，
 *    改动集中在真正执行 SQL 的 `dbHelper.ts`（加 `await`）。
 * 2. `transaction(fn)` 同形：`transaction(fn)(...args)`，返回 Promise。嵌套调用用 SAVEPOINT
 *    （与 `better-sqlite3` 一致）。实现见 `serialize.ts`，两个平台共用一份事务语义。
 * 3. 同一个连接上的所有操作在适配器内部**串行化**（连接锁）：事务持有连接直到
 *    COMMIT / ROLLBACK，保证 31 处 `db.transaction()` 的原子性与回滚语义在异步化后不变。
 * 4. 桌面适配器的方法都是 `async`，但内部**同步执行** better-sqlite3 —— 行为与改造前逐字等价
 *    （WAL pragma、`fileMustExist`、原生 `nativeBinding` 全部保留）。
 *
 * 桌面路径是默认路径；Android 只在平台判定命中时注入（`./index.ts` 的 `setSQLAdapterType`），
 * 因此桌面构建的行为不会发生任何变化。
 */

/** 适配器类型。桌面是默认值，只有 Android 需要显式注入。 */
export type SQLAdapterType = 'desktop' | 'android'

/** 写语句的返回结果（与 better-sqlite3 的 `RunResult` 取其被本工程用到的字段）。 */
export interface SQLRunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/**
 * 绑定参数的形状，与 better-sqlite3 一致：
 * 数组按位置展开成多个实参，对象作为命名参数整体传入。
 */
export type SQLBindParameters<Params extends unknown[] | object> = Params extends unknown[] ? Params : [params: Params]

/** 预编译语句。`prepare()` 同步返回它，三个执行方法全部是 Promise。 */
export interface SQLStatement<BindParameters extends unknown[] | object = unknown[], Result = unknown> {
  get: (...params: SQLBindParameters<BindParameters>) => Promise<Result | undefined>
  all: (...params: SQLBindParameters<BindParameters>) => Promise<Result[]>
  run: (...params: SQLBindParameters<BindParameters>) => Promise<SQLRunResult>
}

/**
 * 打开连接所需的参数，对应原本 `new Database(path, options)` 的两个选项。
 * `nativeBinding` / `fileMustExist` 是 better-sqlite3 专有语义，Android 驱动没有对应物
 * （见 `./android.ts` 的接线说明），但接口保持平台中立。
 */
export interface SQLAdapterOptions {
  databasePath: string
  fileMustExist?: boolean
  nativeBinding?: string
}

/**
 * 驱动层：无锁、无事务语义的裸能力。两个平台的驱动只实现这 4 件事，
 * 串行化与 BEGIN/COMMIT/ROLLBACK/SAVEPOINT 由 `SerializedSQLAdapter`（`serialize.ts`）统一提供，
 * 保证桌面与 Android 的事务语义来自**同一份代码**。
 */
export interface SQLDriver {
  prepare: (sql: string) => SQLStatement<any, any>
  exec: (sql: string) => Promise<void>
  pragma: (pragma: string) => Promise<unknown>
  close: () => Promise<void>
}

/** 业务代码看到的适配器（`getDB()` 的返回类型）。 */
export interface SQLAdapter extends SQLDriver {
  readonly type: SQLAdapterType
  /**
   * 与 better-sqlite3 的 `prepare<BindParameters, Result>` 同形的两个类型参数，
   * 使现有 `db.prepare<[string]>(...)` / `db.prepare<[A], B>(...)` 调用点无需改动。
   */
  prepare: <BindParameters extends unknown[] | object = unknown[], Result = unknown>(sql: string) => SQLStatement<BindParameters, Result>
  /** better-sqlite3 风格的事务包装：`transaction(fn)(...args) => Promise<Result>`。 */
  transaction: <Args extends any[], Result>(fn: (...args: Args) => Promise<Result> | Result) => (...args: Args) => Promise<Result>
}
