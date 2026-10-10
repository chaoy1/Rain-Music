/**
 * Android 移植 · **P0-2 第六刀（`player_list_music_get`，歌单内歌曲的纯读通道）**
 * 的契约 / 接线 / 落点 / 范围回归网。
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
 * 9. **纯读守卫**：本文件里**没有**任何 INSERT / UPDATE / DELETE / 建表 / 显式事务 / `execSQL` /
 *    `compileStatement`；唯一"像写"的东西是一条**节流警告**；
 * 10. **本刀不做写回**：`dedupePlaybackQueue` + `overwriteMusicInfo` + 快照 +
 *     `resolvePlaybackQueueRestoreIndex` / `completePlaybackQueueRestore` 一条都没实现
 *     （但它们**必须**能在桌面的源码里被指出来 —— 那是下一刀的活）；
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
  // ㊙️ 本刀敢"只读、不写回"的**唯一**依据：渲染层读 default 时自己会去重。
  assert.match(
    listManageActionTs,
    /if \(listId == LIST_IDS\.DEFAULT\) musicList = dedupePlaybackQueue\(musicList\)/,
    '渲染层的去重没了 ⇒ 本刀不写回就会让界面看到重复（那时必须重新评估）',
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
  assert.match(getCode, /item\.put\(COLUMN_META, parseMeta\(id, cursor\.getString\(metaIndex\)\)\)/)
  // 绝不许"原样回传"（那是 TEXT，渲染层拿到的是字符串）。
  assert.ok(!/item\.put\(COLUMN_META, jsonValue\(/.test(getCode), 'meta 不许走 jsonValue（那是给可空字符串列的）')
  assert.ok(!/item\.put\(COLUMN_META, cursor\.getString\(metaIndex\)\)/.test(getCode), 'meta 不许原样回传')

  // NULL 列：与桌面 JSON.parse(null) ⇒ null 逐字等价（NOT NULL 列被写坏时的行为）。
  assert.match(getCode, /if \(text == null\) \{[\s\S]{0,900}?return JSONObject\.NULL;/)
  // 坏 meta：抛错（不跳过这一行、也不当成成功读）。
  assert.match(getCode, /catch \(JSONException ex\) \{\s*throw new IllegalStateException\(/)
  assert.match(getJava, /坏 meta 同样会让\*\*整条读\*\*失败/)
  assert.match(getJava, /不会跳过这一行/)
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
  const puts = [...getCode.matchAll(/item\.put\((COLUMN_[A-Z_]+), /g)].map(match => match[1])
  assert.deepEqual(puts, [
    'COLUMN_ID', 'COLUMN_NAME', 'COLUMN_SINGER', 'COLUMN_SOURCE', 'COLUMN_INTERVAL', 'COLUMN_META',
  ])
  for (const [constant, value] of [
    ['COLUMN_ID', 'id'], ['COLUMN_NAME', 'name'], ['COLUMN_SINGER', 'singer'],
    ['COLUMN_SOURCE', 'source'], ['COLUMN_INTERVAL', 'interval'], ['COLUMN_META', 'meta'],
  ]) {
    assert.equal(javaConstant(getJava, constant), value)
  }
  // interval 是 string | null ⇒ NULL 走 jsonValue（不然 org.json 的 put(name, null) 会**删键**）。
  assert.match(getCode, /item\.put\(COLUMN_INTERVAL, jsonValue\(cursor\.getString\(intervalIndex\)\)\)/)
  assert.match(getCode, /private static Object jsonValue\(Object value\)/)
  assert.match(getCode, /return value == null \? JSONObject\.NULL : value/)
  assert.match(read('src/common/types/music.d.ts'), /interval: string \| null/)
  assert.match(read('src/common/types/music.d.ts'), /meta: MusicInfoMetaBase/)
})

test('返回的顺序就是 SQL 结果顺序（不许在 Java 侧去重 / 排序 / 分组）', () => {
  const loop = getCode.slice(getCode.indexOf('while (cursor.moveToNext())'), getCode.indexOf('} catch (IllegalStateException'))
  assert.deepEqual([...loop.matchAll(/musics\.put\(([^;]*)\)/g)].map(match => match[1].trim()), ['item'])
  assert.ok(!/new TreeSet|new HashSet|Collections\.sort|Arrays\.sort/.test(getCode), '不许在 Java 侧去重 / 排序')
  // ⚠️ 但**去重判定**是另一回事：default 列上要算一次（只为了警告），那条路不改返回值。
  assert.match(getCode, /RainMusicPlaybackQueueKey\.findDuplicates\(rows\)/)
  assert.match(getJava, /照常返回原始行/)
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
// 纯读 / 范围 / 不假装成功
// ---------------------------------------------------------------------------

test('纯读守卫：本文件里没有任何写 SQL、建表、显式事务或原生写入口', () => {
  for (const forbidden of ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'REPLACE']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(getCodeNoStrings),
      `只读通道里不该出现 ${forbidden}（写回留给下一刀）`,
    )
  }
  for (const forbidden of ['execSQL', 'compileStatement', 'beginTransaction', 'setTransactionSuccessful', 'endTransaction', 'rawQueryWithFactory', 'insert(', 'update(', 'delete(']) {
    assert.ok(!getCodeNoStrings.includes(forbidden), `只读通道里不该出现 ${forbidden}`)
  }
  // 唯一的数据库入口是 RainMusicDatabase（不另开库、不 new Helper）。
  assert.ok(!getCode.includes('SQLiteOpenHelper'), '不许另开 helper')
  assert.ok(!getCode.includes('getSharedPreferences'), '这不走 SharedPreferences')
  // 不广播任何东西：这条通道没有"变更通知"这种出口。
  assert.ok(!getCode.includes('emit'), '读通道不广播')
  // 游标在 finally 里关（两条路径都不漏）。
  assert.equal((getCode.match(/finally \{\s*if \(cursor != null\) cursor\.close\(\);/g) ?? []).length, 1)
  // 唯一的写 SQL 面在 RainMusicDatabase 的 onCreate 里（本刀一行都没改它）。
  assert.ok(!getCode.includes('RainMusicDatabase.helper'))
})

test('本刀**不做**默认列的去重写回：桌面那条链必须能在源码里被指出来（给下一刀）', () => {
  // 桌面的写回：dedupePlaybackQueue → overwriteMusicInfo（含 db_info 快照 + 删 + 插、同一个事务）。
  assert.match(listIndexTs, /export const getListMusics = async\(listId: string\): Promise<Rain\.Music\.MusicInfo\[\]>/)
  assert.match(listIndexTs, /const merged = dedupePlaybackQueue\(targetList\)/)
  assert.match(listIndexTs, /if \(merged\.length != targetList\.length\) \{/)
  assert.match(listIndexTs, /const restoreSnapshot = queueStartupRestorePending \? targetList\.map\(\(\{ id, name, singer \}\) => \(\{ id, name, singer \}\)\) : undefined/)
  assert.match(listIndexTs, /await overwriteMusicInfo\(listId, toDBMusicInfo\(merged, listId\), restoreSnapshot\)/)
  assert.match(dbHelperTs, /export const overwriteMusicInfo = async\(listId: string, musicInfos: Rain\.DBService\.MusicInfo\[\], startupRestoreSnapshot\?: QueueRestoreRecord\[\]\)/)
  assert.match(dbHelperTs, /INSERT INTO db_info \(field_name, field_value\) VALUES \(\?, \?\)/)
  assert.match(dbHelperTs, /QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'/)
  assert.match(listIndexTs, /let queueStartupRestorePending = true/)
  assert.match(listIndexTs, /export const resolvePlaybackQueueRestoreIndex/)
  assert.match(listIndexTs, /export const completePlaybackQueueRestore/)

  // ⚠️ 而且桌面的去重**只会**发生在 default 上（普通歌单 / temp 永不写回）。
  assert.match(listIndexTs, /if \(listId == LIST_IDS\.DEFAULT\) \{/)
  const constantsTs = read('src/common/constants.ts')
  assert.match(constantsTs, /DEFAULT: 'default'/)

  // Java 侧：这三样**一个都没有**（本刀范围外）。
  // ⚠️ 必须去掉注释**与字符串字面量**再查：类注释里故意写着这些名字（讲"桌面会做、本刀不做"），
  // 而且那条脏队列警告的消息里也点名了 `overwriteMusicInfo`（那是给人看的话，不是实现）。
  for (const forbidden of [
    'overwriteMusicInfo', 'queueStartupRestorePending', 'resolvePlaybackQueueRestoreIndex',
    'completePlaybackQueueRestore', 'playback_queue_startup_restore', 'toDBMusicInfo',
  ]) {
    assert.ok(!getCodeNoStrings.includes(forbidden), `本刀不该出现 ${forbidden}（那是下一刀）`)
  }
  // 模块级缓存也没有：每次读都真的查库（桌面会先查 musicLists 缓存）。
  for (const forbidden of ['musicLists', 'userLists', 'rawPoss']) {
    assert.ok(!getCode.includes(forbidden), `不许照抄桌面那套模块级缓存（${forbidden}）`)
  }
  // 但"不动缓存"这件事本身有语义差别，注释里必须写明（Android 每次读都反映库的真实内容）。
  assert.match(getJava, /android 本刀\*\*只读、不写回\*\*|Android 本刀\*\*只读、不写回\*\*/)
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

test('不假装成功：库打不开 / 表缺失 / 查询失败都抛错，代码里没有"返回空数组"的退路', () => {
  // 库打不开：消息与第四 / 第五刀逐字一致（同一个入口）。
  assert.match(dbCode, /throw new IllegalStateException\(\s*"打不开数据库 " \+ path/)
  assert.match(dbCode, /里没有表/)
  assert.match(dbCode, /这不是本应用建的库/)
  // 唯一的 catch：第一条出路就是 throw（不是"先给个空数组"）。
  assert.match(getCode, /catch \(Exception ex\) \{\s*throw new IllegalStateException\(/)
  assert.match(getCode, /catch \(IllegalStateException ex\) \{\s*throw ex;/)
  assert.ok(!/catch[\s\S]{0,300}?return new JSONArray\(\)/.test(getCode), '不许吞异常返回空数组')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(getCode), '不许空 catch')
  // 失败消息里必须点名表名 + 那句"不假装"。
  assert.match(getCode, /private static String readFailureMessage\(String sql, Exception ex\)/)
  assert.match(getJava, /不会\*\*返回空数组假装「这个歌单是空的」/)
  // 被吞掉的只有"已经点过名的 meta 错误"（rethrow），别的都包上表名与 SQL。
  assert.equal((getCode.match(/catch \(/g) ?? []).length, 3, 'readBareString 之外只应有这两个 catch')
})

// ---------------------------------------------------------------------------
// 脏队列警告（判定细节见 android-playback-queue-key.test.cjs）
// ---------------------------------------------------------------------------

test('脏队列警告：只在 default 上判、节流、点名"桌面会写回而本刀没有"', () => {
  // 只在 default 上收集 & 判定。
  assert.match(getCode, /LIST_ID_DEFAULT\.equals\(listId\) \? new ArrayList<>\(\) : null/)
  assert.match(getCode, /if \(!LIST_ID_DEFAULT\.equals\(listId\)\) return;/)
  assert.equal(javaConstant(getJava, 'LIST_ID_DEFAULT'), 'default')
  assert.match(getCode, /warnIfDefaultQueueLooksDirty\(listId, queueRows, musics\.length\(\)\)/)
  // 判定用的是与 JS 逐字节相同的那份键（不是就地又写一套）。
  assert.match(getCode, /RainMusicPlaybackQueueKey\.findDuplicates\(rows\)/)
  assert.match(getCode, /new RainMusicPlaybackQueueKey\.MusicRow\(id, name, singer\)/)
  // 节流：共享一个闸门 + 分开的一个（meta NULL）。
  assert.match(getCode, /private static final RainMusicLogThrottle DIRTY_QUEUE_WARN =\s*new RainMusicLogThrottle\(DIRTY_QUEUE_WARN_WINDOW_MS\)/)
  assert.match(getCode, /DIRTY_QUEUE_WARN\.shouldLog\(signature, System\.currentTimeMillis\(\)\)/)
  assert.match(getCode, /private static final long DIRTY_QUEUE_WARN_WINDOW_MS = 60_000L/)
  assert.match(getCode, /private static final RainMusicLogThrottle META_NULL_WARN =/)
  // 签名包含"行数 / 重复数 / 前几条重复的键" ⇒ 队列变了会立刻再报。
  assert.match(getCode, /signature = dirtyQueueSignature\(listId, total, duplicates\)/)
  assert.match(getCode, /builder\.append\(listId\)\.append\('\|'\)\.append\(total\)\.append\('\|'\)\.append\(duplicates\.size\(\)\)/)
  // 是 warn（不是 debug），并且真的是一条"点名"的日志。
  assert.match(getCode, /Logger\.warn\(\s*TAG,/)
  assert.match(getJava, /默认播放队列/)
  assert.match(getJava, /只读、不写回/)
  assert.match(getJava, /overwriteMusicInfo/)
  assert.match(getJava, /本条警告节流/)
  assert.match(getJava, /logcat 是本刀唯一的可观测面/)
  // ⚠️ 警告不能反过来影响返回值：它在 return 之前、但用的是**已经组装好的**数组。
  assert.ok(
    getCode.indexOf('warnIfDefaultQueueLooksDirty(') < getCode.indexOf('return musics;'),
    '警告要在返回之前（读成功之后）',
  )
  assert.match(getCode, /return musics;/)
  // 只有一条 warn 出口（不许在别处又刷一条）。
  assert.equal((getCode.match(/Logger\.warn\(/g) ?? []).length, 2, '两处 warn：meta 为 NULL、脏队列')
})

test('并发：没有数据锁；唯一的跨调用可变状态就是那两个日志闸门', () => {
  // 没有任何 synchronized（闸门在 RainMusicLogThrottle 里，本文件不自己加锁）。
  assert.equal((getCode.match(/synchronized/g) ?? []).length, 0, '通道自己不拿锁')
  assert.ok(!getCode.includes('new Object()'), '通道不自己造锁')
  assert.ok(!getCode.includes('WRITE_LOCK'), '这条通道与第三刀那把 SharedPreferences 写锁无关')
  // 唯一的非 final 静态字段：没有（可变状态全在闸门对象里）。
  const mutableStatics = [...getCode.matchAll(/\bprivate static\s+(?!final\b)(?:volatile\s+)?([A-Za-z_][\w.<>[\]]*)\s+(\w+)\s*=/g)]
    .map(match => match[2])
  assert.deepEqual(mutableStatics, [], '通道里不该有可变的静态字段')
  // 闸门自己是有锁的（两条线程同时读也不会把节流打穿）。
  assert.match(stripJavaComments(throttleJava), /synchronized boolean shouldLog\(String signature, long nowMs\)/)
  // 连接不关（桌面同样把连接留到进程退出）。
  assert.ok(!/RainMusicDatabase[\s\S]{0,80}?\.close\(\)/.test(getCode), '读通道不许关掉进程级连接')
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

/** 只声明本刀用到的成员；put(String, Object) 照 AOSP 声明为 throws JSONException。 */
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
 * - 库打不开 / 表缺失 / 查询失败 / meta 坏 ⇒ reject，**绝不** resolve 成 `[]`。
 */
const makeNativeListMusicGet = (options = {}) => {
  const state = { rows: options.rows ?? [], failure: options.failure ?? null }
  const native = {
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
      if (state.failure === 'unopenable') { failed('打不开数据库 /data/data/com.rainmusic.mobile/databases/rain.data.db：file is not a database'); return Promise.resolve({ accepted: true }) }
      if (state.failure === 'missing-table') { failed('数据库 … 里没有表 "my_list_music_info"：这不是本应用建的库，或者它已经损坏。'); return Promise.resolve({ accepted: true }) }
      if (state.failure === 'query-failed') { failed('读 "my_list_music_info" 失败（SELECT … ORDER BY O."order" ASC）：no such table: my_list_music_info_order。'); return Promise.resolve({ accepted: true }) }
      if (state.failure === 'bad-meta') { failed(CHANNEL + '：music id="m-1" 的 "meta" 列不是合法的 JSON 对象'); return Promise.resolve({ accepted: true }) }
      accept(state.rows.filter(row => row.listId === listId).map(({ listId: _listId, ...music }) => music))
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
