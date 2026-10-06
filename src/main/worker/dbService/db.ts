import Database from 'better-sqlite3'
import path from 'path'
import { existsSync } from 'fs'
import tables, { DB_VERSION } from './tables'
import verifyDB from './verifyDB'
import migrateData from './migrate'

let db: Database.Database


const initTables = (db: Database.Database) => {
  db.exec(`
    ${Array.from(tables.values()).join('\n')}
    INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${DB_VERSION}');
  `)
}


// 打开、初始化数据库
export const init = (rainDataPath: string): boolean | null => {
  const databasePath = path.join(rainDataPath, 'rain.data.db')
  const nativeBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')

  // 先判断数据库文件是否已存在。
  // 原逻辑无条件以 fileMustExist: true 打开并靠 catch 兜底建库，
  // 导致首次运行时必然打印一次 SqliteError: unable to open database file —— 属于噪声而非真实故障。
  // 按存在性分流后，既保留了「文件损坏时能区分出来」的能力，也消除了这个误导性报错。
  let dbFileExists = existsSync(databasePath)

  if (dbFileExists) {
    try {
      db = new Database(databasePath, {
        fileMustExist: true,
        nativeBinding,
      })
    } catch (error) {
      console.log(error)
      return null
    }
  }

  if (!dbFileExists) {
    db = new Database(databasePath, {
      nativeBinding,
    })
    initTables(db)
  }
  try {
    db.pragma('journal_mode = WAL')
    if (dbFileExists) migrateData(db)
    // https://www.sqlite.org/pragma.html#pragma_optimize
    if (dbFileExists) db.exec('PRAGMA optimize;')
    if (!verifyDB(db)) {
      db.close()
      return null
    }
  } catch (error) {
    console.log(error)
    db.close()
    if (!dbFileExists) throw error
    return null
  }

  // https://www.sqlite.org/lang_vacuum.html
  // db.exec('VACUUM "main"')

  process.on('exit', () => db.close())
  console.log('db inited')
  // require('./test')
  return dbFileExists
}

// 获取数据库实例
export const getDB = (): Database.Database => db
