/**
 * Android 移植 · **P0-2 第五刀（`player_list_music_check_exist` / `player_list_music_get_list_ids`，
 * 歌单内歌曲的纯读通道）** 的契约 / 接线 / 落点回归网。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**不执行任何 Java**，也**没有真的开过 SQLite** —— 所以它**不能**证明这两条通道在真机上不再是
 * `IPC_CHANNEL_UNSUPPORTED`、不能证明库文件真的落在 `getDatabasePath("rain.data.db")`、
 * 不能证明 `rawQuery` 真的能绑上那两个参数。那几件事只能由 CI 的 `gradlew assembleDebug`（编译）
 * → 真机运行（行为）来证明。本刀额外用 `javac` + 一组手写替身（`android.*` / `org.json` /
 * `com.getcapacitor.Logger` / 一个 `RainMusicIpcPlugin` 替身）把
 * `RainMusicListMusicChannels.java` + `RainMusicDatabase.java` + `RainMusicListChannels.java` +
 * `RainMusicIpcHandlers.java` 编过一遍（exit 0）—— 那是**语法 / 类型自洽**的证据，
 * **不是**编译验证：替身的签名是人手写的，与真实框架 API 一旦不一致，那次 javac 不会发现。
 *
 * 它守的是一组**本机可测、且一旦写错在真机上完全静默（或表现为"这首歌不在任何歌单里"）**的错误：
 *
 * 1. **通道名字面量 == `ipcNames.ts` 生成的真实通道名**
 *    （`player_list_music_check_exist` / `player_list_music_get_list_ids`，`ipcNames.ts:171-176`）
 *    —— 错一个字符就是 `IPC_CHANNEL_UNSUPPORTED`；
 * 2. **形状 == 契约 `ipc-contract.md:115-116`**：两条都是 `mainHandle`（invoke，请求/应答）；
 *    `check_exist` 的参数是 `{listId, musicInfoId}` 对象、返回 `boolean`；
 *    `get_list_ids` 的参数是**裸字符串** `musicInfoId`、返回 `string[]`；渲染层的调用形状
 *    （`rendererListManage.ts:158` / `:166`）逐字对应；
 * 3. **SQL 逐字对齐阶段 2a**：`statements.ts:135-141` 与 `:147-152` 两条语句归一化后与 Java 一致
 *    （唯一的差异是 better-sqlite3 的具名参数 `@musicInfoId` / `@listId` → 位置参数 `?`），
 *    且**没有**人偷偷加 `ORDER BY` / `DISTINCT` / `LIMIT`；
 * 4. **表 / 列名对齐 `tables.ts`**：表名常量与 `my_list_music_info` 一致，SQL 里出现的每一列都在
 *    `tables.ts` 的该表 DDL 里；
 * 5. **返回值形状**：`check_exist` 是裸布尔、`get_list_ids` 只把 `listId` 放进数组
 *    （不是整行、不去重、不排序）；
 * 6. **纯读守卫**：本文件里**没有**任何 INSERT / UPDATE / DELETE / 建表 / 显式事务 /
 *    `execSQL` / `compileStatement`，也**没有** `synchronized` / `WRITE_LOCK` / `emit`；
 * 7. **范围守卫**：本刀只注册这 **2 条**通道；`player_list_music_get`（"读里带写"）与其余
 *    `player_list_music_*` 写通道一条都不碰；第四刀那个文件仍然只注册 1 条；
 * 8. **注册真的被调用**：`RainMusicIpcPlugin.load()` 里调
 *    `RainMusicListMusicChannels.register(this)`，`MainActivity` 仍把插件注册在
 *    `super.onCreate()` **之前**；匹配前**必须去掉注释**（前几刀都被这个坑抓过）；
 * 9. **不假装成功**：库打不开 / 表缺失（`my_list_music_info`）/ 查询失败三条路都**抛错**，
 *    代码里**没有** `catch` 之后 `return false` / `return new JSONArray()` 这种
 *    "把坏了伪装成这首歌不在任何歌单里"的写法；`RainMusicDatabase.open` 是**调用方点名要读哪张表**；
 * 10. **参数语义**：缺键 / 类型不对 ⇒ 抛错；`null` ⇒ 不查库直接给"查不到"
 *     （与桌面把 null 绑成 SQL NULL 逐字等价）。
 *
 * 另外一组（最后一组）用 JS 侧的桥 + 一个**按 Java 语义实现**的原生替身，锁住
 * "查不到 ⇒ `false` / `[]`、坏 ⇒ reject" 这条链在 JS 侧的可观察行为。
 * 它是接线检查，**不是** Java 行为验证 —— 替身与 Java 一旦漂移，这组用例不会变红
 * （所以每条替身语义旁边都有对应的 Java 源码断言）。
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

const musicJava = readJava('ipc/RainMusicListMusicChannels.java')
const listJava = readJava('ipc/RainMusicListChannels.java')
const dbJava = readJava('ipc/RainMusicDatabase.java')
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
const listActionTs = read('src/renderer/store/list/action.ts')
const contractMd = read('docs/android/ipc-contract.md')

/**
 * 去掉注释再匹配（前几刀的用例都踩过这个坑：注释里就写着那行代码，
 * 用整份源码匹配的话，把它注释掉**用例依然通过**，而真机上就是"没注册"）。
 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 再去掉字符串字面量（只用于"这段代码里有没有某个执行面"这类判断）。 */
const stripJavaStrings = source => source.replace(/"(?:\\.|[^"\\])*"/g, '""')

/**
 * 去掉 JS 的块注释与行注释。
 *
 * ⚠️ 必须用它：`ipcBridge/capacitor.js` 的**文件头注释**里就有信封示例
 * （`"channel": "player_list_get"`），直接 `includes()` 会把"注释里出现过通道名"
 * 误判成"有人加了通道白名单"。
 */
const stripJsComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 读 Java 里的字符串常量字面量（`static final String X = "…";`）。 */
const javaConstant = (source, name) => {
  const match = source.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]*)"`))
  assert.ok(match, `Java 里找不到常量 ${name}（读法：static final String ${name} = "…"）`)
  return match[1]
}

/** 读 Java 里的文本块（`static final String X = """…""";`）。 */
const javaTextBlock = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`))
  assert.ok(match, `Java 里找不到文本块 ${name}（读法：static final String ${name} = """…"""）`)
  return match[1]
}

/**
 * SQL 归一化：**与桌面 `verifyDB.ts:4` 的那条正则逐字相同**
 * （`/\n|\s|;|--.+/g`）。两边用同一个函数，所以 Java 文本块的缩进 / 换行都不会影响比对结果。
 */
const normalizeSql = sql => sql.replace(/\n|\s|;|--.+/g, '')

/**
 * better-sqlite3 的**具名参数** → Android 的**位置参数**。
 *
 * 为什么必须有这一步：桌面那两条语句用的是 `@musicInfoId` / `@listId`，
 * 而 `SQLiteDatabase.rawQuery(String, String[])` 只支持 `?`（本刀在类注释「SQL」里写明了）。
 * 替换是**逐个按出现顺序**的（正则不重排），所以比对之后的字符串同时锁住了
 * "列清单 / 表名 / WHERE 结构" **和** "参数的先后顺序"。
 */
const toPositionalSql = sql => sql.replace(/@\w+/g, '?')

const { PLAYER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})

const CHANNEL_CHECK_EXIST = PLAYER_EVENT_NAME.list_music_check_exist
const CHANNEL_GET_LIST_IDS = PLAYER_EVENT_NAME.list_music_get_list_ids
const TABLE_MY_LIST_MUSIC_INFO = 'my_list_music_info'

/** `tables.ts` 的注册表：`[键名, DDL]`，顺序 = 文件里的注册顺序。 */
const tableEntries = [...tablesTs.matchAll(/tables\.set\('([^']+)',\s*`([\s\S]*?)`\)/g)]
  .map(match => [match[1], match[2]])

/** `statements.ts` 的两条语句（`:135-141` / `:147-152`）。 */
const statementsCheckExistSql = statementsTs.match(
  /createMusicInfoByListAndMusicInfoIdQueryStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.ListMusicInfoQuery\]>\(`([\s\S]*?)`\)/,
)[1]
const statementsGetListIdsSql = statementsTs.match(
  /createMusicInfoByMusicInfoIdQueryStatement[\s\S]*?db\.prepare<\[string\]>\(`([\s\S]*?)`\)/,
)[1]

/** 去掉注释后的 Java 源码 —— 凡"这段代码存在吗"的断言都必须用它。 */
const musicCode = stripJavaComments(musicJava)
const dbCode = stripJavaComments(dbJava)
/** 再去掉字符串字面量（"有没有某个执行面"用）。 */
const musicCodeNoStrings = stripJavaStrings(musicCode)
const dbCodeNoStrings = stripJavaStrings(dbCode)

// ---------------------------------------------------------------------------
// 形状：通道名 / invoke / 参数 / 返回类型
// ---------------------------------------------------------------------------

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED）', () => {
  assert.equal(CHANNEL_CHECK_EXIST, 'player_list_music_check_exist', 'ipcNames.ts 的真实值变了？')
  assert.equal(CHANNEL_GET_LIST_IDS, 'player_list_music_get_list_ids', 'ipcNames.ts 的真实值变了？')
  assert.notEqual(CHANNEL_CHECK_EXIST, CHANNEL_GET_LIST_IDS, '两条通道不能是同一个名字')

  assert.equal(javaConstant(musicJava, 'CHANNEL_CHECK_EXIST'), CHANNEL_CHECK_EXIST)
  assert.equal(javaConstant(musicJava, 'CHANNEL_GET_LIST_IDS'), CHANNEL_GET_LIST_IDS)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量但忘了 register 的话，真机上依然是"未注册"。
  // ⚠️ 必须去掉注释再匹配（见文件头的 stripJavaComments）。
  assert.match(musicCode, /register\(\s*CHANNEL_CHECK_EXIST\s*,/)
  assert.match(musicCode, /register\(\s*CHANNEL_GET_LIST_IDS\s*,/)
  // 注册必须走常量（字面量一旦与 ipcNames.ts 漂移，本机就测不出来了）。
  assert.ok(!musicCode.includes('RainMusicIpcHandlers.register("'), '注册必须走常量')
})

test('形状 == 契约 :115-116：两条都是 mainHandle（invoke）；check_exist 收对象、get_list_ids 收裸字符串', () => {
  // 契约那两行逐字钉住（改了契约就该回来看这条用例）。
  assert.ok(
    contractMd.includes('| `player_list_music_check_exist` | `checkListExistMusic` `R:listManage:158` | `M:list:48` | `{listId, musicInfoId}` → `boolean` | 判断歌曲是否已在歌单 |'),
    '契约 :115 那一行变了 → check_exist 的形状必须重新核对',
  )
  assert.ok(
    contractMd.includes('| `player_list_music_get_list_ids` | `getMusicExistListIds` `R:listManage:166` | `M:list:51` | `musicInfoId: string` → `string[]` | 反查歌曲所属歌单 |'),
    '契约 :116 那一行变了 → get_list_ids 的形状必须重新核对',
  )
  // 契约 :481 把这两条记在「列表与 DB」16 条里（本刀只做其中的 2 条纯读）。
  assert.ok(
    contractMd.includes('| 列表与 DB | `player_list_get`、`player_list_add`、`player_list_remove`'),
    '契约 :481 的分组行变了 → 本刀的"同族"范围要重新核对',
  )

  // 桌面 handler：都是 mainHandle ⇒ 渲染层是 rendererInvoke（请求/应答），不是 send、不是广播。
  assert.match(
    desktopEventTs,
    /mainHandle<Rain\.List\.ListActionCheckMusicExistList, boolean>\(PLAYER_EVENT_NAME\.list_music_check_exist, async\(\{ params: \{ listId, musicInfoId \} \}\)/,
  )
  assert.match(
    desktopEventTs,
    /mainHandle<string, string\[\]>\(PLAYER_EVENT_NAME\.list_music_get_list_ids, async\(\{ params: musicInfoId \}\)/,
  )
  for (const channel of ['list_music_check_exist', 'list_music_get_list_ids']) {
    assert.ok(
      !new RegExp(`mainOn<[^>]*>\\(PLAYER_EVENT_NAME\\.${channel}`).test(desktopEventTs),
      '契约是 mainHandle（invoke）',
    )
  }

  // 渲染层封装：两条都是 rendererInvoke，参数形状一个是对象、一个是裸字符串。
  assert.match(
    rendererListManageTs,
    /rendererInvoke<Rain\.List\.ListActionCheckMusicExistList, boolean>\(PLAYER_EVENT_NAME\.list_music_check_exist, \{ listId, musicInfoId \}\)/,
    'checkListExistMusic 必须是 rendererInvoke(channel, {listId, musicInfoId})',
  )
  assert.match(
    rendererListManageTs,
    /rendererInvoke<string, string\[\]>\(PLAYER_EVENT_NAME\.list_music_get_list_ids, musicInfoId\)/,
    'getMusicExistListIds 必须是 rendererInvoke(channel, musicInfoId) —— 裸字符串，不是对象',
  )
  assert.ok(
    !/rendererSend\w*\(\s*PLAYER_EVENT_NAME\.list_music_(check_exist|get_list_ids)/.test(rendererListManageTs),
    '读通道不能走 send / sendSync（Capacitor 上没有同步 IPC）',
  )
})

test('JS 侧零改动：桥是通道无关的，渲染层的两个调用点与再导出原样保留', () => {
  // 桥里不出现这两条通道名（那意味着有人加了白名单）。
  // ⚠️ 去掉 JS 注释再查：桥的文件头注释里就有信封示例（含通道名）。
  const bridge = stripJsComments(read(BRIDGE_MODULE))
  assert.ok(!bridge.includes(CHANNEL_CHECK_EXIST), '桥里不该出现通道名（桥是通道无关的）')
  assert.ok(!bridge.includes(CHANNEL_GET_LIST_IDS), '桥里不该出现通道名（桥是通道无关的）')

  // 渲染层那侧本来就接好了（本刀不碰 JS）：封装 + 再导出 + 两个真实调用点。
  assert.match(rendererListManageTs, /rendererInvoke<Rain\.List\.ListActionCheckMusicExistList, boolean>/)
  assert.match(rendererListManageTs, /rendererInvoke<string, string\[\]>/)
  assert.match(listActionTs, /checkListExistMusic,/)
  assert.match(listActionTs, /getMusicExistListIds,/)
  assert.match(read('src/renderer/components/common/FavoriteButton.vue'), /await getMusicExistListIds\(id\)/)
  assert.match(read('src/renderer/components/common/ListAddModal.vue'), /void getMusicExistListIds\(mid\)\.then\(/)

  // 两条都是"读"：桌面这两条链上开不出任何写（对照下面的纯读守卫）。
  assert.match(dbHelperTs, /export const queryMusicInfoByListIdAndMusicInfoId = async\(listId: string, musicInfoId: string\)/)
  assert.match(dbHelperTs, /export const queryMusicInfoByMusicInfoId = async\(id: string\)/)
})

// ---------------------------------------------------------------------------
// SQL 落点：语句逐字对齐 statements.ts，表 / 列对齐 tables.ts
// ---------------------------------------------------------------------------

test('check_exist 的 SQL 逐字对齐 statements.ts:135-141（只把 @具名参数 换成 ?）', () => {
  // 先钉住桌面那一条（引用没写错文件）。
  assert.match(statementsTs, /createMusicInfoByListAndMusicInfoIdQueryStatement/)
  assert.match(statementsTs, /WHERE "id"=@musicInfoId/)
  assert.match(statementsTs, /AND "listId"=@listId/)

  assert.equal(
    normalizeSql(javaTextBlock(musicJava, 'SQL_MUSIC_BY_LIST_AND_MUSIC_ID')),
    normalizeSql(toPositionalSql(statementsCheckExistSql)),
    'Java 的 SQL 必须与 statements.ts 的"按列表 id + 音乐 id 查询音乐信息"逐字一致（列清单 / 表名 / WHERE 结构）',
  )

  // 绑定顺序 = SQL 里 ? 出现的顺序（先 "id" 后 "listId"）—— 归一化比对抓不住"传参顺序反了"。
  assert.match(musicCode, /new String\[\] \{ musicInfoId, listId \}/, '实参顺序必须是 musicInfoId 在前（对应 WHERE "id"=? AND "listId"=?）')
})

test('get_list_ids 的 SQL 逐字对齐 statements.ts:147-152（那条本来就是位置参数）', () => {
  assert.match(statementsTs, /createMusicInfoByMusicInfoIdQueryStatement/)
  assert.match(statementsTs, /WHERE "id"=\?/)

  assert.equal(
    normalizeSql(javaTextBlock(musicJava, 'SQL_MUSIC_BY_MUSIC_ID')),
    normalizeSql(statementsGetListIdsSql),
    'Java 的 SQL 必须与 statements.ts 的"按音乐 id 查询音乐信息"逐字一致',
  )
  assert.equal(toPositionalSql(statementsGetListIdsSql), statementsGetListIdsSql, '这条桌面上本来就没有具名参数')
  assert.match(musicCode, /new String\[\] \{ musicInfoId \}/)
})

test('两条 SQL 都没有偷偷加 ORDER BY / DISTINCT / LIMIT（桌面的顺序语义就是"没有排序"）', () => {
  // 桌面 getMusicExistListIds 只做 .map(m => m.listId)：SQL 里没有 ORDER BY ⇒ 返回顺序 = 存储顺序。
  assert.ok(!/ORDER BY/i.test(statementsGetListIdsSql), '桌面这条语句不该有 ORDER BY')
  assert.ok(!/ORDER BY/i.test(statementsCheckExistSql), '桌面这条语句不该有 ORDER BY')

  for (const name of ['SQL_MUSIC_BY_LIST_AND_MUSIC_ID', 'SQL_MUSIC_BY_MUSIC_ID']) {
    const sql = javaTextBlock(musicJava, name)
    assert.ok(!/ORDER BY/i.test(sql), `${name} 不许加 ORDER BY（会改变 get_list_ids 的返回顺序）`)
    assert.ok(!/DISTINCT/i.test(sql), `${name} 不许加 DISTINCT（桌面不去重）`)
    assert.ok(!/LIMIT/i.test(sql), `${name} 不许加 LIMIT（桌面不截断）`)
  }

  // 桌面 getMusicExistListIds 的实现就是原样 map，不去重不排序。
  assert.match(listIndexTs, /return musicInfos\.map\(m => m\.listId\)/)
  assert.ok(!/new Set\(/.test(listIndexTs.slice(listIndexTs.indexOf('getMusicExistListIds'), listIndexTs.indexOf('getMusicExistListIds') + 300)), '桌面不去重')
})

test('表名与列名对齐 tables.ts：my_list_music_info 必须存在，SQL 里的每一列都在它的 DDL 里', () => {
  const names = tableEntries.map(([name]) => name)
  assert.ok(names.includes(TABLE_MY_LIST_MUSIC_INFO), 'tables.ts 里没有 my_list_music_info？')
  assert.equal(javaConstant(dbJava, 'TABLE_MY_LIST_MUSIC_INFO'), TABLE_MY_LIST_MUSIC_INFO)

  const ddl = tableEntries.find(([name]) => name === TABLE_MY_LIST_MUSIC_INFO)[1]
  const ddlColumns = [...ddl.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)/g)].map(match => match[1])
  assert.deepEqual(ddlColumns, ['id', 'listId', 'name', 'singer', 'source', 'interval', 'meta'], 'my_list_music_info 的列变了')

  // Java 每条 SQL 里出现的列，必须都在 DDL 里（多写/写错一个列名，真机上 SELECT 直接失败）。
  for (const name of ['SQL_MUSIC_BY_LIST_AND_MUSIC_ID', 'SQL_MUSIC_BY_MUSIC_ID']) {
    const sql = javaTextBlock(musicJava, name)
    // ⚠️ 只看 SELECT 与 FROM 之间那一段：FROM 后面的 `"main"."my_list_music_info"` 里的表名
    // 也会被 `"(\w+)"` 命中（第一版就踩了这个坑）。
    const selectList = sql.match(/SELECT([\s\S]*?)FROM/)[1]
    const columns = [...selectList.matchAll(/"(\w+)"/g)].map(match => match[1])
    assert.ok(columns.length > 0, `${name} 没解析出列清单？`)
    for (const column of columns) {
      assert.ok(ddlColumns.includes(column), `${name} 用了 ${TABLE_MY_LIST_MUSIC_INFO} 里不存在的列 "${column}"`)
    }
    // 表名（含 "main". 前缀）与 tables.ts 的那张表同名。
    assert.match(sql, /FROM "main"\."my_list_music_info"/)
  }

  // UNIQUE("id","listId") 是"最多一行 ⇒ moveToFirst() 等价于桌面的 .get()"的依据。
  assert.match(ddl, /UNIQUE\("id","listId"\)/)
  assert.match(musicJava, /cursor\.moveToFirst\(\)/, 'check_exist 靠"有没有第一行"判断存在性')

  // 只读的那一列在 Java 里有列名常量，且与 DDL 一致。
  assert.equal(javaConstant(musicJava, 'COLUMN_LIST_ID'), 'listId')
  assert.match(musicCode, /cursor\.getColumnIndexOrThrow\(COLUMN_LIST_ID\)/)
})

// ---------------------------------------------------------------------------
// 返回值形状
// ---------------------------------------------------------------------------

test('check_exist 返回裸布尔（桌面 `return musicInfo != null`），不是对象也不是数组', () => {
  assert.match(listIndexTs, /export const checkListExistMusic = async\(listId: string, musicInfoId: string\): Promise<boolean>/)
  assert.match(listIndexTs, /return musicInfo != null/)

  // Java：返回 Boolean（自动装箱），不包 JSONObject / JSONArray。
  assert.match(musicCode, /return cursor\.moveToFirst\(\);/)
  assert.ok(!/return jsonValue\(/.test(musicCode), 'check_exist 的返回值不该被包成 JSON 值')
})

test('get_list_ids 只把 listId 放进数组（不是整行）、且逐行保持 SQL 顺序', () => {
  // 桌面只 map 出 listId 一个字段。
  assert.match(listIndexTs, /getMusicExistListIds[\s\S]{0,200}?return musicInfos\.map\(m => m\.listId\)/)

  // Java：只取 listId 这一列；循环体的唯一动作是往 JSONArray 里 put。
  const mapper = musicCode.slice(musicCode.indexOf('private static Object getListIds'), musicCode.indexOf('// ------------------------------------------------------------------ 参数'))
  assert.match(mapper, /int listIdIndex = cursor\.getColumnIndexOrThrow\(COLUMN_LIST_ID\);/)
  assert.match(mapper, /while \(cursor\.moveToNext\(\)\) \{/)
  assert.deepEqual(
    [...mapper.matchAll(/listIds\.put\(([^;]*)\)/g)].map(match => match[1].trim()),
    ['jsonValue(cursor.getString(listIdIndex))'],
    '循环体只应往数组里放 listId（多放一个字段 = 与桌面形状不一致）',
  )
  // 没有去重集合、没有排序（桌面的顺序就是 SQL 的顺序）。
  assert.ok(!/new TreeSet|new HashSet|Collections\.sort|Arrays\.sort/.test(musicCode), '不许在 Java 侧去重 / 排序')
})

test('可空映射：listId 万一为 NULL 也写出 JSON null，而不是把数组元素挪掉', () => {
  // 与第一 / 三 / 四刀同一个坑：org.json 的 put(name, null) 会删键。
  assert.match(musicCode, /private static Object jsonValue\(Object value\)/)
  assert.match(musicCode, /return value == null \? JSONObject\.NULL : value/)
  assert.match(musicCode, /listIds\.put\(jsonValue\(cursor\.getString\(listIdIndex\)\)\)/)
  // 但 listId 在表结构里是 NOT NULL（正常不可能为 NULL）—— 这一点必须有人读过。
  assert.match(tableEntries.find(([name]) => name === TABLE_MY_LIST_MUSIC_INFO)[1], /"listId" TEXT NOT NULL/)
})

// ---------------------------------------------------------------------------
// 参数语义
// ---------------------------------------------------------------------------

test('参数形状：check_exist 收对象（缺键 ⇒ 抛错），get_list_ids 收裸字符串', () => {
  // check_exist：args[0] 必须是对象，且 listId / musicInfoId 两个键都必须存在。
  assert.match(musicCode, /JSONObject params = readParamsObject\(args, CHANNEL_CHECK_EXIST, FIELD_LIST_ID, FIELD_MUSIC_INFO_ID\)/)
  assert.match(musicCode, /private static final String FIELD_LIST_ID = "listId";/)
  assert.match(musicCode, /private static final String FIELD_MUSIC_INFO_ID = "musicInfoId";/)
  assert.match(musicCode, /if \(!payload\.has\(key\)\)/)
  assert.match(musicCode, /缺键就是失败/)
  // 桌面在缺键时确实会抛：destructure 拿到 undefined，而 better-sqlite3 不能绑 undefined。
  assert.match(desktopEventTs, /async\(\{ params: \{ listId, musicInfoId \} \}\)/)

  // get_list_ids：args[0] 是裸字符串（不是对象）—— 与桌面 async({ params: musicInfoId }) 同形。
  assert.match(musicCode, /String musicInfoId = readBareString\(args, CHANNEL_GET_LIST_IDS\)/)
  assert.match(musicCode, /if \(!\(first instanceof String\)\)/)
  // 对象参数在这里必须被拒（报错信息里点明"不是对象"这条路的反例）。
  assert.match(musicCode, /参数必须是字符串，收到 /)
})

test('null 参数：不查库、直接给"查不到"（与桌面把 null 绑成 SQL NULL 的结果逐字等价）', () => {
  // 桌面：WHERE "id"=NULL 恒不成立 ⇒ false / []。
  assert.match(statementsCheckExistSql, /WHERE "id"=@musicInfoId/)
  // Java：两条都先短路，且短路发生在 RainMusicDatabase.open 之前（不碰库）。
  const checkBlock = musicCode.slice(musicCode.indexOf('private static Object checkExist'), musicCode.indexOf('private static Object getListIds'))
  assert.match(checkBlock, /if \(listId == null \|\| musicInfoId == null\) \{/)
  assert.ok(
    checkBlock.indexOf('if (listId == null') < checkBlock.indexOf('RainMusicDatabase.open('),
    'null 短路必须发生在打开数据库之前',
  )
  const listIdsBlock = musicCode.slice(musicCode.indexOf('private static Object getListIds'), musicCode.indexOf('// ------------------------------------------------------------------ 参数'))
  assert.match(listIdsBlock, /if \(musicInfoId == null\) \{/)
  assert.ok(
    listIdsBlock.indexOf('if (musicInfoId == null') < listIdsBlock.indexOf('RainMusicDatabase.open('),
    'null 短路必须发生在打开数据库之前',
  )
  // 短路的返回值就是"空"的正确取值。
  assert.match(checkBlock, /return false;/)
  assert.match(listIdsBlock, /return new JSONArray\(\);/)
  // 短路**不是**参数错误（那会制造一处桌面没有的失败）。
  assert.ok(!/throw new IllegalArgumentException[\s\S]{0,200}?null/.test(checkBlock), 'null 不该被当成参数错误')
})

// ---------------------------------------------------------------------------
// 纯读 / 范围 / 不假装成功 / 并发
// ---------------------------------------------------------------------------

test('纯读守卫：本文件里没有任何写 SQL、建表、显式事务或原生写入口', () => {
  // 关掉注释与字符串再查：注释里**必须**能点出"下一刀要写哪些东西"，那是说明不是实现。
  for (const forbidden of ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'REPLACE']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(musicCodeNoStrings),
      `只读通道里不该出现 ${forbidden}（写侧留给下一刀）`,
    )
  }
  for (const forbidden of ['execSQL', 'compileStatement', 'beginTransaction', 'setTransactionSuccessful', 'endTransaction', 'rawQueryWithFactory', 'insert(', 'update(', 'delete(']) {
    assert.ok(!musicCodeNoStrings.includes(forbidden), `只读通道里不该出现 ${forbidden}`)
  }
  // 唯一的数据库入口是 RainMusicDatabase（不另开库、不 new Helper）。
  assert.match(musicCode, /RainMusicDatabase\.open\(context, RainMusicDatabase\.TABLE_MY_LIST_MUSIC_INFO\)/)
  assert.ok(!musicCode.includes('SQLiteOpenHelper'), '不许另开 helper')
  assert.ok(!musicCode.includes('getSharedPreferences'), '这不走 SharedPreferences')

  // 不广播任何东西：本刀的两条通道都没有"变更通知"这种出口。
  assert.ok(!musicCode.includes('emit'), '读通道不广播')
  assert.ok(!musicCode.includes('RequestContext'), '读通道不碰请求上下文（没有广播出口）')
})

test('范围守卫：只注册这 2 条；player_list_music_get 与其余写通道一条都不碰', () => {
  const registrations = musicCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(registrations.length, 2, '本文件只应注册 check_exist 与 get_list_ids')

  // 通道名字面量只允许出现这 2 个（写侧一条都不许出现）。
  const literals = [...musicCode.matchAll(/"(player_[a-z_]+)"/g)].map(match => match[1])
  assert.deepEqual(
    [...new Set(literals)].sort(),
    ['player_list_music_check_exist', 'player_list_music_get_list_ids'],
    '本刀只做这 2 条纯读通道；player_list_music_get（读里带写）与写侧都留给下一刀',
  )
  assert.equal(literals.length, 2, '通道名字面量不该出现第二遍（注册必须走常量）')

  // 常量也必须只有 2 个 CHANNEL_*。
  assert.deepEqual(
    [...musicCode.matchAll(/String\s+(CHANNEL_[A-Z_]+)\s*=/g)].map(match => match[1]),
    ['CHANNEL_CHECK_EXIST', 'CHANNEL_GET_LIST_IDS'],
  )

  // 第四刀那个文件仍然只注册 1 条（本刀没有把它改成"3 条"）。
  const listRegistrations = stripJavaComments(listJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(listRegistrations.length, 1, '第四刀的文件不该被本刀改动')
  // 其余三个通道文件也不该被本刀改动（合计 5 条 = 2 + 2 + 1）。
  const settingRegistrations = stripJavaComments(settingJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  const dataRegistrations = stripJavaComments(dataJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(settingRegistrations.length, 2)
  assert.equal(dataRegistrations.length, 2)

  // P0-1 的插件里不应该出现"就地实现"（实现必须都在各自的通道文件里）。
  assert.doesNotMatch(stripJavaComments(pluginJava), /RainMusicIpcHandlers\.register\(/)
})

test('注册必须发生在 RainMusicIpcPlugin.load() 里；MainActivity 仍先 registerPlugin 再 super.onCreate()', () => {
  // ⚠️ 这里**必须**去掉注释再匹配（把 `RainMusicListMusicChannels.register(this);` 整行注释掉之后，
  // 用整份源码匹配的用例**依然通过** —— 注释里就写着这一行，而那正是真机上"未注册"的形状）。
  assert.match(
    stripJavaComments(pluginJava),
    /RainMusicListMusicChannels\.register\(this\)/,
    'load() 里必须注册，否则真机 IPC_CHANNEL_UNSUPPORTED（注释掉不算）',
  )
  // 第四刀那条注册也还在（本刀没把它挤掉）。
  assert.match(stripJavaComments(pluginJava), /RainMusicListChannels\.register\(this\)/)

  // 只看代码、不看注释（注释里就写着这句话）。
  const activityCode = stripJavaComments(activityJava)
  const registerPlugin = activityCode.indexOf('registerPlugin(RainMusicIpcPlugin.class)')
  const superOnCreate = activityCode.indexOf('super.onCreate(')
  assert.ok(registerPlugin > -1 && superOnCreate > -1, 'MainActivity 的注册点/父类调用不见了')
  assert.ok(registerPlugin < superOnCreate, 'registerPlugin 必须在 super.onCreate() 之前')
})

test('不假装成功：库打不开 / 表缺失 / 查询失败都抛错，代码里没有"返回 false / 空数组"的退路', () => {
  // 库打不开：消息与第四刀逐字一致（同一个入口）。
  assert.match(dbCode, /throw new IllegalStateException\(\s*"打不开数据库 " \+ path/)
  // 表缺失：点名是哪张表（本刀要求的是 my_list_music_info）。
  assert.match(dbCode, /里没有表/)
  assert.match(dbCode, /这不是本应用建的库/)

  // 两条通道各自的 catch：第一条出路就是 throw（不是"先给个 false / 空数组"）。
  assert.match(musicCode, /catch \(Exception ex\) \{\s*throw new IllegalStateException\(/)
  assert.equal((musicCode.match(/catch \(Exception ex\) \{/g) ?? []).length, 2, '两条通道各有一处 catch')
  // 关键：**不许**吞异常返回"查不到"。
  assert.ok(!/catch[\s\S]{0,300}?return false;/.test(musicCode), '不许吞异常返回 false')
  assert.ok(!/catch[\s\S]{0,300}?return new JSONArray\(\)/.test(musicCode), '不许吞异常返回空数组')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(musicCode), '不许空 catch')
  // 失败消息里必须点名表名与"不会假装"（否则真机上只有一个无信息量的 ok:false）。
  assert.match(musicCode, /private static String readFailureMessage\(String sql, Exception ex\)/)
  assert.match(musicCode, /RainMusicDatabase\.TABLE_MY_LIST_MUSIC_INFO \+ "\\" 失败/)
  // ⚠️ 消息里是 `**不会**`（Markdown 强调），正则不要写成朴素的中文串。
  assert.match(musicCode, /不会\*\*返回空数组假装/)
  assert.match(musicCode, /不会\*\*返回 false/)

  // 游标在 finally 里关（两条路径都不漏）。
  assert.equal((musicCode.match(/finally \{\s*if \(cursor != null\) cursor\.close\(\);/g) ?? []).length, 2, '两处都要在 finally 里关游标')

  // 只读通道不自己造锁（唯一那把共享锁属于 SharedPreferences 写入）。
  assert.ok(!musicCode.includes('new Object()'), '读通道不该自己造锁')
  assert.ok(!musicCode.includes('WRITE_LOCK'), '读通道与第三刀那把锁无关')
  assert.equal((musicCode.match(/synchronized/g) ?? []).length, 0, '只读通道不需要 synchronized')
})

test('RainMusicDatabase：open(context) 语义不变，新增"调用方点名要读哪些表"的重载，且仍然只有一处 synchronized', () => {
  // 第四刀那条通道的调用点/语义一个字都没改。
  assert.match(stripJavaComments(listJava), /SQLiteDatabase db = RainMusicDatabase\.open\(context\);/)
  assert.match(dbCode, /static SQLiteDatabase open\(Context context\) \{\s*return open\(context, TABLE_MY_LIST\);/)
  // 新重载：可变参数要求的表逐个检查。
  assert.match(dbCode, /static SQLiteDatabase open\(Context context, String\.\.\. requiredTables\)/)
  assert.match(dbCode, /for \(String table : requiredTables\) \{\s*requireTable\(db, path, table\);/)
  // synchronized 仍然只有懒建 helper 那一处（第五刀没有引入第二把锁）。
  assert.equal((dbCode.match(/synchronized/g) ?? []).length, 1, 'DB 层只应有一处 synchronized（懒建 helper）')
  // requireTable 的消息是带表名的（所以 my_list_music_info 缺失时错误信息里就是它）。
  assert.match(dbCode, /"数据库 " \+ path \+ " 里没有表 \\"" \+ table/)
})

test('并发形状：没有新的锁 / 没有跨调用共享状态 / 游标读完就关 / 不开显式事务', () => {
  // 两条通道都只有一条 SELECT，没有任何 read-modify-write 的痕迹。
  assert.equal((musicCode.match(/rawQuery\(/g) ?? []).length, 2, '两条通道各一条查询')
  assert.ok(!/musicData|musicLists|userLists|rawPoss|queueStartupRestorePending/.test(musicCode), '不许照抄桌面那套模块级缓存 / 恢复标志')
  // 没有跨调用的静态可变状态：唯一的非 final 静态字段就是那个 helper 单例
  // （`helper(Context)` 是方法、不带 `=`，所以不会被这条正则捞进来）。
  const mutableStatics = [...dbCode.matchAll(/\bprivate static\s+(?!final\b)(?:volatile\s+)?([A-Za-z_][\w.<>[\]]*)\s+(\w+)\s*=/g)]
    .map(match => match[2])
  assert.deepEqual(mutableStatics, ['helper'], 'DB 层除 helper 外不该有可变静态字段')
  assert.match(dbCode, /private static volatile Helper helper = null/)
  // 单条 SELECT 就是隐式读事务：读通道不开显式事务。
  assert.ok(!musicCodeNoStrings.includes('beginTransaction'), '读通道不开显式事务')
  // 连接不关（桌面同样把连接留到进程退出）。
  assert.ok(!/RainMusicDatabase[\s\S]{0,80}?\.close\(\)/.test(musicCode), '读通道不许关掉进程级连接')
})

test('本刀不做 player_list_music_get：它的写回依赖必须能在源码里被指出来（给下一刀决策）', () => {
  // 这是"为什么把它留作单独一刀"的证据链：读默认歌单时会去重并**写回**库。
  assert.match(listIndexTs, /export const getListMusics = async\(listId: string\): Promise<Rain\.Music\.MusicInfo\[\]>/)
  assert.match(listIndexTs, /if \(listId == LIST_IDS\.DEFAULT\) \{/)
  assert.match(listIndexTs, /const merged = dedupePlaybackQueue\(targetList\)/)
  assert.match(listIndexTs, /if \(merged\.length != targetList\.length\) \{/)
  assert.match(listIndexTs, /await overwriteMusicInfo\(listId, toDBMusicInfo\(merged, listId\), restoreSnapshot\)/)
  // overwriteMusicInfo 的三类写：db_info 快照 + 删 + 插（同一个事务）。
  assert.match(dbHelperTs, /export const overwriteMusicInfo = async\(listId: string, musicInfos: Rain\.DBService\.MusicInfo\[\], startupRestoreSnapshot\?: QueueRestoreRecord\[\]\)/)
  assert.match(dbHelperTs, /INSERT INTO db_info \(field_name, field_value\) VALUES \(\?, \?\)/)
  assert.match(dbHelperTs, /await musicInfoDeleteByListIdStatement\.run\(listId\)/)
  assert.match(dbHelperTs, /await musicInfoOrderDeleteByListIdStatement\.run\(listId\)/)
  assert.match(dbHelperTs, /await db\.transaction\(/)
  // 那条快照本身还有一套读写（桌面 winMain_get_data 里会收尾）。
  assert.match(dbHelperTs, /QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'/)
  assert.match(dbHelperTs, /export const clearPlaybackQueueRestoreSnapshot/)
  assert.match(listIndexTs, /let queueStartupRestorePending = true/)
  assert.match(listIndexTs, /export const resolvePlaybackQueueRestoreIndex/)
  assert.match(listIndexTs, /export const completePlaybackQueueRestore/)
  assert.match(read('src/main/modules/winMain/rendererEvent/data.ts'), /resolvePlaybackQueueRestoreIndex/)

  // Android 侧：这条"读里带写"的通道**没有**被注册（本刀范围外），而且窗口/设置那两条通道
  // 也没有实现桌面那一支的"播放队列恢复校正"（第三刀已明确登记为未实现）。
  assert.ok(!musicCode.includes('player_list_music_get"'), 'player_list_music_get 本刀不做')
  const dataCode = stripJavaComments(dataJava)
  assert.match(dataCode, /桌面版的「播放队列恢复校正」\*\*没有执行\*\*/)
  assert.ok(!dataCode.includes('playback_queue_startup_restore'), 'Android 侧目前没有任何生产者/消费者')
})

// ---------------------------------------------------------------------------
// JS 侧接线检查：桥 + "按 Java 语义实现"的原生替身
// ---------------------------------------------------------------------------

/**
 * 原生侧替身，语义与 `RainMusicListMusicChannels` / `RainMusicDatabase` 对齐
 * （每条旁边写清它抄的是 Java 的哪一段）：
 *
 * - **`check_exist`**：resolve 一个布尔（有行 ⇒ true）。缺键 / 类型不对 ⇒ reject（Java 抛
 *   `IllegalArgumentException`）；`null` ⇒ 不查库直接 resolve `false`（Java 短路）；
 *   库打不开 / 表缺失 / 查询失败 ⇒ reject，**绝不** resolve 成 `false`；
 * - **`get_list_ids`**：resolve 一个 `listId` 数组（按行顺序，不去重不排序）。
 *   `null` ⇒ `[]`；坏 ⇒ reject，**绝不** resolve 成 `[]`；
 * - **未注册**：invoke 立刻 `IPC_CHANNEL_UNSUPPORTED`（本刀只注册这 2 条）。
 */
const makeNativeListMusic = (options = {}) => {
  /** 库的内容 / 故障。`failure` ∈ null | 'unopenable' | 'missing-table' | 'query-failed'。 */
  const state = { rows: options.rows ?? [], failure: options.failure ?? null }

  const native = {
    postCalls: [],
    /** 原生 → 渲染层的**全部**消息条数（一次 invoke 应当**正好** 1 条：那条应答）。 */
    notifies: 0,
    unregisteredSends: [],

    post(envelope) {
      native.postCalls.push(envelope)
      const kind = envelope.kind
      if (kind !== 'invoke' && kind !== 'send') return Promise.resolve({ accepted: true })

      const { id, channel } = envelope
      const args = Array.isArray(envelope.args) ? envelope.args : []
      // P0-1：send 是单向的 ⇒ 只有 invoke 才把结果/错误回给渲染层。
      const accept = payload => {
        if (kind !== 'invoke') return
        native.notify({ id, kind: 'response', channel, ok: true, result: payload })
      }
      const reject = (code, message) => {
        if (kind !== 'invoke') return
        native.notify({ id, kind: 'response', channel, ok: false, error: { code, message } })
      }
      /** Java `RainMusicIpcPlugin.runHandler`：handler 抛异常 ⇒ `ok:false, IPC_HANDLER_FAILED`。 */
      const failed = message => reject('IPC_HANDLER_FAILED', message)

      if (channel !== CHANNEL_CHECK_EXIST && channel !== CHANNEL_GET_LIST_IDS) {
        // 未注册（例如本刀故意不做的 player_list_music_get）。
        native.unregisteredSends.push(channel)
        reject('IPC_CHANNEL_UNSUPPORTED', '原生侧还没有注册通道：' + channel)
        return Promise.resolve({ accepted: true })
      }

      // Java `RainMusicDatabase.open()` 的两条失败路径（在参数校验**之后**才走到，见下面的顺序）。
      const openFailure = () => {
        if (state.failure === 'unopenable') {
          failed('打不开数据库 /data/data/com.rainmusic.mobile/databases/rain.data.db：file is not a database')
          return true
        }
        if (state.failure === 'missing-table') {
          failed('数据库 /data/data/com.rainmusic.mobile/databases/rain.data.db 里没有表 "my_list_music_info"：这不是本应用建的库，或者它已经损坏。')
          return true
        }
        if (state.failure === 'query-failed') {
          failed('读 "my_list_music_info" 失败（SELECT … WHERE "id"=?）：no such column: nope。')
          return true
        }
        return false
      }

      if (channel === CHANNEL_CHECK_EXIST) {
        // Java `readParamsObject()`：args[0] 必须是对象，两个键都必须存在。
        const params = args[0]
        if (params == null || typeof params !== 'object') {
          failed(CHANNEL_CHECK_EXIST + ' 需要一个对象参数 `{listId, musicInfoId}`，收到 ' + JSON.stringify(args))
          return Promise.resolve({ accepted: true })
        }
        for (const key of ['listId', 'musicInfoId']) {
          if (!Object.hasOwn(params, key)) {
            failed(CHANNEL_CHECK_EXIST + ' 的参数缺少 `' + key + '` 字段')
            return Promise.resolve({ accepted: true })
          }
        }
        for (const key of ['listId', 'musicInfoId']) {
          const value = params[key]
          if (value !== null && typeof value !== 'string') {
            failed(CHANNEL_CHECK_EXIST + ' 的参数 `' + key + '` 必须是字符串或 null，收到 ' + typeof value)
            return Promise.resolve({ accepted: true })
          }
        }
        // Java：任一为 null ⇒ 不查库、直接 false（与桌面把 null 绑成 SQL NULL 等价）。
        if (params.listId === null || params.musicInfoId === null) {
          accept(false)
          return Promise.resolve({ accepted: true })
        }
        if (openFailure()) return Promise.resolve({ accepted: true })
        // Java：`WHERE "id"=? AND "listId"=?` + moveToFirst()（UNIQUE(id,listId) ⇒ 最多一行）。
        accept(state.rows.some(row => row.id === params.musicInfoId && row.listId === params.listId))
        return Promise.resolve({ accepted: true })
      }

      // Java `readBareString()`：args[0] 必须是字符串或 JSON null（不是对象）。
      // ⚠️ "缺参数"与"显式传 null"必须分开（Java 也是这样分的）：
      //    - 缺参数（invoke(channel) / 末端 undefined 被桥的 normalizeArgs 裁掉）⇒ args 为空
      //      ⇒ Java `args.isEmpty()` ⇒ 抛 IllegalArgumentException ⇒ reject；
      //    - 显式 null ⇒ 过桥之后 Java 看到的是 `JSONObject.NULL`（**不是** Java null）
      //      ⇒ `readBareString` 返回 null ⇒ 短路成 []（与桌面把 null 绑成 SQL NULL 等价）。
      if (args.length === 0 || args[0] === undefined) {
        failed(CHANNEL_GET_LIST_IDS + ' 需要一个字符串参数 musicInfoId，收到 ' + JSON.stringify(args))
        return Promise.resolve({ accepted: true })
      }
      const musicInfoId = args[0]
      if (musicInfoId === null) {
        // Java：`if (musicInfoId == null) { … return new JSONArray(); }`（在 open() 之前）。
        accept([])
        return Promise.resolve({ accepted: true })
      }
      if (typeof musicInfoId !== 'string') {
        failed(CHANNEL_GET_LIST_IDS + ' 的参数必须是字符串，收到 ' + typeof musicInfoId)
        return Promise.resolve({ accepted: true })
      }
      if (openFailure()) return Promise.resolve({ accepted: true })
      // Java：`WHERE "id"=?` 逐行取 listId（顺序 = 行顺序，不去重不排序）。
      accept(state.rows.filter(row => row.id === musicInfoId).map(row => row.listId))
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
  const native = makeNativeListMusic(options)
  const mod = load(BRIDGE_MODULE, {}, {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native, timeoutMs: 15000 },
  })
  return { mod, native }
}

test('check_exist：invoke 的信封是 args=[{listId, musicInfoId}]，命中 ⇒ true、没命中 ⇒ false', async() => {
  const { mod, native } = setup({ rows: [{ id: 'm-1', listId: 'list-1' }, { id: 'm-1', listId: 'list-2' }] })

  assert.equal(await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 'list-2', musicInfoId: 'm-1' }), true)
  assert.equal(await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 'list-9', musicInfoId: 'm-1' }), false)
  // 音乐 id 对了但歌单不对 ⇒ false（不是"这首歌存在"的意思，与桌面同一条件）。
  assert.equal(await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 'list-1', musicInfoId: 'm-9' }), false)

  // 信封形状：invoke、参数是**一个**对象（契约 :115 的 {listId, musicInfoId}）。
  // ⚠️ 用 JSON.stringify 比对：参数数组是在 `vm.runInNewContext` 里造出来的（另一个 realm），
  // `assert.deepEqual` 会因为原型不同而假失败（第四刀踩过同一个坑）。
  const first = native.postCalls[0]
  assert.equal(first.channel, CHANNEL_CHECK_EXIST)
  assert.equal(first.kind, 'invoke')
  assert.equal(first.args.length, 1)
  assert.equal(JSON.stringify(first.args[0]), JSON.stringify({ listId: 'list-2', musicInfoId: 'm-1' }))
  assert.equal(native.notifies, 3, '三次 invoke 只应收到三条应答（多出来的就是广播）')

  // 对照的源码断言（替身与 Java 一旦漂移，这些断言还在）。
  assert.match(musicCode, /new String\[\] \{ musicInfoId, listId \}/)
  assert.match(musicCode, /return cursor\.moveToFirst\(\);/)
})

test('get_list_ids：invoke 的信封是 args=[musicInfoId]（裸字符串），返回按行顺序的 listId 数组', async() => {
  const { mod, native } = setup({
    rows: [
      { id: 'm-1', listId: 'list-2' },
      { id: 'm-2', listId: 'list-1' },
      { id: 'm-1', listId: 'list-1' },
    ],
  })

  const ids = await mod.bridge.invoke(CHANNEL_GET_LIST_IDS, 'm-1')
  // 顺序 = SQL 结果顺序（不是排序后的 list-1, list-2），也不去重。
  assert.equal(JSON.stringify(ids), JSON.stringify(['list-2', 'list-1']))
  assert.equal(JSON.stringify(await mod.bridge.invoke(CHANNEL_GET_LIST_IDS, 'm-9')), JSON.stringify([]))

  const first = native.postCalls[0]
  assert.equal(first.channel, CHANNEL_GET_LIST_IDS)
  assert.equal(first.kind, 'invoke')
  // 裸字符串（不是对象、不是数组）—— JSON.stringify(值) 与 JSON.stringify([值]) 的区别就锁在这里。
  assert.equal(JSON.stringify(first.args), JSON.stringify(['m-1']))

  // 对照的源码断言。
  assert.match(musicCode, /new String\[\] \{ musicInfoId \}/)
  assert.match(musicCode, /listIds\.put\(jsonValue\(cursor\.getString\(listIdIndex\)\)\)/)
})

test('"查不到"与"库坏了"在 JS 侧必须是两种表现（false / [] vs reject）', async() => {
  // ① 空库 / 查不到：resolve 成"空"的正确取值，**不是** reject。
  const empty = setup({ rows: [] })
  assert.equal(await empty.mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 'l', musicInfoId: 'm' }), false)
  assert.equal(JSON.stringify(await empty.mod.bridge.invoke(CHANNEL_GET_LIST_IDS, 'm')), JSON.stringify([]))

  // ② 库打不开 / 表缺失 / 查询失败：两条通道都必须 reject，绝不 resolve 成"查不到"。
  for (const failure of ['unopenable', 'missing-table', 'query-failed']) {
    const { mod } = setup({ rows: [], failure })
    const checkError = await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 'l', musicInfoId: 'm' }).then(
      () => { throw new Error(`不应该 resolve：${failure} 必须 reject，否则"坏了"会被伪装成"这首歌不在歌单里"`) },
      err => err,
    )
    assert.equal(checkError.code, 'IPC_HANDLER_FAILED')
    assert.equal(checkError.channel, CHANNEL_CHECK_EXIST)
    if (failure === 'missing-table') assert.match(checkError.message, /没有表 "my_list_music_info"/)
    if (failure === 'unopenable') assert.match(checkError.message, /打不开数据库/)
    if (failure === 'query-failed') assert.match(checkError.message, /读 "my_list_music_info" 失败/)

    const idsError = await mod.bridge.invoke(CHANNEL_GET_LIST_IDS, 'm').then(
      () => { throw new Error(`不应该 resolve：${failure} 必须 reject，否则"坏了"会被伪装成"不在任何歌单里"`) },
      err => err,
    )
    assert.equal(idsError.code, 'IPC_HANDLER_FAILED')
    assert.equal(idsError.channel, CHANNEL_GET_LIST_IDS)
  }

  // 对照的源码断言：表缺失检查是"调用方点名的表"，两条通道都点名 my_list_music_info。
  assert.match(dbCode, /for \(String table : requiredTables\)/)
  assert.equal((musicCode.match(/RainMusicDatabase\.open\(context, RainMusicDatabase\.TABLE_MY_LIST_MUSIC_INFO\)/g) ?? []).length, 2)
})

test('参数错误：缺键 / 类型不对 ⇒ reject（不是静默 false / []）；null ⇒ 不查库、给"查不到"', async() => {
  const { mod, native } = setup({ rows: [{ id: 'm-1', listId: 'l-1' }] })

  // 缺键：桌面那一支拿到 undefined，better-sqlite3 绑不上 ⇒ 桌面本来就抛。
  const missing = await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 'l-1' }).then(
    () => { throw new Error('不应该 resolve：缺 musicInfoId 必须失败') },
    err => err,
  )
  assert.equal(missing.code, 'IPC_HANDLER_FAILED')
  assert.match(missing.message, /缺少 `musicInfoId` 字段/)

  // 类型不对（数字）：本刀**有意**拒绝（静默返回 false 会让界面显示"这首歌不在任何歌单里"）。
  const wrongType = await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: 1, musicInfoId: 'm-1' }).then(
    () => { throw new Error('不应该 resolve：类型不对必须失败') },
    err => err,
  )
  assert.equal(wrongType.code, 'IPC_HANDLER_FAILED')
  assert.match(wrongType.message, /必须是字符串或 null/)

  const wrongBare = await mod.bridge.invoke(CHANNEL_GET_LIST_IDS, { musicInfoId: 'm-1' }).then(
    () => { throw new Error('不应该 resolve：get_list_ids 的参数是裸字符串，不是对象') },
    err => err,
  )
  assert.equal(wrongBare.code, 'IPC_HANDLER_FAILED')
  assert.match(wrongBare.message, /必须是字符串/)

  // null：不是参数错误，直接给"查不到"（与桌面把 null 绑成 SQL NULL 等价）。
  const beforeNull = native.postCalls.length
  assert.equal(await mod.bridge.invoke(CHANNEL_CHECK_EXIST, { listId: null, musicInfoId: 'm-1' }), false)
  assert.equal(JSON.stringify(await mod.bridge.invoke(CHANNEL_GET_LIST_IDS, null)), JSON.stringify([]))
  assert.equal(native.postCalls.length - beforeNull, 2, 'null 也要走完一次 invoke（只是不查库）')
  // 显式 null 在**线缆上**就是 `args=[null]`（桥的 normalizeArgs 只裁末端的 undefined）——
  // 所以 Java 侧"缺参数"与"传 null"确实是两条路（见 readBareString）。
  assert.equal(JSON.stringify(native.postCalls[native.postCalls.length - 1].args), JSON.stringify([null]))

  // "缺参数"与"传 null"必须表现不同：前者 reject，后者给"查不到"。
  const missingBare = await mod.bridge.invoke(CHANNEL_GET_LIST_IDS).then(
    () => { throw new Error('不应该 resolve：缺参数必须失败（桌面在这一点上抛 TypeError）') },
    err => err,
  )
  assert.equal(missingBare.code, 'IPC_HANDLER_FAILED')
  assert.match(missingBare.message, /需要一个字符串参数 musicInfoId/)

  // 对照的源码断言。
  assert.match(musicCode, /if \(!payload\.has\(key\)\)/)
  assert.match(musicCode, /if \(listId == null \|\| musicInfoId == null\) \{/)
  assert.match(musicCode, /if \(musicInfoId == null\) \{/)
})

test('本刀故意不做的 player_list_music_get：invoke 它拿到 IPC_CHANNEL_UNSUPPORTED（大声失败）', async() => {
  const { mod, native } = setup({ rows: [] })
  const channel = PLAYER_EVENT_NAME.list_music_get
  assert.equal(channel, 'player_list_music_get')

  const error = await mod.bridge.invoke(channel, 'default').then(
    () => { throw new Error('不应该 resolve：这条通道本刀没做，必须大声失败') },
    err => err,
  )
  assert.equal(error.code, 'IPC_CHANNEL_UNSUPPORTED')
  assert.deepEqual(native.unregisteredSends, [channel])
  // 一次正常读取只带来那一条应答，一条广播都没有。
  assert.equal(native.notifies, 1, '读通道不广播')
})
