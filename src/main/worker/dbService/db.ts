import path from 'path'
import { existsSync } from 'fs'
import tables, { DB_VERSION } from './tables'
import verifyDB from './verifyDB'
import migrateData from './migrate'
import { createSQLAdapter } from './adapter'
import { type SQLAdapter } from './adapter/types'

let db: SQLAdapter


const initTables = async(db: SQLAdapter) => {
  await db.exec(`
    ${Array.from(tables.values()).join('\n')}
    INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${DB_VERSION}');
  `)
}


// 打开、初始化数据库
export const init = async(rainDataPath: string): Promise<boolean | null> => {
  const databasePath = path.join(rainDataPath, 'rain.data.db')
  const nativeBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')

  // 先判断数据库文件是否已存在。
  // 原逻辑无条件以 fileMustExist: true 打开并靠 catch 兜底建库，
  // 导致首次运行时必然打印一次 SqliteError: unable to open database file —— 属于噪声而非真实故障。
  // 按存在性分流后，既保留了「文件损坏时能区分出来」的能力，也消除了这个误导性报错。
  let dbFileExists = existsSync(databasePath)

  if (dbFileExists) {
    try {
      db = createSQLAdapter({
        databasePath,
        fileMustExist: true,
        nativeBinding,
      })
    } catch (error) {
      console.log(error)
      return null
    }
  }

  if (!dbFileExists) {
    db = createSQLAdapter({
      databasePath,
      nativeBinding,
    })
    await initTables(db)
  }
  try {
    await db.pragma('journal_mode = WAL')
    if (dbFileExists) await migrateData(db)
    // https://www.sqlite.org/pragma.html#pragma_optimize
    if (dbFileExists) await db.exec('PRAGMA optimize;')
    if (!await verifyDB(db)) {
      await db.close()
      return null
    }
  } catch (error) {
    console.log(error)
    await db.close()
    if (!dbFileExists) throw error
    return null
  }

  // https://www.sqlite.org/lang_vacuum.html
  // db.exec('VACUUM "main"')

  // `process.on` 只有 Node（桌面版 worker_threads）才有；Android WebView / Web Worker 里没有进程概念，
  // 关库由 Capacitor 生命周期负责，因此这里按宿主能力注册。
  const hostProcess = (globalThis as { process?: { on?: (event: string, listener: () => void) => void } }).process
  if (typeof hostProcess?.on === 'function') hostProcess.on('exit', () => { void db.close() })
  console.log('db inited')
  // require('./test')
  return dbFileExists
}

// 获取数据库实例
export const getDB = (): SQLAdapter => db
