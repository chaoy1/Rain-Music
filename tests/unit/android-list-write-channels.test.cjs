/**
 * Android 移植 · **P0-2 第八刀**（`player_list_update`：改名，invoke + 同名广播两半）
 * 的契约 / 接线 / 落点 / 范围回归网。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**没有在 Android 上跑过任何东西**，也**没有真的开过 SQLite** —— 所以它**不能**证明这条通道
 * 在真机上不再是 `IPC_CHANNEL_UNSUPPORTED`、不能证明 `bindString`/`bindLong` 在真机 SQLite 上
 * 的实际落库形状、不能证明 `ctx.emitTo` 在真机上真的到达 WebView。那几件事只能由 CI 的
 * `gradlew assembleDebug`（编译）→ 真机运行（行为）来证明。
 *
 * 它由三组证据组成，三组各自**只**回答一个问题：
 *
 * 1. **源码形状组**：通道名 == `ipcNames.ts` 生成的真实通道名；形状 == 契约 `ipc-contract.md:104`
 *    （`listInfos[]` → `void`）且那一行本刀改成了"双向"；桌面四段链（
 *    `rendererListManage.ts:53-56` → `rendererEvent.ts:18-20` → `ListEvent.ts:71-75` →
 *    `winRendererEvent.ts:15-17` + 订阅 `rendererListManage.ts:231`）逐字对得上；
 *    `SQL_LIST_UPDATE` 与 `statements.ts:56-62` 归一化后**逐字一致**（**4 列、没有 position**）；
 *    表结构对齐 `tables.ts:128-138`（`position` 是 `INTEGER NOT NULL` ⇒ 它不能出现在 SET 里）；
 *    `LIST_WRITE_LOCK` 是 `private static final Object`、**临界区里没有 emit**、
 *    emit 在锁块**之后**；失败三态（参数非法 ⇒ `IllegalArgumentException` 点名；库打不开 /
 *    表缺失 ⇒ 复用 `RainMusicDatabase.open` / `requireTable`）。
 *
 * 2. **渲染层接线组（真 JS）**：用真的桥（`capacitor.js`）+ **真的** `rendererListManage.ts`
 *    与**真的** `action.ts`（只把它们的 import 换成替身），跑一遍
 *    "原生 `{kind:'event', channel:'player_list_update', args:[payload]}` → 渲染层 state 被改"。
 *    它钉住的是**广播载荷必须是裸数组**：包成对象 ⇒ `for…of` 抛 `TypeError` ⇒ 被桥自己吞成
 *    **一条 `console.error`**（`capacitor.js:464-467`）⇒ 界面完全不动。
 *
 * 3. **JVM 行为组（真 `javac` + 真 `java`）**：把 `RainMusicListWriteChannels.java` 与
 *    **没改过的** `RainMusicIpcHandlers.java` 连同一组**手写替身**（假 `SQLiteDatabase` /
 *    假 `org.json` / 假 `Logger` / 假 `RainMusicDatabase` / 假 `RainMusicIpcPlugin`）编一遍并运行
 *    （exit 0），用"观察者探针"把每个场景的结果打印成 `section<TAB>key<TAB>value`，
 *    断言全部在**本 JS 文件**里。它覆盖的是本文件的**控制流**：
 *    锁（同一时刻只可能有一个事务开着）、emit 在 `commit` 之后且在锁外、
 *    失败时**不广播**、载荷的**形状与绑定顺序**、0 行命中 = 成功、半批失败 ⇒ 整个事务回滚、
 *    空数组 ⇒ 0 条 SQL + 提交 + 广播空数组。
 *    ⚠️ 替身的签名是人手写的，与真框架 API 一旦不一致，这次 `javac` 不会发现；而
 *    `RainMusicDatabase` 在本组里是**替身**（真文件的建表 / 迁移 / `requireTable` 语义不在
 *    本组覆盖范围内，那些由 `android-list-channels.test.cjs` 等用例在源码层面对齐）。
 *    本机没有 javac 时这一组跳过。
 *
 * 范围守卫：本文件本身**只注册 1 条**通道（`player_list_update`），**不改**第四 / 五 / 六 /
 * 七刀与第一 / 二 / 三刀的任何一个文件（那些文件的注册条数在这里被重新数一遍），
 * 也不碰 `player_list_add` / `player_list_remove`（第九 / 第十刀）。
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
const JAVA_REL_DIR = 'android/app/src/main/java/com/rainmusic/mobile/ipc'

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readJava = name => read(`${JAVA_REL_DIR}/${name}`)

const writeJava = readJava('RainMusicListWriteChannels.java')
const handlersJava = readJava('RainMusicIpcHandlers.java')
const listJava = readJava('RainMusicListChannels.java')
const musicJava = readJava('RainMusicListMusicChannels.java')
const musicGetJava = readJava('RainMusicListMusicGetChannels.java')
const dataJava = readJava('RainMusicDataChannels.java')
const settingJava = readJava('RainMusicAppSettingChannels.java')
const pluginJava = readJava('RainMusicIpcPlugin.java')
const dbJava = readJava('RainMusicDatabase.java')

const statementsTs = read('src/main/worker/dbService/modules/list/statements.ts')
const dbHelperTs = read('src/main/worker/dbService/modules/list/dbHelper.ts')
const tablesTs = read('src/main/worker/dbService/tables.ts')
const desktopEventTs = read('src/main/modules/commonRenderers/list/rendererEvent.ts')
const desktopListEventTs = read('src/main/event/ListEvent.ts')
const desktopWinRendererEventTs = read('src/main/modules/commonRenderers/list/winRendererEvent.ts')
const rendererListManageTs = read('src/renderer/store/list/listManage/rendererListManage.ts')
const rendererActionTs = read('src/renderer/store/list/listManage/action.ts')
const contractMd = read('docs/android/ipc-contract.md')

/** 去掉注释再匹配（前几刀都踩过这个坑：注释里就写着那行代码，用整份源码匹配会放过"被注释掉"）。 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

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

/**
 * 从 `marker` 之后第一个 `{` 开始做花括号配对，返回块体与它在整份源码里的区间。
 * 用来回答"emit 到底在不在锁里"这种**只有解析过括号才能回答**的问题 ——
 * 单纯 indexOf 比对会被"把 emit 挪到 synchronized 块里、顺序看起来仍然靠后"骗过。
 */
const blockRange = (source, marker) => {
  const start = source.indexOf(marker)
  assert.ok(start > -1, `找不到 ${marker}`)
  const open = source.indexOf('{', start)
  assert.ok(open > -1, `${marker} 后面没有 {`)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return { start, open, end: i, body: source.slice(open + 1, i) }
    }
  }
  assert.fail(`${marker} 的花括号不配对`)
}

/** 与桌面 `verifyDB.ts:4` 的那条正则逐字相同（`/\n|\s|;|--.+/g`）。 */
const normalizeSql = sql => sql.replace(/\n|\s|;|--.+/g, '')
/** better-sqlite3 的具名参数 → Android 的位置参数（逐个按出现顺序替换，锁住参数先后）。 */
const toPositionalSql = sql => sql.replace(/@\w+/g, '?')

const writeCode = stripJavaComments(writeJava)
const dbCode = stripJavaComments(dbJava)

const { PLAYER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})
const CHANNEL = PLAYER_EVENT_NAME.list_update
/** 桌面那一条 UPDATE（`statements.ts:56-62` 的 `createListUpdateStatement`）。 */
const desktopUpdateSql = statementsTs.match(/createListUpdateStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.UserListInfo\]>\(`([\s\S]*?)`\)/)[1]
/** 桌面 `updateUserLists` 的事务边界（`dbHelper.ts:99-105`）。 */
const desktopUpdateHelper = dbHelperTs.match(/export const updateUserLists[\s\S]*?\}\)\(lists\)/)[0]

const noop = () => {}

// ---------------------------------------------------------------------------
// 1. 形状：通道名 / invoke / 广播 / 契约那一行
// ---------------------------------------------------------------------------

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED）', () => {
  assert.equal(CHANNEL, 'player_list_update', 'ipcNames.ts 的真实值变了？')
  assert.equal(javaConstant(writeJava, 'CHANNEL_LIST_UPDATE'), CHANNEL)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量但忘了 register 的话，真机上依然是"未注册"。
  assert.match(writeCode, /RainMusicIpcHandlers\.register\(\s*CHANNEL_LIST_UPDATE\s*,/)
  // 注册必须走常量（字面量一旦与 ipcNames.ts 漂移，本机就测不出来了）。
  assert.ok(!writeCode.includes('RainMusicIpcHandlers.register("'), '注册必须走常量')
})

test('形状 == 契约 :104：mainHandle（invoke）+ **同名广播**（本刀把那一行改成"双向"）', () => {
  // 契约那一行逐字钉住（改了契约就该回来看这条用例）。
  assert.ok(
    contractMd.includes('| `player_list_update` | 双向：`updateUserList` `R:listManage:55`；监听 `R:listManage:231` | 接收 `M:list:18`；发送 `M:listSend:16` | `listInfos[]` → `void` | 改歌单元信息 |'),
    '契约 :104 那一行变了 → 本通道的形状必须重新核对',
  )

  // 桌面四段链：渲染层封装 → mainHandle → ListEvent → dbService。
  assert.match(
    rendererListManageTs,
    /rendererInvoke<Rain\.List\.ListActionUpdate>\(PLAYER_EVENT_NAME\.list_update, data\)/,
    'updateUserList 必须是 rendererInvoke(channel, data)',
  )
  assert.match(
    desktopEventTs,
    /mainHandle<Rain\.List\.ListActionUpdate>\(PLAYER_EVENT_NAME\.list_update/,
    '主进程那一支必须是 mainHandle（invoke），不是 mainOn',
  )
  assert.match(desktopListEventTs, /this\.emit\('list_update', lists\)/, 'ListEvent 必须把同一个 lists 往后传')
  assert.match(
    desktopListEventTs,
    /await global\.rain\.worker\.dbService\.updateUserLists\(lists\)\s*\n\s*this\.emit\('list_update', lists\)/,
    '桌面是"先落库、再广播"——顺序不能反',
  )

  // 广播那一半：**裸数组**（不是 {listInfos}）。
  assert.match(
    desktopWinRendererEventTs,
    /sendEvent<Rain\.List\.ListActionUpdate>\(PLAYER_EVENT_NAME\.list_update, lists\)/,
    'winRendererEvent 发的必须是裸数组',
  )
  assert.ok(
    !/list_update,\s*\{\s*listInfos/.test(desktopWinRendererEventTs),
    '广播载荷不能包成 {listInfos}',
  )

  // 渲染层订阅 + 监听器体（契约注里点名的行号必须真的是这几行）。
  assert.match(
    rendererListManageTs,
    /const list_update = \(\{ params: listInfos \}: Rain\.IpcRendererEventParams<Rain\.List\.ListActionUpdate>\) => \{\s*\n\s*userListsUpdate\(listInfos\)/,
  )
  assert.match(rendererListManageTs, /rendererOn\(PLAYER_EVENT_NAME\.list_update, list_update\)/)
  assert.ok(
    !/rendererSend\w*\(\s*PLAYER_EVENT_NAME\.list_update/.test(rendererListManageTs),
    'invoke 那一半不能走 send / sendSync',
  )
})

test('契约注里点名的三个订阅行号（:229/:230/:231）与桌面源码逐行对得上', () => {
  const rendererLines = rendererListManageTs.split('\n')
  assert.match(rendererLines[228], /rendererOn\(PLAYER_EVENT_NAME\.list_add, list_create\)/)
  assert.match(rendererLines[229], /rendererOn\(PLAYER_EVENT_NAME\.list_remove, list_remove\)/)
  assert.match(rendererLines[230], /rendererOn\(PLAYER_EVENT_NAME\.list_update, list_update\)/)

  const winRendererLines = desktopWinRendererEventTs.split('\n')
  assert.match(winRendererLines[9], /sendEvent<Rain\.List\.ListActionAdd>\(PLAYER_EVENT_NAME\.list_add, \{ position, listInfos \}\)/)
  assert.match(winRendererLines[12], /sendEvent<Rain\.List\.ListActionRemove>\(PLAYER_EVENT_NAME\.list_remove, ids\)/)
  assert.match(winRendererLines[15], /sendEvent<Rain\.List\.ListActionUpdate>\(PLAYER_EVENT_NAME\.list_update, lists\)/)

  const mainEventLines = desktopEventTs.split('\n')
  assert.match(mainEventLines[11], /mainHandle<Rain\.List\.ListActionAdd>\(PLAYER_EVENT_NAME\.list_add/)
  assert.match(mainEventLines[14], /mainHandle<Rain\.List\.ListActionRemove>\(PLAYER_EVENT_NAME\.list_remove/)
  assert.match(mainEventLines[17], /mainHandle<Rain\.List\.ListActionUpdate>\(PLAYER_EVENT_NAME\.list_update/)

  // 另外两条"双向"也一起记进了文档（本刀只补这三条，不改别的行）。
  assert.ok(contractMd.includes('| `player_list_add` | 双向：`createUserList` `R:listManage:38`；监听 `R:listManage:229` | 接收 `M:list:12`；发送 `M:listSend:10` | `{position, listInfos}` → `void` | 新建歌单 |'))
  assert.ok(contractMd.includes('| `player_list_remove` | 双向：`removeUserList` `R:listManage:46`；监听 `R:listManage:230` | 接收 `M:list:15`；发送 `M:listSend:13` | `ids: string[]` → `void` | 删除歌单 |'))
  // 表下那条注必须点明"裸数组 / 不能包成对象"以及它的代价（被桥吞成一条 console.error）。
  assert.match(contractMd, /> \*\*上面三条"双向"的广播载荷形状（照抄，别自己包装）\*\*/)
  assert.ok(contractMd.includes('裸数组'))
  assert.ok(contractMd.includes('console.error'))
})

// ---------------------------------------------------------------------------
// 2. SQL 落点：语句逐字对齐 statements.ts，表结构逐字对齐 tables.ts
// ---------------------------------------------------------------------------

test('UPDATE 逐字对齐 statements.ts:56-62（**4 列、SET 里没有 position**）', () => {
  // 先钉住桌面那一条（引用没写错文件）。
  assert.match(statementsTs, /createListUpdateStatement/)
  assert.match(desktopUpdateSql, /UPDATE "main"\."my_list"/)
  assert.match(desktopUpdateSql, /WHERE "id"=@id/)

  const javaSql = javaTextBlock(writeJava, 'SQL_LIST_UPDATE')
  assert.equal(
    normalizeSql(javaSql),
    normalizeSql(toPositionalSql(desktopUpdateSql)),
    'Java 的 SQL_LIST_UPDATE 必须与 statements.ts:56-62 的更新语句逐字一致（只允许 @x → ?）',
  )

  // 归一化比对抓不住"把 position 也塞进 SET"这种"看着很像"的改动，所以按列再断一次。
  const columns = text => [...text.match(/SET([\s\S]*?)WHERE/)[1].matchAll(/"(\w+)"\s*=\s*[@?]/g)].map(match => match[1])
  assert.deepEqual(columns(desktopUpdateSql), ['name', 'source', 'sourceListId', 'locationUpdateTime'])
  assert.deepEqual(columns(javaSql), ['name', 'source', 'sourceListId', 'locationUpdateTime'])
  assert.ok(!/position/.test(javaSql), 'SET 里不许出现 position（桌面那一句里就没有它）')
  assert.ok(!writeCode.includes('position'), '去掉注释后的 Java 代码里根本不该出现 position')

  // 绑定顺序 = ? 的出现顺序（1…5）。改了顺序就是改了语义。
  assert.match(writeCode, /bindNullableText\(statement, 1, info, COLUMN_NAME, i\)/)
  assert.match(writeCode, /bindNullableText\(statement, 2, info, COLUMN_SOURCE, i\)/)
  assert.match(writeCode, /bindNullableText\(statement, 3, info, COLUMN_SOURCE_LIST_ID, i\)/)
  assert.match(writeCode, /bindNullableTimestamp\(statement, 4, info, i\)/)
  assert.match(writeCode, /statement\.bindString\(5, requireId\(info, i\)\)/)
})

test('表 / 列名对齐 tables.ts：my_list 的 6 列都在，且 position 是 NOT NULL（所以它不能进 SET）', () => {
  const ddl = tablesTs.match(/tables\.set\('my_list',\s*`([\s\S]*?)`\)/)[1]
  const columns = [...ddl.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)([^,\n]*)/g)]
    .map(match => [match[1], `${match[2]}${match[3]}`.trim()])
  assert.deepEqual(columns, [
    ['id', 'TEXT NOT NULL'],
    ['name', 'TEXT NOT NULL'],
    ['source', 'TEXT'],
    ['sourceListId', 'TEXT'],
    ['position', 'INTEGER NOT NULL'],
    ['locationUpdateTime', 'INTEGER'],
  ])
  // Android 侧的 DDL 与它逐字一致（第四刀的文件里那句是唯一出处，本刀不复制它）。
  const androidDdl = javaTextBlock(dbJava, 'DDL_MY_LIST')
  assert.equal(normalizeSql(androidDdl), normalizeSql(ddl))

  // 4 个列名常量都在，且都取自这张表。
  for (const column of ['COLUMN_NAME', 'COLUMN_SOURCE', 'COLUMN_SOURCE_LIST_ID', 'COLUMN_LOCATION_UPDATE_TIME', 'COLUMN_ID']) {
    assert.match(writeJava, new RegExp(`String\\s+${column}\\s*=\\s*"`))
  }
})

test('事务：整批改名在一个事务里（对齐 dbHelper.ts:99-105 的 updateUserLists）', () => {
  // 桌面那一支：一个 db.transaction，循环里逐条 run。
  assert.match(desktopUpdateHelper, /db\.transaction/)
  assert.match(desktopUpdateHelper, /for \(const list of lists\) await listUpdateStatement\.run\(list\)/)

  const lock = blockRange(writeCode, 'synchronized (LIST_WRITE_LOCK)')
  for (const call of ['db.beginTransaction()', 'db.setTransactionSuccessful()', 'db.endTransaction()', 'statement.executeUpdateDelete()']) {
    assert.ok(lock.body.includes(call), `临界区里必须有 ${call}`)
  }
  // 异常路径：setTransactionSuccessful 与 endTransaction 的顺序 + finally 保证回滚。
  assert.match(lock.body, /finally\s*\{[\s\S]*db\.endTransaction\(\)/)
})

// ---------------------------------------------------------------------------
// 3. 锁与 emit 的位置（本刀最容易写错、且写错了本机完全静默的两处）
// ---------------------------------------------------------------------------

test('锁：private static final Object LIST_WRITE_LOCK（三条写通道共用；不是 RainMusicStoreLock）', () => {
  assert.match(
    writeCode,
    /private\s+static\s+final\s+Object\s+LIST_WRITE_LOCK\s*=\s*new\s+Object\(\)\s*;/,
    '锁必须是文件私有的 static final Object（三条写通道共用同一把）',
  )
  // 只 synchronized 一次（多一把锁 = 第九刀会挑错）。
  assert.equal((writeCode.match(/synchronized\s*\(/g) ?? []).length, 1)
  // 临界区就是 SQL 那一段，不是整个 handler：参数校验与 emit 都在锁外。
  const lock = blockRange(writeCode, 'synchronized (LIST_WRITE_LOCK)')
  assert.ok(!lock.body.includes('readListInfos'), '参数校验不该在锁里')
  assert.ok(!lock.body.includes('emitTo'), '锁里不许 emit')

  // 不要与第三刀那把 SharedPreferences 的锁混用（代码里一次都不该出现）。
  assert.ok(!writeCode.includes('RainMusicStoreLock'), 'LIST_WRITE_LOCK 与 RainMusicStoreLock 是两把不同的锁')
  // 但要**写清楚**它管不到别的连接、也不是那把锁（这是本刀要求的说明，必须在注释里）。
  assert.ok(writeJava.includes('RainMusicStoreLock'), '类注释必须点名它跟 RainMusicStoreLock 无关')
  assert.match(writeJava, /别的连接|跨连接/, '类注释必须写明它管不到别的连接')
  assert.match(writeJava, /固定 2 线程池|2 线程池/, '类注释必须写明它护的是同一 2 线程池里的两次 handler')
})

test('emit 在**提交成功之后**、**锁外**，且载荷就是那个 JSONArray（不是包装对象）', () => {
  // ⚠️ 这两处是**两个方法**（listUpdate 里 emit、applyListUpdates 里加锁），所以不能拿"源码里谁的
  // indexOf 更大"当证据 —— 结构证据是"锁块与写库方法里都没有 emit"，行为证据在 JVM 探针那一组
  // （`events` 必须是 `…>update>commit>close>end>emit`）。
  const lock = blockRange(writeCode, 'synchronized (LIST_WRITE_LOCK)')
  const writeMethod = blockRange(writeCode, 'private static void applyListUpdates')
  assert.ok(!lock.body.includes('emitTo'), '锁块里不许 emit（临界区 = 只有 SQL）')
  assert.ok(!writeMethod.body.includes('emitTo'), '写库那个方法里也不许 emit（emit 只能在它返回之后）')
  assert.ok(!writeMethod.body.includes('RequestContext'), '写库那个方法连 ctx 都不该拿到')

  const emitIndex = writeCode.indexOf('ctx.emitTo(CHANNEL_LIST_UPDATE, listInfos)')
  assert.ok(emitIndex > -1, 'emit 调用必须逐字是 ctx.emitTo(CHANNEL_LIST_UPDATE, listInfos)')
  assert.ok(emitIndex > writeCode.indexOf('applyListUpdates(db, listInfos);'), 'emit 必须晚于写库调用（提交成功之后）')

  // 载荷 = 那个校验过的裸数组本身；包成对象就会让渲染层的 for…of 抛错（见渲染层接线组）。
  assert.match(writeCode, /JSONArray\s+listInfos\s*=\s*readListInfos\(args\)/)
  assert.ok(!/emitTo\([^)]*new JSONObject/.test(writeCode), 'emit 的载荷不能包成 JSONObject')

  // 失败时不许改本地状态：没有把 emit 放进 catch/finally 的退路。
  assert.ok(!/finally\s*\{[^}]*emitTo/.test(writeCode), 'emit 不能放在 finally 里')
  assert.ok(!/catch\s*\(/.test(writeCode), '本文件不该有任何 catch（异常一律冒泡成 ok:false）')
})

test('失败语义三态：参数非法 ⇒ IllegalArgumentException 点名；库坏 / 表缺失 ⇒ 复用 open(...) 抛错', () => {
  // 库打不开 / 表缺失：走的是第四刀那个入口（同一个 open + requireTable），不是自己再实现一遍。
  assert.match(writeCode, /RainMusicDatabase\.open\(context, RainMusicDatabase\.TABLE_MY_LIST\)/)
  assert.ok(!writeCode.includes('getWritableDatabase'), '不要绕开 RainMusicDatabase.open')

  // 参数校验必须点名，且三类坏形状各有一条消息。
  assert.match(writeCode, /throw new IllegalArgumentException\(/)
  assert.match(writeCode, /first instanceof JSONArray/)
  assert.match(writeCode, /raw instanceof JSONObject/)
  assert.match(writeCode, /id\.length\(\) == 0/)
  assert.match(writeJava, /缺少 `" \+ COLUMN_ID \+ "` 字段/)
  assert.match(writeJava, /不能是空字符串/)

  // 绝不吞错：没有"catch 之后返回成功 / 返回 false"的退路。
  assert.ok(!/catch\s*\(/.test(writeCode), '本文件不该有任何 catch（异常一律冒泡成 ok:false）')
  assert.ok(!/return\s+false/.test(writeCode))
})

test('0 行命中 = 成功（幂等）：不看 executeUpdateDelete 的返回值，也不把它当错误', () => {
  // 语句调用处必须是"裸调用"（拿到返回值再判断 = 加了一条桌面没有的语义）。
  assert.match(writeCode, /statement\.executeUpdateDelete\(\);/)
  assert.ok(!/int\s+\w+\s*=\s*statement\.executeUpdateDelete\(\)/.test(writeCode), '不该把返回值接住')
  assert.ok(!/executeUpdateDelete\(\)\s*==\s*0/.test(writeCode))
  // 类注释里必须把"0 行 = 成功"与桌面的证据写出来。
  assert.match(writeJava, /0 行命中 = 成功/)
  assert.match(writeJava, /better-sqlite3/)
})

// ---------------------------------------------------------------------------
// 4. 范围守卫：只注册这 1 条；老文件一个都没改；零新增依赖
// ---------------------------------------------------------------------------

test('范围守卫：本文件只注册 1 条通道；同族写通道（add / remove）一条都不碰', () => {
  const registrations = writeCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(registrations.length, 1, '本文件只应注册 player_list_update')

  // 通道名字面量只允许出现这一个（写错一个字就是真机 IPC_CHANNEL_UNSUPPORTED）。
  assert.deepEqual(
    [...new Set([...writeCode.matchAll(/"(player_[a-z_]+)"/g)].map(match => match[1]))],
    ['player_list_update'],
  )
  // 常量也只能有一个 CHANNEL_*。
  assert.deepEqual(
    [...writeCode.matchAll(/String\s+(CHANNEL_[A-Z_]+)\s*=/g)].map(match => match[1]),
    ['CHANNEL_LIST_UPDATE'],
  )

  // 后面几刀的写通道一条都不许出现（连拼名片段都不许）。
  for (const forbidden of [
    'player_list_add', 'player_list_remove', 'player_list_update_position', 'player_list_data_overwire',
    'player_list_music', 'CHANNEL_LIST_ADD', 'CHANNEL_LIST_REMOVE', 'CHANNEL_LIST_UPDATE_POSITION',
    'CHANNEL_LIST_DATA_OVERWIRE',
  ]) {
    assert.ok(!writeCode.includes(forbidden), `本刀不应出现 ${forbidden}（第九/第十刀再做）`)
  }

  // 老文件冻结：每一刀的注册条数一个都没变。
  const count = source => (stripJavaComments(source).match(/RainMusicIpcHandlers\.register\(/g) ?? []).length
  assert.equal(count(settingJava), 2, '第一刀的文件不该被本刀改动')
  assert.equal(count(dataJava), 2, '第二/三刀的文件不该被本刀改动')
  assert.equal(count(listJava), 1, '第四刀的文件不该被本刀改动')
  assert.equal(count(musicJava), 2, '第五刀的文件不该被本刀改动')
  assert.equal(count(musicGetJava), 1, '第六/七刀的文件不该被本刀改动')
  assert.equal(count(handlersJava), 0, 'P0-1 的注册表里不该有"就地实现"')

  // P0-1 的插件里也不应该有"就地实现"（实现必须都在各自的通道文件里）。
  assert.doesNotMatch(stripJavaComments(pluginJava), /RainMusicIpcHandlers\.register\(/)
})

test('注册必须发生在 RainMusicIpcPlugin.load() 里、且在收尾日志之前', () => {
  // ⚠️ 必须去掉注释再匹配（把那一行注释掉之后，用整份源码匹配的用例**依然通过**）。
  const pluginCode = stripJavaComments(pluginJava)
  assert.match(
    pluginCode,
    /RainMusicListWriteChannels\.register\(this\)/,
    'load() 里必须注册，否则真机 IPC_CHANNEL_UNSUPPORTED（注释掉不算）',
  )
  const loadIndex = pluginCode.indexOf('public void load()')
  const registerIndex = pluginCode.indexOf('RainMusicListWriteChannels.register(this)')
  assert.ok(loadIndex > -1 && registerIndex > loadIndex, '注册必须在 load() 内')
  assert.ok(registerIndex < pluginCode.indexOf('IPC 传输桥已加载'), '注册要在 load() 的收尾日志之前')
  // 前面几刀的注册也都还在（本刀没把它们挤掉）。
  for (const other of [
    'RainMusicAppSettingChannels.register(this)', 'RainMusicDataChannels.register(this)',
    'RainMusicListChannels.register(this)', 'RainMusicListMusicChannels.register(this)',
    'RainMusicListMusicGetChannels.register(this)',
  ]) {
    assert.ok(pluginCode.includes(other), `${other} 不见了（本刀不该动它）`)
  }
})

test('零新增依赖：import 只允许那几个（框架自带 + :capacitor-android 的 Logger）', () => {
  const imports = [...writeCode.matchAll(/^import\s+([\w.]+)\s*;/gm)].map(match => match[1]).sort()
  assert.deepEqual(imports, [
    'android.content.Context',
    'android.database.sqlite.SQLiteDatabase',
    'android.database.sqlite.SQLiteStatement',
    'com.getcapacitor.Logger',
    'java.util.List',
    'org.json.JSONArray',
    'org.json.JSONObject',
  ].sort())
  assert.ok(!/kotlin/i.test(writeCode), '没有引入 Kotlin')
  assert.ok(!/androidx\./.test(writeCode), '没有引入 androidx')
})

// ---------------------------------------------------------------------------
// 5. 渲染层接线组（真桥 + 真 rendererListManage + 真 action）：广播载荷必须是裸数组
// ---------------------------------------------------------------------------

/** 原生插件替身：post 收信封、addListener 收 ipcMessage、deliver 模拟原生广播。 */
const makeNativePlugin = () => {
  const native = { posts: [], notifies: 0, listener: null }
  native.deliver = payload => {
    native.notifies++
    if (native.listener) native.listener(payload)
  }
  native.plugin = {
    post(envelope) {
      native.posts.push(envelope)
      if (envelope.kind === 'invoke') {
        // 应答走桥订阅的那条事件通道（与真插件 notifyListeners 同形）。
        native.deliver({ id: envelope.id, kind: 'response', channel: envelope.channel, ok: true, result: null })
      }
      return Promise.resolve({ accepted: true })
    },
    addListener(eventName, listener) {
      if (eventName === 'ipcMessage') native.listener = listener
      return { remove: () => { native.listener = null } }
    },
  }
  return native
}

/**
 * 把**真的** `rendererListManage.ts` + **真的** `action.ts` 接在**真的**桥上
 * （只把它们的 import 换成替身）。这样"广播到达之后 state 变不变"跑的是生产代码。
 */
const setupRenderer = () => {
  const errors = []
  const native = makeNativePlugin()
  const globals = {
    console: { log: noop, warn: noop, error: (...args) => errors.push(args.join(' ')) },
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native.plugin, timeoutMs: 15000 },
  }
  const bridgeMod = load(BRIDGE_MODULE, {}, globals)
  const rendererIpc = load('src/common/rendererIpc.ts', { '@common/platform/ipcBridge': bridgeMod }, globals)

  const state = {
    userLists: [],
    allMusicList: new Map(),
    defaultList: { id: 'default', name: 'list__name_default' },
    tempList: { id: 'temp', name: '临时列表' },
  }
  const action = load('src/renderer/store/list/listManage/action.ts', {
    '@common/utils/vueTools': { markRaw: value => value, markRawList: value => value, toRaw: value => value },
    './state': state,
    '@renderer/utils/data': {
      overwriteListPosition: noop,
      overwriteListUpdateInfo: noop,
      removeListPosition: noop,
      removeListUpdateInfo: noop,
    },
    '@common/constants': { LIST_IDS: { DEFAULT: 'default', TEMP: 'temp', LOVE: 'love' } },
    '@common/utils/common': {
      arrPush: (target, items) => { target.push(...items) },
      arrUnshift: (target, items) => { target.unshift(...items) },
    },
    '@common/utils/playbackQueue': {
      dedupePlaybackQueue: list => list,
      filterPlaybackQueueAdditions: (_target, additions) => additions,
    },
  }, globals)
  const rendererListManage = load('src/renderer/store/list/listManage/rendererListManage.ts', {
    '@common/utils/vueTools': { toRaw: value => value },
    '@common/rendererIpc': rendererIpc,
    '@common/ipcNames': { PLAYER_EVENT_NAME },
    './action': action,
    './state': { allMusicList: state.allMusicList },
    '@common/constants': { ADD_MUSIC_LOCATION_TYPE: 'bottom' },
  }, globals)

  // 生产代码的 run 之前先订阅（与 useDataInit 的时序一致：先 registerListAction，再收广播）。
  rendererListManage.registerListAction({}, noop)
  return { errors, native, state, action, rendererListManage }
}

const seedUserLists = (state, list) => {
  state.userLists.length = 0
  state.userLists.push(list)
}

test('invoke 的信封是 args=[[{…}]]（裸数组），与契约 :104 的 listInfos[] 同形', async() => {
  const env = setupRenderer()
  const payload = [{ id: 'l-1', name: '新名字', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1700000000000 }]
  await env.rendererListManage.updateUserList(payload)

  const envelope = env.native.posts[0]
  assert.equal(envelope.kind, 'invoke')
  assert.equal(envelope.channel, CHANNEL)
  // ⚠️ 用 JSON.stringify 比对：参数数组是在 `vm.runInNewContext` 里造出来的（另一个 realm）。
  assert.equal(JSON.stringify(envelope.args), JSON.stringify([payload]), 'args[0] 必须是数组（不是 {listInfos}）')
})

test('广播载荷是裸数组：原生 args=[listInfos] ⇒ 真渲染层监听器 ⇒ 真 action.userListsUpdate 改到 state', () => {
  const env = setupRenderer()
  seedUserLists(env.state, { id: 'l-1', name: '旧名字', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1 })

  env.native.deliver({
    kind: 'event',
    channel: CHANNEL,
    args: [[{ id: 'l-1', name: '新名字', source: 'kg', sourceListId: 's-2', locationUpdateTime: 1700000000000 }]],
  })

  assert.equal(env.state.userLists[0].name, '新名字', '裸数组必须能走到 userListsUpdate')
  assert.equal(env.state.userLists[0].source, 'kg')
  assert.equal(env.state.userLists[0].sourceListId, 's-2')
  assert.equal(env.state.userLists[0].locationUpdateTime, 1700000000000)
  assert.deepEqual(env.errors, [], '裸数组这一路不该有任何 console.error')
})

test('把裸数组包成对象 ⇒ for…of TypeError 被桥吞成**一条 console.error**，界面完全不动', () => {
  const env = setupRenderer()
  seedUserLists(env.state, { id: 'l-1', name: '旧名字', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1 })

  env.native.deliver({
    kind: 'event',
    channel: CHANNEL,
    args: [{ listInfos: [{ id: 'l-1', name: '新名字' }] }],
  })

  assert.equal(env.state.userLists[0].name, '旧名字', '包成对象 ⇒ 渲染层一个字都没改（这正是必须钉住形状的原因）')
  assert.equal(env.errors.length, 1, '桥把监听器的异常吞成恰好一条 console.error')
  assert.match(env.errors[0], /监听器抛错/)
  assert.match(env.errors[0], new RegExp(CHANNEL))
  assert.match(env.errors[0], /not iterable/)
  // 调用方那边**什么都不会收到**（不是 reject，也不是 resolve）。
  assert.equal(env.native.notifies, 1, '只有那一条广播，没有应答')
})

test('监听器体 == 生产代码那三行（rendererListManage.ts:189-191 → action.ts:177-181）', () => {
  assert.match(rendererListManageTs, /\{ params: listInfos \}[\s\S]{0,80}userListsUpdate\(listInfos\)/)
  assert.match(rendererActionTs, /export const userListsUpdate = \(listInfos: Rain\.List\.UserListInfo\[\]\) => \{\s*\n\s*for \(const info of listInfos\)/)
  assert.match(rendererActionTs, /targetList\.name = name/)
})

// ---------------------------------------------------------------------------
// 6. JVM 行为组：真 javac + 真 java + 手写替身（观察者探针）
// ---------------------------------------------------------------------------

const STUB_LOGGER = String.raw`
package com.getcapacitor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 替身：只声明本刀真正调用的那几个重载（真 Logger 的其余部分一概不声明）。 */
public class Logger {
    public static final List<String> LINES = Collections.synchronizedList(new ArrayList<String>());

    public static void info(String tag, String message) { LINES.add("info|" + tag + "|" + message); }
    public static void debug(String tag, String message) { LINES.add("debug|" + tag + "|" + message); }
    public static void warn(String tag, String message) { LINES.add("warn|" + tag + "|" + message); }
    public static void error(String tag, String message) { LINES.add("error|" + tag + "|" + message); }
}
`

const STUB_CONTEXT = String.raw`
package android.content;

/** 替身：本刀的通道只用到 getApplicationContext()（真 Context 的其余部分一概不声明）。 */
public class Context {
    public Context getApplicationContext() { return this; }
}
`

const STUB_SQLITE_DATABASE = String.raw`
package android.database.sqlite;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 手写替身（**不是**真 SQLite）：只记录观察点，让 JS 侧的断言能看见
 * "事务边界 / 语句执行 / 同时开着几个事务"这三件事。
 */
public class SQLiteDatabase {

    public static final List<String> EVENTS = Collections.synchronizedList(new ArrayList<String>());
    public static final List<String> EXECUTED = Collections.synchronizedList(new ArrayList<String>());
    public static final List<String> SQL_SEEN = Collections.synchronizedList(new ArrayList<String>());
    public static final AtomicInteger OPEN_TRANSACTIONS = new AtomicInteger(0);
    public static final AtomicInteger MAX_OPEN_TRANSACTIONS = new AtomicInteger(0);
    public static volatile int AFFECTED_ROWS = 1;
    /** 并发探针的会合点：两个线程都进到 beginTransaction 时立刻放行（用来放大"没锁"的窗口）。 */
    public static volatile CountDownLatch RENDEZVOUS = null;

    public void beginTransaction() {
        int now = OPEN_TRANSACTIONS.incrementAndGet();
        MAX_OPEN_TRANSACTIONS.accumulateAndGet(now, Math::max);
        EVENTS.add("begin");
        CountDownLatch latch = RENDEZVOUS;
        if (latch != null) {
            latch.countDown();
            try {
                latch.await(200, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public void setTransactionSuccessful() { EVENTS.add("commit"); }

    public void endTransaction() {
        OPEN_TRANSACTIONS.decrementAndGet();
        EVENTS.add("end");
    }

    public SQLiteStatement compileStatement(String sql) {
        SQL_SEEN.add(sql);
        EVENTS.add("compile");
        return new SQLiteStatement();
    }
}
`

const STUB_SQLITE_STATEMENT = String.raw`
package android.database.sqlite;

import java.util.Arrays;

/** 手写替身：绑定 + 一次"UPDATE"，观察点由 SQLiteDatabase 那个替身收集。 */
public class SQLiteStatement {

    private final Object[] bindings = new Object[5];

    public void bindNull(int index) { bindings[index - 1] = null; }

    public void bindString(int index, String value) { bindings[index - 1] = value; }

    public void bindLong(int index, long value) { bindings[index - 1] = Long.valueOf(value); }

    public void clearBindings() { Arrays.fill(bindings, null); }

    /** AOSP 的 SQLiteStatement 继承 SQLiteProgram（Closeable）⇒ close() 是它自带的。 */
    public void close() { SQLiteDatabase.EVENTS.add("close"); }

    /**
     * 替身里唯一"有业务语义"的地方：my_list."name" 是 TEXT NOT NULL（tables.ts:131），
     * 而 SQLite 是在**语句执行时**报这个约束的 —— 替身照做，这样"载荷没带 name"走的就是
     * 真机上那条路（抛错 ⇒ 不 markSuccessful ⇒ endTransaction 回滚 ⇒ 不广播）。
     */
    public int executeUpdateDelete() {
        if (bindings[0] == null) {
            throw new RuntimeException("NOT NULL constraint failed: my_list.name (code 1299)");
        }
        SQLiteDatabase.EVENTS.add("update");
        SQLiteDatabase.EXECUTED.add(
            "name=" + bindings[0] + ";source=" + bindings[1] + ";sourceListId=" + bindings[2] +
            ";locationUpdateTime=" + bindings[3] + ";id=" + bindings[4]
        );
        return SQLiteDatabase.AFFECTED_ROWS;
    }
}
`

const STUB_JSON_ARRAY = String.raw`
package org.json;

import java.util.ArrayList;
import java.util.List;

/** 手写替身（只实现本刀用到的子集）：长度 / 下标 / put / names() 的文本化。 */
public class JSONArray {

    private final List<Object> values = new ArrayList<Object>();

    public JSONArray() {}

    public JSONArray put(Object value) {
        values.add(value);
        return this;
    }

    public int length() { return values.size(); }

    public Object opt(int index) {
        return index >= 0 && index < values.size() ? values.get(index) : null;
    }

    /** 与 AOSP 的 JSONObject.toString / JSONArray.toString 一样紧凑（逗号后没有空格）。 */
    static String text(Object value) {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof JSONObject || value instanceof JSONArray) return value.toString();
        if (value instanceof String) return JSONObject.quote((String) value);
        return String.valueOf(value);
    }

    @Override
    public String toString() {
        StringBuilder builder = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) builder.append(',');
            builder.append(text(values.get(i)));
        }
        return builder.append(']').toString();
    }
}
`

const STUB_JSON_OBJECT = String.raw`
package org.json;

import java.util.LinkedHashMap;
import java.util.Map;

/** 手写替身（只实现本刀用到的子集）。键序 = 插入序（LinkedHashMap），方便断言载荷的键集合。 */
public class JSONObject {

    /** 与 AOSP 同名哨兵同形：opt(name) 对 JSON null 返回它，调用方用 == 判断。 */
    public static final Object NULL = new JSONObject.NullValue();

    private static final class NullValue {
        @Override public String toString() { return "null"; }
    }

    private final Map<String, Object> values = new LinkedHashMap<String, Object>();

    public JSONObject() {}

    public JSONObject put(String name, Object value) {
        values.put(name, value);
        return this;
    }

    public Object opt(String name) { return values.get(name); }

    public boolean has(String name) { return values.containsKey(name); }

    public boolean isNull(String name) { return values.containsKey(name) && values.get(name) == NULL; }

    public int length() { return values.size(); }

    public JSONArray names() {
        JSONArray array = new JSONArray();
        for (String key : values.keySet()) array.put(key);
        return array;
    }

    static String quote(String value) {
        StringBuilder builder = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') builder.append('\\').append(c);
            else if (c == '\n') builder.append("\\n");
            else builder.append(c);
        }
        return builder.append('"').toString();
    }

    @Override
    public String toString() {
        StringBuilder builder = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            if (!first) builder.append(',');
            first = false;
            builder.append(quote(entry.getKey())).append(':').append(JSONArray.text(entry.getValue()));
        }
        return builder.append('}').toString();
    }
}
`

const STUB_PLUGIN = String.raw`
package com.rainmusic.mobile.ipc;

import android.content.Context;

/** 替身：本刀的通道只用到 getContext()（真插件的 371 行里其余部分是 Capacitor 接线）。 */
public class RainMusicIpcPlugin {

    private final Context context;

    public RainMusicIpcPlugin(Context context) { this.context = context; }

    public Context getContext() { return context; }
}
`

const STUB_DATABASE = String.raw`
package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;

/**
 * 替身：只保留本刀用到的常量与 open(Context, String...) 这个**入口**。
 * 真文件（35 KB）的建表 / 迁移 / requireTable 语义**不在本探针的覆盖范围内** ——
 * 那些由 android-list-channels.test.cjs / android-list-music-get-channels.test.cjs
 * 在源码层面对齐。这里只按真文件的消息形状复现两条失败路径。
 */
public final class RainMusicDatabase {

    static final String DATABASE_NAME = "rain.dataSQLite.db";
    static final String TABLE_MY_LIST = "my_list";
    static final String SCHEMA_VERSION_TEXT = "4";

    public static volatile boolean FAIL_OPEN = false;
    public static volatile boolean FAIL_REQUIRE_TABLE = false;
    public static final SQLiteDatabase DATABASE = new SQLiteDatabase();

    static SQLiteDatabase open(Context context, String... requiredTables) {
        if (FAIL_OPEN) {
            throw new IllegalStateException(
                "打不开数据库 /data/data/com.rainmusic.mobile/databases/" + DATABASE_NAME +
                "：file is not a database。本通道**不会**把它当成「改成功了」"
            );
        }
        if (requiredTables != null && FAIL_REQUIRE_TABLE) {
            throw new IllegalStateException(
                "数据库 /data/data/com.rainmusic.mobile/databases/" + DATABASE_NAME +
                " 里没有表 \"" + requiredTables[0] + "\"：这不是本应用建的库，或者它已经损坏。"
            );
        }
        return DATABASE;
    }

    private RainMusicDatabase() {}
}
`

const PROBE_SOURCE = String.raw`
package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;

/**
 * 观察者探针：把每个场景的结果打印成 section<TAB>key<TAB>value，**断言全部在 JS 侧**。
 * 它只调用生产代码（注册 + 从注册表取 handler + handle(...)），不复制任何业务逻辑。
 */
public final class WriteProbe {

    static final String CHANNEL = RainMusicListWriteChannels.CHANNEL_LIST_UPDATE;
    static final StringBuilder REPORT = new StringBuilder();
    static final List<String> EMITS = Collections.synchronizedList(new ArrayList<String>());

    interface Call { Object run() throws Exception; }

    public static void main(String[] args) throws Exception {
        RainMusicIpcHandlers.setEmitter((channel, emitArgs) -> recordEmit(channel, emitArgs));
        RainMusicListWriteChannels.register(new RainMusicIpcPlugin(new Context()));
        say("probe", "registered", String.valueOf(RainMusicIpcHandlers.get(CHANNEL) != null));

        // 1) 正常一条：四个字段都在。
        runCase("happy", () -> call(args(arr(obj(
            "id", "l-1", "name", "新名字", "source", "wy", "sourceListId", "s-1", "locationUpdateTime", 1700000000000L
        )))));

        // 2) 0 行命中（id 不在库里）⇒ 成功 + 照样广播。
        runCase("zero-rows", () -> {
            SQLiteDatabase.AFFECTED_ROWS = 0;
            return call(args(arr(obj("id", "gone", "name", "x"))));
        });

        // 3) 空数组 ⇒ 0 条 SQL、提交成功、广播一个空数组。
        runCase("empty-array", () -> call(args(arr())));

        // 4) 载荷未带的三个可空列 ⇒ 绑 NULL（name 在，所以语句成功）。
        runCase("nullable-columns-absent", () -> call(args(arr(obj("id", "l-1", "name", "只有名字")))));

        // 5) 显式 JSON null ⇒ 同样绑 NULL（走 raw == JSONObject.NULL 那一支）。
        runCase("explicit-json-null", () -> call(args(arr(obj(
            "id", "l-1", "name", "x", "source", JSONObject.NULL, "sourceListId", JSONObject.NULL, "locationUpdateTime", JSONObject.NULL
        )))));

        // 6) 缺 name ⇒ 假 SQLite 按 DDL 的 NOT NULL 抛错 ⇒ 回滚 + 不广播。
        runCase("missing-name-not-null", () -> call(args(arr(obj("id", "l-1")))));

        // 7) 半批失败 ⇒ 整个事务回滚（第一条 UPDATE 发出去过，但没有 commit、也没有广播）。
        runCase("partial-batch-rolled-back", () -> call(args(arr(obj("id", "l-1", "name", "ok"), obj("id", "l-2")))));

        // 8) 参数：一个都没给。
        runCase("param-missing", () -> call(new ArrayList<Object>()));

        // 9) 参数：包成对象（{listInfos: [...]}）—— 最常见的写错法。
        runCase("param-wrapped-object", () -> call(args(obj("listInfos", arr(obj("id", "l-1", "name", "x"))))));

        // 10) 参数：元素不是对象。
        runCase("param-item-not-object", () -> call(args(arr("l-1"))));

        // 11~13) id 的三种坏形状。
        runCase("param-id-missing", () -> call(args(arr(obj("name", "x")))));
        runCase("param-id-not-string", () -> call(args(arr(obj("id", 123, "name", "x")))));
        runCase("param-id-empty", () -> call(args(arr(obj("id", "", "name", "x")))));

        // 14~15) 可空列给了错的类型。
        runCase("param-source-not-string", () -> call(args(arr(obj("id", "l-1", "name", "x", "source", 42)))));
        runCase("param-time-fraction", () -> call(args(arr(obj("id", "l-1", "name", "x", "locationUpdateTime", 1.5)))));

        // 16~17) 库打不开 / 表缺失（都是 open(...) 那一层）。
        runCase("open-failure", () -> {
            RainMusicDatabase.FAIL_OPEN = true;
            return call(args(arr(obj("id", "l-1", "name", "x"))));
        });
        runCase("table-missing", () -> {
            RainMusicDatabase.FAIL_REQUIRE_TABLE = true;
            return call(args(arr(obj("id", "l-1", "name", "x"))));
        });

        // 18) 并发：两个线程同时改名 —— 有锁时同一时刻只可能有一个事务开着。
        concurrencyCase("concurrent-two-writers");

        writeReport();
    }

    // ---------------------------------------------------------------- 场景骨架

    static void runCase(String name, Call call) {
        reset();
        String result = "ok";
        String message = "-";
        try {
            Object value = call.run();
            result = value == null ? "null" : "value:" + value.getClass().getSimpleName();
        } catch (Throwable ex) {
            result = "threw:" + ex.getClass().getName();
            message = firstLine(ex.getMessage());
        }
        say(name, "result", result);
        say(name, "message", message);
        say(name, "emitCount", String.valueOf(EMITS.size()));
        say(name, "emit0", EMITS.isEmpty() ? "-" : EMITS.get(0));
        say(name, "events", SQLiteDatabase.EVENTS.isEmpty() ? "-" : String.join(">", SQLiteDatabase.EVENTS));
        say(name, "executed", String.valueOf(SQLiteDatabase.EXECUTED.size()));
        for (String binding : SQLiteDatabase.EXECUTED) say(name, "binding", binding);
        say(name, "maxOpenTransactions", String.valueOf(SQLiteDatabase.MAX_OPEN_TRANSACTIONS.get()));
        say(name, "sql", SQLiteDatabase.SQL_SEEN.isEmpty() ? "-" : oneLine(SQLiteDatabase.SQL_SEEN.get(0)));
    }

    static void concurrencyCase(String name) throws Exception {
        reset();
        SQLiteDatabase.RENDEZVOUS = new CountDownLatch(1);
        final List<Object> payload = args(arr(obj("id", "l-1", "name", "并发"), obj("id", "l-2", "name", "并发2")));
        final String[] results = new String[2];
        Thread first = new Thread(() -> { results[0] = attempt(payload); }, "probe-a");
        Thread second = new Thread(() -> { results[1] = attempt(payload); }, "probe-b");
        first.start();
        second.start();
        first.join(10000);
        second.join(10000);

        say(name, "result0", results[0]);
        say(name, "result1", results[1]);
        say(name, "maxOpenTransactions", String.valueOf(SQLiteDatabase.MAX_OPEN_TRANSACTIONS.get()));
        say(name, "executed", String.valueOf(SQLiteDatabase.EXECUTED.size()));
        say(name, "emitCount", String.valueOf(EMITS.size()));
        say(name, "commitCount", String.valueOf(SQLiteDatabase.EVENTS.stream().filter("commit"::equals).count()));
    }

    static String attempt(List<Object> payload) {
        try {
            Object value = call(payload);
            return value == null ? "ok" : "ok:" + value.getClass().getSimpleName();
        } catch (Throwable ex) {
            return "threw:" + ex.getClass().getName() + ":" + firstLine(ex.getMessage());
        }
    }

    /** 通过**注册表**拿 handler（与真插件同一条路），不直接反射私有方法。 */
    static Object call(List<Object> payload) throws Exception {
        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(CHANNEL);
        if (handler == null) throw new IllegalStateException("通道没注册：" + CHANNEL);
        return handler.handle(payload, new RainMusicIpcHandlers.RequestContext("ipc-probe-1", CHANNEL));
    }

    // ---------------------------------------------------------------- 广播记录

    static void recordEmit(String channel, List<Object> emitArgs) {
        SQLiteDatabase.EVENTS.add("emit");
        StringBuilder builder = new StringBuilder();
        builder.append(channel).append('|').append(emitArgs == null ? -1 : emitArgs.size()).append('|');
        Object arg0 = (emitArgs == null || emitArgs.isEmpty()) ? null : emitArgs.get(0);
        if (arg0 instanceof JSONArray) {
            JSONArray array = (JSONArray) arg0;
            builder.append("array|").append(array.length()).append('|').append(firstIdOf(array)).append('|').append(firstKeysOf(array));
        } else if (arg0 instanceof JSONObject) {
            JSONObject object = (JSONObject) arg0;
            builder.append("object|").append(object.length()).append('|').append(String.valueOf(object.opt("id"))).append('|').append(String.valueOf(object.names()));
        } else {
            builder.append(arg0 == null ? "none" : arg0.getClass().getSimpleName()).append("|-|-");
        }
        EMITS.add(builder.toString());
    }

    static String firstIdOf(JSONArray array) {
        Object first = array.opt(0);
        if (!(first instanceof JSONObject)) return "-";
        Object id = ((JSONObject) first).opt("id");
        return id == null ? "-" : String.valueOf(id);
    }

    static String firstKeysOf(JSONArray array) {
        Object first = array.opt(0);
        if (!(first instanceof JSONObject)) return "-";
        return String.valueOf(((JSONObject) first).names());
    }

    // ---------------------------------------------------------------- 杂项

    static void reset() {
        SQLiteDatabase.EVENTS.clear();
        SQLiteDatabase.EXECUTED.clear();
        SQLiteDatabase.SQL_SEEN.clear();
        SQLiteDatabase.OPEN_TRANSACTIONS.set(0);
        SQLiteDatabase.MAX_OPEN_TRANSACTIONS.set(0);
        SQLiteDatabase.AFFECTED_ROWS = 1;
        SQLiteDatabase.RENDEZVOUS = null;
        RainMusicDatabase.FAIL_OPEN = false;
        RainMusicDatabase.FAIL_REQUIRE_TABLE = false;
        com.getcapacitor.Logger.LINES.clear();
        EMITS.clear();
    }

    static JSONObject obj(Object... pairs) {
        JSONObject object = new JSONObject();
        for (int i = 0; i < pairs.length; i += 2) object.put((String) pairs[i], pairs[i + 1]);
        return object;
    }

    static JSONArray arr(Object... items) {
        JSONArray array = new JSONArray();
        for (Object item : items) array.put(item);
        return array;
    }

    static List<Object> args(Object first) {
        List<Object> list = new ArrayList<Object>();
        list.add(first);
        return list;
    }

    static String firstLine(String text) {
        if (text == null) return "-";
        String line = text.split("\n")[0].replace('\t', ' ');
        return line.isEmpty() ? "-" : line;
    }

    static String oneLine(String sql) {
        return sql.trim().replaceAll("\\s+", " ");
    }

    static void say(String section, String key, String value) {
        REPORT.append(section).append('\t').append(key).append('\t').append(value).append('\n');
    }

    static void writeReport() throws Exception {
        // 显式 UTF-8：Windows 控制台编码不稳定，报告里有中文（歌单名）。
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        out.print(REPORT);
        out.flush();
    }
}
`

const STUBS = {
  'com/getcapacitor/Logger.java': STUB_LOGGER,
  'android/content/Context.java': STUB_CONTEXT,
  'android/database/sqlite/SQLiteDatabase.java': STUB_SQLITE_DATABASE,
  'android/database/sqlite/SQLiteStatement.java': STUB_SQLITE_STATEMENT,
  'org/json/JSONArray.java': STUB_JSON_ARRAY,
  'org/json/JSONObject.java': STUB_JSON_OBJECT,
  'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': STUB_PLUGIN,
  'com/rainmusic/mobile/ipc/RainMusicDatabase.java': STUB_DATABASE,
  'com/rainmusic/mobile/ipc/WriteProbe.java': PROBE_SOURCE,
}

const JAVAC_AVAILABLE = (() => {
  try {
    return spawnSync('javac', ['-version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
})()
const SKIP_REASON = JAVAC_AVAILABLE
  ? false
  : '本机没有可用的 javac（JDK）⇒ 这一组"用假 SQLite 把本刀的控制流跑起来"的用例无法执行'

const temporaryDirs = []
after(() => {
  for (const dir of temporaryDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const compileOnce = (() => {
  let cached = null
  return () => {
    if (cached) return cached
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-list-write-'))
    temporaryDirs.push(dir)
    const stubRoot = path.join(dir, 'stub')
    const outDir = path.join(dir, 'out')
    fs.mkdirSync(outDir, { recursive: true })
    for (const [relative, source] of Object.entries(STUBS)) {
      const file = path.join(stubRoot, ...relative.split('/'))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, source)
    }
    const compiled = spawnSync('javac', [
      '-encoding', 'UTF-8',
      '-sourcepath', stubRoot,
      '-d', outDir,
      // 生产的两个真文件（RainMusicDatabase / RainMusicIpcPlugin 走 sourcepath 上的替身）。
      path.join(stubRoot, 'com/rainmusic/mobile/ipc/WriteProbe.java'),
      path.join(ROOT, JAVA_REL_DIR, 'RainMusicListWriteChannels.java'),
      path.join(ROOT, JAVA_REL_DIR, 'RainMusicIpcHandlers.java'),
    ], { encoding: 'utf8' })
    cached = {
      outDir,
      ok: compiled.status === 0,
      log: `${compiled.stdout ?? ''}${compiled.stderr ?? ''}`,
    }
    return cached
  }
})()

let cachedReport = null
const probeReport = () => {
  if (cachedReport) return cachedReport
  const build = compileOnce()
  assert.ok(build.ok, `javac 编不过（本刀的通道 + P0-1 的注册表 + 手写替身）：\n${build.log}`)
  const run = spawnSync('java', [
    '-Dfile.encoding=UTF-8',
    '-cp', build.outDir,
    'com.rainmusic.mobile.ipc.WriteProbe',
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(run.status, 0, `探针没跑通：\n${run.stdout ?? ''}\n${run.stderr ?? ''}`)
  cachedReport = parseReport(run.stdout ?? '')
  return cachedReport
}

function parseReport (stdout) {
  const sections = {}
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [section, key, ...rest] = line.split('\t')
    sections[section] ??= {}
    sections[section][key] ??= []
    sections[section][key].push(rest.join('\t'))
  }
  return sections
}

const field = (report, section, key) => {
  const values = report[section]?.[key]
  assert.ok(values != null && values.length > 0, `探针报告里没有 ${section}.${key}`)
  return values[0]
}
const fields = (report, section, key) => report[section]?.[key] ?? []
/** `events` 里的先后关系（`begin>compile>update>commit>end>emit`）。 */
const order = events => key => events.indexOf(key)

test('JVM 探针：真 javac 把本刀编过一遍（语法 / 类型自洽，exit 0）', { skip: SKIP_REASON }, () => {
  const build = compileOnce()
  assert.ok(build.ok, `javac 编不过：\n${build.log}`)
})

test('JVM 探针：注册 + 正常一条 —— 事务里一次 UPDATE、4 列 + id 的绑定顺序、commit 之后才 emit', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'probe', 'registered'), 'true')
  assert.equal(field(report, 'happy', 'result'), 'null', '契约是 void ⇒ 成功时返回 null')

  // 绑定的列与顺序（1…5）：name / source / sourceListId / locationUpdateTime / id。
  assert.deepEqual(fields(report, 'happy', 'binding'), [
    'name=新名字;source=wy;sourceListId=s-1;locationUpdateTime=1700000000000;id=l-1',
  ])

  // 真的执行的是那一条 SQL（与 statements.ts 归一化后一致）。
  const sql = field(report, 'happy', 'sql')
  assert.equal(normalizeSql(sql), normalizeSql(toPositionalSql(desktopUpdateSql)))
  assert.ok(!/position/.test(sql))

  // 事件顺序：begin → compile → update → commit → end → emit（emit 在提交之后、事务之外）。
  const events = field(report, 'happy', 'events')
  const at = order(events)
  assert.ok(at('begin') === 0 && at('commit') > at('update') && at('end') > at('commit') && at('emit') > at('end'),
    `事务与广播的先后不对：${events}`)

  // 广播载荷：1 个参数、是**数组**、1 个元素、就是调用方传来的那个 listInfos。
  assert.equal(field(report, 'happy', 'emitCount'), '1')
  assert.equal(
    field(report, 'happy', 'emit0'),
    'player_list_update|1|array|1|l-1|["id","name","source","sourceListId","locationUpdateTime"]',
  )
})

test('JVM 探针：0 行命中 = 成功（幂等）且照样广播；空数组 = 0 条 SQL + 提交 + 广播空数组', { skip: SKIP_REASON }, () => {
  const report = probeReport()

  assert.equal(field(report, 'zero-rows', 'result'), 'null', '命中 0 行不是错误（桌面 better-sqlite3 也是静默成功）')
  assert.equal(field(report, 'zero-rows', 'executed'), '1', '语句确实发出去了')
  assert.deepEqual(fields(report, 'zero-rows', 'binding'), ['name=x;source=null;sourceListId=null;locationUpdateTime=null;id=gone'])
  assert.equal(field(report, 'zero-rows', 'emitCount'), '1', '0 行命中也要广播（桌面照样 emit）')
  assert.ok(field(report, 'zero-rows', 'events').includes('commit'))

  assert.equal(field(report, 'empty-array', 'result'), 'null')
  assert.equal(field(report, 'empty-array', 'executed'), '0', '空数组 ⇒ 一条 SQL 都不发')
  assert.equal(field(report, 'empty-array', 'emitCount'), '1')
  assert.equal(field(report, 'empty-array', 'emit0'), 'player_list_update|1|array|0|-|-', '广播的是空数组')
  assert.ok(field(report, 'empty-array', 'events').includes('commit'), '空数组同样提交成功')
})

test('JVM 探针：载荷未带的列绑 NULL（显式 JSON null 同路）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.deepEqual(fields(report, 'nullable-columns-absent', 'binding'), [
    'name=只有名字;source=null;sourceListId=null;locationUpdateTime=null;id=l-1',
  ])
  assert.equal(field(report, 'nullable-columns-absent', 'emitCount'), '1')
  assert.deepEqual(fields(report, 'explicit-json-null', 'binding'), [
    'name=x;source=null;sourceListId=null;locationUpdateTime=null;id=l-1',
  ])
  assert.equal(field(report, 'explicit-json-null', 'emitCount'), '1')
})

test('JVM 探针：语句失败 ⇒ 回滚（没有 commit）+ **不广播**；半批失败整批回滚', { skip: SKIP_REASON }, () => {
  const report = probeReport()

  // 缺 name ⇒ 假 SQLite 按 DDL 的 NOT NULL 抛错。
  assert.match(field(report, 'missing-name-not-null', 'result'), /^threw:/)
  assert.match(field(report, 'missing-name-not-null', 'message'), /NOT NULL constraint failed/)
  assert.ok(!field(report, 'missing-name-not-null', 'events').includes('commit'), '没 markSuccessful ⇒ 回滚')
  assert.ok(field(report, 'missing-name-not-null', 'events').includes('end'), 'endTransaction 必须被调到')
  assert.equal(field(report, 'missing-name-not-null', 'emitCount'), '0', '失败**不许**改本地状态 ⇒ 一条广播都没有')

  // 半批：第一条 UPDATE 已经执行过，但整批回滚 ⇒ 库不会留下半批。
  assert.match(field(report, 'partial-batch-rolled-back', 'result'), /^threw:/)
  assert.equal(field(report, 'partial-batch-rolled-back', 'executed'), '1', '第一条确实执行过')
  assert.equal(field(report, 'partial-batch-rolled-back', 'maxOpenTransactions'), '1')
  assert.ok(!field(report, 'partial-batch-rolled-back', 'events').includes('commit'))
  assert.equal(field(report, 'partial-batch-rolled-back', 'emitCount'), '0')
})

test('JVM 探针：参数非法 ⇒ IllegalArgumentException 点名字段（8 种坏形状）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const expected = {
    'param-missing': /需要一个 `listInfos` 数组参数/,
    'param-wrapped-object': /必须是数组（`listInfos`）/,
    'param-item-not-object': /第 0 个元素必须是对象/,
    'param-id-missing': /第 0 个元素缺少 `id` 字段/,
    'param-id-not-string': /`id` 必须是字符串/,
    'param-id-empty': /`id` 不能是空字符串/,
    'param-source-not-string': /`source` 必须是字符串或 null/,
    'param-time-fraction': /必须是整数毫秒/,
  }
  for (const [section, pattern] of Object.entries(expected)) {
    assert.equal(field(report, section, 'result'), 'threw:java.lang.IllegalArgumentException', `${section} 必须是 IllegalArgumentException`)
    assert.match(field(report, section, 'message'), pattern, `${section} 的消息必须点名`)
    assert.equal(field(report, section, 'executed'), '0', `${section} 不该发任何 SQL`)
    assert.equal(field(report, section, 'emitCount'), '0', `${section} 不该广播`)
  }
  // "包成对象"这一种要顺便把"不是 {listInfos} 包装"这句话说出来。
  assert.match(field(report, 'param-wrapped-object', 'message'), /不是\*\* args=\[\{listInfos/)
})

test('JVM 探针：库打不开 / 表缺失 ⇒ IllegalStateException，不广播', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'open-failure', 'result'), 'threw:java.lang.IllegalStateException')
  assert.match(field(report, 'open-failure', 'message'), /打不开数据库/)
  assert.equal(field(report, 'open-failure', 'emitCount'), '0')
  assert.equal(field(report, 'open-failure', 'events'), '-', '库都没打开 ⇒ 连事务都不该开')

  assert.equal(field(report, 'table-missing', 'result'), 'threw:java.lang.IllegalStateException')
  assert.match(field(report, 'table-missing', 'message'), /没有表 "my_list"/)
  assert.equal(field(report, 'table-missing', 'emitCount'), '0')
})

test('JVM 探针：两个线程同时改名 ⇒ 同一时刻只可能有一个事务开着（锁真的在护临界区）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'concurrent-two-writers', 'result0'), 'ok')
  assert.equal(field(report, 'concurrent-two-writers', 'result1'), 'ok')
  assert.equal(field(report, 'concurrent-two-writers', 'maxOpenTransactions'), '1',
    '去锁之后这里会变成 2（两个 handler 各自开一个事务）—— 这条断言就是锁的存在证明')
  assert.equal(field(report, 'concurrent-two-writers', 'commitCount'), '2')
  assert.equal(field(report, 'concurrent-two-writers', 'emitCount'), '2')
  assert.equal(field(report, 'concurrent-two-writers', 'executed'), '4', '两条通道各写 2 条')
})
