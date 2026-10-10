/**
 * Android 移植 · **P0-2 第四刀（`player_list_get`，歌单 / 列表的读取通道）**
 * 的契约 / 接线 / 落点回归网。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**不执行任何 Java**，也**没有真的开过 SQLite** —— 所以它**不能**证明这条通道在真机上不再是
 * `IPC_CHANNEL_UNSUPPORTED`，不能证明库文件真的落在 `getDatabasePath("rain.data.db")`、
 * 不能证明首次打开真的建出了那 9 张表。那几件事只能由 CI 的 `gradlew assembleDebug`（编译）
 * → 真机运行（行为）来证明。
 *
 * 它守的是一组**本机可测、且一旦写错在真机上完全静默（或表现为"用户歌单空了"）**的错误：
 *
 * 1. **通道名字面量 == `ipcNames.ts` 生成的真实通道名**（模块前缀是 `player`、键名是 `list_get`，
 *    `ipcNames.ts:171-176`）—— 错一个字符就是 `IPC_CHANNEL_UNSUPPORTED`；
 * 2. **形状 == 契约**：`player_list_get` 是 `mainHandle`（invoke，请求/应答）、**无参数**、
 *    返回 `Rain.List.UserListInfo[]`（契约 `ipc-contract.md:101`）；渲染层
 *    `rendererListManage.ts:28` 的调用是 `rendererInvoke`、不传第二个参数；
 * 3. **SQL 逐字对齐阶段 2a**：`SELECT … FROM "main"."my_list" ORDER BY "position" ASC, "rowid" ASC`
 *    与 `modules/list/statements.ts:14-21` 归一化后逐字相同（含 `position` 排序那一句 ——
 *    少了它，歌单顺序在 VACUUM 之后就会变，重启后排序失效）；
 * 4. **表结构逐字对齐 `tables.ts`**：`RainMusicDatabase.java` 里的 12 个 DDL 文本块
 *    （9 张表 + 3 个索引）与 `tables.ts` 的 `tables.set('…')` 归一化后逐字相同，
 *    **一条不多一条不少、顺序一致**（`db.ts:13-14` 用的就是注册顺序）；
 * 5. **返回值的形状**：`position` 被剥掉（桌面 `getAllUserList()` 的 `const { position, ...newList }`）、
 *    `sourceListId` 末尾的 `.0` 被修掉（桌面 `queryAllUserList()` 的兼容逻辑）、
 *    可空列写出 JSON `null` 而不是"删键"（`org.json` 的 `put(name, null)` 会删键）；
 * 6. **注册真的被调用**：`RainMusicIpcPlugin.load()` 里调 `RainMusicListChannels.register(this)`，
 *    且 `MainActivity` 仍把插件注册在 `super.onCreate()` **之前**；匹配前**必须去掉注释**
 *    （前两刀都被这个坑抓过）；
 * 7. **不假装成功**：库打不开 / 表缺失 / 查询失败三条路都**抛错**，代码里**没有**
 *    `catch` 之后 `return new JSONArray()` 这种"把坏了伪装成用户没有歌单"的写法；
 * 8. **范围守卫**：本刀只注册这 **1 条**通道，写侧一条都不碰；并且**不注册、也不广播**
 *    `player_list_data_overwire`（理由见 `RainMusicListChannels` 类注释那一节）。
 *
 * 另外两组：
 * - 最后一组用 JS 侧的桥 + 一个**按 Java 语义实现**的原生替身，锁住"空 ⇒ `[]`、坏 ⇒ reject"
 *   这条链在 JS 侧的可观察行为。它是接线检查，**不是** Java 行为验证 —— 替身与 Java 一旦漂移，
 *   这组用例不会变红（所以每条替身语义旁边都有对应的 Java 源码断言）；
 * - 并发那一条只断言**代码形状**（进程级单例 + 懒建只加在 helper 上 + 游标在 finally 里关 +
 *   查询路径上没有 synchronized），因为"真的并发读会不会坏"本机无从验证。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const ROOT = path.join(__dirname, '../..')
const BRIDGE_MODULE = 'src/common/platform/ipcBridge/capacitor.js'

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readJava = relative => read(path.join('android/app/src/main/java/com/rainmusic/mobile', relative))

const listJava = readJava('ipc/RainMusicListChannels.java')
const dbJava = readJava('ipc/RainMusicDatabase.java')
const pluginJava = readJava('ipc/RainMusicIpcPlugin.java')
const activityJava = readJava('MainActivity.java')
const dataJava = readJava('ipc/RainMusicDataChannels.java')
const settingJava = readJava('ipc/RainMusicAppSettingChannels.java')
const lockJava = readJava('ipc/RainMusicStoreLock.java')

const tablesTs = read('src/main/worker/dbService/tables.ts')
const statementsTs = read('src/main/worker/dbService/modules/list/statements.ts')
const dbHelperTs = read('src/main/worker/dbService/modules/list/dbHelper.ts')
const listIndexTs = read('src/main/worker/dbService/modules/list/index.ts')
const desktopEventTs = read('src/main/modules/commonRenderers/list/rendererEvent.ts')
const desktopWinEventTs = read('src/main/modules/commonRenderers/list/winRendererEvent.ts')
const rendererListManageTs = read('src/renderer/store/list/listManage/rendererListManage.ts')
const useDataInitTs = read('src/renderer/core/useApp/useDataInit.ts')
const contractMd = read('docs/android/ipc-contract.md')

/**
 * 去掉注释再匹配（前两刀的用例都踩过这个坑：注释里就写着那行代码，
 * 用整份源码匹配的话，把它注释掉**用例依然通过**，而真机上就是"没注册"）。
 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 再去掉字符串字面量（只用于"这段代码里有没有某个执行面"这类判断）。 */
const stripJavaStrings = source => source.replace(/"(?:\\.|[^"\\])*"/g, '""')

/**
 * 去掉 JS 的块注释与行注释。
 *
 * ⚠️ 必须用它：`ipcBridge/capacitor.js` 的**文件头注释**里就有一个信封示例
 * （`"channel": "player_list_get"`），直接 `includes()` 会把"注释里出现过通道名"
 * 误判成"有人加了通道白名单"。这与 Java 侧那个 stripJavaComments 的坑同型。
 */
const stripJsComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 读 Java 里的字符串常量字面量（`static final String X = "…";`）。 */
const javaConstant = (source, name) => {
  const match = source.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]*)"`))
  assert.ok(match, `Java 里找不到常量 ${name}（读法：static final String ${name} = "…"）`)
  return match[1]
}

/**
 * 读 Java 里**含转义引号**的字符串常量（典型是 SQL：`"SELECT \"id\" FROM …"`），并把 `\"` 还原成 `"`。
 *
 * 为什么单独一个读法：直接拿源码正则去匹配 `\"` 极易写错（前几刀都在这类断言上翻过车），
 * 而"把字符串**值**读出来再比对"才是这些断言真正想表达的意思。
 */
const javaStringLiteral = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`))
  assert.ok(match, `Java 里找不到字符串常量 ${name}`)
  return match[1].replace(/\\(.)/g, '$1')
}

/** 读 Java 里的文本块（`static final String X = """…""";`）。 */
const javaTextBlock = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`))
  assert.ok(match, `Java 里找不到文本块 ${name}（读法：static final String ${name} = """…"""）`)
  return match[1]
}

/**
 * SQL 归一化：**与桌面 `verifyDB.ts:4` 的那条正则逐字相同**
 * （`/\n|\s|;|--.+/g`：去掉换行、空白、分号与 `--` 行注释）。
 * 两边用同一个函数，所以 Java 文本块的缩进 / 换行 / `tables.ts` 里那句被注释掉的
 * `-- TODO "meta" TEXT NOT NULL,` 都不会影响比对结果。
 */
const normalizeSql = sql => sql.replace(/\n|\s|;|--.+/g, '')

const { PLAYER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})

const EXPECTED_CHANNEL = PLAYER_EVENT_NAME.list_get
const EXPECTED_OVERWIRE_CHANNEL = PLAYER_EVENT_NAME.list_data_overwire

/** `tables.ts` 的注册表：`[键名, DDL]`，顺序 = 文件里的注册顺序（= `db.ts:13-14` 的执行顺序）。 */
const tableEntries = [...tablesTs.matchAll(/tables\.set\('([^']+)',\s*`([\s\S]*?)`\)/g)]
  .map(match => [match[1], match[2]])
/** `tables.ts` 的 `DB_VERSION`（`:231`）。 */
const tablesDbVersion = tablesTs.match(/export const DB_VERSION = '([^']+)'/)[1]
/** `statements.ts` 的列表查询语句（`:14-21`）。 */
const statementsListSql = statementsTs.match(/createListQueryStatement[\s\S]*?db\.prepare<\[\]>\(`([\s\S]*?)`\)/)[1]

/** 去掉注释后的 Java 源码 —— 凡"这段代码存在吗"的断言都必须用它。 */
const listCode = stripJavaComments(listJava)
const dbCode = stripJavaComments(dbJava)

// ---------------------------------------------------------------------------
// 形状：通道名 / invoke / 无参数 / 返回类型
// ---------------------------------------------------------------------------

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED）', () => {
  assert.equal(EXPECTED_CHANNEL, 'player_list_get', 'ipcNames.ts 的真实值变了？')
  assert.equal(javaConstant(listJava, 'CHANNEL_LIST_GET'), EXPECTED_CHANNEL)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量但忘了 register 的话，真机上依然是"未注册"。
  // ⚠️ 必须去掉注释再匹配（见文件头的 stripJavaComments）。
  assert.match(listCode, /register\(\s*CHANNEL_LIST_GET\s*,/)
})

test('形状 == 契约 :101：mainHandle（invoke）/ 无参数 / 返回 Rain.List.UserListInfo[]', () => {
  // 契约那一行逐字钉住（改了契约就该回来看这条用例）。
  assert.ok(
    contractMd.includes('| `player_list_get` | `getUserLists` `R:listManage:28` | `M:list:6` | 无 → `Rain.List.UserListInfo[]` | 读全部歌单 |'),
    '契约 :101 那一行变了 → 本通道的形状必须重新核对',
  )

  // 桌面 handler：mainHandle ⇒ 渲染层是 rendererInvoke（请求/应答），不是 send、不是广播。
  assert.match(desktopEventTs, /mainHandle<Rain\.List\.UserListInfo\[\]>\(PLAYER_EVENT_NAME\.list_get/)
  assert.ok(!/mainOn<[^>]*>\(PLAYER_EVENT_NAME\.list_get/.test(desktopEventTs), '契约是 mainHandle（invoke）')

  // 渲染层封装：rendererInvoke(通道) —— **不传第二个参数**（args 就是 []）。
  assert.match(
    rendererListManageTs,
    /rendererInvoke<Rain\.List\.UserListInfo\[\]>\(PLAYER_EVENT_NAME\.list_get\)/,
    'getUserLists 必须是 rendererInvoke(channel)，不传参数',
  )
  assert.ok(
    !/rendererSend\w*\(\s*PLAYER_EVENT_NAME\.list_get/.test(rendererListManageTs),
    '读通道不能走 send / sendSync（Capacitor 上没有同步 IPC）',
  )
})

test('范围守卫：本刀只注册 1 条通道；写侧与 data_overwire 一条都不碰、也不广播', () => {
  const registrations = listCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(registrations.length, 1, '本文件只应注册 player_list_get')

  // 这些通道本刀**不做**（任务书明确排除写侧）。⚠️ 必须看**去掉注释后**的代码：
  // 类注释里就写着这些名字（用来登记"一条都不做"），直接匹配整份源码会假失败。
  for (const forbidden of [
    'CHANNEL_LIST_ADD',
    'CHANNEL_LIST_REMOVE',
    'CHANNEL_LIST_UPDATE',
    'CHANNEL_LIST_DATA_OVERWIRE',
    'CHANNEL_LIST_MUSIC',
  ]) {
    assert.ok(!listCode.includes(forbidden), `本刀不应出现 ${forbidden}`)
  }
  // 连通道名字面量也不许出现（写成常量名之外的形式同样算越界）。
  for (const forbidden of ['player_list_add', 'player_list_remove', 'player_list_update', 'player_list_data_overwire', 'player_list_music']) {
    assert.ok(!listCode.includes(forbidden), `本刀不应出现 ${forbidden}（写侧下一刀再做）`)
  }

  // 不广播任何东西：本刀只读，连 `emit` 这个出口都不该出现（data_overwire 没有生产者）。
  assert.ok(!listCode.includes('emit'), '读通道不广播；player_list_data_overwire 本刀没有生产者')
  assert.ok(!dbCode.includes('emit'), '数据库层更不该广播')

  // 注册必须走常量（字面量一旦与 ipcNames.ts 漂移，本机就测不出来了）。
  assert.ok(!listCode.includes('RainMusicIpcHandlers.register("'), '注册必须走常量')

  // P0-1 的插件里不应该出现"就地实现"（实现必须都在各自的通道文件里）。
  assert.doesNotMatch(stripJavaComments(pluginJava), /RainMusicIpcHandlers\.register\(/)

  // 四个通道文件合计 5 条：第一刀 2 条 + 第二/三刀 2 条 + 本刀 1 条。
  const settingRegistrations = stripJavaComments(settingJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  const dataRegistrations = stripJavaComments(dataJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(settingRegistrations.length, 2, '第一刀的设置通道不该被本刀改动')
  assert.equal(dataRegistrations.length, 2, '第二/三刀的数据通道不该被本刀改动')
  assert.equal(settingRegistrations.length + dataRegistrations.length + registrations.length, 5)
})

test('注册必须发生在 RainMusicIpcPlugin.load() 里；MainActivity 仍先 registerPlugin 再 super.onCreate()', () => {
  // ⚠️ 这里**必须**去掉注释再匹配（把 `RainMusicListChannels.register(this);` 整行注释掉之后，
  // 用整份源码匹配的用例**依然通过** —— 注释里就写着这一行，而那正是真机上"未注册"的形状）。
  assert.match(
    stripJavaComments(pluginJava),
    /RainMusicListChannels\.register\(this\)/,
    'load() 里必须注册，否则真机 IPC_CHANNEL_UNSUPPORTED（注释掉不算）',
  )

  // 只看代码、不看注释（注释里就写着这句话）。
  const activityCode = stripJavaComments(activityJava)
  const registerPlugin = activityCode.indexOf('registerPlugin(RainMusicIpcPlugin.class)')
  const superOnCreate = activityCode.indexOf('super.onCreate(')
  assert.ok(registerPlugin > -1 && superOnCreate > -1, 'MainActivity 的注册点/父类调用不见了')
  assert.ok(registerPlugin < superOnCreate, 'registerPlugin 必须在 super.onCreate() 之前')
})

// ---------------------------------------------------------------------------
// SQL 落点：语句逐字对齐 statements.ts，表结构逐字对齐 tables.ts
// ---------------------------------------------------------------------------

test('SELECT 逐字对齐 statements.ts（含 ORDER BY "position" ASC, "rowid" ASC —— 少了它排序就不持久）', () => {
  // 先钉住桌面那一条（引用没写错文件）。
  assert.match(statementsTs, /ORDER BY "position" ASC, "rowid" ASC/)
  assert.match(statementsTs, /FROM "main"\."my_list"/)

  const javaSql = javaTextBlock(listJava, 'SQL_LIST_GET')
  assert.equal(
    normalizeSql(javaSql),
    normalizeSql(statementsListSql),
    'Java 的 SQL_LIST_GET 必须与 statements.ts:14-21 的列表查询语句逐字一致（列清单 / 表名 / ORDER BY）',
  )

  // 三条语义要点单独再钉一遍（归一化比对会被"顺手删掉 ORDER BY"这种改动抓住，
  // 但抓不住"大小写/空格之外的重排"，所以这里按原文再断一次）。
  assert.match(listJava, /SELECT "id", "name", "source", "sourceListId", "position", "locationUpdateTime"/)
  assert.match(listJava, /FROM "main"\."my_list"/)
  assert.match(listJava, /ORDER BY "position" ASC, "rowid" ASC/)

  // 列名清单必须与 tables.ts 里 my_list 的列一致（多一列/少一列都会让真机上的 SELECT 直接失败）。
  const myListDdl = tableEntries.find(([name]) => name === 'my_list')[1]
  assert.deepEqual(
    [...myListDdl.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)/g)].map(match => match[1]),
    ['id', 'name', 'source', 'sourceListId', 'position', 'locationUpdateTime'],
    'my_list 的列变了 → 与阶段 2a 的表结构不再逐字一致',
  )
})

test('表结构逐字对齐 tables.ts：12 条 DDL 一条不多一条不少、顺序一致', () => {
  const keys = tableEntries.map(([name]) => name)
  assert.equal(keys.length, 12, 'tables.ts 的注册表变了（9 张表 + 3 个索引）→ 本刀的 schema 副本必须重新核对')

  // 1. 每条 DDL 单独比对（常量名规则：DDL_ + 键名大写）。
  for (const [name, ddl] of tableEntries) {
    assert.equal(
      normalizeSql(javaTextBlock(dbJava, `DDL_${name.toUpperCase()}`)),
      normalizeSql(ddl),
      `Java 的 DDL_${name.toUpperCase()} 与 tables.ts 的 tables.set('${name}') 不再逐字一致`,
    )
  }

  // 2. 顺序与完整性：SCHEMA_STATEMENTS 里引用的常量**必须**正好是这 12 个、且顺序相同
  //    （桌面 db.ts:13-14 就是 Array.from(tables.values()) 的顺序）。
  const schemaBlock = dbJava.match(/SCHEMA_STATEMENTS\s*=\s*\{([\s\S]*?)\}/)
  assert.ok(schemaBlock, '找不到 SCHEMA_STATEMENTS 数组')
  const referenced = schemaBlock[1].match(/DDL_[A-Z0-9_]+/g) ?? []
  assert.deepEqual(
    referenced,
    keys.map(name => `DDL_${name.toUpperCase()}`),
    'SCHEMA_STATEMENTS 的条目或顺序与 tables.ts 不一致（多了/少了/换了顺序）',
  )

  // 3. `lyric` 那条里被注释掉的列也逐字抄了过来（删掉它就不再是逐字副本）。
  assert.match(javaTextBlock(dbJava, 'DDL_LYRIC'), /-- TODO {2}"meta" TEXT NOT NULL,/)
})

test('schema 版本：Java 的 SCHEMA_VERSION_TEXT 必须等于 tables.ts 的 DB_VERSION（' + tablesDbVersion + '）', () => {
  assert.equal(tablesDbVersion, '4', 'DB_VERSION 变了？阶段 2a 的迁移历史要重新核对')
  assert.equal(javaConstant(dbJava, 'SCHEMA_VERSION_TEXT'), tablesDbVersion)

  // 版本行写进 db_info（与 db.ts:15 同一张表、同样两个列名、同一个 field_name）。
  assert.match(dbJava, /static final String TABLE_DB_INFO = "db_info"/)
  assert.match(dbJava, /static final String COLUMN_FIELD_NAME = "field_name"/)
  assert.match(dbJava, /static final String COLUMN_FIELD_VALUE = "field_value"/)
  assert.match(dbJava, /static final String FIELD_VERSION = "version"/)

  // INSERT 语句的**值**逐字比对（不是拿源码正则去碰转义：见 javaStringLiteral 的说明）。
  const insertSql = javaStringLiteral(dbJava, 'SQL_INSERT_SCHEMA_VERSION')
  assert.deepEqual(
    [...insertSql.matchAll(/"(\w+)"/g)].map(match => match[1]),
    ['main', 'db_info', 'field_name', 'field_value'],
    'INSERT 的表名/列名必须与 tables.ts 的 db_info 一致',
  )
  assert.match(insertSql, /^INSERT INTO "main"\."db_info" \("field_name", "field_value"\) VALUES \(\?, \?\)$/)
  // 两个 db_info 列名必须真的出现在 tables.ts 的 db_info DDL 里。
  const dbInfoDdl = tableEntries.find(([name]) => name === 'db_info')[1]
  for (const column of ['field_name', 'field_value']) {
    assert.ok(dbInfoDdl.includes(`"${column}"`), `db_info 里没有列 ${column}`)
  }

  // 版本号只有一个出处：user_version 由 SCHEMA_VERSION_TEXT 解析而来。
  assert.match(dbCode, /SCHEMA_VERSION = Integer\.parseInt\(SCHEMA_VERSION_TEXT\)/)
  assert.match(dbCode, /super\(context, DATABASE_NAME, null, SCHEMA_VERSION\)/)

  // 建表 SQL 必须逐条执行（Android 的 execSQL 一次只吃一条），并把版本行插在同一个事务里。
  assert.match(dbCode, /for \(String statement : SCHEMA_STATEMENTS\)/)
  assert.match(dbCode, /db\.execSQL\(statement\)/)
  assert.match(dbCode, /db\.execSQL\(SQL_INSERT_SCHEMA_VERSION, new Object\[\] \{ FIELD_VERSION, SCHEMA_VERSION_TEXT \}\)/)
})

test('落点 == 桌面同名的 rain.data.db，且用 SQLiteOpenHelper（databases 目录，应用私有）', () => {
  // 文件名与桌面 db.ts:22 的 `rain.data.db` 同名（线 A 的插件会用同一个 databases 目录）。
  assert.match(read('src/main/worker/dbService/db.ts'), /path\.join\(rainDataPath, 'rain\.data\.db'\)/)
  assert.equal(javaConstant(dbJava, 'DATABASE_NAME'), 'rain.data.db')

  // 用框架自带的 android.database.sqlite（**零新增 gradle 依赖**，任务书要求）。
  assert.match(dbJava, /import android\.database\.sqlite\.SQLiteOpenHelper;/)
  assert.match(dbJava, /extends SQLiteOpenHelper/)
  // ⚠️ 去掉注释与字符串再查：类注释里**必须**能点名"契约给的方案是 @capacitor-community/sqlite"
  // （否则读代码的人不知道这条落点为什么与契约的建议不同），那是说明，不是依赖。
  assert.ok(
    !stripJavaStrings(stripJavaComments(dbJava)).includes('@capacitor-community/sqlite'),
    '本刀不引入任何 SQLite 插件依赖（只允许在注释里提到契约的建议方案）',
  )

  // 表名常量与 tables.ts 一致。
  assert.equal(javaConstant(dbJava, 'TABLE_MY_LIST'), 'my_list')
})

// ---------------------------------------------------------------------------
// 返回值的形状：position 剥掉 / .0 修掉 / null 不删键
// ---------------------------------------------------------------------------

test('返回值里没有 position（桌面 getAllUserList 把它剥掉），但 SQL 里必须有它（排序用）', () => {
  // 桌面的两处依据。
  assert.match(listIndexTs, /const \{ position, \.\.\.newList \} = list/, '桌面确实把 position 剥掉了')
  assert.match(read('src/common/types/list.d.ts'), /interface UserListInfo \{[\s\S]{0,300}?locationUpdateTime: number \| null/)

  // Java：SQL 里查了 position，但**没有任何一句把它放进 JSON**。
  // ⚠️ 不能用 "代码里不出现 \"position\"" 来断言：SQL 那条 SELECT 里本来就必须有它
  // （逐字对齐 statements.ts），所以这里只盯"有没有人把它 put 进返回值"。
  assert.match(listJava, /"position"/, 'SQL 必须包含 position（逐字对齐 statements.ts + 排序）')
  assert.ok(!/put\(\s*(COLUMN_POSITION|"position")/.test(listCode), '不许把 position 放进返回值')
  // 也不许为它建列下标常量（那说明有人打算把它读出来）。
  assert.ok(!/COLUMN_POSITION\s*=/.test(listCode), 'position 只参与 ORDER BY，不需要列下标')
})

test('sourceListId 末尾的 .0 必须修掉（桌面 queryAllUserList 的兼容逻辑，逐条对齐）', () => {
  // 桌面依据（引用没写错文件）。
  assert.match(dbHelperTs, /info\.sourceListId\.replace\(idFixRxp, ''\)/)
  assert.match(dbHelperTs, /const idFixRxp = \/\\\.0\$\//)

  // Java 的等价实现。
  assert.match(listCode, /endsWith\("\.0"\)/, 'Java 必须做同样的 .0 修复')
  assert.match(listCode, /stripLegacyNumericIdSuffix\(cursor\.getString\(sourceListIdIndex\)\)/)
})

test('可空列写出 JSON null，而不是把键删掉（org.json 的 put(name, null) 会删键）', () => {
  assert.match(listCode, /private static Object jsonValue\(Object value\)/)
  assert.match(listCode, /return value == null \? JSONObject\.NULL : value/)
  assert.match(listCode, /jsonValue\(cursor\.getString\(sourceIndex\)\)/)
  assert.match(listCode, /item\.put\(COLUMN_LOCATION_UPDATE_TIME, JSONObject\.NULL\)/)
  // locationUpdateTime 是 number | null：NULL 走 JSONObject.NULL，非 NULL 走 getLong。
  assert.match(listCode, /cursor\.isNull\(locationUpdateTimeIndex\)/)
  assert.match(listCode, /cursor\.getLong\(locationUpdateTimeIndex\)/)
})

// ---------------------------------------------------------------------------
// 不假装成功 / 并发形状
// ---------------------------------------------------------------------------

test('库打不开 / 表缺失 / 查询失败 ⇒ 抛出（ok:false），代码里没有"返回空数组"的退路', () => {
  // 三条失败路径都在，而且都在**抛**（这里只断言"抛在哪一段"，不去碰转义引号 ——
  // 表存在性检查那句 SQL 用 javaStringLiteral 读**值**来比对，见下一个断言）。
  assert.match(dbCode, /throw new IllegalStateException\(\s*"打不开数据库 " \+ path/)
  assert.match(dbCode, /里没有表/, '表缺失必须点名（并被当成失败）')
  assert.match(dbCode, /这不是本应用建的库/, '表缺失的消息必须说清"这库不是我们建的/已损坏"')
  assert.match(listCode, /throw new IllegalStateException\(\s*"读 \\"\" \+ RainMusicDatabase\.TABLE_MY_LIST/)

  // 关键：**没有**任何 catch 之后返回空数组/空列表的写法（那会把"库坏了"伪装成"用户没有歌单"）。
  assert.ok(!/catch[\s\S]{0,300}?return new JSONArray\(\)/.test(listCode), '不许吞异常返回空数组')
  assert.ok(!/catch[\s\S]{0,300}?return new JSONArray\(\)/.test(dbCode), '不许吞异常返回空数组')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(listCode), '不许空 catch')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(dbCode), '不许空 catch')
  // 抛错那一段必须是 catch 里的第一条出路（而不是"先 return 空数组、再 throw"）。
  assert.match(listCode, /catch \(Exception ex\) \{\s*throw new IllegalStateException\(/)

  // 表存在性检查用的是只读查询（读**值**比对），且游标在 finally 里关。
  assert.equal(
    javaStringLiteral(dbJava, 'SQL_TABLE_EXISTS'),
    'SELECT "name" FROM "main".sqlite_master WHERE "type"=\'table\' AND "name"=?',
  )
  assert.match(dbCode, /if \(cursor != null\) cursor\.close\(\)/)

  // 只读通道不自己造锁（唯一那把共享锁属于 SharedPreferences 写入，见 RainMusicStoreLock）。
  assert.ok(!listCode.includes('new Object()'), '读通道不该自己造锁')
  assert.ok(!dbCode.includes('new Object()'), '数据库层不该引入第二把锁对象')
  assert.match(lockJava, /static final Object WRITE_LOCK = new Object\(\)/)
})

test('并发形状：进程级单例 helper + 懒建只锁一次 + 查询路径上没有 synchronized', () => {
  // 单例（同一份库只能有一个 SQLiteOpenHelper / 一条缓存连接）。
  assert.match(dbCode, /private static volatile Helper helper = null/)
  assert.match(dbCode, /private static synchronized Helper helper\(Context context\)/)
  assert.match(dbCode, /if \(helper == null\) \{/)

  // `synchronized` 只出现在那一处（懒建）；查询路径（readLists / rawQuery）上不许有。
  assert.equal((dbCode.match(/synchronized/g) ?? []).length, 1, 'DB 层只应有一处 synchronized（懒建 helper）')
  assert.equal((listCode.match(/synchronized/g) ?? []).length, 0, '只读通道不需要 synchronized')

  // 连接不关（桌面同样把连接留到进程退出），文档里有依据。
  assert.ok(!/\.close\(\)\s*;?\s*\/\/\s*db/.test(dbCode))
  assert.match(dbJava, /db\.ts:72-73|进程退出|process\.on\('exit'\)/)

  // 游标在 finally 里关（两条路径都不漏）。
  assert.match(listCode, /finally \{\s*if \(cursor != null\) cursor\.close\(\);/)

  // 建表自己开事务（不依赖 SQLiteOpenHelper 是否包了事务），并走 setTransactionSuccessful/endTransaction。
  assert.match(dbCode, /db\.beginTransaction\(\)/)
  assert.match(dbCode, /db\.setTransactionSuccessful\(\)/)
  assert.match(dbCode, /db\.endTransaction\(\)/)

  // 迁移策略：onUpgrade 抛错（不静默沿用旧结构、也不删库重建）。
  assert.match(dbCode, /public void onUpgrade\(SQLiteDatabase db, int oldVersion, int newVersion\)/)
  assert.match(dbCode, /throw new SQLiteException\(/)
})

test('本通道不广播：不注册 player_list_data_overwire，渲染层的订阅保持原样（JS 零改动）', () => {
  // 契约把它记成双向，但本刀只做读：写方向（整表覆盖）是下一刀，广播方向没有生产者。
  assert.ok(
    contractMd.includes('| `player_list_data_overwire` | 双向：`overwriteUserLists` `R:listManage:149`；监听 `R:listManage:228` | 接收 `M:list:9`；发送 `M:listSend:7` |'),
    '契约 :106 那一行变了 → data_overwire 的范围判断要重新核对',
  )
  assert.match(desktopWinEventTs, /sendEvent<Rain\.List\.ListActionDataOverwrite>\(PLAYER_EVENT_NAME\.list_data_overwire, listData\)/)

  // 渲染层那一侧的订阅**本来就在**，且不需要改（桥是通道无关的）。
  assert.match(rendererListManageTs, /rendererOn\(PLAYER_EVENT_NAME\.list_data_overwire, list_data_overwrite\)/)

  // JS 侧零改动：桥里不出现通道名（那意味着有人加了白名单），取值点的兜底也还在。
  // ⚠️ 去掉 JS 注释再查：桥的文件头**注释**里就有一个信封示例（`"channel": "player_list_get"`）。
  const bridge = stripJsComments(read(BRIDGE_MODULE))
  assert.ok(!bridge.includes('player_list_get'), '桥里不该出现通道名（桥是通道无关的）')
  assert.match(
    useDataInitTs,
    /invokeSkippable\(async\(\) => getUserLists\(\), PLAYER_EVENT_NAME\.list_get, 'A'/,
    'player_list_get 的取值点必须仍然走 invokeSkippable（失败 ⇒ 跳过，而不是塞一个 []）',
  )
  // 失败的可见面：一条点名通道名的 console.error（"空"与"坏"因此是两种表现）。
  assert.match(read('src/renderer/platform/ipcFallback/subscribe.ts'), /reportChannelSkipped\(channel, grade/)
  assert.match(useDataInitTs, /if \(userListInfos\) window\.rainData\.userLists = userListInfos/)
})

// ---------------------------------------------------------------------------
// JS 侧接线检查：桥 + "按 Java 语义实现"的原生替身
// ---------------------------------------------------------------------------

/**
 * 原生侧替身，语义与 `RainMusicListChannels` / `RainMusicDatabase` 对齐
 * （每条旁边写清它抄的是 Java 的哪一段）：
 *
 * - **成功**：resolve 一个数组，元素形状 = `Rain.List.UserListInfo`
 *   （`position` 剥掉、`sourceListId` 的 `.0` 修掉、可空列是 JSON `null`）；
 * - **失败**（库打不开 / 表缺失 / 查询失败）：`ok:false` —— **绝不** resolve 成 `[]`；
 * - **未注册**：invoke 立刻 `IPC_CHANNEL_UNSUPPORTED`（本刀没有注册 data_overwire），
 *   send 只 warn（P0-1 的 `runHandler` 对 `!expectsResponse` 只写 logcat）；
 * - **参数**：Java 侧不校验（桌面不读参数）⇒ 替身也不校验。
 */
const makeNativeList = (options = {}) => {
  /** 库的内容 / 故障。`failure` ∈ null | 'unopenable' | 'missing-table' | 'query-failed'。 */
  const state = { rows: options.rows ?? [], failure: options.failure ?? null }

  /** 一行 DB 记录 → 一行返回值（Java `readLists()` 的映射）。 */
  const mapRow = row => {
    const sourceListId = typeof row.sourceListId === 'string' && row.sourceListId.endsWith('.0')
      ? row.sourceListId.slice(0, -2) // Java: stripLegacyNumericIdSuffix()
      : (row.sourceListId ?? null)
    return {
      // ⚠️ 注意这里**没有 position**（Java 不把它放进 JSON；桌面 getAllUserList 也剥掉它）。
      id: row.id ?? null,
      name: row.name ?? null,
      source: row.source ?? null,
      sourceListId,
      locationUpdateTime: row.locationUpdateTime ?? null,
    }
  }

  const native = {
    postCalls: [],
    /** 原生 → 渲染层的**全部**消息条数（一次 invoke 应当**正好** 1 条：那条应答；多出来的就是广播）。 */
    notifies: 0,
    unregisteredSends: [],

    post(envelope) {
      native.postCalls.push(envelope)
      const kind = envelope.kind
      if (kind !== 'invoke' && kind !== 'send') return Promise.resolve({ accepted: true })

      const { id, channel } = envelope
      // P0-1：send 是单向的 ⇒ 只有 invoke 才把结果/错误回给渲染层。
      const accept = payload => {
        if (kind !== 'invoke') return
        native.notify({ id, kind: 'response', channel, ok: true, result: payload })
      }
      const reject = (code, message) => {
        if (kind !== 'invoke') return
        native.notify({ id, kind: 'response', channel, ok: false, error: { code, message } })
      }

      if (channel !== EXPECTED_CHANNEL) {
        // 未注册（本刀只有 player_list_get）：invoke 立刻 IPC_CHANNEL_UNSUPPORTED；send 只 warn。
        native.unregisteredSends.push(channel)
        reject('IPC_CHANNEL_UNSUPPORTED', '原生侧还没有注册通道：' + channel)
        return Promise.resolve({ accepted: true })
      }

      // Java `listGet()`：参数一律忽略（桌面那一支不读参数）。
      switch (state.failure) {
        case 'unopenable':
          // Java RainMusicDatabase.open()：`throw new IllegalStateException("打不开数据库 " + path + …)`
          reject('IPC_HANDLER_FAILED', '打不开数据库 /data/data/com.rainmusic.mobile/databases/rain.data.db：file is not a database')
          return Promise.resolve({ accepted: true })
        case 'missing-table':
          // Java RainMusicDatabase.requireTable()：`… 里没有表 "my_list" …`
          reject('IPC_HANDLER_FAILED', '数据库 /data/data/com.rainmusic.mobile/databases/rain.data.db 里没有表 "my_list"')
          return Promise.resolve({ accepted: true })
        case 'query-failed':
          // Java RainMusicListChannels.readLists()：`throw new IllegalStateException("读 \"my_list\" 失败（…）")`
          reject('IPC_HANDLER_FAILED', '读 "my_list" 失败（SELECT …）：no such column: nope')
          return Promise.resolve({ accepted: true })
        default:
          // Java：没有任何歌单时我就是空数组 —— 这才是"空"的正确取值（与桌面首启同形）。
          accept(state.rows.map(mapRow))
          return Promise.resolve({ accepted: true })
      }
    },

    addListener(eventName, listener) {
      if (eventName === 'ipcMessage') native.listener = listener
      return { remove: () => { native.listener = null } }
    },

    notify(payload) {
      native.notifies++
      if (native.listener) native.listener(payload)
    },
  }
  return native
}

const setup = options => {
  const native = makeNativeList(options)
  const mod = load(BRIDGE_MODULE, {}, {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native, timeoutMs: 15000 },
  })
  return { mod, native }
}

test('成功：invoke(player_list_get) ⇒ args=[]，resolve 成一个"没有 position"的数组（映射与 Java 逐条同形）', async() => {
  const { mod, native } = setup({
    rows: [
      { id: 'list-1', name: '我喜欢的', source: 'tx', sourceListId: '123.0', position: 0, locationUpdateTime: 1700000000000 },
      { id: 'list-2', name: '空歌单', source: null, sourceListId: null, position: 1, locationUpdateTime: null },
    ],
  })

  const lists = await mod.bridge.invoke(EXPECTED_CHANNEL)

  // 信封：invoke，且**没有参数**（契约 :101 那一格就是"无"）。
  assert.equal(native.postCalls.length, 1)
  assert.equal(native.postCalls[0].channel, EXPECTED_CHANNEL)
  assert.equal(native.postCalls[0].kind, 'invoke')
  assert.equal(JSON.stringify(native.postCalls[0].args), JSON.stringify([]))

  // 返回值：position 剥掉、.0 修掉、null 是 null。
  assert.equal(JSON.stringify(lists), JSON.stringify([
    { id: 'list-1', name: '我喜欢的', source: 'tx', sourceListId: '123', locationUpdateTime: 1700000000000 },
    { id: 'list-2', name: '空歌单', source: null, sourceListId: null, locationUpdateTime: null },
  ]))
  for (const list of lists) assert.ok(!Object.hasOwn(list, 'position'), 'position 不该出现在返回值里')

  // 对照的源码断言（替身与 Java 一旦漂移，这些断言还在）。
  assert.match(listCode, /stripLegacyNumericIdSuffix\(cursor\.getString\(sourceListIdIndex\)\)/)
  assert.ok(!/put\(\s*COLUMN_POSITION/.test(listCode))
})

test('空库：resolve 成 []，**不是** reject（"用户确实没有自建歌单"与"库/桥坏了"必须分开）', async() => {
  const { mod } = setup({ rows: [] })
  const lists = await mod.bridge.invoke(EXPECTED_CHANNEL)
  assert.equal(JSON.stringify(lists), JSON.stringify([]))
})

test('库打不开：reject ok:false，**绝不** resolve 成 [] 假装"用户歌单空了"', async() => {
  const { mod } = setup({ failure: 'unopenable' })

  const error = await mod.bridge.invoke(EXPECTED_CHANNEL).then(
    () => { throw new Error('不应该 resolve：库坏了必须 reject，否则"坏了"会被伪装成"空的"') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /打不开数据库/)
  assert.equal(error.channel, EXPECTED_CHANNEL)
  // 对照的源码断言：Java 里确实是抛，而不是给一个空数组。
  assert.match(dbCode, /throw new IllegalStateException\(\s*"打不开数据库 " \+ path/)
})

test('表缺失：reject（点名 my_list），**不**当成"空库"返回 []', async() => {
  const { mod } = setup({ failure: 'missing-table' })

  const error = await mod.bridge.invoke(EXPECTED_CHANNEL).then(
    () => { throw new Error('不应该 resolve：表缺失必须 reject') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /没有表 "my_list"/)
  assert.match(dbCode, /没有表/)
})

test('查询失败（结构漂移等）：reject，消息里带原始原因', async() => {
  const { mod } = setup({ failure: 'query-failed' })

  const error = await mod.bridge.invoke(EXPECTED_CHANNEL).then(
    () => { throw new Error('不应该 resolve：查询失败必须 reject') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /读 "my_list" 失败/)
  // 对照的源码断言：catch 里第一条出路就是抛（不是"先给个空数组"）。
  assert.match(listCode, /catch \(Exception ex\) \{\s*throw new IllegalStateException\(/)
  assert.ok(!/return new JSONArray\(\)/.test(listCode.replace('JSONArray lists = new JSONArray()', '')))
})

test('data_overwire 本刀没有注册：invoke 它拿到 IPC_CHANNEL_UNSUPPORTED（大声失败），且全程零广播', async() => {
  const { mod, native } = setup({ rows: [] })

  // 渲染层的订阅（rendererListManage.ts:228）照常建立 —— 桥是通道无关的，不需要改 JS。
  const events = []
  mod.bridge.on(EXPECTED_OVERWIRE_CHANNEL, payload => events.push(payload))

  // 但本刀没有生产者：一次正常读取只会带来**那一条应答**，一条广播都没有。
  await mod.bridge.invoke(EXPECTED_CHANNEL)
  assert.deepEqual(events, [], '读通道不广播')
  assert.equal(native.notifies, 1, '一次 invoke 只应收到一条应答（多出来的就是广播）')

  // 真去 invoke 覆盖通道：立刻 IPC_CHANNEL_UNSUPPORTED（而不是"静默成功/静默失败"）。
  const error = await mod.bridge.invoke(EXPECTED_OVERWIRE_CHANNEL, { defaultList: [], userList: [] }).then(
    () => { throw new Error('不应该 resolve：写侧通道本刀没做，必须大声失败') },
    err => err,
  )
  assert.equal(error.code, 'IPC_CHANNEL_UNSUPPORTED')
  assert.deepEqual(native.unregisteredSends, [EXPECTED_OVERWIRE_CHANNEL])
})
