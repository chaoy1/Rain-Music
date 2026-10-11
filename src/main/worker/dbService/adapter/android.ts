import { DB_VERSION } from '../tables'
import { type SQLAdapterOptions, type SQLDriver } from './types'

/**
 * 插件 `createConnection({ version })` 要的**库版本数**。
 *
 * - **单一出处**：`tables.ts:231` 的 `DB_VERSION`（`'4'`）—— 与 `db.ts:15` 写进 `db_info.version`、
 *   原生侧 `RainMusicDatabase.SCHEMA_VERSION_TEXT`（`RainMusicDatabase.java:223`）是同一个数，
 *   所以这里**不写字面量**。
 * - 为什么要转一次：`DB_VERSION` 是 `string`（`migrate.ts:105` 用 `case DB_VERSION:` 比对字符串），
 *   而插件的 `version` 是 `number`，`Number()` 是这两者之间唯一的转换点。
 * - 填错会怎样：`SQLiteOpenHelper` 的 `user_version` 就是这个 4，以**低于**它的版本打开
 *   会走框架的 `onDowngrade` → **抛错**（`RainMusicDatabase.java:104,527` 明确"刻意不覆写它"），
 *   所以阶段 2a 的占位值 `1` 一旦带进真机是"库打不开"，而不是"少了一个迁移"。
 */
export const ANDROID_DB_VERSION = Number(DB_VERSION)

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
 *    - `new Database(...)` → `CapacitorSQLite.createConnection({ database, encrypted: false, mode: 'no-encryption', version: ANDROID_DB_VERSION, readonly: false })` + `open()`。
 *      **版本号用文件顶部那个 `ANDROID_DB_VERSION`（= `Number(DB_VERSION)`），不要在这里写字面量** ——
 *      它与原生侧 `RainMusicDatabase.SCHEMA_VERSION_TEXT`（`RainMusicDatabase.java:223`）以及
 *      `SQLiteOpenHelper` 的 `user_version` 是同一个数；填低了原生侧打开这份库会直接抛错。
 *      注意插件的 `version` **不是**"期望的库版本校验"：`Database.open()` 只 `getVersion()`，
 *      且仅当 `version > 当前` **并且** 传过 `addUpgradeStatement` 才会动手，比当前低则**静默不管**
 *      ⇒ 「版本不对就大声失败」这条保护**只来自原生侧**，JS 驱动这边填错不会有任何报错。
 *    - **库文件名：已核实（读插件源码）—— Android 侧叫 `rain.dataSQLite.db`，不是桌面的 `rain.data.db`**。
 *      插件会**改写**库名：`CapacitorSQLite.getDatabaseName()` 砍掉结尾的 `.db`，
 *      `createConnection()` 再固定拼 `"SQLite.db"` ⇒ `database` 传 `'rain.data.db'` 或 `'rain.data'`
 *      **都得到同一个文件 `rain.dataSQLite.db`**（传别的名字只会得到 `<名字>SQLite.db`）。
 *      目录 = 框架 `databases` 目录（`UtilsFile.isFileExists()` / `getDatabaseDirectoryPath()` 都走
 *      `context.getDatabasePath(...)`），与原生侧同目录。
 *      ⇒ 接线决定（已拍板）：**JS 驱动就用普通 `createConnection`**，不要另辟路径；原生侧
 *      `RainMusicDatabase.DATABASE_NAME` 已改为 `rain.dataSQLite.db`（依据写在那个常量旁），
 *      两边于是打开**同一个文件**。`createNCConnection({ databasePath, version })` 那条路不要走：
 *      它要求文件已存在且固定 `readonly: true`，不能建库、不能当主连接。
 *      ⚠️ 依据 = 插件**官方文档 + master 源码**（本机未安装该插件，无 node_modules 版本可执行），
 *      所以**真机上仍要复核一次**文件名与 `user_version`（见下面「未验证清单」）。
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
 * ## 未验证清单（接线前必须先回答，不要当成已解决）
 *
 * 1. **同一个文件会被两套 SQLite 实现打开**：插件用的是 **SQLCipher** 的
 *    `net.zetetic.database.sqlcipher.SQLiteDatabase`（`Database` 构造里 `System.loadLibrary("sqlcipher")`）
 *    的 `openOrCreateDatabase(file, password, null, null)`；原生侧 `RainMusicDatabase` 用的是框架
 *    `android.database.sqlite.SQLiteOpenHelper`。两者打开**同一个文件**这件事没有验证过
 *    （未加密时文件格式预期兼容，但预期不是证据）。
 * 2. **`user_version` 的写入方不确定**：插件 `Database.open()` 只 `getVersion()`，且只有在
 *    `version > 当前` **并且** 传过 `addUpgradeStatement` 时才走升级 —— **它自己不写 `user_version`**；
 *    原生侧由 `SQLiteOpenHelper` 写。⇒ 谁先建库，决定这个文件里的 `user_version` 是多少。
 * 3. **最坏路径是原生侧抛错**：若插件先建库（`user_version` = 0、**一张表都没有**），随后原生
 *    `getWritableDatabase()` 会判定 0 < 4 而调用 `onUpgrade(db, 0, 4)`，而 `RainMusicDatabase`
 *    的既定策略就是**在这里抛错**（类注释「迁移策略」：不猜迁移）。那是**大声失败**、
 *    不是静默损坏 —— 但用户看到的是"打不开"。
 * 4. **复核方法（真机，接入后立刻做）**：先**只让一侧**建库并跑通一次（例如只跑原生通道），
 *    再让另一侧打开，检查三件事：文件是不是同一个（`ls /data/data/<pkg>/databases/`）、
 *    `PRAGMA user_version` 是否仍为 4、另一侧是否抛 `onUpgrade`。结论回写到本节 +
 *    `RainMusicDatabase.java` 的「仍然需要真机复核的点」。
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
