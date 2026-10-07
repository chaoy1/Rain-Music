import { type SQLAdapterOptions, type SQLDriver } from './types'

/**
 * Android 驱动——**阶段 2 只落接口与骨架，不实现**。
 *
 * ## 为什么这一轮不实现
 *
 * 1. 本机没有 Android SDK、没有 `@capacitor-community/sqlite`，**写出来也无法验证**
 *    （`docs/android-port-plan.md:7-24`：用户已决定走 CI 出包）。
 * 2. `docs/android/native-bridge-needs.md` §5 第 2 条已明确登记该插件的能力**未核实**：
 *    `journal_mode=WAL` 支持、嵌套事务 / SAVEPOINT、并发 busy 重试、web 回退（jeep-sqlite / sql.js）
 *    全部没有实测证据。按这些假设写出来的代码只会是"看起来能跑"的死代码。
 *
 * 所以这里只做两件事：把驱动接口占住（让 `./index.ts` 的平台分支是真实的），
 * 并把接线方法写成可执行的清单，下一个阶段照着填即可。
 *
 * ## 后续怎么接（接线清单）
 *
 * 1. **依赖**：`npm i @capacitor-community/sqlite`（+ Android 侧 `npx cap sync android`）。
 *    为了避免桌面 bundle 被牵连，接入时用 `await import('@capacitor-community/sqlite')`
 *    动态加载，并且只在 `getSQLAdapterType() === 'android'` 的分支里加载。
 * 2. **连接**：
 *    - `new Database(...)` → `CapacitorSQLite.createConnection({ database, encrypted: false, mode: 'no-encryption', version: 1, readonly: false })` + `open()`。
 *    - `fileMustExist` **没有对应物**：插件在 open 时会自己建库。要保留"损坏 / 空库能被识别出来"
 *      的现有行为（`db.ts` 里按文件存在性分流），需要先用 `CapacitorSQLite.isDatabase({ database })`
 *      或 `Filesystem.stat()` 判断文件是否存在，再把结果映射成 `fileMustExist` 语义。
 *    - `nativeBinding` **没有对应物**（插件自带 Android SQLite），忽略即可。
 * 3. **`prepare(sql)`**：插件**没有** prepared-statement 对象。建议在 JS 侧维护一个
 *    `sql -> { id, readonly }` 的映射：`sql` 首关键字是 `SELECT` / `PRAGMA` / `WITH` 的走
 *    `query({ statement, values })`（`all()` 返回 `values`，`get()` 取第 0 行），其余走
 *    `run({ statement, values, transaction: false })`（把它返回的 `changes.changes` 映射成
 *    `SQLRunResult.changes`；`lastInsertRowid` 插件不返回，需要时用 `last_insert_rowid()` 补查）。
 * 4. **`exec(sql)`**：→ `execute({ statements: sql })`。注意插件不接受参数绑定，多语句可用 `;` 分隔。
 * 5. **`pragma(sql)`**：→ `query('PRAGMA ' + sql)`；`journal_mode = WAL` 能否生效 **必须真机验证**
 *    （`native-bridge-needs.md` §5 第 2 条把它列为未确认项）。
 * 6. **事务**：**驱动不要实现 `transaction()`** —— BEGIN / COMMIT / ROLLBACK / SAVEPOINT 由
 *    `SerializedSQLAdapter`（`./serialize.ts`）负责，两个平台共用同一份语义。
 *    唯一需要确认的是插件在 `execute('BEGIN')` 之后、跨多个 `await` 时是否保持同一连接（预期是，
 *    但属于未验证项）。
 * 7. **`close()`**：→ `CapacitorSQLite.closeConnection({ database })`。
 *    另外 `db.ts` 里的 `process.on('exit', ...)` 在 WebView 里不存在，已经加了 `typeof process.on`
 *    判定，不需要驱动处理。
 * 8. **web 回退**（纯浏览器调试用）：`jeep-sqlite` 需要 `initWebStore()` + 自定义元素注册，
 *    与本驱动的接口无关，接的时候一并做。
 *
 * ## 注入方式（桌面路径不受影响）
 *
 * `./index.ts` 的判定顺序是"显式注入 > 平台判定 > 桌面默认"：
 * - 显式：Android 启动流程里调用 `setSQLAdapterType('android')`；
 * - 或按 `docs/android/ipc-contract.md` §6.1 的做法，用构建期别名把 `./index.ts` 换成只导出
 *   Android 分支的入口，从而把 `better-sqlite3` 彻底排除出 Android bundle。
 */
export const createCapacitorSQLiteDriver = (options: SQLAdapterOptions): SQLDriver => {
  throw new Error(
    'Rain SQL adapter: the Android (@capacitor-community/sqlite) driver is not implemented yet. ' +
    `See src/main/worker/dbService/adapter/android.ts for the wiring checklist (database: ${options.databasePath}).`,
  )
}
