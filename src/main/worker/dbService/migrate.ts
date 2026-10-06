import type Database from 'better-sqlite3'
import tables, { DB_VERSION } from './tables'

// 已删除的内置「我的收藏」列表 id。
// 迁移脚本刻意写死字面量（而不是引用 constants 里的常量），
// 保证历史迁移不随上层常量变动而改变语义。
const LOVE_LIST_ID = 'love'

// const migrateV1 = (db: Database.Database) => {
//   const sql = `
//     DROP TABLE "main"."download_list";

//     CREATE TABLE "download_list" (
//       "id" TEXT NOT NULL,
//       "isComplate" INTEGER NOT NULL,
//       "status" TEXT NOT NULL,
//       "statusText" TEXT NOT NULL,
//       "progress_downloaded" INTEGER NOT NULL,
//       "progress_total" INTEGER NOT NULL,
//       "url" TEXT,
//       "quality" TEXT NOT NULL,
//       "ext" TEXT NOT NULL,
//       "fileName" TEXT NOT NULL,
//       "filePath" TEXT NOT NULL,
//       "musicInfo" TEXT NOT NULL,
//       "position" INTEGER NOT NULL,
//       PRIMARY KEY("id")
//     );
//   `
//   db.exec(sql)
//   db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: '2' })
// }

const migrateV1 = (db: Database.Database) => {
  // 修复 v2.4.0 的默认数据库版本号不对的问题
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'dislike_list\';').get()
  if (!existsTable) {
    const sql = tables.get('dislike_list')!
    db.exec(sql)
  }
}

/**
 * 迁移 v2 -> v3：彻底删除内置「我的收藏」列表及其数据
 *
 * 收藏歌曲存放在 my_list_music_info / my_list_music_info_order 里
 * （以 listId = 'love' 区分），my_list 里也可能残留收藏列表条目。
 * 用户确认「不做迁移、连同数据一起删除」，因此这里直接清空这些行，
 * 老版本升级后收藏数据不再存在。
 */
const migrateV2 = (db: Database.Database) => {
  db.prepare('DELETE FROM "main"."my_list" WHERE "id" = ?').run(LOVE_LIST_ID)
  db.prepare('DELETE FROM "main"."my_list_music_info" WHERE "listId" = ?').run(LOVE_LIST_ID)
  db.prepare('DELETE FROM "main"."my_list_music_info_order" WHERE "listId" = ?').run(LOVE_LIST_ID)
}

/**
 * 迁移 v3 -> v4：把用户自建歌单的展示顺序规范化到 my_list."position"
 *
 * 「自定义列表可自由调整顺序」的顺序持久化以 "position" 列为准
 * （见 modules/list/statements.ts 的 createListQueryStatement 与
 * modules/list/index.ts 的 updateUserListsPosition）。
 * 但历史库里的 position 可能并没有真正排过序（旧版本创建列表时任意赋值，
 * 甚至整库都是 0），此时排序值不可用，读回顺序只能靠存储顺序。
 * 这里按存储顺序（rowid）重新编号一次，让顺序有明确、可持久化的依据；
 * 已经是 0..n-1 的库不会被改动。
 */
const migrateV3 = (db: Database.Database) => {
  const rows = db.prepare(`
    SELECT "id", "position"
    FROM "main"."my_list"
    ORDER BY "position" ASC, "rowid" ASC
    `).all() as Array<{ id: string, position: number | null }>
  if (!rows.length) return
  if (rows.every((row, index) => row.position === index)) return
  const update = db.prepare('UPDATE "main"."my_list" SET "position"=@position WHERE "id"=@id')
  rows.forEach((row, index) => {
    update.run({ id: row.id, position: index })
  })
}

export default (db: Database.Database) => {
  // PRAGMA user_version = x
  // console.log(db.prepare('PRAGMA user_version').get().user_version)
  // https://github.com/WiseLibs/better-sqlite3/issues/668#issuecomment-1145285728
  const info = db.prepare<[string]>('SELECT "field_value" FROM "main"."db_info" WHERE "field_name" = ?').get('version') as { field_value: string } | undefined
  if (!info) throw new Error('Database schema version is missing')
  const version = info.field_value
  switch (version) {
    case '1':
      migrateV1(db)
      migrateV2(db)
      migrateV3(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '2':
      migrateV2(db)
      migrateV3(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '3':
      migrateV3(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case DB_VERSION:
      break
    default:
      throw new Error(`Unsupported database schema version: ${version}`)
  }
}
