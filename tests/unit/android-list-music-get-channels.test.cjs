/**
 * Android 移植 · **P0-2 第六刀 + 第七刀-A + 第七刀-B（`player_list_music_get`）**
 * 的契约 / 接线 / 落点 / 范围回归网。
 *
 * ⚠️ 第六刀那一版是**纯读**；第七刀-A 把 `default` 分支上的"去重合并 + 单事务写回 + 失败冒泡"
 * 补在**同一个通道文件**里；第七刀-B 再补上那个事务的**第一步**：**条件**插入一份"合并前身份快照"
 * （`db_info.playback_queue_startup_restore`，对齐 `dbHelper.ts:337-339`）。所以本文件里第 9 / 10 两条
 * （写守卫、"只做那一半"）被改写成**五条写语句**与"哪一半做了、哪一半仍不做"。行为层面的证据
 * （真 JVM + 手写假 SQLite 跑这两刀的控制流，含快照的时序 / 条件 / 回滚）在
 * `tests/unit/android-playback-queue-merge.test.cjs` 里，本文件只做源码形状 / 落点 / 接线 / 范围。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**没有在 Android 上跑过任何东西**，也**没有真的开过 SQLite** —— 所以它**不能**证明这条通道
 * 在真机上不再是 `IPC_CHANNEL_UNSUPPORTED`、不能证明 `LEFT JOIN my_list_music_info_order` 的实际行序、
 * 不能证明 `new JSONObject(meta)` 在 Android 的 org.json 上与 `JSON.parse` 行为一致。
 * 那几件事只能由 CI 的 `gradlew assembleDebug`（编译）→ 真机运行（行为）来证明。
 *
 * 它比前几刀的用例多做了一件事：用 `javac` + 一组**手写替身**（`android.*` / `org.json` /
 * `com.getcapacitor.Logger` / 一个 `RainMusicIpcPlugin` 替身）把本刀新增的
 * `RainMusicListMusicGetChannels.java` + `RainMusicPlaybackQueueKey.java` + `RainMusicLogThrottle.java`
 * 连同**没改过的** `RainMusicDatabase.java` / `RainMusicIpcHandlers.java` 编过一遍（exit 0）。
 * 那是**语法 / 类型自洽**的证据，**不是**编译验证：替身的签名是人手写的，与真实框架 API 一旦
 * 不一致，那次 javac 不会发现（所以替身里刻意**不**声明 AOSP 没有的方法，例如 `JSONArray.size()`）。
 * 本机没有 javac 时这一条跳过。
 *
 * 它守的是一组**本机可测、且一旦写错在真机上完全静默（或表现为"这个歌单是空的"）**的错误：
 *
 * 1. **通道名字面量 == `ipcNames.ts` 生成的真实通道名**（`player_list_music_get`）；
 * 2. **形状 == 契约 `ipc-contract.md:107`**：参数是**裸字符串** `listId`（不是 `{listId}`），
 *    返回 `Rain.Music.MusicInfo[]`；渲染层 `rendererListManage.ts:73` 与主进程
 *    `rendererEvent.ts:24` 两头逐字对应；
 * 3. **SQL 逐字对齐 `statements.ts:68-78`**（`createMusicInfoQueryStatement`），唯一的差异是
 *    `@listId` → `?`（出现两次，绑定顺序也被钉住），且**没有** `DISTINCT` / `LIMIT` / rowid 兜底；
 * 4. **表 / 列名对齐 `tables.ts`**：`my_list_music_info` 与 `my_list_music_info_order` 都在，
 *    SQL 里出现的每一列都在对应表的 DDL 里；
 * 5. **`meta` 必须解析成对象**（桌面那一句是 `JSON.parse`），不许把 TEXT 原样回传；
 * 6. **返回值形状**：六键 `id/name/singer/source/interval/meta`，**没有** `listId`、**没有** `order`；
 * 7. **参数语义**：缺参数 ⇒ 抛错；类型不对 ⇒ 抛错；`null` ⇒ 不查库直接 `[]`；
 * 8. **不假装成功**：库打不开 / 表缺失 / 查询失败 / meta 坏 ⇒ 抛错，代码里没有
 *    "catch 之后返回空数组"的退路；游标在 `finally` 里关；
 * 9. **写守卫**：写只发生在 `default` 的那一个分支里（`overwriteDefaultQueue`）—— 五条写语句
 *    （快照 INSERT + DELETE ×2 + INSERT ×2）与 `statements.ts` / `dbHelper.ts` 逐字一致、
 *    整段在**同一个事务**里；非 `default` 的调用**一条写语句都不发**（普通歌单 / temp 永不合并）；
 * 10. **第七刀-A + 第七刀-B 做了哪一半**：`dedupePlaybackQueue` + 单事务写回 +
 *    "返回去重后的列表" + **同事务、在两条 DELETE 之前条件插入的 `db_info` 合并前快照**
 *    （键名/列名逐字对齐桌面与 `tables.ts`）**已经做了**；
 *    `resolvePlaybackQueueRestoreIndex` / `completePlaybackQueueRestore` **仍然一个都没有**
 *    （Android 侧没有消费者；桌面那半条链必须能在源码里被指出来），
 *    而且**没有**照抄 `queueStartupRestorePending`（条件由"库里有没有快照"推导）；
 * 11. **范围守卫**：本刀只注册**这 1 条**通道；第五刀的文件仍然只有 2 条、第四刀仍然只有 1 条
 *     （老文件冻结，一行都没改）；
 * 12. **注册真的被调用**：`RainMusicIpcPlugin.load()` 里调 `RainMusicListMusicGetChannels.register(this)`，
 *     匹配前**必须去掉注释**（前几刀都被这个坑抓过）；`MainActivity` 仍先 `registerPlugin` 再 `super.onCreate()`。
 *
 * 另外一组（最后一组）用 JS 侧的桥 + 一个**按 Java 语义实现**的原生替身，锁住
 * "空 ⇒ `[]`、坏 ⇒ reject" 这条链在 JS 侧的可观察行为与信封形状（`args=[listId]`）。
 * 它是接线检查，**不是** Java 行为验证。
 *
 * 去重键（NFKC / JS 的 trim / `Locale.ROOT`）与节流闸门的**真 JVM 差分**在
 * `tests/unit/android-playback-queue-key.test.cjs` 里（那个文件会用真的 `javac` + `java` 跑）。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const load = require('./load-ts.cjs')
const assertCheckedJsonSignatures = require('./json-checked-exception-probe.cjs')

const ROOT = path.join(__dirname, '../..')
const BRIDGE_MODULE = 'src/common/platform/ipcBridge/capacitor.js'

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readJava = relative => read(path.join('android/app/src/main/java/com/rainmusic/mobile', relative))

const getJava = readJava('ipc/RainMusicListMusicGetChannels.java')
const keyJava = readJava('ipc/RainMusicPlaybackQueueKey.java')
const throttleJava = readJava('ipc/RainMusicLogThrottle.java')
const musicJava = readJava('ipc/RainMusicListMusicChannels.java')
const listJava = readJava('ipc/RainMusicListChannels.java')
const dbJava = readJava('ipc/RainMusicDatabase.java')
const handlersJava = readJava('ipc/RainMusicIpcHandlers.java')
const pluginJava = readJava('ipc/RainMusicIpcPlugin.java')
const activityJava = readJava('MainActivity.java')
const dataJava = readJava('ipc/RainMusicDataChannels.java')
const settingJava = readJava('ipc/RainMusicAppSettingChannels.java')

const tablesTs = read('src/main/worker/dbService/tables.ts')
const statementsTs = read('src/main/worker/dbService/modules/list/statements.ts')
const listIndexTs = read('src/main/worker/dbService/modules/list/index.ts')
const dbHelperTs = read('src/main/worker/dbService/modules/list/dbHelper.ts')
const desktopEventTs = read('src/main/modules/commonRenderers/list/rendererEvent.ts')
const rendererListManageTs = read('src/renderer/store/list/listManage/rendererListManage.ts')
const listManageActionTs = read('src/renderer/store/list/listManage/action.ts')
const contractMd = read('docs/android/ipc-contract.md')

/** 去掉注释再匹配（前几刀都踩过这个坑：注释里就写着那行代码，用整份源码匹配会放过"被注释掉"）。 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
/** 再去掉字符串字面量（只用于"这段代码里有没有某个执行面"这类判断）。 */
const stripJavaStrings = source => source.replace(/"(?:\\.|[^"\\])*"/g, '""')
const stripJsComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const javaConstant = (source, name) => {
  const match = source.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]*)"`))
  assert.ok(match, `Java 里找不到常量 ${name}（读法：static final String ${name} = "…"）`)
  return match[1]
}

const javaTextBlock = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`))
  assert.ok(match, `Java 里找不到文本块 ${name}（读法：static final String ${name} = """…"""）`)
  return match[1]
}

/** 与桌面 `verifyDB.ts:4` 的那条正则逐字相同（`/\n|\s|;|--.+/g`）。 */
const normalizeSql = sql => sql.replace(/\n|\s|;|--.+/g, '')
/** better-sqlite3 的具名参数 → Android 的位置参数（逐个按出现顺序替换，锁住参数先后）。 */
const toPositionalSql = sql => sql.replace(/@\w+/g, '?')

const getCode = stripJavaComments(getJava)
const getCodeNoStrings = stripJavaStrings(getCode)
const dbCode = stripJavaComments(dbJava)

const { PLAYER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})
/** 桌面那把 `dedupePlaybackQueue` —— 下面那个原生替身与期望值都用它（与 Java 侧同源）。 */
const { dedupePlaybackQueue } = load('src/common/utils/playbackQueue.ts', {}, {})

const CHANNEL = PLAYER_EVENT_NAME.list_music_get
const TABLE_MUSIC_INFO = 'my_list_music_info'
const TABLE_MUSIC_INFO_ORDER = 'my_list_music_info_order'

/** `tables.ts` 的注册表：`[键名, DDL]`，顺序 = 文件里的注册顺序。 */
const tableEntries = [...tablesTs.matchAll(/tables\.set\('([^']+)',\s*`([\s\S]*?)`\)/g)]
  .map(match => [match[1], match[2]])
const tableDdl = name => {
  const entry = tableEntries.find(([key]) => key === name)
  assert.ok(entry, `tables.ts 里没有 ${name}？`)
  return entry[1]
}
const ddlColumns = ddl => [...ddl.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)/g)].map(match => match[1])

/** `statements.ts:68-78` 的 `createMusicInfoQueryStatement` 原文。 */
const statementsGetSql = statementsTs.match(
  /createMusicInfoQueryStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.MusicInfoQuery\]>\(`([\s\S]*?)`\)/,
)[1]

// ---------------------------------------------------------------------------
// 形状：通道名 / invoke / 参数 / 返回类型
// ---------------------------------------------------------------------------

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED）', () => {
  assert.equal(CHANNEL, 'player_list_music_get', 'ipcNames.ts 的真实值变了？')
  assert.equal(javaConstant(getJava, 'CHANNEL_MUSIC_GET'), CHANNEL)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量却忘了 register 的话，真机上依然是"未注册"。
  // ⚠️ 必须去掉注释再匹配。
  assert.match(getCode, /register\(\s*CHANNEL_MUSIC_GET\s*,/)
  assert.ok(!getCode.includes('RainMusicIpcHandlers.register("'), '注册必须走常量')

  // 与第五刀那两条不是同一个名字（三条通道必须互不相同）。
  assert.notEqual(CHANNEL, PLAYER_EVENT_NAME.list_music_check_exist)
  assert.notEqual(CHANNEL, PLAYER_EVENT_NAME.list_music_get_list_ids)
})

test('形状 == 契约 :107：mainHandle（invoke），参数是裸字符串 listId，返回 MusicInfo[]', () => {
  // 契约那一行逐字钉住（改了契约就该回来看这条用例）。
  assert.ok(
    contractMd.includes('| `player_list_music_get` | `getListMusics` `R:listManage:73` | `M:list:24` | `listId: string` → `Rain.Music.MusicInfo[]` | 读歌单内歌曲 |'),
    '契约 :107 那一行变了 → 本通道的形状必须重新核对',
  )
  // 契约 :481 把这条记在「列表与 DB」16 条里（本刀只做其中的这一条）。
  assert.ok(
    contractMd.includes('| 列表与 DB | `player_list_get`、`player_list_add`、`player_list_remove`'),
    '契约 :481 的分组行变了 → 本刀的"同族"范围要重新核对',
  )

  // 主进程 handler：mainHandle ⇒ 渲染层是 rendererInvoke（请求/应答），不是 send、不是广播。
  assert.match(
    desktopEventTs,
    /mainHandle<string, Rain\.Music\.MusicInfo\[\]>\(PLAYER_EVENT_NAME\.list_music_get, async\(\{ params: listId \}\)/,
  )
  assert.ok(
    !/mainOn<[^>]*>\(PLAYER_EVENT_NAME\.list_music_get/.test(desktopEventTs),
    '契约是 mainHandle（invoke）',
  )

  // 渲染层封装：rendererInvoke(channel, listId) —— **裸字符串**，不是对象。
  assert.match(
    rendererListManageTs,
    /rendererInvoke<string, Rain\.Music\.MusicInfo\[\]>\(PLAYER_EVENT_NAME\.list_music_get, listId\)/,
    'getListMusics 必须是 rendererInvoke(channel, listId)（:73）',
  )
  assert.ok(
    !/rendererSend\w*\(\s*PLAYER_EVENT_NAME\.list_music_get/.test(rendererListManageTs),
    '读通道不能走 send / sendSync（Capacitor 上没有同步 IPC）',
  )
  // 渲染层自己会在 listId 为空时短路（所以真机上 `null` 到不了原生侧 —— 但原生侧照样要处理它）。
  assert.match(rendererListManageTs, /export const getListMusics = async\(listId: string \| null\): Promise<Rain\.Music\.MusicInfo\[\]> => \{\s*if \(!listId\) return \[\]/)

  // Java：参数的读法必须是"裸字符串"，且参数校验发生在打开数据库**之前**。
  assert.match(getCode, /String listId = readBareString\(args, CHANNEL_MUSIC_GET\)/)
  assert.ok(
    getCode.indexOf('readBareString(args, CHANNEL_MUSIC_GET)') < getCode.indexOf('RainMusicDatabase.open('),
    '参数必须在打开数据库之前校验',
  )
  assert.match(getCode, /return new JSONArray\(\);/)
})

test('JS 侧零改动：桥是通道无关的，渲染层与主进程的两头都原样保留', () => {
  // 桥里不出现这条通道名（那意味着有人加了白名单）。⚠️ 去掉 JS 注释再查。
  const bridge = stripJsComments(read(BRIDGE_MODULE))
  assert.ok(!bridge.includes(CHANNEL), '桥里不该出现通道名（桥是通道无关的）')

  assert.match(desktopEventTs, /return global\.rain\.worker\.dbService\.getListMusics\(listId\)/)
  // 渲染层的调用点与"读缓存"分支都在（本刀不碰 JS）。
  assert.match(rendererListManageTs, /if \(allMusicList\.has\(listId\)\) return allMusicList\.get\(listId\)!/)
  assert.match(rendererListManageTs, /return setMusicList\(listId, list\)/)
  // ㊙️ 写回失败时渲染层**不缓存**：setMusicList 在 await **之后** ⇒ reject 会让它根本不被调用
  // （所以下一次 invoke 必然重新查库；如果 Java 侧吞掉写回错误、返回去重后的列表，这里就会缓存一份
  // 库里并不存在的列表，缓存与库永久分叉）。
  assert.match(
    rendererListManageTs,
    /const list = await rendererInvoke<string, Rain\.Music\.MusicInfo\[\]>\(PLAYER_EVENT_NAME\.list_music_get, listId\)\s*\n\s*return setMusicList\(listId, list\)/,
    'setMusicList 必须在 await 之后（reject 时不被调用 ⇒ 那条 invoke 的结果不会被缓存）',
  )
  // 渲染层读 default 时自己也会去重（与 Java 侧的去重同源：src/common/utils/playbackQueue.ts）。
  assert.match(
    listManageActionTs,
    /if \(listId == LIST_IDS\.DEFAULT\) musicList = dedupePlaybackQueue\(musicList\)/,
    '渲染层的去重没了 ⇒ "界面所见与桌面一致"这条论证要重新核',
  )
})

// ---------------------------------------------------------------------------
// SQL 落点：语句逐字对齐 statements.ts，表 / 列对齐 tables.ts
// ---------------------------------------------------------------------------

test('SQL 逐字对齐 statements.ts:68-78（只把两处 @listId 换成 ?），LEFT JOIN 与 ORDER BY 一字不改', () => {
  // 先钉住桌面那一条（引用没写错文件）。
  assert.match(statementsTs, /createMusicInfoQueryStatement/)
  assert.match(statementsGetSql, /FROM my_list_music_info mInfo/)
  assert.match(statementsGetSql, /LEFT JOIN my_list_music_info_order O/)
  assert.match(statementsGetSql, /ON mInfo\.id=O\.musicInfoId AND O\.listId=@listId/)
  assert.match(statementsGetSql, /WHERE mInfo\.listId=@listId/)
  assert.match(statementsGetSql, /ORDER BY O\."order" ASC/)

  assert.equal(
    normalizeSql(javaTextBlock(getJava, 'SQL_MUSIC_BY_LIST_ID')),
    normalizeSql(toPositionalSql(statementsGetSql)),
    'Java 的 SQL 必须与 statements.ts 的 createMusicInfoQueryStatement 逐字一致（列清单 / 表名 / JOIN / ORDER BY）',
  )
  // 具名参数恰好两处 ⇒ 位置参数恰好两个（少一个/多一个绑定就错位）。
  assert.equal((statementsGetSql.match(/@listId/g) ?? []).length, 2)
  assert.equal((javaTextBlock(getJava, 'SQL_MUSIC_BY_LIST_ID').match(/\?/g) ?? []).length, 2)
  // 绑定顺序 = SQL 里 ? 出现的顺序；两处是**同一个值**（桌面两处都是 @listId）。
  assert.match(getCode, /new String\[\] \{ listId, listId \}/, '两处 ? 都要绑 listId')
})

test('没有偷偷加 DISTINCT / LIMIT / rowid 兜底；ORDER BY 是本条通道语义的一部分', () => {
  const sql = javaTextBlock(getJava, 'SQL_MUSIC_BY_LIST_ID')
  assert.ok(!/DISTINCT/i.test(sql), '桌面不去重（去重在 JS 层，且只在 default 上做）')
  assert.ok(!/LIMIT/i.test(sql), '桌面不截断')
  assert.ok(!/rowid/i.test(sql), 'rowid 兜底会改变"哪一条存活"与整体行序（抄列表通道那套会改语义）')
  assert.match(sql, /ORDER BY O\."order" ASC/, '这一句不许省：没有它，去重留下的"第一条"就不是桌面的那一条')
  // 桌面那条语句里也没有这些东西（对照）。
  assert.ok(!/DISTINCT|LIMIT|rowid/i.test(statementsGetSql))
})

test('表与列对齐 tables.ts：两张表都在，SQL 里出现的每一列都能在对应的 DDL 里找到', () => {
  const infoColumns = ddlColumns(tableDdl(TABLE_MUSIC_INFO))
  assert.deepEqual(infoColumns, ['id', 'listId', 'name', 'singer', 'source', 'interval', 'meta'])
  const orderColumns = ddlColumns(tableDdl(TABLE_MUSIC_INFO_ORDER))
  assert.deepEqual(orderColumns, ['listId', 'musicInfoId', 'order'], 'my_list_music_info_order 的列变了')

  // Java 侧的表名常量（order 表是本文件自己的常量：RainMusicDatabase 里没有它的名字，见类注释）。
  assert.equal(javaConstant(getJava, 'TABLE_MY_LIST_MUSIC_INFO_ORDER'), TABLE_MUSIC_INFO_ORDER)
  assert.match(dbCode, /static final String TABLE_MY_LIST_MUSIC_INFO = "my_list_music_info"/)

  const sql = javaTextBlock(getJava, 'SQL_MUSIC_BY_LIST_ID')
  // 列清单：只看 SELECT 与 FROM 之间那段（FROM 后面的表名也会被 "(\w+)" 命中）。
  const selectList = sql.match(/SELECT([\s\S]*?)FROM/)[1]
  const selected = [...selectList.matchAll(/"(\w+)"/g)].map(match => match[1])
  assert.deepEqual(selected, ['id', 'name', 'singer', 'source', 'interval', 'meta'],
    '列清单必须与 statements.ts 逐字一致，而且**不含** listId（桌面那条也没选它）')
  for (const column of selected) {
    assert.ok(infoColumns.includes(column), `SQL 用了 ${TABLE_MUSIC_INFO} 里不存在的列 "${column}"`)
  }
  // JOIN 用到的两列必须在 order 表的 DDL 里（写错一个列名，真机上 JOIN 直接失败）。
  assert.match(sql, /ON mInfo\.id=O\.musicInfoId AND O\.listId=\?/)
  for (const column of ['musicInfoId', 'listId', 'order']) {
    assert.ok(orderColumns.includes(column), `${TABLE_MUSIC_INFO_ORDER} 里没有 "${column}"`)
  }
  // open() 点名要读的表（第五刀引入的那个重载）。
  assert.match(getCode, /RainMusicDatabase\.open\(context, RainMusicDatabase\.TABLE_MY_LIST_MUSIC_INFO\)/)
})

// ---------------------------------------------------------------------------
// meta：必须是对象，不是 TEXT
// ---------------------------------------------------------------------------

test('meta 必须解析成 JSON 对象（桌面那一句是 JSON.parse），不许把 TEXT 原样回传', () => {
  // 桌面：modules/list/index.ts:192 的 `meta: JSON.parse(info.meta)`。
  assert.match(listIndexTs, /meta: JSON\.parse\(info\.meta\)/)
  // Java：走 new JSONObject(text)（与 RainMusicDataChannels / RainMusicAppSettingChannels 同款）。
  assert.match(getCode, /private static Object parseMeta\(String musicId, String text\)/)
  assert.match(getCode, /return new JSONObject\(text\);/)
  // 每一行都解析（含即将被删掉的重复行）⇒ 行模型持有的是**对象**，组装 JSON 与写回都从它出发。
  assert.match(getCode, /parseMeta\(id, cursor\.getString\(metaIndex\)\)/)
  assert.match(getCode, /item\.put\(COLUMN_META, meta\);/)
  // 绝不许"原样回传"（那是 TEXT，渲染层拿到的是字符串）。
  assert.ok(!/item\.put\(COLUMN_META, jsonValue\(/.test(getCode), 'meta 不许走 jsonValue（那是给可空字符串列的）')
  assert.ok(!/item\.put\(COLUMN_META, cursor\.getString\(metaIndex\)\)/.test(getCode), 'meta 不许原样回传')
  // 写回时 meta 走的就是那个对象重新序列化出来的文本（桌面是 JSON.stringify(info.meta)）。
  assert.match(getCode, /String metaText\(\) \{\s*return String\.valueOf\(meta\);/)

  // NULL 列：与桌面 JSON.parse(null) ⇒ null 逐字等价（NOT NULL 列被写坏时的行为）。
  assert.match(getCode, /if \(text == null\) \{[\s\S]{0,900}?return JSONObject\.NULL;/)
  // 坏 meta：抛错（不跳过这一行、也不当成成功读）。
  assert.match(getCode, /catch \(JSONException ex\) \{\s*throw new IllegalStateException\(/)


  // meta 在表结构里是 NOT NULL（所以 NULL 那一支只可能是被人写坏）。
  assert.match(tableDdl(TABLE_MUSIC_INFO), /"meta" TEXT NOT NULL/)
})

// ---------------------------------------------------------------------------
// 返回值形状
// ---------------------------------------------------------------------------

test('一行 = 六个键 id/name/singer/source/interval/meta（没有 listId、没有 order）', () => {
  // 桌面那张 map 刚好六行（modules/list/index.ts:185-194）。
  const desktopMap = listIndexTs.slice(
    listIndexTs.indexOf('targetList = (await queryMusicInfoByListId(listId)).map(info => {'),
    listIndexTs.indexOf('if (listId == LIST_IDS.DEFAULT) {'),
  )
  for (const key of ['id: info.id', 'name: info.name', 'singer: info.singer', 'source: info.source', 'interval: info.interval', 'meta: JSON.parse(info.meta)']) {
    assert.ok(desktopMap.includes(key), `桌面那张 map 少了 ${key}`)
  }
  assert.ok(!desktopMap.includes('listId:'), '桌面没有把 listId 放进返回值（SQL 也没选它）')

  // Java：六个 put，且键名走常量、与 SQL 的列名一致（两个键名都不许出现）。
  // ⚠️ 只看 `toJson()`（返回给渲染层那一行）：第七刀-B 的 `toSnapshotJson()` 也 put 三个键，
  // 但它不属于"返回值"这件东西（它只有 id/name/singer，见下面单独的一条）。
  const toJsonBody = getCode.slice(getCode.indexOf('JSONObject toJson() throws JSONException'), getCode.indexOf('JSONObject toSnapshotJson()'))
  const puts = [...toJsonBody.matchAll(/item\.put\((COLUMN_[A-Z_]+), /g)].map(match => match[1])
  assert.deepEqual(puts, [
    'COLUMN_ID', 'COLUMN_NAME', 'COLUMN_SINGER', 'COLUMN_SOURCE', 'COLUMN_INTERVAL', 'COLUMN_META',
  ])
  // 第七刀-B 的快照元素：**只有** id / name / singer 三个键（顺序也一样，对齐 index.ts:198 那个 map）。
  const snapshotBody = getCode.slice(getCode.indexOf('JSONObject toSnapshotJson() throws JSONException'), getCode.indexOf('String metaText()'))
  assert.deepEqual(
    [...snapshotBody.matchAll(/item\.put\((COLUMN_[A-Z_]+), /g)].map(match => match[1]),
    ['COLUMN_ID', 'COLUMN_NAME', 'COLUMN_SINGER'],
    '快照里每个元素只有 id / name / singer（source / interval / meta 不进快照）',
  )
  for (const [constant, value] of [
    ['COLUMN_ID', 'id'], ['COLUMN_NAME', 'name'], ['COLUMN_SINGER', 'singer'],
    ['COLUMN_SOURCE', 'source'], ['COLUMN_INTERVAL', 'interval'], ['COLUMN_META', 'meta'],
  ]) {
    assert.equal(javaConstant(getJava, constant), value)
  }
  // interval 是 string | null ⇒ NULL 走 jsonValue（不然 org.json 的 put(name, null) 会**删键**）。
  assert.match(getCode, /item\.put\(COLUMN_INTERVAL, jsonValue\(interval\)\)/)
  // 写回时 interval 原样传给绑定数组（NULL ⇒ SQL NULL）。
  assert.match(getCode, /return new Object\[\] \{ id, listId, name, singer, source, interval, metaText\(\) \};/)
  assert.match(getCode, /private static Object jsonValue\(Object value\)/)
  assert.match(getCode, /return value == null \? JSONObject\.NULL : value/)
  assert.match(read('src/common/types/music.d.ts'), /interval: string \| null/)
  assert.match(read('src/common/types/music.d.ts'), /meta: MusicInfoMetaBase/)
})

test('返回的顺序就是 SQL 结果顺序（Java 侧不重排；只有 default 那条写回会**删**重复行）', () => {
  // 组装 JSON 是"按读到的顺序逐行 put"，中间没有任何排序 / 分组。
  assert.match(getCode, /while \(cursor\.moveToNext\(\)\) \{/)
  assert.match(getCode, /for \(MusicInfoRow row : rows\) \{\s*if \(dropped != null && dropped\.contains\(row\.keyRow\)\) continue;\s*array\.put\(row\.toJson\(\)\);/)
  assert.ok(!/new TreeSet|new HashSet|Collections\.sort|Arrays\.sort/.test(getCode), '不许在 Java 侧重排 / 分组')
  // ⚠️ 去重判定是另一回事：default 上要算一次，而它**只删**（保留第一条）、不排序。
  assert.match(getCode, /RainMusicPlaybackQueueKey\.findDuplicates\(keyRows\)/)


  // 桌面的 dedupe 也是 filter（保序），两边同形。
  assert.match(read('src/common/utils/playbackQueue.ts'), /return musics\.filter\(music => \{/)
})

// ---------------------------------------------------------------------------
// 参数语义
// ---------------------------------------------------------------------------

test('参数形状：裸字符串；缺参数 / 类型不对 ⇒ 抛错；null ⇒ 不查库直接 []', () => {
  assert.match(getCode, /private static String readBareString\(List<Object> args, String channel\)/)
  assert.match(getCode, /Object first = args\.get\(0\);/)
  assert.match(getCode, /if \(first == JSONObject\.NULL\) return null;/)
  assert.match(getCode, /if \(!\(first instanceof String\)\)/)
  assert.match(getCode, /参数必须是字符串，收到 /)
  assert.match(getCode, /if \(listId == null\) \{/)
  assert.ok(
    getCode.indexOf('if (listId == null)') < getCode.indexOf('RainMusicDatabase.open('),
    'null 短路必须发生在打开数据库之前',
  )
  // 短路**不是**参数错误（那会制造一处桌面没有的失败）：桌面把 null 绑成 SQL NULL ⇒ 查不到。
  const nullBlock = getCode.slice(getCode.indexOf('if (listId == null)'), getCode.indexOf('RainMusicDatabase.open('))
  assert.ok(!/throw /.test(nullBlock), 'null 不该被当成参数错误')
  assert.match(nullBlock, /return new JSONArray\(\);/)
  // 桌面那一支（rendererEvent.ts:24）在缺参数时拿到 undefined，better-sqlite3 绑不上 ⇒ 本来就抛。
  assert.match(desktopEventTs, /async\(\{ params: listId \}\)/)
})

// ---------------------------------------------------------------------------
// 写守卫 / 范围 / 不假装成功
// ---------------------------------------------------------------------------

test('写守卫：写只在 default 的那一个分支里（overwriteDefaultQueue），且五条写语句各只出现一次', () => {
  // 写入口只有五个 SQL 常量 + 五次 execSQL 调用点；它们必须**全部**落在 overwriteDefaultQueue 里。
  const writeMethod = getCode.slice(
    getCode.indexOf('private static void overwriteDefaultQueue('),
    getCode.indexOf('private static String writeBackFailureMessage('),
  )
  assert.ok(writeMethod.length > 0, '找不到 overwriteDefaultQueue')
  // ⚠️ 允许 `execSQL(` 与语句常量之间有空白（快照那一句参数较长，Java 侧换行了）。
  const execSqlCalls = [...getCode.matchAll(/db\.execSQL\(\s*([A-Z_]+)/g)].map(match => match[1])
  assert.deepEqual(execSqlCalls, [
    'SQL_INSERT_QUEUE_RESTORE_SNAPSHOT',
    'SQL_DELETE_MUSIC_INFO_BY_LIST_ID',
    'SQL_DELETE_MUSIC_ORDER_BY_LIST_ID',
    'SQL_INSERT_MUSIC_INFO',
    'SQL_INSERT_MUSIC_ORDER',
  ], '写语句只有这五条（第七刀-B 加了快照那条），且顺序 = dbHelper.ts:337-349')
  assert.equal(
    (writeMethod.match(/db\.execSQL\(/g) ?? []).length, 5,
    '五条 execSQL 必须都在这一个方法里（读路径上一条写语句都不许有）',
  )
  // 除了这个方法，别处不许出现 execSQL / compileStatement（"读通道顺手写库"是这一刀唯一的写面）。
  const outside = getCode.replace(writeMethod, '')
  assert.ok(!outside.includes('execSQL'), 'overwriteDefaultQueue 之外不许有 execSQL')
  assert.ok(!getCode.includes('compileStatement'), '不用编译语句（与既有几刀同一形状）')
  assert.ok(!getCode.includes('rawQueryWithFactory'), '不自己开查询工厂')

  // 事务：三段式，且只有一处（整段写回是**一个**事务）。
  assert.equal((getCode.match(/db\.beginTransaction\(\)/g) ?? []).length, 1)
  assert.equal((getCode.match(/db\.setTransactionSuccessful\(\)/g) ?? []).length, 1)
  assert.equal((getCode.match(/db\.endTransaction\(\)/g) ?? []).length, 1)
  assert.match(writeMethod, /db\.beginTransaction\(\);[\s\S]*?finally \{[\s\S]*?db\.endTransaction\(\);/,
    'endTransaction 必须在 finally 里（异常路径也要结束事务，否则连接一直被占着）')
  assert.match(writeMethod, /db\.setTransactionSuccessful\(\);\s*commitStarted = true;/)

  // ⚠️ 第七刀-B：快照那一句必须在 `beginTransaction()` **之后**（同一事务）、两条 DELETE **之前**
  // （它记的是**合并前**的身份；放到 DELETE 之后记的就是合并后的了）。
  assert.ok(
    writeMethod.indexOf('db.beginTransaction();') < writeMethod.indexOf('SQL_INSERT_QUEUE_RESTORE_SNAPSHOT'),
    '快照必须在 beginTransaction() 之后发出（同一事务）',
  )
  assert.ok(
    writeMethod.indexOf('SQL_INSERT_QUEUE_RESTORE_SNAPSHOT') < writeMethod.indexOf('SQL_DELETE_MUSIC_INFO_BY_LIST_ID'),
    '快照必须在两条 DELETE **之前**',
  )
  assert.match(writeMethod, /if \(queueStartupRestorePending && !hasQueueRestoreSnapshot\(db\)\) \{[\s\S]{0,200}?SQL_INSERT_QUEUE_RESTORE_SNAPSHOT/,
    '"仅在 db_info 里还没有快照时"这个条件必须真的写在那一句外面')

  // 触发条件：default + 去重真删掉了元素；没有重复时**一条写语句都不发**。
  assert.match(getCode, /if \(!LIST_ID_DEFAULT\.equals\(listId\)\) \{\s*return readListMusics\(context, listId, false\);/)
  assert.match(getCode, /List<RainMusicPlaybackQueueKey\.MusicRow> duplicates =\s*RainMusicPlaybackQueueKey\.findDuplicates\(keyRows\);/)
  assert.match(getCode, /if \(!duplicates\.isEmpty\(\)\) \{/)
  assert.match(getCode, /if \(dropped == null\) \{[\s\S]{0,200}?return musics;/)

  // 唯一的数据库入口是 RainMusicDatabase（不另开库、不 new Helper）。
  assert.ok(!getCode.includes('SQLiteOpenHelper'), '不许另开 helper')
  assert.ok(!getCode.includes('getSharedPreferences'), '这不走 SharedPreferences')
  // 不广播任何东西：这条通道没有"变更通知"这种出口。
  assert.ok(!getCode.includes('emit'), '这条通道不广播')
  // 游标在 finally 里关（两条路径都不漏）：读歌单那条 + 快照存在性检查那条（第七刀-B 的第二个游标）。
  assert.equal((getCode.match(/finally \{\s*if \(cursor != null\) cursor\.close\(\);/g) ?? []).length, 2,
    '两个游标（读行、查快照在不在）都要在 finally 里关')
  // 进程级连接不关、也不碰 DB 层的私有单例。
  assert.ok(!getCode.includes('RainMusicDatabase.helper'))
  assert.ok(!/RainMusicDatabase[\s\S]{0,80}?\.close\(\)/.test(getCode), '不许关掉进程级连接')
})

test('默认队列快照在同事务内条件插入，DATA消费者持久确认后结束启动恢复', () => {
  // 桌面的写回：dedupePlaybackQueue → overwriteMusicInfo（含 db_info 快照 + 删 + 插、同一个事务）。
  assert.match(listIndexTs, /export const getListMusics = async\(listId: string\): Promise<Rain\.Music\.MusicInfo\[\]>/)
  assert.match(listIndexTs, /const merged = dedupePlaybackQueue\(targetList\)/)
  assert.match(listIndexTs, /if \(merged\.length != targetList\.length\) \{/)
  assert.match(listIndexTs, /const restoreSnapshot = queueStartupRestorePending \? targetList\.map\(\(\{ id, name, singer \}\) => \(\{ id, name, singer \}\)\) : undefined/)
  assert.match(listIndexTs, /await overwriteMusicInfo\(listId, toDBMusicInfo\(merged, listId\), restoreSnapshot\)/)
  assert.match(dbHelperTs, /export const overwriteMusicInfo = async\(listId: string, musicInfos: Rain\.DBService\.MusicInfo\[\], startupRestoreSnapshot\?: QueueRestoreRecord\[\]\)/)
  assert.match(dbHelperTs, /INSERT INTO db_info \(field_name, field_value\) VALUES \(\?, \?\)/)
  assert.match(dbHelperTs, /QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'/)
  // 桌面那三步（本刀做的）就在同一个事务里。
  assert.match(dbHelperTs, /await musicInfoDeleteByListIdStatement\.run\(listId\)/)
  assert.match(dbHelperTs, /await musicInfoOrderDeleteByListIdStatement\.run\(listId\)/)
  assert.match(dbHelperTs, /await db\.transaction\(/)
  assert.match(listIndexTs, /let queueStartupRestorePending = true/)
  assert.match(listIndexTs, /export const resolvePlaybackQueueRestoreIndex/)
  assert.match(listIndexTs, /export const completePlaybackQueueRestore/)

  // ⚠️ 而且桌面的去重**只会**发生在 default 上（普通歌单 / temp 永不写回）。
  assert.match(listIndexTs, /if \(listId == LIST_IDS\.DEFAULT\) \{/)
  const constantsTs = read('src/common/constants.ts')
  assert.match(constantsTs, /DEFAULT: 'default'/)

  // Java 侧：**第七刀-B 已经把快照那一半补上了**（第七刀-A 时这里是一条"一个都没有"的守卫）。
  // 快照的三件东西必须在：键名常量、存在性查询、快照 INSERT，而且**列名/表名逐字对齐 tables.ts**。
  assert.equal(
    javaConstant(getJava, 'QUEUE_RESTORE_SNAPSHOT_KEY'),
    dbHelperTs.match(/QUEUE_RESTORE_SNAPSHOT_KEY = '([^']*)'/)[1],
    '快照的 field_name 必须与桌面逐字一致（跨 worker 的持久数据）',
  )
  // 表名走 RainMusicDatabase 的常量（不新加字符串字面量），列名写死在 SQL 文本里（同库 SQL_INSERT_SCHEMA_VERSION 的做法）。
  assert.match(getCode, /RainMusicDatabase\.TABLE_DB_INFO/)
  const dbInfoDdl = tablesTs.match(/tables\.set\('db_info',\s*`([\s\S]*?)`\)/)[1]
  assert.deepEqual(
    [...dbInfoDdl.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)/g)].map(match => match[1]),
    ['id', 'field_name', 'field_value'],
    'tables.ts:120-127 的 db_info 列清单变了 → 快照那两句要重新核',
  )
  for (const [name, expected] of [
    ['SQL_SELECT_QUEUE_RESTORE_SNAPSHOT', ['field_value', 'main', 'db_info', 'field_name']],
    ['SQL_INSERT_QUEUE_RESTORE_SNAPSHOT', ['main', 'db_info', 'field_name', 'field_value']],
  ]) {
    assert.deepEqual(
      [...javaTextBlock(getJava, name).matchAll(/"(\w+)"/g)].map(match => match[1]),
      expected,
      `${name} 的表/列名必须逐字对齐 tables.ts:120-127（**不许**新加列，也不许碰自增主键 id）`,
    )
  }
  // 桌面那两句（出处）逐字钉住（改了桌面就该回来看这两句）。
  assert.match(dbHelperTs, /SELECT field_value FROM db_info WHERE field_name = \?/)
  assert.match(dbHelperTs, /INSERT INTO db_info \(field_name, field_value\) VALUES \(\?, \?\)/)

  // Native DATA restoration consumes snapshots; the getter only owns startup pending state.
  assert.match(getCode, /private static boolean queueStartupRestorePending = true;/)
  assert.match(getCode, /static void finishStartupRestore\(\) \{ queueStartupRestorePending = false; \}/)
  assert.match(stripJavaComments(dataJava), /RainMusicPlaybackQueueRestore\.resolve\(/)
  assert.match(stripJavaComments(dataJava), /RainMusicPlaybackQueueRestore\.complete\(/)

  // 模块级缓存也没有：每次读都真的查库（桌面会先查 musicLists 缓存）。
  for (const forbidden of ['musicLists', 'userLists', 'rawPoss']) {
    assert.ok(!getCode.includes(forbidden), `不许照抄桌面那套模块级缓存（${forbidden}）`)
  }
  // "不动缓存"本身是一处有意的语义差别，注释里必须写明。

})

test('范围守卫：本刀只注册 1 条；第五刀的文件仍然只有 2 条、第四刀仍然只有 1 条（老文件冻结）', () => {
  assert.equal((getCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []).length, 1, '本文件只应注册 1 条通道')
  assert.deepEqual(
    [...getCode.matchAll(/String\s+(CHANNEL_[A-Z_]+)\s*=/g)].map(match => match[1]),
    ['CHANNEL_MUSIC_GET'],
  )
  // 通道名字面量只允许出现这一个。
  assert.deepEqual([...new Set([...getCode.matchAll(/"(player_[a-z_]+)"/g)].map(match => match[1]))],
    ['player_list_music_get'])
  // 同族的写通道一条都不许出现。
  for (const written of ['player_list_music_add', 'player_list_music_move', 'player_list_music_remove', 'player_list_music_update', 'player_list_music_overwrite', 'player_list_music_clear']) {
    assert.ok(!getJava.includes(written), `写通道 ${written} 不属于本刀`)
  }

  // 第五刀的文件**一行都没改**：仍然 2 条注册、2 个 CHANNEL_* 常量，且没有 player_list_music_get 字面量
  // （它自己的用例里就有这条范围守卫 —— 本刀把实现放在**新文件**里，所以那条守卫依然成立、不用改它）。
  const musicCode = stripJavaComments(musicJava)
  assert.equal((musicCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []).length, 2, '第五刀那个文件不该被本刀改动')
  assert.deepEqual(
    [...musicCode.matchAll(/String\s+(CHANNEL_[A-Z_]+)\s*=/g)].map(match => match[1]),
    ['CHANNEL_CHECK_EXIST', 'CHANNEL_GET_LIST_IDS'],
  )
  assert.ok(!musicJava.includes('player_list_music_get"'), '第五刀那个文件里仍不该有这条通道')
  // ⚠️ 但第五刀的**用例**里有一条"invoke player_list_music_get ⇒ IPC_CHANNEL_UNSUPPORTED"——
  // 那是它文件内自己那个**替身**的行为（替身只注册它那 2 条），不是对原生侧的断言；
  // 第六刀实现的是原生侧（另一个文件），所以那条用例仍然自洽。本刀**不动**它。
  assert.ok(read('tests/unit/android-list-music-channels.test.cjs').includes('invoke 它拿到 IPC_CHANNEL_UNSUPPORTED'))

  // 第四刀 / 第一到三刀的文件也都没被本刀改动（合计 1 + 2 + 2）。
  assert.equal((stripJavaComments(listJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []).length, 1)
  assert.equal((stripJavaComments(settingJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []).length, 2)
  assert.equal((stripJavaComments(dataJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []).length, 2)
  // P0-1 的插件里仍然没有"就地实现"（实现都在各自的通道文件里）。
  assert.doesNotMatch(stripJavaComments(pluginJava), /RainMusicIpcHandlers\.register\(/)
})

test('注册必须发生在 RainMusicIpcPlugin.load() 里；MainActivity 仍先 registerPlugin 再 super.onCreate()', () => {
  // ⚠️ 必须去掉注释再匹配（把那一行注释掉之后，用整份源码匹配的用例**依然通过**）。
  const pluginCode = stripJavaComments(pluginJava)
  assert.match(
    pluginCode,
    /RainMusicListMusicGetChannels\.register\(this\)/,
    'load() 里必须注册，否则真机 IPC_CHANNEL_UNSUPPORTED（注释掉不算）',
  )
  // 前面几刀的注册也都还在（本刀没把它们挤掉）。
  for (const other of ['RainMusicListMusicChannels.register(this)', 'RainMusicListChannels.register(this)', 'RainMusicDataChannels.register(this)', 'RainMusicAppSettingChannels.register(this)']) {
    assert.ok(pluginCode.includes(other), `${other} 不见了（本刀不该动它）`)
  }
  // register 必须在 load() 里、且在"已注册通道数"那条日志之前。
  const loadIndex = pluginCode.indexOf('public void load()')
  const registerIndex = pluginCode.indexOf('RainMusicListMusicGetChannels.register(this)')
  assert.ok(loadIndex > -1 && registerIndex > loadIndex, '注册必须在 load() 内')
  assert.ok(registerIndex < pluginCode.indexOf('IPC 传输桥已加载'), '注册要在 load() 的收尾日志之前')

  // 只看代码、不看注释（注释里就写着这句话）。
  const activityCode = stripJavaComments(activityJava)
  const registerPlugin = activityCode.indexOf('registerPlugin(RainMusicIpcPlugin.class)')
  const superOnCreate = activityCode.indexOf('super.onCreate(')
  assert.ok(registerPlugin > -1 && superOnCreate > -1, 'MainActivity 的注册点/父类调用不见了')
  assert.ok(registerPlugin < superOnCreate, 'registerPlugin 必须在 super.onCreate() 之前')
})

test('不假装成功：库打不开 / 表缺失 / 查询失败 / **写回失败**都抛错，代码里没有"返回空数组 / 返回去重后的列表"的退路', () => {
  // 库打不开：消息与第四 / 第五刀逐字一致（同一个入口）。
  assert.match(dbCode, /throw new IllegalStateException\(\s*"打不开数据库 " \+ path/)
  assert.match(dbCode, /里没有表/)
  assert.match(dbCode, /这不是本应用建的库/)
  // 三个 catch，第一条出路都是 throw（不是"先给个空数组"）。
  assert.match(getCode, /catch \(Exception ex\) \{\s*throw new IllegalStateException\(/)
  assert.match(getCode, /catch \(IllegalStateException ex\) \{\s*throw ex;/)
  assert.ok(!/catch[\s\S]{0,300}?return new JSONArray\(\)/.test(getCode), '不许吞异常返回空数组')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(getCode), '不许空 catch')
  assert.ok(!/catch[\s\S]{0,400}?return merged;/.test(getCode), '不许吞掉写回错误却返回去重后的列表（缓存与库会永久分叉）')
  // 失败消息里必须点名表名 + 那句"不假装"。
  assert.match(getCode, /private static String readFailureMessage\(String sql, Exception ex\)/)
  assert.match(getJava, /不会\*\*返回空数组假装「这个歌单是空的」/)
  // 被吞掉的只有"已经点过名的 meta 错误"（rethrow），别的都包上表名与 SQL。
  assert.equal((getCode.match(/catch \(/g) ?? []).length, 4,
    'readBareString 之外应有四个 catch：读的两个（rethrow meta 错 / 包成读失败）、写回的一个、parseMeta 的一个')
  // 写回失败有**自己**的消息（不许被 readFailureMessage 包成"读失败"，那正是第六刀当时的顾虑）。
  assert.match(getCode, /private static String writeBackFailureMessage\(/)
  assert.match(getCode, /writeBackFailureMessage\(\s*listId, readCount, kept\.size\(\), duplicateCount, snapshotInserted, commitStarted, ex\s*\)/)
  for (const phrase of ['读到 ', ' 行成功', '写回失败', '已回滚', '库仍是写回前的 ', '行**']) {
    assert.ok(getJava.includes(phrase), `写回失败的消息里必须点名「${phrase}」`)
  }
  // 第七刀-B：消息还必须如实点名"快照那一句在不在回滚集合里"（两种分支各有一句）。
  assert.match(getJava, /快照 INSERT/)
  assert.match(getJava, /本次\*\*没有\*\*发出快照 INSERT/)
  assert.match(getJava, /db_info 里也不会留下半份快照/)
  assert.match(getJava, /提交阶段/)

})

// ---------------------------------------------------------------------------
// 合并日志（判定细节见 android-playback-queue-key.test.cjs；行为见 android-playback-queue-merge.test.cjs）
// ---------------------------------------------------------------------------

test('合并警告：只在 default 上判、节流、说的是"已去重写回"（那条"只读不写回"的临时 warn 必须没了）', () => {
  assert.equal(javaConstant(getJava, 'LIST_ID_DEFAULT'), 'default')
  // 判定用的是与 JS 逐字节相同的那份键（不是就地又写一套）。
  assert.match(getCode, /RainMusicPlaybackQueueKey\.findDuplicates\(keyRows\)/)
  assert.match(getCode, /new RainMusicPlaybackQueueKey\.MusicRow\(id, name, singer\)/)
  // 节流：一个合并警告的闸门 + 分开的一个（meta NULL）。
  assert.match(getCode, /private static final RainMusicLogThrottle QUEUE_MERGED_WARN =\s*new RainMusicLogThrottle\(QUEUE_MERGED_WARN_WINDOW_MS\)/)
  assert.match(getCode, /QUEUE_MERGED_WARN\.shouldLog\(signature, System\.currentTimeMillis\(\)\)/)
  assert.match(getCode, /private static final long QUEUE_MERGED_WARN_WINDOW_MS = 60_000L/)
  assert.match(getCode, /private static final RainMusicLogThrottle META_NULL_WARN =/)
  // 签名包含"行数 / 重复数 / 前几条重复的键" ⇒ 队列变了会立刻再报。
  assert.match(getCode, /signature = queueMergedSignature\(listId, readCount, duplicates\)/)
  assert.match(getCode, /builder\.append\(listId\)\.append\('\|'\)\.append\(total\)\.append\('\|'\)\.append\(duplicates\.size\(\)\)/)
  // 是 warn（不是 debug），说话的内容必须是"已经写回"，而不是"库还是脏的"。
  assert.match(getCode, /Logger\.warn\(\s*TAG,/)
  assert.match(getJava, /默认播放队列/)
  assert.match(getJava, /已按桌面的规则去重/)
  assert.match(getJava, /在\*\*同一个事务\*\*里写回/)
  // 日志说明启动期间条件插入快照，完成后仍继续修复重复数据。
  assert.match(getJava, /四步对齐 src\/main\/worker\/dbService\/modules\/list\/dbHelper\.ts:337-349/)
  assert.match(getJava, /只在 db_info 里还没有它时插一份/)
  assert.match(getJava, /Preferences 持久确认后删除快照/)


  // 那条临时警告（说 Android 只读、库还是脏的）必须已经不在 —— 留着它就说谎。
  // ⚠️ 类注释里**故意**引用了它一次（讲"它被替换掉了"），所以这里只看**注释之外**的字符串字面量。
  const stringLiterals = [...getCode.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match => match[1])
  for (const stale of ['只读、不写回', '写回**未做**', '检出重复时只打一条节流警告']) {
    assert.ok(!stringLiterals.some(text => text.includes(stale)), `运行期的日志里不许再有"${stale}"（它会说谎）`)
  }
  assert.ok(!getCodeNoStrings.includes('只读、不写回'), '那段临时警告的实现/消息不许还在')

  assert.match(getJava, /本条警告节流/)

  // 调用点在写回**成功之后**（失败会抛出去，不该先报一条"已写回"）。
  const mergeCall = getCode.indexOf('warnQueueMerged(listId, rows.size(), kept.size(), dropped);')
  const writeCall = getCode.indexOf('overwriteDefaultQueue(db, listId, kept, rows.size(), duplicateCount, restoreSnapshotText);')
  assert.ok(writeCall > -1 && mergeCall > writeCall, '警告必须在写回成功之后')
  assert.match(getCode, /return merged;/)
  // 只有两处 warn：meta 为 NULL、合并成功。
  assert.equal((getCode.match(/Logger\.warn\(/g) ?? []).length, 2, '两处 warn：meta 为 NULL、合并成功')
})

test('并发：default 去重使用列表共用写锁（从 SELECT 之前开始），非 default 读不进锁', () => {
  // 保留本文件的锁别名，共用 monitor 还覆盖歌曲新增和歌单删除。
  assert.equal((getCode.match(/synchronized/g) ?? []).length, 1, '这条通道只该有一处 synchronized')
  assert.match(getCode, /private static final Object DEFAULT_QUEUE_MERGE_LOCK = RainMusicListWriteLock\.LOCK;/)
  assert.match(getCode, /synchronized \(DEFAULT_QUEUE_MERGE_LOCK\) \{\s*return readListMusics\(context, listId, true\);/)
  assert.ok(!getCode.includes('WRITE_LOCK'), '这条通道与第三刀那把 SharedPreferences 写锁无关（不许混用）')
  assert.ok(!getCode.includes('RainMusicStoreLock'), '不许引用 SharedPreferences 那把锁')
  // 临界区必须包含**读**（在 readListMusics 里 SELECT → 判重 → 删 → 插都在锁内），
  // 否则两次并发读会各自读到脏队列、各写一遍。
  assert.ok(
    getCode.indexOf('synchronized (DEFAULT_QUEUE_MERGE_LOCK)') < getCode.indexOf('db.rawQuery(SQL_MUSIC_BY_LIST_ID'),
    '锁必须在 SELECT 之前拿到（临界区含读，不只含写）',
  )
  // 非 default 走的是不进锁的纯读分支。
  const before = getCode.slice(0, getCode.indexOf('synchronized (DEFAULT_QUEUE_MERGE_LOCK)'))
  assert.match(before, /return readListMusics\(context, listId, false\);/)
  // 唯一的非 final 静态字段：没有（可变状态全在闸门对象里）。
  const mutableStatics = [...getCode.matchAll(/\bprivate static\s+(?!final\b)(?:volatile\s+)?([A-Za-z_][\w.<>[\]]*)\s+(\w+)\s*=/g)]
    .map(match => match[2])
  assert.deepEqual(mutableStatics, ['queueStartupRestorePending'], '唯一可变静态字段是本进程启动恢复标志')
  // 闸门自己是有锁的（两条线程同时读也不会把节流打穿）。
  assert.match(stripJavaComments(throttleJava), /synchronized boolean shouldLog\(String signature, long nowMs\)/)
  // 连接不关（桌面同样把连接留到进程退出）。
  assert.ok(!/RainMusicDatabase[\s\S]{0,80}?\.close\(\)/.test(getCode), '这条通道不许关掉进程级连接')
  // 关键键类不含 Android 类型 ⇒ 本机能用真 JVM 跑它（见另一个测试文件）。
  assert.ok(!/^import\s+(android|com\.getcapacitor|org\.json)\./m.test(keyJava), 'Key 类必须只依赖 JDK')
  assert.ok(!/^import\s+(android|com\.getcapacitor|org\.json)\./m.test(throttleJava), 'Throttle 类必须只依赖 JDK')
})

// ---------------------------------------------------------------------------
// 用 javac + 手写替身把新文件编过一遍（本机没有 Android SDK）
// ---------------------------------------------------------------------------

/**
 * 手写替身。**刻意按 AOSP 的真实签名写**，并且刻意**不**声明真实 API 里没有的方法
 * （例如 `JSONArray` 只有 `length()`、没有 `size()`）—— 这样"用错 API"在这里能变红。
 * ⚠️ 但它证明不了"签名与真实框架一致"：那是 CI 的 `gradlew assembleDebug` 的事。
 */
const STUBS = {
  'android/content/Context.java': `package android.content;

public abstract class Context {
    public abstract Context getApplicationContext();
    public abstract java.io.File getDatabasePath(String name);
}
`,
  'android/database/Cursor.java': `package android.database;

/** 照 AOSP：Cursor extends Closeable，但 close() 被重声明为**不抛** IOException。 */
public interface Cursor extends java.io.Closeable {
    boolean moveToFirst();
    boolean moveToNext();
    int getColumnIndexOrThrow(String columnName);
    String getString(int columnIndex);
    long getLong(int columnIndex);
    boolean isNull(int columnIndex);
    @Override
    void close();
}
`,
  'android/database/sqlite/SQLiteException.java': `package android.database.sqlite;

public class SQLiteException extends RuntimeException {
    public SQLiteException() {}
    public SQLiteException(String error) { super(error); }
    public SQLiteException(String error, Throwable cause) { super(error, cause); }
}
`,
  'android/database/sqlite/SQLiteDatabase.java': `package android.database.sqlite;

import android.database.Cursor;

public class SQLiteDatabase {
    public interface CursorFactory {}
    public Cursor rawQuery(String sql, String[] selectionArgs) { return null; }
    public void execSQL(String sql) {}
    public void execSQL(String sql, Object[] bindArgs) {}
    public void beginTransaction() {}
    public void setTransactionSuccessful() {}
    public void endTransaction() {}
    public void close() {}
}
`,
  'android/database/sqlite/SQLiteOpenHelper.java': `package android.database.sqlite;

import android.content.Context;

public abstract class SQLiteOpenHelper {
    public SQLiteOpenHelper(Context context, String name, SQLiteDatabase.CursorFactory factory, int version) {}
    public SQLiteDatabase getWritableDatabase() { return null; }
    public synchronized void close() {}
    public abstract void onCreate(SQLiteDatabase db);
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}
}
`,
  'com/getcapacitor/Logger.java': `package com.getcapacitor;

public class Logger {
    public static void verbose(String tag, String message) {}
    public static void debug(String tag, String message) {}
    public static void info(String tag, String message) {}
    public static void warn(String tag, String message) {}
    public static void error(String tag, String message, Throwable e) {}
}
`,
  'org/json/JSONException.java': `package org.json;

public class JSONException extends Exception {
    public JSONException(String message) { super(message); }
}
`,
  'org/json/JSONObject.java': `package org.json;

import java.util.Map;

/** 只声明本刀用到的成员；put(String, Object) 照 AOSP 声明为 throws JSONException。
 *  ⚠️ 第十一刀：签名逐字核对过真 org.json（javap -classpath android-json-0.0.20131108.vaadin1.jar
 *  org.json.JSONObject，以及 AOSP libcore main 的同名源码）；未声明的成员一律**不**声明 —— 少声明
 *  比"声明一个签名宽松的假方法"安全（生产代码用到时会当场编不过）。*/
public class JSONObject {
    public static final Object NULL = new Object();
    public JSONObject() {}
    public JSONObject(String source) throws JSONException {}
    public JSONObject(Map copyFrom) {}
    public JSONObject put(String name, Object value) throws JSONException { return this; }
    public boolean has(String name) { return false; }
    public Object opt(String name) { return null; }
}
`,
  'org/json/JSONArray.java': `package org.json;

/** 照 AOSP：只有 length()，**没有** size()。 */
public class JSONArray {
    public JSONArray() {}
    public JSONArray put(Object value) { return this; }
    public int length() { return 0; }
}
`,
  'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': `package com.rainmusic.mobile.ipc;

import android.content.Context;

/** 只是为了让通道文件能编过：本刀只用到 plugin.getContext()。 */
public class RainMusicIpcPlugin {
    public Context getContext() { return null; }
}
`,
}

const JAVAC_AVAILABLE = (() => {
  const result = spawnSync('javac', ['-version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()
const SKIP_REASON = JAVAC_AVAILABLE
  ? false
  : '本机没有可用的 javac（JDK）⇒ 这一条"用手写替身编过一遍"的用例无法执行'

test('JSON 替身负向验证：读通道的 put / 字符串构造器必须要求处理 JSONException', { skip: SKIP_REASON }, () => {
  assertCheckedJsonSignatures(STUBS, [
    ['UncheckedObjectPut', 'new JSONObject().put("name", (Object) "value")'],
    ['UncheckedObjectConstructor', 'new JSONObject("{}")'],
  ])
})

const temporaryDirs = []
after(() => {
  for (const dir of temporaryDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/** 跑一个外部进程，把 stdout/stderr 落到**文件**（受限沙箱下 Node 拿不到命名管道）。 */
const runToFile = (command, args, cwd, logFile) => {
  const fd = fs.openSync(logFile, 'w')
  let result
  try {
    result = spawnSync(command, args, { cwd, stdio: ['ignore', fd, fd] })
  } finally {
    fs.closeSync(fd)
  }
  return {
    status: result.status,
    error: result.error,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '',
  }
}

test('用 javac + 手写替身把本刀的文件（含没改过的 DB / 注册表）编过一遍（exit 0）', { skip: SKIP_REASON }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-android-get-'))
  temporaryDirs.push(dir)
  const stubRoot = path.join(dir, 'stub')
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  for (const [relative, source] of Object.entries(STUBS)) {
    const file = path.join(stubRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
  }

  const javaDir = path.join(ROOT, 'android/app/src/main/java/com/rainmusic/mobile/ipc')
  const sources = [
    path.join(javaDir, 'RainMusicListMusicGetChannels.java'),
    path.join(javaDir, 'RainMusicPlaybackQueueKey.java'),
    path.join(javaDir, 'RainMusicLogThrottle.java'),
    path.join(javaDir, 'RainMusicDatabase.java'),
    path.join(javaDir, 'RainMusicIpcHandlers.java'),
    path.join(javaDir, 'RainMusicListWriteLock.java'),
  ]
  // -sourcepath 指向替身目录：这样 javac 只会去那里找 RainMusicIpcPlugin（而不是仓库里那个真的，
  // 那个依赖整个 Capacitor SDK）。仓库里的 5 个真文件是**显式**列出来的，照样编。
  const compiled = runToFile(
    'javac',
    ['-encoding', 'UTF-8', '-sourcepath', stubRoot, '-d', outDir, ...sources],
    dir,
    path.join(dir, 'javac.log'),
  )
  assert.equal(compiled.status, 0, `javac 退出码 ${compiled.status}：\n${compiled.log}`)
  // 真的产出了 class（不是"什么都没编"）。
  const classes = fs.readdirSync(path.join(outDir, 'com/rainmusic/mobile/ipc'))
  for (const name of ['RainMusicListMusicGetChannels.class', 'RainMusicPlaybackQueueKey.class', 'RainMusicLogThrottle.class', 'RainMusicDatabase.class', 'RainMusicIpcHandlers.class']) {
    assert.ok(classes.includes(name), `没编出 ${name}（产出：${classes.join(', ')}）`)
  }
})

// ---------------------------------------------------------------------------
// JS 侧接线检查：桥 + "按 Java 语义实现"的原生替身
// ---------------------------------------------------------------------------

/**
 * 原生侧替身，语义与 `RainMusicListMusicGetChannels` 对齐（每条旁边写清抄的是 Java 的哪一段）：
 *
 * - 参数是**裸字符串** `listId`（Java `readBareString`）；缺参数 / 类型不对 ⇒ reject；
 *   `null` ⇒ 不查库直接 `[]`（Java 在 `open()` 之前短路）；
 * - 返回 `MusicInfo[]`（`meta` 是**对象**）；
 * - 库打不开 / 表缺失 / 查询失败 / meta 坏 ⇒ reject，**绝不** resolve 成 `[]`；
 * - **第七刀-A + 第七刀-B**：`listId === 'default'` 且**去重真删掉了元素**时（Java `findDuplicates` 非空），
 *   按桌面的 `dedupePlaybackQueue` 去重、把模型改成去重后的样子（等价于那次事务写回：**第一步**是
 *   "db_info 里还没有这份快照时插一份合并前的 (id,name,singer) 列表"，然后才是 DELETE ×2 + INSERT ×2N）
 *   并返回**去重后**的列表；写回失败（`options.writeFailure`）⇒ reject，消息同时点名"读到 N 行成功"与
 *   "写回失败"（**绝不** resolve 成去重后的列表 —— 那会让渲染层缓存一份库里并不存在的列表）；
 * - 非 `default` 一律原样返回（普通歌单 / temp 永不合并，也**不碰 db_info**）。
 */
const makeNativeListMusicGet = (options = {}) => {
  const state = {
    rows: (options.rows ?? []).map(row => ({ ...row })),
    failure: options.failure ?? null,
    writeFailure: options.writeFailure ?? false,
    merges: 0,
    // 这一组接线用例只关心"返回什么 / 抛不抛"，所以这里只记"快照写没写"，
    // 真正的快照形状由 android-playback-queue-merge.test.cjs 的假 SQLite 跑出来。
    snapshots: [],
  }
  const native = {
    state,
    postCalls: [],
    notifies: 0,
    unregisteredSends: [],
    post(envelope) {
      native.postCalls.push(envelope)
      const kind = envelope.kind
      if (kind !== 'invoke' && kind !== 'send') return Promise.resolve({ accepted: true })
      const { id, channel } = envelope
      const args = Array.isArray(envelope.args) ? envelope.args : []
      const accept = payload => { if (kind === 'invoke') native.notify({ id, kind: 'response', channel, ok: true, result: payload }) }
      const failed = message => { if (kind === 'invoke') native.notify({ id, kind: 'response', channel, ok: false, error: { code: 'IPC_HANDLER_FAILED', message } }) }

      if (channel !== CHANNEL) {
        native.unregisteredSends.push(channel)
        if (kind === 'invoke') native.notify({ id, kind: 'response', channel, ok: false, error: { code: 'IPC_CHANNEL_UNSUPPORTED', message: '原生侧还没有注册通道：' + channel } })
        return Promise.resolve({ accepted: true })
      }

      // Java `readBareString()`：缺参数抛错；显式 null 过桥后是 JSONObject.NULL ⇒ 短路成 []。
      if (args.length === 0 || args[0] === undefined) {
        failed(CHANNEL + ' 需要一个字符串参数 listId，收到 ' + JSON.stringify(args))
        return Promise.resolve({ accepted: true })
      }
      const listId = args[0]
      if (listId === null) { accept([]); return Promise.resolve({ accepted: true }) }
      if (typeof listId !== 'string') {
        failed(CHANNEL + ' 的参数必须是字符串，收到 ' + typeof listId)
        return Promise.resolve({ accepted: true })
      }
      // Java `RainMusicDatabase.open()` 的两条失败路径（在参数校验之后）。
      if (state.failure === 'unopenable') { failed('打不开数据库 /data/data/com.rainmusic.mobile/databases/rain.dataSQLite.db：file is not a database'); return Promise.resolve({ accepted: true }) }
      if (state.failure === 'missing-table') { failed('数据库 … 里没有表 "my_list_music_info"：这不是本应用建的库，或者它已经损坏。'); return Promise.resolve({ accepted: true }) }
      if (state.failure === 'query-failed') { failed('读 "my_list_music_info" 失败（SELECT … ORDER BY O."order" ASC）：no such table: my_list_music_info_order。'); return Promise.resolve({ accepted: true }) }
      if (state.failure === 'bad-meta') { failed(CHANNEL + '：music id="m-1" 的 "meta" 列不是合法的 JSON 对象'); return Promise.resolve({ accepted: true }) }

      // Java `readListMusics()` 的读：只有这个 listId 的行，顺序 = 传进来的顺序（= SQL 的结果顺序）。
      const readRows = state.rows.filter(row => row.listId === listId).map(({ listId: _listId, ...music }) => music)
      if (listId === 'default') {
        // Java：findDuplicates 非空才写回。
        const merged = dedupePlaybackQueue(readRows)
        if (merged.length !== readRows.length) {
          if (state.writeFailure) {
            failed(
              CHANNEL + '：默认播放队列的去重写回失败（"listId"="default"，落点 my_list_music_info / my_list_music_info_order）。' +
              '**读到 ' + readRows.length + ' 行成功**（这一步没有出错），去重要删掉 ' + (readRows.length - merged.length) +
              ' 条重复、留下 ' + merged.length + ' 条，但**写回失败**：注入的写失败。' +
              '**已回滚**（未标记成功 ⇒ endTransaction 回滚）。这个事务里的写是：db_info 的快照 INSERT' +
              '（"playback_queue_startup_restore"，在两条 DELETE 之前） + DELETE my_list_music_info / DELETE ' +
              'my_list_music_info_order / INSERT ×2×' + merged.length + '，**全部撤销** ⇒ ' +
              '**库仍是写回前的 ' + readRows.length + ' 行**，db_info 里也不会留下半份快照。' +
              '本通道**不会**吞掉写回错误、把「读到了但没修好」伪装成一次成功的读。',
            )
            return Promise.resolve({ accepted: true })
          }
          // 写回成功：模型变成去重后的样子（等价于"两张表全删 + 逐条插回"）。
          // 第七刀-B：第一步是条件插入合并前的身份快照（这里只记下来，形状由另一个文件守）。
          state.snapshots.push(readRows.map(({ id, name, singer }) => ({ id, name, singer })))
          state.merges++
          state.rows = state.rows.filter(row => row.listId !== listId)
            .concat(merged.map(music => ({ ...music, listId })))
          accept(merged)
          return Promise.resolve({ accepted: true })
        }
      }
      accept(readRows)
      return Promise.resolve({ accepted: true })
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
  const native = makeNativeListMusicGet(options)
  const mod = load(BRIDGE_MODULE, {}, {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native, timeoutMs: 15000 },
  })
  return { mod, native }
}

test('invoke 的信封是 args=[listId]（裸字符串），结果是 MusicInfo[]（meta 是对象）', async() => {
  const rows = [
    { listId: 'list-1', id: 'm-2', name: 'B', singer: 'S', source: 'wy', interval: null, meta: { qualitys: [] } },
    { listId: 'list-1', id: 'm-1', name: 'A', singer: 'S', source: 'wy', interval: '03:55', meta: { qualitys: [] } },
    { listId: 'list-2', id: 'm-9', name: 'C', singer: 'S', source: 'kg', interval: null, meta: {} },
  ]
  const { mod, native } = setup({ rows })
  const musics = await mod.bridge.invoke(CHANNEL, 'list-1')
  // 顺序 = 行顺序（不是按 id 排序），只有 list-1 的行。
  assert.equal(JSON.stringify(musics.map(m => m.id)), JSON.stringify(['m-2', 'm-1']))
  // meta 是对象（不是字符串）。
  assert.equal(typeof musics[0].meta, 'object')
  assert.equal(musics[0].interval, null)

  const first = native.postCalls[0]
  assert.equal(first.channel, CHANNEL)
  assert.equal(first.kind, 'invoke')
  // ⚠️ 用 JSON.stringify 比对：参数数组是在 `vm.runInNewContext` 里造出来的（另一个 realm）。
  assert.equal(JSON.stringify(first.args), JSON.stringify(['list-1']), '参数必须是裸字符串，不是 {listId}')
  assert.equal(native.notifies, 1, '一次 invoke 只应收到一条应答（多出来的就是广播）')
})

test('"空"与"坏"在 JS 侧必须是两种表现（[] vs reject）', async() => {
  const empty = setup({ rows: [] })
  assert.equal(JSON.stringify(await empty.mod.bridge.invoke(CHANNEL, 'list-1')), JSON.stringify([]))
  // 没有这个歌单 ⇒ 同样是 []
  assert.equal(JSON.stringify(await empty.mod.bridge.invoke(CHANNEL, 'nope')), JSON.stringify([]))

  for (const failure of ['unopenable', 'missing-table', 'query-failed', 'bad-meta']) {
    const { mod } = setup({ rows: [], failure })
    const error = await mod.bridge.invoke(CHANNEL, 'default').then(
      () => { throw new Error(`不应该 resolve：${failure} 必须 reject，否则"坏了"会被伪装成"这个歌单是空的"`) },
      err => err,
    )
    assert.equal(error.code, 'IPC_HANDLER_FAILED')
    assert.equal(error.channel, CHANNEL)
  }
})

test('参数错误：缺参数 / 类型不对 ⇒ reject（不是静默 []）；null ⇒ 不查库、给 []', async() => {
  const { mod, native } = setup({ rows: [{ listId: 'l-1', id: 'm-1', name: 'A', singer: 'S', source: 'wy', interval: null, meta: {} }] })

  const missing = await mod.bridge.invoke(CHANNEL).then(
    () => { throw new Error('不应该 resolve：缺参数必须失败（桌面在这一点上抛 TypeError）') },
    err => err,
  )
  assert.equal(missing.code, 'IPC_HANDLER_FAILED')
  assert.match(missing.message, /需要一个字符串参数 listId/)

  const wrongType = await mod.bridge.invoke(CHANNEL, { listId: 'l-1' }).then(
    () => { throw new Error('不应该 resolve：本通道的参数是裸字符串，不是对象') },
    err => err,
  )
  assert.equal(wrongType.code, 'IPC_HANDLER_FAILED')
  assert.match(wrongType.message, /必须是字符串/)

  const beforeNull = native.postCalls.length
  assert.equal(JSON.stringify(await mod.bridge.invoke(CHANNEL, null)), JSON.stringify([]))
  assert.equal(native.postCalls.length - beforeNull, 1)
  // 显式 null 在**线缆上**就是 `args=[null]`。
  assert.equal(JSON.stringify(native.postCalls[native.postCalls.length - 1].args), JSON.stringify([null]))
})

test('本刀没有注册别的通道：invoke 同族写通道拿到 IPC_CHANNEL_UNSUPPORTED（大声失败）', async() => {
  const { mod, native } = setup({ rows: [] })
  const writeChannel = PLAYER_EVENT_NAME.list_music_overwrite
  assert.equal(writeChannel, 'player_list_music_overwrite')
  const error = await mod.bridge.invoke(writeChannel, { listId: 'x', musicInfos: [] }).then(
    () => { throw new Error('不应该 resolve：写通道本刀没做，必须大声失败') },
    err => err,
  )
  assert.equal(error.code, 'IPC_CHANNEL_UNSUPPORTED')
  assert.deepEqual(native.unregisteredSends, [writeChannel])
  assert.equal(native.notifies, 1, '读通道不广播')
})

// ---------------------------------------------------------------------------
// 第七刀-A 在 JS 侧的可观察行为（替身按 Java 的控制流实现，不是 Java 行为验证）
// ---------------------------------------------------------------------------

/** default 的三行、其中两行按去重键重复（m-2 与 m-1 的名字/歌手只差大小写）。 */
const DEFAULT_ROWS = [
  { listId: 'default', id: 'm-1', name: 'Song One', singer: 'Singer A', source: 'wy', interval: null, meta: { n: 1 } },
  { listId: 'default', id: 'm-2', name: 'song one', singer: 'singer a', source: 'kg', interval: null, meta: { n: 2 } },
  { listId: 'default', id: 'm-3', name: 'Other', singer: 'X', source: 'tx', interval: '03:00', meta: {} },
]

test('default 有重复 ⇒ resolve **去重后的**列表；第二次 invoke 不会再合并（库已经干净）', async() => {
  const { mod, native } = setup({ rows: DEFAULT_ROWS })
  assert.equal(DEFAULT_ROWS.length, 3)
  const expected = dedupePlaybackQueue(DEFAULT_ROWS.map(({ listId: _listId, ...music }) => music)).map(music => music.id)
  assert.deepEqual(expected, ['m-1', 'm-3'], '期望值由真实现算出来')

  const first = await mod.bridge.invoke(CHANNEL, 'default')
  assert.deepEqual(first.map(music => music.id), expected, '返回的必须是去重后的列表（桌面 :201 的 targetList = merged）')
  assert.equal(native.state.merges, 1, '第一次读要写回一次')
  // 第七刀-B：那次合并的第一步记了"合并前的 (id,name,singer) 列表"（含 m-2 那条重复）。
  assert.deepEqual(native.state.snapshots, [[
    { id: 'm-1', name: 'Song One', singer: 'Singer A' },
    { id: 'm-2', name: 'song one', singer: 'singer a' },
    { id: 'm-3', name: 'Other', singer: 'X' },
  ]])

  // 第二次读：库里已经干净 ⇒ 不再合并（等价于桌面"缓存已热"的那一半语义）。
  const second = await mod.bridge.invoke(CHANNEL, 'default')
  assert.deepEqual(second.map(music => music.id), expected)
  assert.equal(native.state.merges, 1, '第二次读不该再写一遍（没有重复了）')
  assert.equal(native.notifies, 2, '两次 invoke 两条应答（没有广播）')
})

test('default 写回失败 ⇒ reject（**不是** resolve 去重后的列表），消息同时点名两半', async() => {
  const { mod, native } = setup({ rows: DEFAULT_ROWS, writeFailure: true })
  const error = await mod.bridge.invoke(CHANNEL, 'default').then(
    () => { throw new Error('不应该 resolve：吞掉写回错误就会让渲染层缓存一份库里并不存在的列表') },
    err => err,
  )
  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.equal(error.channel, CHANNEL)
  assert.match(error.message, /读到 3 行成功/)
  assert.match(error.message, /写回失败/)
  assert.match(error.message, /已回滚/)
  assert.match(error.message, /库仍是写回前的 3 行/)
  assert.match(error.message, /不会\*\*吞掉写回错误/)
  // 库没被改动（回滚）⇒ 模型还是三行，而且**没有留下快照**（第一步的写也一起撤掉）。
  assert.equal(native.state.rows.length, 3)
  assert.equal(native.state.merges, 0)
  assert.deepEqual(native.state.snapshots, [], '写回失败 ⇒ 连快照都不该留下（同一事务）')
})

test('非 default（用户歌单）有同样的重复 ⇒ 原样返回全部行、一次合并都不发生', async() => {
  const rows = DEFAULT_ROWS.map(row => ({ ...row, listId: 'list-1' }))
  const { mod, native } = setup({ rows })
  const musics = await mod.bridge.invoke(CHANNEL, 'list-1')
  assert.deepEqual(musics.map(music => music.id), ['m-1', 'm-2', 'm-3'],
    '普通歌单永不合并：连重复都要原样返回（去重只属于 default）')
  assert.equal(native.state.merges, 0)
  // 模型也没被动过，db_info 更是一条都没写（非 default 连快照都不碰）。
  assert.equal(native.state.rows.length, 3)
  assert.deepEqual(native.state.snapshots, [])
})
