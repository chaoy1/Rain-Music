import Database from 'better-sqlite3'
import { type SQLAdapterOptions, type SQLDriver, type SQLStatement } from './types'

/**
 * 桌面驱动：把原来的 `better-sqlite3` 直接用法搬到这里，行为逐字等价。
 *
 * 与原 `db.ts` 的对应关系：
 * - `new Database(path, { fileMustExist, nativeBinding })`：`db.ts` 原来按文件是否存在分流
 *   （存在时 `fileMustExist: true`，不存在时不传），分流逻辑仍在 `db.ts`，这里只透传选项。
 * - `db.exec` → `exec`；`db.pragma` → `pragma`；`db.close` → `close`；`db.prepare` → `prepare`。
 * - **所有方法都是 `async`，但内部同步执行**：`better-sqlite3` 是同步 API，
 *   包上 Promise 只是为了让上层统一 `await`，实际时序与改造前一致。
 * - `transaction()` 不在驱动里实现：它由 `SerializedSQLAdapter` 用 BEGIN/COMMIT/ROLLBACK 统一提供，
 *   桌面与 Android 共用同一份事务语义（见 `./serialize.ts`）。
 */
export const createBetterSqlite3Driver = (options: SQLAdapterOptions): SQLDriver => {
  // better-sqlite3 v13 严格校验选项：`fileMustExist` 只要出现在 options 里就必须是 boolean，
  // 传 `undefined` 会直接抛 `Expected the "fileMustExist" option to be a boolean`。
  // 原实现是"存在文件时才传这个键"，所以这里也只透传显式给出的选项。
  const nativeOptions: Database.Options = {}
  if (options.fileMustExist != null) nativeOptions.fileMustExist = options.fileMustExist
  if (options.nativeBinding != null) nativeOptions.nativeBinding = options.nativeBinding

  const db = new Database(options.databasePath, nativeOptions)

  return {
    prepare(sql: string): SQLStatement<any> {
      const statement = db.prepare(sql)
      return {
        get: async(...params: any[]) => statement.get(...params),
        all: async(...params: any[]) => statement.all(...params),
        run: async(...params: any[]) => {
          const info = statement.run(...params)
          return {
            changes: info.changes,
            lastInsertRowid: info.lastInsertRowid,
          }
        },
      }
    },
    async exec(sql: string) {
      db.exec(sql)
    },
    async pragma(pragma: string) {
      return db.pragma(pragma)
    },
    async close() {
      db.close()
    },
  }
}
