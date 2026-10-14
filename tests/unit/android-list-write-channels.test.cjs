/**
 * Android 移植 · **P0-2 第八刀**（`player_list_update`：改名，invoke + 同名广播两半）
 * + **第九刀-a/b**（`player_list_add`：新建，invoke + 同名广播两半）
 * + **第十刀-a/b**（`player_list_remove`：删除，invoke + 同名广播两半）
 * 的契约 / 接线 / 落点 / 范围回归网。
 *
 * ⚠️ **第十刀-b（本刀）只改本文件、`docs/android/ipc-contract.md`，以及
 * `RainMusicListWriteChannels.java` 里那一处 `.0` 归一化**：第十刀-a 把 `player_list_remove`
 * 实现进**同一个**生产文件之后，本文件里"整个文件只有两条通道 / 只有两个临界区 / 禁字表里还有
 * remove"的**旧守卫**全部过期了。本刀把它们从"两条"改成"三条"，并没有放宽任何一条断言：
 * `player_list_update` / `player_list_add` 那两半的每一条守卫都**逐字保留**，新增的是 remove 那一半；
 * 同时把第十刀-a 只用 `%TEMP%` 里的临时探针跑过的两组断言（原生 JVM 组 11 条 + 渲染层组）
 * **正式搬进仓库**（替身补上了"认识三句 DELETE"的能力，见 `STUB_SQLITE_STATEMENT` 的类注释）。
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
 *    **第九刀-a 那一半同款**：形状 == 契约 `:102`（`{position, listInfos}` → `void`，广播载荷是
 *    **对象**）、桌面三段链（`rendererListManage.ts:36-39` → `rendererEvent.ts:12-14` →
 *    `ListEvent.ts:50-55` → `winRendererEvent.ts:9-11` + 订阅 `rendererListManage.ts:229`）
 *    逐字对得上；`SQL_LIST_INSERT` / `SQL_LIST_CLEAR` / 排序列读逐字对齐 `statements.ts:16-20,27-41`。
 *    **第十刀-a 那一半同款**：形状 == 契约 `:103`（`ids: string[]` → `void`，广播载荷是**裸数组**）、
 *    桌面三段链（`rendererListManage.ts:45-47` → `rendererEvent.ts:15-17` → `ListEvent.ts:61-65` →
 *    `winRendererEvent.ts:12-14` + 订阅 `rendererListManage.ts:230`）逐字对得上；
 *    三句 DELETE 逐字对齐 `statements.ts:49 / :119 / :192`（`my_list` → `my_list_music_info` →
 *    `my_list_music_info_order`，**每个 id 三句连着发**，对齐 `dbHelper.ts:86-90`）；
 *    **三个** `synchronized (LIST_WRITE_LOCK)` 临界区都**逐块**断言"块内没有 emit、
 *    没有顶层载荷解析（含 `readRemoveIds` / `requireRemoveId`）"；保留 id 的常量与消息文本；
 *    以及 `.0` 归一化（写通道读现有行那一处与读通道 / 桌面 `dbHelper.ts:44-49` 逐字同形）。
 *
 * 2. **渲染层接线组（真 JS）**：用真的桥（`capacitor.js`）+ **真的** `rendererListManage.ts`
 *    与**真的** `action.ts`（只把它们的 import 换成替身），跑一遍
 *    "原生 `{kind:'event', channel:'player_list_update', args:[payload]}` → 渲染层 state 被改"。
 *    它钉住的是**广播载荷必须是裸数组**：包成对象 ⇒ `for…of` 抛 `TypeError` ⇒ 被桥自己吞成
 *    **一条 `console.error`**（`capacitor.js:464-467`）⇒ 界面完全不动。
 *    同一条链也跑了 add（对象载荷）与 remove（裸字符串数组）两半 —— 三条通道**形状各不同形**。
 *
 * 3. **JVM 行为组（真 `javac` + 真 `java`）**：把 `RainMusicListWriteChannels.java` 与
 *    **没改过的** `RainMusicIpcHandlers.java` 连同一组**手写替身**（假 `SQLiteDatabase` /
 *    假 `org.json` / 假 `Logger` / 假 `RainMusicDatabase` / 假 `RainMusicIpcPlugin`）编一遍并运行
 *    （exit 0），用"观察者探针"把每个场景的结果打印成 `section<TAB>key<TAB>value`，
 *    断言全部在**本 JS 文件**里。它覆盖的是本文件的**控制流**：
 *    锁（同一时刻只可能有一个事务开着）、emit 在 `commit` 之后且在锁外、
 *    失败时**不广播**、载荷的**形状与绑定顺序**、0 行命中 = 成功、半批失败 ⇒ 整个事务回滚、
 *    空数组 ⇒ 0 条 SQL + 提交 + 广播空数组；
 *    **第九刀-a 新增的 add 场景**：广播载荷是**对象**且 `position` 是**调用方原值**（`-1` 不被折算）、
 *    空 `listInfos` ⇒ 0 条 INSERT + 提交 + 广播、**空洞续号**（库里 `0,1,5` ⇒ 下一个 `6`）、
 *    **插队重编号**（清表 + `0..n-1` 全量重写、可空列原样搬回）、id 冲突 ⇒ 回滚 + 不广播、
 *    缺 `name` ⇒ 连事务都不开（校验早于 `open`）、两个线程并发 add ⇒ 位置不重复；
 *    **第十刀-b 新增的 remove 场景**（第十刀-a 只用 `%TEMP%` 跑过的那 11 条，逐条搬进来）：
 *    两个 id ⇒ 一个事务六句 DELETE（绑定序 `l-1,l-1,l-1,l-2,l-2,l-2`）、广播是**裸字符串数组**
 *    （`arg0=JSONArray`、`wire=["l-1","l-2"]`）、单个 / 不存在的 id 都不被误拒、**`love` 不被拒**、
 *    空数组 ⇒ 0 条 SQL（连 prepare 都不做）、**保留 id（`default` / `temp`）在 `open` 之前就被拒**、
 *    第 2 句失败 ⇒ 回滚（第一句删掉的行走回来）+ 不广播、库打不开 / 表缺失、两个线程并发 remove。
 *    ⚠️ 第十一刀（`JSONException` 漏检修复）之后，替身的签名**不再是人手照着记忆写的**：`org.json` 那三个
 *    类的每一个成员都逐字对着真 AOSP 的编译产物（`javap -classpath android-json-0.0.20131108.vaadin1.jar`）
 *    与 AOSP libcore 源码核过（见 `STUB_JSON_EXCEPTION` 上方的出处说明），并且多了一条**负向**用例：
 *    "故意不处理 `JSONException` 的调用方必须编不过"——替身一旦又变宽松，那条用例就红。
 *    这次修复的由来：早先的替身把 `put(String, Object)` 写成了**不抛异常**的版本（比真机宽松），
 *    本组探针因此系统性放过了 `RainMusicListWriteChannels.java:869-870` 的未处理受检异常，
 *    直到 CI 的 `gradlew assembleDebug` 才炸出来。
 *    仍然要注意：`RainMusicDatabase` 在本组里是**替身**（真文件的建表 / 迁移 / `requireTable` 语义不在
 *    本组覆盖范围内，那些由 `android-list-channels.test.cjs` 等用例在源码层面对齐），
 *    `android.*` 那几个替身的签名也**没有**对着真 `android.jar` 核过（本机没有 Android SDK）。
 *    本机没有 javac 时这一组跳过。
 *
 * 范围守卫：本文件覆盖**同一个生产文件**里的**三条**通道（第八刀的 `player_list_update`
 * + 第九刀-a 的 `player_list_add` + 第十刀-a 的 `player_list_remove`），**不改**第四 / 五 / 六 / 七刀
 * 与第一 / 二 / 三刀的任何一个文件（那些文件的注册条数在这里被重新数一遍）；
 * 后面几刀的写通道（`player_list_update_position` / `player_list_data_overwire` /
 * `player_list_music*`）仍在禁字表里，一个字都不许出现。
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
const blockOf = (source, start, marker) => {
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

/** `marker` 第一次出现处的那个块（等价于老的 `blockRange`）。 */
const blockRange = (source, marker) => {
  const start = source.indexOf(marker)
  assert.ok(start > -1, `找不到 ${marker}`)
  return blockOf(source, start, marker)
}

/**
 * 同一份源码里**所有**以 `marker` 开头的块（第九刀-a 起本文件有**两个**临界区，
 * 只配对第一个会让"第二个锁块里偷偷 emit / 偷偷解析载荷"完全不被覆盖）。
 */
const blockRanges = (source, marker) => {
  const found = []
  let from = 0
  for (;;) {
    const at = source.indexOf(marker, from)
    if (at === -1) break
    found.push(blockOf(source, at, marker))
    from = at + marker.length
  }
  return found
}

/** 与桌面 `verifyDB.ts:4` 的那条正则逐字相同（`/\n|\s|;|--.+/g`）。 */
const normalizeSql = sql => sql.replace(/\n|\s|;|--.+/g, '')
/** better-sqlite3 的具名参数 → Android 的位置参数（逐个按出现顺序替换，锁住参数先后）。 */
const toPositionalSql = sql => sql.replace(/@\w+/g, '?')

const writeCode = stripJavaComments(writeJava)
const dbCode = stripJavaComments(dbJava)

const { PLAYER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})
const CHANNEL = PLAYER_EVENT_NAME.list_update
/** 第九刀-a 的通道名（同一个文件里的第二条通道）。 */
const CHANNEL_ADD = PLAYER_EVENT_NAME.list_add
/** 第十刀-a 的通道名（同一个文件里的第三条通道）。 */
const CHANNEL_REMOVE = PLAYER_EVENT_NAME.list_remove
/** 桌面那一条 UPDATE（`statements.ts:56-62` 的 `createListUpdateStatement`）。 */
const desktopUpdateSql = statementsTs.match(/createListUpdateStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.UserListInfo\]>\(`([\s\S]*?)`\)/)[1]
/** 桌面那一条 INSERT（`statements.ts:27-32`，**6 列、含 position**）。 */
const desktopInsertSql = statementsTs.match(/createListInsertStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.UserListInfo\]>\(`([\s\S]*?)`\)/)[1]
/** 桌面那一条清表（`statements.ts:38-41`，**没有 WHERE**）。 */
const desktopClearSql = statementsTs.match(/createListClearStatement[\s\S]*?db\.prepare<\[\]>\('([\s\S]*?)'\)/)[1]
/** 桌面读全部歌单那一句（`statements.ts:16-20`，`ORDER BY "position" ASC, "rowid" ASC`）。 */
const desktopQuerySql = statementsTs.match(/createListQueryStatement[\s\S]*?db\.prepare<\[\]>\(`([\s\S]*?)`\)/)[1]
/** 第十刀-a 的三句删除（`statements.ts:49 / :119 / :192`，三句**本来就是位置参数**）。 */
const desktopListDeleteSql = statementsTs.match(/createListDeleteStatement[\s\S]*?db\.prepare<\[string\]>\('([\s\S]*?)'\)/)[1]
const desktopMusicInfoDeleteSql = statementsTs.match(/createMusicInfoDeleteByListIdStatement[\s\S]*?db\.prepare<\[string\]>\('([\s\S]*?)'\)/)[1]
const desktopOrderDeleteSql = statementsTs.match(/createMusicInfoOrderDeleteByListIdStatement[\s\S]*?db\.prepare<\[string\]>\('([\s\S]*?)'\)/)[1]
/** 桌面 `updateUserLists` 的事务边界（`dbHelper.ts:99-105`）。 */
const desktopUpdateHelper = dbHelperTs.match(/export const updateUserLists[\s\S]*?\}\)\(lists\)/)[0]
/** 桌面 `insertUserLists` 的事务边界（`dbHelper.ts:58-75`，`isClear` 那一支）。 */
const desktopInsertHelper = dbHelperTs.match(/export const insertUserLists[\s\S]*?\}\)\(lists\)/)[0]
/** 桌面 `deleteUserLists` 的事务边界（`dbHelper.ts:81-93`，"每个 id 三句连着发"）。 */
const desktopDeleteHelper = dbHelperTs.match(/export const deleteUserLists[\s\S]*?\}\)\(listIds\)/)[0]
/** 桌面 `createUserLists` 的两个分支（`modules/list/index.ts:70-98`）。 */
const desktopCreateLists = read('src/main/worker/dbService/modules/list/index.ts').match(/export const createUserLists[\s\S]*?\n\}/)[0]

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
  // ⚠️ 第九刀-b：`:102` 那一行的"用途"一格里补了**原生已实现**的标注（指向生产文件），
  // 所以这条断言跟着换成了新文本 —— 它钉的还是"那一行的形状没被顺手改掉"。
  assert.ok(contractMd.includes('| `player_list_add` | 双向：`createUserList` `R:listManage:38`；监听 `R:listManage:229` | 接收 `M:list:12`；发送 `M:listSend:10` | `{position, listInfos}` → `void` | 新建歌单（**原生已实现**：`RainMusicListWriteChannels.java` 的 `CHANNEL_LIST_ADD`，第九刀-a；本行左侧的契约就是实现的形状） |'))
  // ⚠️ 第十刀-b：`:103` 同款（第十刀-a 已实现 remove，本刀按第八/九刀的做法补上标注）。
  assert.ok(contractMd.includes('| `player_list_remove` | 双向：`removeUserList` `R:listManage:46`；监听 `R:listManage:230` | 接收 `M:list:15`；发送 `M:listSend:13` | `ids: string[]` → `void` | 删除歌单（**原生已实现**：`RainMusicListWriteChannels.java` 的 `CHANNEL_LIST_REMOVE`，第十刀-a；本行左侧的契约就是实现的形状） |'))
  // 表下那条注必须点明"裸数组 / 不能包成对象"以及它的代价（被桥吞成一条 console.error）。
  assert.match(contractMd, /> \*\*上面三条"双向"的广播载荷形状（照抄，别自己包装）\*\*/)
  assert.ok(contractMd.includes('裸数组'))
  assert.ok(contractMd.includes('console.error'))
  // 第九刀-b 补的那一段：add 的**对象**载荷形状（原生侧到底发什么、position 是原值、键序）。
  assert.match(contractMd, /> \*\*`player_list_add` 的对象载荷形状（原生已实现，第九刀-a）\*\*/)
  assert.ok(contractMd.includes('`ctx.emitTo(CHANNEL_LIST_ADD, payload)`'), '契约注必须点名原生侧那一次 emit')
  assert.ok(contractMd.includes('args = [{ position, listInfos }]'), '契约注必须写出 wire 的形状')
  assert.ok(contractMd.includes('就是调用方传来的原值'), '契约注必须点明 position 不折算')
  assert.ok(contractMd.includes('position ASC, rowid ASC'), '契约注必须写出插队分支的读序')
  // 第十刀-b 补的那一段：remove 的**裸数组**载荷形状 + 它的四条 invoke 语义。
  assert.match(contractMd, /> \*\*`player_list_remove` 的裸数组载荷形状（原生已实现，第十刀-a）\*\*/)
  assert.ok(contractMd.includes('`ctx.emitTo(CHANNEL_LIST_REMOVE, ids)`'), '契约注必须点名原生侧那一次 emit')
  assert.ok(contractMd.includes('args = [["l-1","l-2"]]'), '契约注必须写出 remove 的 wire 形状（裸数组）')
  assert.ok(contractMd.includes('`args = [{ ids: […] }]`'), '契约注必须点明**不能**包成 {ids:…}')
  assert.ok(contractMd.includes('每个 id **连着跑三句** DELETE'), '契约注必须写清三句 DELETE 的形状')
  assert.ok(contractMd.includes('0 条 SQL（连 prepare 都不做）'), '契约注必须写清空数组的语义')
  assert.ok(contractMd.includes('保留 id（`default` / `temp`'), '契约注必须写清保留 id 被拒 + 这是一处有意偏离')
  assert.ok(contractMd.includes('`love` **不在**拒绝之列'), '契约注必须写清 love 不被拒（裁定 4）')
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
  // ⚠️ 第九刀-b：适用域从"整个文件"收窄到"update 那一半" —— add 那一半**必须**写 position
  // （`SQL_LIST_INSERT` 的 6 列里就有它，见下一个用例）。替代原来那条
  // `!writeCode.includes('position')`：那条在 add 落地后必然为假，但它想钉的其实是
  // "改名的 UPDATE 不许碰 position"。所以这里逐块钉：update 用的**每一段**代码里都没有它。
  const updateOnlyRegion = [
    javaSql,
    blockRange(writeCode, 'private static void applyListUpdates').body,
    blockRange(writeCode, 'private static void bindNullableText').body,
    blockRange(writeCode, 'private static void bindNullableTimestamp').body,
    blockRange(writeCode, 'private static JSONObject requireInfoObject').body,
    blockRange(writeCode, 'private static String requireId').body,
    blockRange(writeCode, 'private static JSONArray readListInfos').body,
  ].join('\n')
  assert.ok(!/position/i.test(updateOnlyRegion), 'update 那一半（UPDATE 语句 + 它的写库 / 绑定 / 校验）里根本不该出现 position')
  // 反向守卫：position 只允许出现在 add 那一半（INSERT 语句里必须有它）。
  assert.match(javaTextBlock(writeJava, 'SQL_LIST_INSERT'), /"position"/, 'add 的 6 列里必须有 position')

  // 绑定顺序 = ? 的出现顺序（1…5）。改了顺序就是改了语义。
  assert.match(writeCode, /bindNullableText\(statement, 1, info, COLUMN_NAME, i\)/)
  assert.match(writeCode, /bindNullableText\(statement, 2, info, COLUMN_SOURCE, i\)/)
  assert.match(writeCode, /bindNullableText\(statement, 3, info, COLUMN_SOURCE_LIST_ID, i\)/)
  assert.match(writeCode, /bindNullableTimestamp\(statement, 4, info, i\)/)
  assert.match(writeCode, /statement\.bindString\(5, requireId\(info, i\)\)/)
})

test('第九刀-a 的 SQL 逐字对齐 statements.ts：INSERT 6 列（含 position）、CLEAR 无 WHERE、读现有行同序', () => {
  // INSERT：`statements.ts:27-32`，6 列、列序 = tables.ts 的列序 = dbHelper.ts:65-72 的绑定序。
  const javaInsert = javaTextBlock(writeJava, 'SQL_LIST_INSERT')
  assert.match(desktopInsertSql, /INSERT INTO "main"\."my_list"/)
  assert.equal(
    normalizeSql(javaInsert),
    normalizeSql(toPositionalSql(desktopInsertSql)),
    'Java 的 SQL_LIST_INSERT 必须与 statements.ts:27-32 的插入语句逐字一致（只允许 @x → ?）',
  )
  const insertColumns = text => text.match(/\(([^)]*)\)\s*VALUES/)[1].matchAll(/"(\w+)"/g)
  assert.deepEqual([...insertColumns(desktopInsertSql)].map(m => m[1]),
    ['id', 'name', 'source', 'sourceListId', 'position', 'locationUpdateTime'])
  assert.deepEqual([...insertColumns(javaInsert)].map(m => m[1]),
    ['id', 'name', 'source', 'sourceListId', 'position', 'locationUpdateTime'])

  // CLEAR：`statements.ts:38-41`，**没有 WHERE**（插队分支 = 整表清空重写）。
  const javaClear = javaTextBlock(writeJava, 'SQL_LIST_CLEAR')
  assert.equal(normalizeSql(javaClear), normalizeSql(desktopClearSql))
  assert.ok(!/WHERE/i.test(javaClear), 'CLEAR 不能带 WHERE：它必须清掉整张表（否则插队会留下残行）')

  // 读现有行：`statements.ts:16-20`，**必须**是 position ASC, rowid ASC —— 插队的位置靠这个序，
  // 按 SQLite 存储序读会让"有空洞 / 与 rowid 不同序"的库插图位置与桌面不同。
  const javaOrdered = javaTextBlock(writeJava, 'SQL_LIST_ORDERED')
  assert.equal(
    normalizeSql(javaOrdered),
    normalizeSql(desktopQuerySql),
    'Java 的 SQL_LIST_ORDERED 必须与 statements.ts:16-20 的查询逐字一致（同 6 列、同序）',
  )
  assert.match(javaOrdered, /ORDER BY "position" ASC, "rowid" ASC/)

  // COUNT / MAX 是这一刀新增的"读基数 / 读起点"（桌面用的是 queryAllUserList() 的长度与最后一行的
  // 原始 position —— 见类注释「新位置怎么算」），所以它们没有桌面逐字对应物，但必须落在同一张表上。
  for (const name of ['SQL_COUNT_LISTS', 'SQL_MAX_POSITION']) {
    const sql = javaTextBlock(writeJava, name)
    assert.match(sql, /FROM "main"\."my_list"/, `${name} 必须查 my_list`)
    assert.ok(!/my_list_music_info/.test(sql), `${name} 不许碰歌单内的歌曲表`)
  }
  assert.match(javaTextBlock(writeJava, 'SQL_COUNT_LISTS'), /COUNT\(\*\)/)
  assert.match(javaTextBlock(writeJava, 'SQL_MAX_POSITION'), /MAX\("position"\)/)

  // 两个分支的判定与桌面 `index.ts:72` 逐字同形：`position < 0 || position >= COUNT(*)`。
  assert.match(desktopCreateLists, /if \(position < 0 \|\| position >= userLists\.length\)/)
  assert.match(writeCode, /return !cursor\.moveToFirst\(\) \|\| position < 0 \|\| position >= cursor\.getLong\(0\)/)

  // 事务边界对齐 `dbHelper.ts:58-75` 的 `insertUserLists`：一个 db.transaction，循环里逐条 run，
  // `isClear` 时先清表。
  assert.match(desktopInsertHelper, /db\.transaction/)
  assert.match(desktopInsertHelper, /if \(isClear\) await listClearStatement\.run\(\)/)
  assert.match(desktopInsertHelper, /for \(const list of lists\) \{\s*\n\s*await listInsertStatement\.run\(/)
})

test('第十刀-a 的三句 DELETE 逐字对齐 statements.ts（my_list / my_list_music_info / my_list_music_info_order，各一句）', () => {
  // 先钉住桌面那三句（引用没写错文件）：三张表**一个都不能写错**，写错 = 删错表。
  assert.match(desktopListDeleteSql, /DELETE FROM "main"\."my_list" WHERE "id"=\?/)
  assert.match(desktopMusicInfoDeleteSql, /DELETE FROM "main"\."my_list_music_info" WHERE "listId"=\?/)
  assert.match(desktopOrderDeleteSql, /DELETE FROM "main"\."my_list_music_info_order" WHERE "listId"=\?/)

  const pairs = [
    ['SQL_LIST_DELETE', desktopListDeleteSql, 'my_list', 'id'],
    ['SQL_MUSIC_INFO_DELETE_BY_LIST_ID', desktopMusicInfoDeleteSql, 'my_list_music_info', 'listId'],
    ['SQL_MUSIC_INFO_ORDER_DELETE_BY_LIST_ID', desktopOrderDeleteSql, 'my_list_music_info_order', 'listId'],
  ]
  for (const [name, desktop, table, column] of pairs) {
    const java = javaTextBlock(writeJava, name)
    assert.equal(
      normalizeSql(java),
      normalizeSql(toPositionalSql(desktop)),
      `Java 的 ${name} 必须与 statements.ts 那一句逐字一致（这三句本来就只有位置参数）`,
    )
    // 归一化比对挡不住"三句全抄成 my_list"这种抄错（去空白后仍是合法 SQL），所以按表 / 列再断一次。
    assert.match(java, new RegExp(`DELETE FROM "main"\\."${table}" WHERE "${column}"=\\?`), `${name} 必须删 ${table}.${column}`)
    assert.equal((java.match(/\?/g) ?? []).length, 1, `${name} 只该有一个位置参数（多一个 = 删得比桌面多）`)
  }

  // 三句在**同一个循环**里、按 1→2→3 连着发（对齐 dbHelper.ts:86-90）。
  assert.match(desktopDeleteHelper, /db\.transaction/)
  assert.match(
    desktopDeleteHelper,
    /for \(const id of listIds\) \{\s*\n\s*await listDeleteStatement\.run\(id\)\s*\n\s*await musicInfoDeleteByListIdStatement\.run\(id\)\s*\n\s*await musicInfoOrderDeleteByListIdStatement\.run\(id\)/,
    '桌面就是"每个 id 三句连着发"——顺序不能反、也不能少的少',
  )

  const body = blockRange(writeCode, 'private static void applyListRemoves').body
  const compiled = pairs.map(([name]) => body.indexOf(`compileStatement(${name})`))
  assert.ok(compiled.every(at => at > -1) && compiled[0] < compiled[1] && compiled[1] < compiled[2],
    `三句 compileStatement 的顺序必须与 statements.ts 的调用序一致：${compiled.join(',')}`)
  const loop = body.slice(body.indexOf('for (int i = 0'), body.indexOf('db.setTransactionSuccessful()'))
  const fired = ['listDelete.clearBindings()', 'musicInfoDelete.clearBindings()', 'orderDelete.clearBindings()']
    .map(call => loop.indexOf(call))
  assert.ok(fired[0] > -1 && fired[1] > fired[0] && fired[2] > fired[1], `三句的执行顺序必须是 1→2→3：${fired.join(',')}`)
  assert.equal((loop.match(/executeUpdateDelete\(\)/g) ?? []).length, 3, '每个 id 恰好三句 DELETE')
  assert.equal((loop.match(/bindString\(1, id\)/g) ?? []).length, 3, '三句都用位置参数 1 绑同一个 id')
  // 不做的事：删歌单**不重排 / 不重编号** position（桌面也不做），也不看 executeUpdateDelete 的返回值。
  assert.ok(!/position/i.test(body), 'remove 的写库段里不该出现 position')
  assert.ok(!/=\s*\w+\.executeUpdateDelete\(\)/.test(loop), '三句的返回值一律丢掉（0 行命中 = 成功）')
  // 裁定 1：空数组**连 prepare 都不做**（"0 条 SQL"要在任何读法下都字面成立）——
  // 三条 compileStatement 必须在 `ids.length() > 0` 那个 if 里面。
  const guardIndex = body.indexOf('if (ids.length() > 0)')
  assert.ok(guardIndex > -1, '空数组那条分支必须显式存在（`if (ids.length() > 0)`）')
  assert.ok(compiled.every(at => at > guardIndex), '三条 prepare 必须在 `ids.length() > 0` 的块里')
})

test('`.0` 归一化：写通道**读现有行**时与读通道 / 桌面同一条规则（少了它，插队整表重写会把 "123.0" 固化）', () => {
  // 桌面：`dbHelper.ts:23` 的 `idFixRxp = /\.0$/`，`:44-49` 在 queryAllUserList() 里逐条去掉末尾 .0。
  assert.match(dbHelperTs, /const idFixRxp = \/\\\.0\$\//)
  assert.match(
    dbHelperTs,
    /if \(info\.sourceListId\?\.endsWith\?\.\('\.0'\)\) \{\s*\n\s*info\.sourceListId = info\.sourceListId\.replace\(idFixRxp, ''\)/,
  )
  // 读通道（第四刀）照抄了它：本文件（写通道）读现有行那一处也必须接上 —— 否则老库里的 "123.0"
  // 在插队整表重写之后仍是 "123.0"，而渲染层走读通道看到的是 123 ⇒ 两侧视图不一致。
  assert.match(listJava, /jsonValue\(stripLegacyNumericIdSuffix\(cursor\.getString\(sourceListIdIndex\)\)\)/)
  assert.match(writeCode, /jsonNullIfNull\(stripLegacyNumericIdSuffix\(cursor\.getString\(sourceListIdIndex\)\)\)/)
  // 必须是**读现有行**的那条路（readOrderedRows），不是别处顺手加的。
  assert.match(
    blockRange(writeCode, 'private static List<ListRow> readOrderedRows').body,
    /stripLegacyNumericIdSuffix\(cursor\.getString\(sourceListIdIndex\)\)/,
  )
  // 语义（不是只匹配名字）：只去**末尾那一次**的 `.0`，null 原样返回。
  assert.match(
    writeCode,
    /return sourceListId\.endsWith\("\.0"\) \? sourceListId\.substring\(0, sourceListId\.length\(\) - 2\) : sourceListId;/,
  )
  // 两份实现必须**逐字同形**（一份语义、两处实现；抽共享要动读通道 ⇒ 见汇报）：
  // 改一份而不改另一份，同一个 "123.0" 在读 / 写两条通道上就会有**两个**答案。
  const bodyOf = (source, marker) => blockRange(stripJavaComments(source), marker).body.replace(/\s+/g, ' ').trim()
  assert.equal(
    bodyOf(writeJava, 'private static String stripLegacyNumericIdSuffix'),
    bodyOf(listJava, 'private static String stripLegacyNumericIdSuffix'),
    '两份 stripLegacyNumericIdSuffix 必须逐字同形（改一份必须同时改另一份）',
  )
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
  // ⚠️ 第九刀-b：本文件有**两个**临界区（第八刀改名的 `applyListUpdates` + 第九刀-a 新建的
  // `applyListAdds`）；第十刀-b 起是**三个**（第十刀-a 删除的 `applyListRemoves`）。**一条都不许省**：
  // 数少了说明锁没了，数多了说明有人又新加了一把/一处锁，两种情况都要回来看这一条。
  assert.equal((writeCode.match(/synchronized\s*\(/g) ?? []).length, 3, '本文件应恰好有三个临界区（update 一个、add 一个、remove 一个）')
  // ⚠️ 逐块断言（第九刀-b 起覆盖**全部**临界区，第十刀-b 把第三条也纳进来）：三块里都**不许** emit、
  // 也**不许**做顶层载荷解析。顶层载荷解析（`readListInfos` / `readAddParams` / `requirePosition` /
  // `requireAddListInfos` / `buildPayloadRows` / `readRemoveIds` / `requireRemoveId`）必须在进锁**之前**做完：
  // 它们只依赖 args，进锁只会白占锁并让"参数非法"这条路径先去开库/开事务
  // （缺 name / 保留 id 连事务都不该开，见 JVM 探针 add-missing-name 与 remove-reserved-default）。
  const locks = blockRanges(writeCode, 'synchronized (LIST_WRITE_LOCK)')
  assert.equal(locks.length, 3, '三个临界区都要被解析出来（blockRanges 按花括号配对）')
  for (const [index, one] of locks.entries()) {
    for (const forbidden of [
      'emitTo', 'RequestContext', 'readListInfos', 'readAddParams', 'requirePosition',
      'requireAddListInfos', 'buildPayloadRows', 'readRemoveIds', 'requireRemoveId',
    ]) {
      assert.ok(!one.body.includes(forbidden), `第 ${index + 1} 个临界区里不该出现 ${forbidden}`)
    }
  }
  // 三个临界区必须**各属于一个写方法**，且都在 `beginTransaction` 之前进入、`endTransaction`
  // 之后退出（同一个块里既 begin 又 end ⇒ 锁包住了整趟事务；emit 在块外 ⇒ 提交后才广播）。
  const updateFn = blockRange(writeCode, 'private static void applyListUpdates')
  const addFn = blockRange(writeCode, 'private static void applyListAdds')
  const removeFn = blockRange(writeCode, 'private static void applyListRemoves')
  const within = fn => locks.filter(one => one.start > fn.open && one.end < fn.end)
  assert.equal(within(updateFn).length, 1, 'applyListUpdates（改名）里必须有且只有一个临界区')
  assert.equal(within(addFn).length, 1, 'applyListAdds（新建）里必须有且只有一个临界区')
  assert.equal(within(removeFn).length, 1, 'applyListRemoves（删除）里必须有且只有一个临界区')
  // 三个块不是同一个：一个是 UPDATE 的写库段、一个是 INSERT/DELETE 的写库段、一个是三句 DELETE 的写库段。
  assert.ok(within(updateFn)[0].body.includes('statement.executeUpdateDelete()'))
  assert.ok(within(addFn)[0].body.includes('writeListRows(db, rows)'), 'add 的临界区里必须真的落库')
  assert.ok(within(addFn)[0].body.includes('db.execSQL(SQL_LIST_CLEAR)'), 'add 的临界区里必须含清表那一半')
  assert.match(blockRange(writeCode, 'private static void writeListRows').body,
    /for \(Object\[\] row : rows\) db\.execSQL\(SQL_LIST_INSERT, row\)/, '逐行 execSQL，而不是一条拼出来的多值 INSERT')
  // remove 的临界区：三句 DELETE 一句话都不许少（逐句都点名，见「三句 DELETE」那一条用例）。
  for (const call of ['listDelete.executeUpdateDelete()', 'musicInfoDelete.executeUpdateDelete()', 'orderDelete.executeUpdateDelete()']) {
    assert.ok(within(removeFn)[0].body.includes(call), `remove 的临界区里必须有 ${call}`)
  }
  assert.notEqual(within(updateFn)[0].start, within(addFn)[0].start)
  assert.notEqual(within(updateFn)[0].start, within(removeFn)[0].start)
  assert.notEqual(within(addFn)[0].start, within(removeFn)[0].start)
  for (const [index, one] of locks.entries()) {
    assert.match(one.body, /db\.beginTransaction\(\)/, `第 ${index + 1} 个临界区里必须开事务`)
    assert.match(one.body, /db\.setTransactionSuccessful\(\)/, `第 ${index + 1} 个临界区里必须标成功`)
    assert.match(one.body, /finally\s*\{[\s\S]*db\.endTransaction\(\)/, `第 ${index + 1} 个临界区里必须保证 endTransaction`)
  }

  // 不要与第三刀那把 SharedPreferences 的锁混用（代码里一次都不该出现）。
  assert.ok(!writeCode.includes('RainMusicStoreLock'), 'LIST_WRITE_LOCK 与 RainMusicStoreLock 是两把不同的锁')
  // 但要**写清楚**它管不到别的连接、也不是那把锁（这是本刀要求的说明，必须在注释里）。
  assert.ok(writeJava.includes('RainMusicStoreLock'), '类注释必须点名它跟 RainMusicStoreLock 无关')
  assert.match(writeJava, /别的连接|跨连接/, '类注释必须写明它管不到别的连接')
  assert.match(writeJava, /固定 2 线程池|2 线程池/, '类注释必须写明它护的是同一 2 线程池里的两次 handler')
})

test('emit 在**提交成功之后**、**锁外**；update / remove 的载荷是裸数组、add 的载荷是对象（三条各钉一条）', () => {
  // ⚠️ 这是**两个方法**（listUpdate 里 emit、applyListUpdates 里加锁），所以不能拿"源码里谁的
  // indexOf 更大"当证据 —— 结构证据是"锁块与三个写库方法里都没有 emit"，行为证据在 JVM 探针那一组
  // （update 的 `events` 是 `…>update>commit>close>end>emit`，add 的是 `…>execSQL>commit>end>emit`，
  // remove 的是 `…>delete:my_list>delete:my_list_music_info>delete:my_list_music_info_order>commit>end>emit`）。
  const lock = blockRange(writeCode, 'synchronized (LIST_WRITE_LOCK)')
  const writeMethod = blockRange(writeCode, 'private static void applyListUpdates')
  assert.ok(!lock.body.includes('emitTo'), '锁块里不许 emit（临界区 = 只有 SQL）')
  assert.ok(!writeMethod.body.includes('emitTo'), 'update 的写库方法里也不许 emit（emit 只能在它返回之后）')
  assert.ok(!writeMethod.body.includes('RequestContext'), '写库那个方法连 ctx 都不该拿到')

  const emitIndex = writeCode.indexOf('ctx.emitTo(CHANNEL_LIST_UPDATE, listInfos)')
  assert.ok(emitIndex > -1, 'emit 调用必须逐字是 ctx.emitTo(CHANNEL_LIST_UPDATE, listInfos)')
  assert.ok(emitIndex > writeCode.indexOf('applyListUpdates(db, listInfos);'), 'emit 必须晚于写库调用（提交成功之后）')

  // ⚠️ 第九刀-b：**两条通道的载荷形状不同形**，所以这里必须是**两条**断言，而不是一条
  // 打不中的正则（`readListInfos` 被参数化之后是跨行调用，`/…readListInfos\(args\)/` 匹配不到）。
  //
  // (a) update：载荷是**裸数组** —— `readListInfos` 把 `args[0]` 当数组，`emitTo` 发的是它本身。
  assert.match(
    writeCode,
    /JSONArray\s+listInfos\s*=\s*readListInfos\(\s*args,\s*CHANNEL_LIST_UPDATE,\s*"docs\/android\/ipc-contract\.md:104",\s*"`listInfos\[\]`"\s*\)/,
    'update 的载荷必须是 `args[0]` 那个裸数组（readListInfos(args, CHANNEL_LIST_UPDATE, …)）',
  )
  assert.match(writeCode, /ctx\.emitTo\(CHANNEL_LIST_UPDATE, listInfos\)/, 'update 广播的必须是那个数组本身')
  // (b) add：载荷是**对象** `{position, listInfos}` —— `readAddParams` 把 `args[0]` 当对象，
  // 广播时现场拼一个 JSONObject，两个键**一个都不能少**。
  assert.match(writeCode, /JSONObject\s+params\s*=\s*readAddParams\(args\)/, 'add 的载荷必须被当成对象读')
  assert.match(writeCode, /JSONArray\s+listInfos\s*=\s*requireAddListInfos\(params\)/)
  assert.match(writeCode, /payload\.put\(FIELD_POSITION, position\)/, 'add 的广播载荷必须有 position 键')
  assert.match(writeCode, /payload\.put\(FIELD_LIST_INFOS, listInfos\)/, 'add 的广播载荷必须有 listInfos 键')
  assert.match(writeCode, /ctx\.emitTo\(CHANNEL_LIST_ADD, payload\)/, 'add 广播的必须是那个对象')
  // 两条 emit 都在各自的锁块之外、写库调用之后（结构证据；行为证据在 JVM 探针的 events）。
  const addWriteMethod = blockRange(writeCode, 'private static void applyListAdds')
  assert.ok(!addWriteMethod.body.includes('emitTo'), 'add 的写库方法里也不许 emit')
  assert.ok(!addWriteMethod.body.includes('RequestContext'), 'add 的写库方法连 ctx 都不该拿到')
  assert.ok(
    writeCode.indexOf('ctx.emitTo(CHANNEL_LIST_ADD, payload)') > writeCode.indexOf('applyListAdds(db, position, additions);'),
    'add 的 emit 必须晚于写库调用（提交成功之后）',
  )
  // (c) 第十刀-b：remove 也是**裸数组**（与 update 同形、与 add 不同形）—— `readRemoveIds` 把
  // `args[0]` 当数组并**原样返回它**，`emitTo` 发的是它本身。这一条**不是**"抄 update 那一条
  // 的断言"：它点的是第三条通道自己的那个变量名（`ids`），改错了名字这里就红。
  assert.match(writeCode, /JSONArray\s+ids\s*=\s*readRemoveIds\(args\)/, 'remove 的载荷必须是 `args[0]` 那个裸数组')
  assert.match(writeCode, /ctx\.emitTo\(CHANNEL_LIST_REMOVE, ids\)/, 'remove 广播的必须是那个数组本身（不是 {ids}）')
  const removeWriteMethod = blockRange(writeCode, 'private static void applyListRemoves')
  assert.ok(!removeWriteMethod.body.includes('emitTo'), 'remove 的写库方法里也不许 emit')
  assert.ok(!removeWriteMethod.body.includes('RequestContext'), 'remove 的写库方法连 ctx 都不该拿到')
  assert.ok(
    writeCode.indexOf('ctx.emitTo(CHANNEL_LIST_REMOVE, ids)') > writeCode.indexOf('applyListRemoves(db, ids);'),
    'remove 的 emit 必须晚于写库调用（提交成功之后）',
  )
  // 三条 emit 都在**锁块外**：三块里一块都不许出现 emitTo（逐块，不是"整份源码 indexOf"）。
  for (const [index, one] of blockRanges(writeCode, 'synchronized (LIST_WRITE_LOCK)').entries()) {
    assert.ok(!one.body.includes('emitTo'), `第 ${index + 1} 个临界区里不许 emit`)
  }
  assert.ok(!/emitTo\([^)]*new JSONObject/.test(writeCode), 'emit 的载荷不能就地包成 JSONObject（update 那一条尤其）')

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
// 4. 范围守卫：只注册这 3 条（update + add + remove）；老文件一个都没改；零新增依赖
// ---------------------------------------------------------------------------

test('范围守卫：本文件只注册 3 条通道（update + add + remove）；后面几刀的一条都不碰', () => {
  const registrations = writeCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  // ⚠️ 第十刀-b：从 2 改成 3（第八刀的 update + 第九刀-a 的 add + 第十刀-a 的 remove）。数**精确**：
  // 少一条说明那一条没落地（真机 IPC_CHANNEL_UNSUPPORTED），多一条说明有人顺手做了下一刀。
  assert.equal(registrations.length, 3, '本文件应注册 player_list_update + player_list_add + player_list_remove，一条不多一条不少')

  // 通道名字面量只允许出现这三个、**且首现顺序就是三条常量的声明序**（update, add, remove）。
  assert.deepEqual(
    [...new Set([...writeCode.matchAll(/"(player_[a-z_]+)"/g)].map(match => match[1]))],
    ['player_list_update', 'player_list_add', 'player_list_remove'],
  )
  // 常量也只能有这三个 CHANNEL_*。
  assert.deepEqual(
    [...writeCode.matchAll(/String\s+(CHANNEL_[A-Z_]+)\s*=/g)].map(match => match[1]),
    ['CHANNEL_LIST_UPDATE', 'CHANNEL_LIST_ADD', 'CHANNEL_LIST_REMOVE'],
  )
  // 三条通道都真的挂进注册表（常量存在但没 register = 真机上还是"未注册"）。
  assert.match(writeCode, /RainMusicIpcHandlers\.register\(\s*CHANNEL_LIST_UPDATE\s*,/)
  assert.match(writeCode, /RainMusicIpcHandlers\.register\(\s*CHANNEL_LIST_ADD\s*,/)
  assert.match(writeCode, /RainMusicIpcHandlers\.register\(\s*CHANNEL_LIST_REMOVE\s*,/)

  // 后面几刀的写通道一条都不许出现（连拼名片段都不许）。⚠️ 第十刀-b 起 remove 两项**已解禁**
  // （它们正是本刀的落点），另外 5 项仍在禁字表里 —— 一个字都不许松。
  for (const forbidden of [
    'player_list_update_position', 'player_list_data_overwire', 'player_list_music',
    'CHANNEL_LIST_UPDATE_POSITION', 'CHANNEL_LIST_DATA_OVERWIRE',
  ]) {
    assert.ok(!writeCode.includes(forbidden), `本刀不应出现 ${forbidden}（第十一刀及以后再做）`)
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

test('零新增依赖：import 只允许那几个（框架自带 + JDK + :capacitor-android 的 Logger）', () => {
  const imports = [...writeCode.matchAll(/^import\s+([\w.]+)\s*;/gm)].map(match => match[1]).sort()
  // ⚠️ 第九刀-b：集合**补全到项**（deepEqual 是集合比较）。第九刀-a 新增了两个 import，都是
  // 零 gradle 依赖的：`android.database.Cursor`（Android 框架自带，读 `MAX(position)` /
  // 现有行要用）与 `java.util.ArrayList`（JDK，装插队分支的行）。集合里**多一项就是多一个依赖**。
  // ⚠️ 第十一刀（JSONException 漏检修复）：新增 `org.json.JSONException` —— 它**不是**新依赖：
  // 同一个 `org.json` 包（Android 平台自带，见下面两行）里的异常类型，`put(...)` 的 `throws` 子句
  // 必须点名它。这一项与 `org.json.JSONArray` / `org.json.JSONObject` 同源，判据（第 773 行
  // 那条 `org.json.` 前缀的白名单）本来就是这么写的。
  assert.deepEqual(imports, [
    'android.content.Context',
    'android.database.Cursor',
    'android.database.sqlite.SQLiteDatabase',
    'android.database.sqlite.SQLiteStatement',
    'com.getcapacitor.Logger',
    'java.util.ArrayList',
    'java.util.List',
    'org.json.JSONArray',
    'org.json.JSONException',
    'org.json.JSONObject',
  ].sort())
  assert.ok(!/kotlin/i.test(writeCode), '没有引入 Kotlin')
  assert.ok(!/androidx\./.test(writeCode), '没有引入 androidx')
  // 只有 Capacitor 那一个 import 来自 `com.getcapacitor`（其余 import 全部是 android.* / org.json / JDK）。
  const external = imports.filter(name => !/^(android\.|java\.|org\.json\.)/.test(name))
  assert.deepEqual(external, ['com.getcapacitor.Logger'], '除了 :capacitor-android 的 Logger，不许引入别的第三方包')
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

/** 播几行歌单（第十刀-b：接受多个 —— remove 要证明"没被点名的那个还在"）。 */
const seedUserLists = (state, ...lists) => {
  state.userLists.length = 0
  state.userLists.push(...lists)
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
// 5b. 第九刀-a 的渲染层接线（同一个真桥 + 真 rendererListManage + 真 action）：
//     add 的广播载荷必须是**对象** `{position, listInfos}`（与 update 的裸数组不同形）
// ---------------------------------------------------------------------------

/** add 的 invoke 那一半：`createUserList(data)` → `rendererInvoke(list_add, {position, listInfos})`。 */
test('add 的 invoke 信封是 args=[{position, listInfos}]（**对象**，与 update 的 args=[listInfos] 不同形）', async() => {
  const env = setupRenderer()
  const data = { position: -1, listInfos: [{ id: 'n-1', name: '新歌单' }] }
  await env.rendererListManage.createUserList(data)

  const envelope = env.native.posts[0]
  assert.equal(envelope.kind, 'invoke')
  assert.equal(envelope.channel, CHANNEL_ADD)
  assert.equal(CHANNEL_ADD, 'player_list_add', 'ipcNames.ts 的真实值变了？')
  assert.equal(JSON.stringify(envelope.args), JSON.stringify([{ position: -1, listInfos: data.listInfos }]),
    'args[0] 必须是对象（不是裸数组 —— 裸数组属于 player_list_update）')
})

test('add 的广播载荷是对象：args=[{position:-1, listInfos:[…]}] ⇒ 真 list_create ⇒ userListCreate 追加（position 原值参与判定）', () => {
  const env = setupRenderer()
  seedUserLists(env.state, { id: 'l-1', name: '已有', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1 })

  env.native.deliver({
    kind: 'event',
    channel: CHANNEL_ADD,
    args: [{ position: -1, listInfos: [{ id: 'n-1', name: '新歌单' }] }],
  })

  assert.deepEqual(env.state.userLists.map(list => list.id), ['l-1', 'n-1'],
    'position=-1 ⇒ 追加（渲染层 action.ts:48 用原值判 position < 0）')
  assert.equal(env.state.userLists[1].name, '新歌单')
  assert.deepEqual(env.errors, [], '对象载荷这一路不该有任何 console.error')
})

test('add 发成裸数组 ⇒ 解构出 undefined 的 listInfos ⇒ for…of TypeError 被桥吞成一条 console.error，界面不动', () => {
  const env = setupRenderer()
  seedUserLists(env.state, { id: 'l-1', name: '已有', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1 })

  env.native.deliver({
    kind: 'event',
    channel: CHANNEL_ADD,
    args: [[{ id: 'n-1', name: '新歌单' }]],
  })

  assert.deepEqual(env.state.userLists.map(list => list.id), ['l-1'], '发成裸数组 ⇒ 一个字都没加进去')
  assert.equal(env.errors.length, 1, '桥把监听器的异常吞成恰好一条 console.error')
  assert.match(env.errors[0], /监听器抛错/)
  assert.match(env.errors[0], new RegExp(CHANNEL_ADD))
  assert.match(env.errors[0], /not iterable/)
})

test('监听器体 == 生产代码那三行（rendererListManage.ts:180-184 → action.ts:144-161）', () => {
  assert.match(rendererListManageTs, /\{ params: \{ position, listInfos \} \}[\s\S]{0,120}for \(const list of listInfos\) \{\s*\n\s*userListCreate\(\{ \.\.\.list, position \}\)/)
  assert.match(rendererActionTs, /export const userListCreate = \(\{ name, id, source, sourceListId, position, locationUpdateTime \}/)
  assert.match(rendererActionTs, /if \(userLists\.some\(item => item\.id == id\)\) return/)
  // add 的订阅也必须在同一个 registerListAction 里（:229）。
  assert.match(rendererListManageTs.split('\n')[228], /rendererOn\(PLAYER_EVENT_NAME\.list_add, list_create\)/)
})

// ---------------------------------------------------------------------------
// 5c. 第十刀-a 的渲染层接线（同一个真桥 + 真 rendererListManage + 真 action）：
//     remove 的广播载荷必须是**裸数组** `ids`（与 update 同形、与 add 的对象不同形）
// ---------------------------------------------------------------------------

test('remove 的 invoke 信封是 args=[["l-1"]]（**裸数组**；不是 {ids:[…]}）', async() => {
  const env = setupRenderer()
  await env.rendererListManage.removeUserList(['l-1'])

  const envelope = env.native.posts[0]
  assert.equal(envelope.kind, 'invoke')
  assert.equal(envelope.channel, CHANNEL_REMOVE)
  assert.equal(CHANNEL_REMOVE, 'player_list_remove', 'ipcNames.ts 的真实值变了？')
  // ⚠️ JSON.stringify 比对：参数数组是在 `vm.runInNewContext` 里造的（另一个 realm）。
  assert.equal(JSON.stringify(envelope.args), JSON.stringify([['l-1']]), 'args[0] 必须是数组（不是 {ids}）')
  assert.equal(Array.isArray(envelope.args[0]), true, 'args[0] 必须是数组')
  assert.equal(typeof envelope.args[0][0], 'string', 'args[0] 的元素必须是字符串（契约是 ids: string[]）')
})

test('remove 的广播载荷是裸数组：args:[["l-1"]] ⇒ 真 list_remove ⇒ 真 userListsRemove **真的删掉**、零 console.error', () => {
  const env = setupRenderer()
  seedUserLists(
    env.state,
    { id: 'l-1', name: '甲', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1 },
    { id: 'l-2', name: '乙', source: 'wy', sourceListId: 's-2', locationUpdateTime: 2 },
  )

  env.native.deliver({ kind: 'event', channel: CHANNEL_REMOVE, args: [['l-1']] })

  assert.deepEqual(env.state.userLists.map(list => list.id), ['l-2'],
    '裸数组必须能走到 userListsRemove（点名的那个真的被删掉）')
  assert.equal(env.state.userLists[0].name, '乙', '没被点名的那个一个字都不许动')
  assert.deepEqual(env.errors, [], '裸数组这一路不该有任何 console.error')
  assert.equal(env.native.notifies, 1, '只有那一条广播（没有应答）')
})

test('remove 的裸数组包成 {ids:[…]} ⇒ for…of TypeError 被桥吞成**一条 console.error**，state 一个字没动', () => {
  const env = setupRenderer()
  seedUserLists(
    env.state,
    { id: 'l-1', name: '甲', source: 'wy', sourceListId: 's-1', locationUpdateTime: 1 },
    { id: 'l-2', name: '乙', source: 'wy', sourceListId: 's-2', locationUpdateTime: 2 },
  )

  env.native.deliver({ kind: 'event', channel: CHANNEL_REMOVE, args: [{ ids: ['l-1'] }] })

  assert.deepEqual(env.state.userLists.map(list => list.id), ['l-1', 'l-2'], '包成对象 ⇒ 界面完全不动')
  assert.equal(env.errors.length, 1, '桥把监听器的异常吞成恰好一条 console.error')
  assert.match(env.errors[0], /监听器抛错/)
  assert.match(env.errors[0], new RegExp(CHANNEL_REMOVE))
  assert.match(env.errors[0], /not iterable/)
  // 调用方那边**什么都不会收到**（不是 reject，也不是 resolve）。
  assert.equal(env.native.notifies, 1, '只有那一条广播，没有应答')
})

test('remove 的监听器体 == 生产代码那三行（rendererListManage.ts:185-188 → action.ts:163-175）', () => {
  assert.match(rendererListManageTs, /\{ params: ids \}[\s\S]{0,120}userListsRemove\(ids\)/)
  assert.match(
    rendererActionTs,
    /export const userListsRemove = \(ids: string\[\]\) => \{\s*\n\s*const changedIds = \[\]\s*\n\s*for \(const id of ids\)/,
  )
  // 订阅也必须在同一个 registerListAction 里（:230）。
  assert.match(rendererListManageTs.split('\n')[229], /rendererOn\(PLAYER_EVENT_NAME\.list_remove, list_remove\)/)
  // 桌面链那三行（本通道广播形状的来源）。
  assert.match(
    desktopWinRendererEventTs.split('\n')[12],
    /sendEvent<Rain\.List\.ListActionRemove>\(PLAYER_EVENT_NAME\.list_remove, ids\)/,
    'winRendererEvent 发的必须是裸数组 ids',
  )
  assert.ok(
    !/list_remove,\s*\{\s*ids/.test(desktopWinRendererEventTs),
    '广播载荷不能包成 {ids}',
  )
  assert.match(desktopEventTs.split('\n')[14], /mainHandle<Rain\.List\.ListActionRemove>\(PLAYER_EVENT_NAME\.list_remove/)
  assert.match(
    desktopListEventTs,
    /await global\.rain\.worker\.dbService\.removeUserLists\(ids\)\s*\n\s*this\.emit\('list_remove', ids\)/,
    '桌面是"先落库、再广播同一个 ids"——顺序不能反',
  )
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

const STUB_CURSOR = String.raw`
package android.database;

import java.io.Closeable;

/**
 * 手写替身（第九刀-a 新增）：签名照 AOSP 的 {@code android.database.Cursor} ——
 * 它是 {@code Closeable} 的子接口，并且**自己把 {@code close()} 重声明成不抛 {@code IOException}**，
 * 所以实现类（以及调用它的生产代码）不需要 try/catch。只声明本刀真正调用的那几个方法。
 */
public interface Cursor extends Closeable {

    boolean moveToFirst();

    boolean moveToNext();

    boolean isNull(int columnIndex);

    long getLong(int columnIndex);

    String getString(int columnIndex);

    int getColumnIndexOrThrow(String columnName);

    @Override
    void close();
}
`

const STUB_SQLITE_DATABASE = String.raw`
package android.database.sqlite;

import android.database.Cursor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 手写替身（**不是**真 SQLite）：第九刀-b 起它还要**认识 my_list 这张表**
 * （{@code COUNT(*)} / {@code MAX("position")} / 按 {@code position, rowid} 读 /
 * {@code INSERT} / {@code DELETE}），否则 add 的两个分支在本机根本跑不起来。
 *
 * <p>它记录四类观察点：事务边界（{@code begin} / {@code commit} / {@code end}）、语句执行
 * （{@code compile} / {@code update} / {@code execSQL}）、读的形状
 * （{@code query:count} / {@code query:max} / {@code query:ordered}）、
 * 以及**同时开着几个事务**。事务语义照 SQLite：{@code begin} 时快照整表，
 * {@code endTransaction} 时没 {@code setTransactionSuccessful} 就**回滚** ——
 * 这样"id 冲突 ⇒ 整批不落库"才是真的被验证过，而不是只看了个 {@code emitCount}。
 */
public class SQLiteDatabase {

    public static final List<String> EVENTS = Collections.synchronizedList(new ArrayList<String>());
    public static final List<String> EXECUTED = Collections.synchronizedList(new ArrayList<String>());
    /** {@code INSERT} 的绑定（第九刀-a）：一行一条，按**执行序**记（重编号的序就靠它断言）。 */
    public static final List<String> INSERTED = Collections.synchronizedList(new ArrayList<String>());
    public static final List<String> SQL_SEEN = Collections.synchronizedList(new ArrayList<String>());
    public static final AtomicInteger OPEN_TRANSACTIONS = new AtomicInteger(0);
    public static final AtomicInteger MAX_OPEN_TRANSACTIONS = new AtomicInteger(0);
    public static volatile int AFFECTED_ROWS = 1;
    /** 并发探针的会合点：两个线程都进到 beginTransaction 时立刻放行（用来放大"没锁"的窗口）。 */
    public static volatile CountDownLatch RENDEZVOUS = null;
    /**
     * 第十刀-b：{@code bindString} 的**先后**（{@code 下标:值}，按调用序）。
     * 三句 DELETE 都绑位置参数 1，所以它同时钉住"三句都绑同一个 id"与"每个 id 三句连着发"。
     */
    public static final List<String> BINDS = Collections.synchronizedList(new ArrayList<String>());
    /** 第十刀-b 的失败注入：第 N 次（**从 0 数**）DELETE 抛错；{@code -1} = 不注入。 */
    public static volatile int FAIL_DELETE_INDEX = -1;
    public static final AtomicInteger DELETE_INDEX = new AtomicInteger(0);

    /** 假 {@code my_list}：一行 = {id, name, source, sourceListId, position, locationUpdateTime}。 */
    private static final List<Object[]> ROWS = Collections.synchronizedList(new ArrayList<Object[]>());
    private static List<Object[]> SNAPSHOT = null;
    private static boolean SUCCESSFUL = false;

    public static void resetRows() {
        synchronized (ROWS) {
            ROWS.clear();
            SNAPSHOT = null;
            SUCCESSFUL = false;
        }
    }

    /** 播一行现有数据（可空列传 {@code JSONObject.NULL} 哨兵）。 */
    public static void seedList(
        String id, String name, Object source, Object sourceListId, long position, Object locationUpdateTime
    ) {
        ROWS.add(new Object[] { id, name, source, sourceListId, Long.valueOf(position), locationUpdateTime });
    }

    /** 按 {@code ORDER BY "position" ASC, "rowid" ASC}（插入序兜底）把现有行文本化，供 JS 侧断言。 */
    public static List<String> dumpList() {
        List<Object[]> sorted = sortedRows();
        List<String> lines = new ArrayList<String>(sorted.size());
        for (Object[] row : sorted) lines.add(describeRow(row));
        return lines;
    }

    public static int rowCount() { return ROWS.size(); }

    public void beginTransaction() {
        int now = OPEN_TRANSACTIONS.incrementAndGet();
        MAX_OPEN_TRANSACTIONS.accumulateAndGet(now, Math::max);
        EVENTS.add("begin");
        synchronized (ROWS) {
            SNAPSHOT = new ArrayList<Object[]>(ROWS);
            SUCCESSFUL = false;
        }
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

    public void setTransactionSuccessful() {
        SUCCESSFUL = true;
        EVENTS.add("commit");
    }

    /** 没有 {@code setTransactionSuccessful} ⇒ 回滚到 {@code beginTransaction} 时的快照（照 SQLite 的语义）。 */
    public void endTransaction() {
        OPEN_TRANSACTIONS.decrementAndGet();
        synchronized (ROWS) {
            if (!SUCCESSFUL && SNAPSHOT != null) {
                ROWS.clear();
                ROWS.addAll(SNAPSHOT);
            }
            SNAPSHOT = null;
        }
        EVENTS.add("end");
    }

    public SQLiteStatement compileStatement(String sql) {
        SQL_SEEN.add(sql);
        EVENTS.add("compile");
        // ⚠️ 第十刀-b：SQL 本身要传给替身 —— 否则它分不清"改名那一句 UPDATE"与"删除的三句 DELETE"
        // （见 STUB_SQLITE_STATEMENT 的类注释）。
        return new SQLiteStatement(sql);
    }

    /** 删一行假 {@code my_list}（第十刀-b）：只有 my_list 有行模型，另两张子表只记执行。 */
    static void deleteListRow(String id) {
        synchronized (ROWS) {
            for (int i = ROWS.size() - 1; i >= 0; i--) {
                if (id.equals(String.valueOf(ROWS.get(i)[0]))) ROWS.remove(i);
            }
        }
    }

    /** 第九刀-a 的三个读：{@code COUNT(*)} / {@code MAX("position")} / 按 {@code position, rowid} 读现有行。 */
    public Cursor rawQuery(String sql, String[] selectionArgs) {
        SQL_SEEN.add(sql);
        if (sql.contains("COUNT(*)")) {
            EVENTS.add("query:count");
            return new FakeCursor(new String[] { "COUNT(*)" }, one(Long.valueOf(ROWS.size())));
        }
        if (sql.contains("MAX(")) {
            EVENTS.add("query:max");
            // ⚠️ MAX 在**空表**上返回一行一列的 NULL（真 SQLite 的聚合语义）：这一点决定了
            // "空表 ⇒ 起点 0"，所以替身必须照做，不能返回 0。
            Object max = ROWS.isEmpty() ? null : Long.valueOf(maxPosition());
            return new FakeCursor(new String[] { "MAX(\"position\")" }, one(max));
        }
        if (sql.contains("ORDER BY")) {
            EVENTS.add("query:ordered");
            List<Object[]> rows = new ArrayList<Object[]>(sortedRows());
            return new FakeCursor(
                new String[] { "id", "name", "source", "sourceListId", "position", "locationUpdateTime" }, rows);
        }
        throw new IllegalStateException("假库不认识这条查询：" + sql);
    }

    /** {@code DELETE FROM "main"."my_list"}（无绑定）：清掉整张表。 */
    public void execSQL(String sql) {
        SQL_SEEN.add(sql);
        EVENTS.add("execSQL");
        if (!sql.contains("DELETE")) throw new IllegalStateException("假库不认识这条无参 execSQL：" + sql);
        ROWS.clear();
    }

    /** {@code INSERT INTO "main"."my_list" (…)} {@code VALUES (?, …)}：真的插一行；id 重复照 SQLite 抛错。 */
    public void execSQL(String sql, Object[] bindArgs) {
        SQL_SEEN.add(sql);
        EVENTS.add("execSQL");
        if (!sql.contains("INSERT")) throw new IllegalStateException("假库不认识这条带参 execSQL：" + sql);
        Object[] row = new Object[6];
        for (int i = 0; i < 6; i++) row[i] = bindArgs[i];
        String id = String.valueOf(row[0]);
        for (Object[] existing : ROWS) {
            if (id.equals(String.valueOf(existing[0]))) {
                throw new RuntimeException("UNIQUE constraint failed: my_list.id (code 1555)");
            }
        }
        ROWS.add(row);
        INSERTED.add(describeRow(row));
    }

    static String describeRow(Object[] row) {
        return "id=" + text(row[0]) + ";name=" + text(row[1]) + ";source=" + text(row[2]) +
            ";sourceListId=" + text(row[3]) + ";position=" + text(row[4]) +
            ";locationUpdateTime=" + text(row[5]);
    }

    static String text(Object value) {
        if (value == null || value == org.json.JSONObject.NULL) return "null";
        return String.valueOf(value);
    }

    /**
     * 假库里"这一格是 SQL NULL"的两种写法：Java {@code null}（seedList 直接给的）与
     * {@code JSONObject.NULL} 哨兵（**生产代码写进来的就是它**，见 writeListRows 的 execSQL）。
     * 读的时候两者都必须还原成 NULL —— 否则"读完再写回去"会把哨兵当成一个 Number 去强转。
     */
    static boolean isSqlNull(Object value) {
        return value == null || value == org.json.JSONObject.NULL;
    }

    private static List<Object[]> one(Object value) {
        List<Object[]> rows = new ArrayList<Object[]>();
        rows.add(new Object[] { value });
        return rows;
    }

    private static long maxPosition() {
        long max = Long.MIN_VALUE;
        for (Object[] row : ROWS) max = Math.max(max, ((Number) row[4]).longValue());
        return max;
    }

    /** {@code ORDER BY "position" ASC, "rowid" ASC}：position 相同时按插入序（假 rowid）。 */
    private static List<Object[]> sortedRows() {
        List<Object[]> copy = new ArrayList<Object[]>(ROWS);
        copy.sort((left, right) -> Long.compare(((Number) left[4]).longValue(), ((Number) right[4]).longValue()));
        return copy;
    }

    /** 只实现生产代码用到的那几个方法（签名照 AOSP 的 {@code android.database.Cursor}）。 */
    static final class FakeCursor implements Cursor {

        private final String[] columns;
        private final List<Object[]> rows;
        private int index = -1;
        private boolean closed = false;

        FakeCursor(String[] columns, List<Object[]> rows) {
            this.columns = columns;
            this.rows = rows;
        }

        @Override public boolean moveToFirst() { index = 0; return rows.size() > 0; }

        @Override public boolean moveToNext() {
            index++;
            return index < rows.size();
        }

        @Override public boolean isNull(int columnIndex) { return isSqlNull(rows.get(index)[columnIndex]); }

        @Override public long getLong(int columnIndex) {
            Object value = rows.get(index)[columnIndex];
            return isSqlNull(value) ? 0L : ((Number) value).longValue();
        }

        @Override public String getString(int columnIndex) {
            Object value = rows.get(index)[columnIndex];
            return isSqlNull(value) ? null : String.valueOf(value);
        }

        @Override public int getColumnIndexOrThrow(String columnName) {
            for (int i = 0; i < columns.length; i++) {
                if (columns[i].equals(columnName)) return i;
            }
            throw new IllegalArgumentException("column '" + columnName + "' does not exist");
        }

        /** AOSP 的 Cursor 是 Closeable ⇒ 生产代码在 finally 里关它；替身记录一次、并且**只关一次**。 */
        @Override public void close() {
            if (closed) throw new IllegalStateException("Cursor 被关了两次（真机上会抛）");
            closed = true;
            EVENTS.add("close");
        }
    }
}
`

const STUB_SQLITE_STATEMENT = String.raw`
package android.database.sqlite;

import java.util.Arrays;

/**
 * 手写替身：绑定 + 一次"UPDATE / DELETE"，观察点由 SQLiteDatabase 那个替身收集。
 *
 * <p>⚠️ 第十刀-b：{@code compileStatement(sql)} 现在把 SQL 本身传进来。替身**必须**分得清
 * 改名那一句 {@code UPDATE} 与删除的三句 {@code DELETE}（{@code my_list} /
 * {@code my_list_music_info} / {@code my_list_music_info_order}）：不分的话，"每个 id 三句、
 * 顺序 1→2→3"在本机根本没有观察点，而且 DELETE 会被当成 UPDATE 去查 {@code bindings[0] == null}
 * （把绑进去的 id 当成 name 记一条假的 NOT NULL 检查）。
 */
public class SQLiteStatement {

    /** 这一句是怎么来的（{@code compileStatement} 传进来的原文）。 */
    private final String sql;

    private final Object[] bindings = new Object[5];

    SQLiteStatement(String sql) { this.sql = sql == null ? "" : sql; }

    public void bindNull(int index) { bindings[index - 1] = null; }

    public void bindString(int index, String value) {
        bindings[index - 1] = value;
        // 第十刀-b：绑定的**先后**本身就是一个观察点（"每个 id 三句连着发、三句都绑同一个 id"）。
        SQLiteDatabase.BINDS.add(index + ":" + value);
    }

    public void bindLong(int index, long value) { bindings[index - 1] = Long.valueOf(value); }

    public void clearBindings() { Arrays.fill(bindings, null); }

    /** AOSP 的 SQLiteStatement 继承 SQLiteProgram（Closeable）⇒ close() 是它自带的。 */
    public void close() { SQLiteDatabase.EVENTS.add("close"); }

    /**
     * 替身里唯一"有业务语义"的地方（UPDATE 那一支）：my_list."name" 是 TEXT NOT NULL
     * （tables.ts:131），而 SQLite 是在**语句执行时**报这个约束的 —— 替身照做，这样"载荷没带
     * name"走的就是真机上那条路（抛错 ⇒ 不 markSuccessful ⇒ endTransaction 回滚 ⇒ 不广播）。
     */
    public int executeUpdateDelete() {
        if (sql.contains("DELETE")) return executeDelete();
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

    /**
     * {@code DELETE}（第十刀-b 新增）：三句都是"绑一个 id、删它那一行"
     * （{@code SQL_LIST_DELETE} / {@code SQL_MUSIC_INFO_DELETE_BY_LIST_ID} /
     * {@code SQL_MUSIC_INFO_ORDER_DELETE_BY_LIST_ID}）。替身里只有 {@code my_list} 真的存了行
     * （另两张子表没有行模型），所以：
     * <ul>
     *   <li>三句都记进 {@code EVENTS}（{@code delete:表名}）与 {@code EXECUTED}
     *       （{@code delete|表名|id}）："每个 id 三句、顺序 1→2→3"就是靠这两个观察点断言的；</li>
     *   <li>只有 {@code my_list} 那一句真的从假表里删行 ⇒ "半批失败 ⇒ 整批回滚之后那一行还在"
     *       才是真的被验证过，而不是只看了个 emitCount；</li>
     *   <li>{@code FAIL_DELETE_INDEX} 让探针指定"第 N 句 DELETE 抛错"（注入失败路径）。</li>
     * </ul>
     */
    private int executeDelete() {
        int index = SQLiteDatabase.DELETE_INDEX.getAndIncrement();
        if (index == SQLiteDatabase.FAIL_DELETE_INDEX) {
            throw new RuntimeException("探针注入：第 " + (index + 1) + " 句 DELETE 失败（真机上会是一条 SQLiteException）");
        }
        String table = deleteTable();
        String id = String.valueOf(bindings[0]);
        SQLiteDatabase.EVENTS.add("delete:" + table);
        SQLiteDatabase.EXECUTED.add("delete|" + table + "|" + id);
        if ("my_list".equals(table)) SQLiteDatabase.deleteListRow(id);
        return 1;
    }

    /** 这一句删的是哪张表（只认生产代码真正会 compile 的那三句；认不出来 = 替身过期，直接抛）。 */
    private String deleteTable() {
        if (sql.contains("my_list_music_info_order")) return "my_list_music_info_order";
        if (sql.contains("my_list_music_info")) return "my_list_music_info";
        if (sql.contains("my_list")) return "my_list";
        throw new IllegalStateException("假语句不认识这句 DELETE（替身过期了？）：" + sql);
    }

    /**
     * AOSP 的形状：{@code compileStatement(INSERT).executeInsert()}（返回新 rowid）。
     * ⚠️ 本刀的实现**没有**走它 —— {@code SQL_LIST_INSERT} 是用 {@code db.execSQL(sql, args)} 发的
     * （见类注释「逐行 INSERT」）。这里只把签名补上：下一刀真换成 {@code compileStatement} 时，
     * 不会被"替身编不过"误读成"实现编不过"。它同样照 DDL 在 name 为 NULL 时抛错。
     */
    public long executeInsert() {
        if (bindings[1] == null) {
            throw new RuntimeException("NOT NULL constraint failed: my_list.name (code 1299)");
        }
        SQLiteDatabase.EVENTS.add("insert");
        return 1L;
    }
}
`

/**
 * ⚠️ 第十一刀（`JSONException` 漏检修复）：org.json 的替身**逐字重抄了真 API 的签名** ——
 * 包括每一个 `throws JSONException`。
 *
 * 为什么要重抄：本文件早先的替身把 `JSONObject.put(String, Object)` 写成了**不抛异常**的版本，
 * 比真机 API 更宽松 ⇒ "真 javac + 手写替身"这一组探针**系统性放过**了生产代码里未处理的受检异常，
 * 直到 CI 的 `gradlew assembleDebug` 才报出来（`RainMusicListWriteChannels.java:869-870`）。
 * 教训：**替身比真机宽松 = 系统性漏检**。下面另有一条**负向**用例钉住这件事：
 * 故意不处理 `JSONException` 的调用方必须编不过（见「替身不比真机宽松」那一条）。
 *
 * 签名出处（逐字核对，**不是凭记忆写的**）：
 *   1) `javap -classpath android-json-0.0.20131108.vaadin1.jar org.json.JSONObject`（真 AOSP org.json 的编译产物）
 *      + 同一份 jar 的 `org.json.JSONArray` / `org.json.JSONException`；
 *   2) AOSP libcore main：`json/src/main/java/org/json/{JSONObject,JSONArray,JSONException,JSON}.java`。
 *   两者对下面每一个成员的签名**一致**（javap 打印的 `throws` 子句与源码逐行对得上）。
 *
 * 行为也照 AOSP 真语义，不是"差不多"：`put(name, null)` **删掉**那个键（不是存一个 Java null）；
 * 数值是 NaN / ±Infinity ⇒ `JSONException("Forbidden numeric value: …")`；`put(name, null)` 的 null 键
 * **不**做 checkName（AOSP 如此）；`names()` 在**空对象**上返回 **null**；`isNull(name)` 对**不存在的键**
 * 返回 true；`JSONObject.NULL` 的 `equals(null) == true`（AOSP 注释明说这是 API 指定的"坏"实现）；
 * `JSONArray.put(Object)` **不**声明 `throws`（AOSP 里它真的只是 `values.add`，校验在 `put(double)`）。
 *
 * ⚠️ 本替身**故意只声明本刀用到的子集**：没有 `new JSONObject(String)` / `JSONTokener` / `getXxx` /
 * `keys()` / `toString(int)` / `accumulate` / `JSONObject(Map)`。**少声明比"声明一个签名宽松的假方法"安全**：
 * 生产代码一旦用到没声明的成员，本机就**编不过**（当场暴露），而不是安静地跑在一个假实现上。
 * 要加成员时照上面的出处抄签名与实现，别凭记忆写。
 */
const STUB_JSON_EXCEPTION = String.raw`
package org.json;

/** 照 AOSP：真 API 有三个构造器，不止 (String)。 */
public class JSONException extends Exception {

    public JSONException(String message) { super(message); }

    public JSONException(String message, Throwable cause) { super(message, cause); }

    public JSONException(Throwable cause) { super(cause); }
}
`

/** 照 AOSP：`JSON` 是**包内可见**的工具类，`checkDouble` 是包内 static。本替身只声明这一个成员。 */
const STUB_JSON = String.raw`
package org.json;

final class JSON {

    static double checkDouble(double value) throws JSONException {
        if (Double.isInfinite(value) || Double.isNaN(value)) {
            throw new JSONException("Forbidden numeric value: " + value);
        }
        return value;
    }

    private JSON() {}
}
`

const STUB_JSON_ARRAY = String.raw`
package org.json;

import java.util.ArrayList;
import java.util.List;

/**
 * 手写替身：签名逐字照真 org.json（AOSP libcore），出处见本组 STUB_JSON_OBJECT 上方那段注释。
 * 真 API 里 put(Object) / put(boolean) / put(int) / put(long) **没有** throws，put(double) **有**；
 * 本类逐个照抄（早先只实现了 put(Object) 一个）。
 */
public class JSONArray {

    private final List<Object> values = new ArrayList<Object>();

    public JSONArray() {}

    /** 照 AOSP：真的只是 values.add —— **不**校验、**不**声明 throws。 */
    public JSONArray put(Object value) {
        values.add(value);
        return this;
    }

    public JSONArray put(boolean value) {
        values.add(value);
        return this;
    }

    /** 照 AOSP：values.add(JSON.checkDouble(value)) ⇒ NaN / ±Infinity 抛 JSONException。 */
    public JSONArray put(double value) throws JSONException {
        values.add(JSON.checkDouble(value));
        return this;
    }

    public JSONArray put(int value) {
        values.add(value);
        return this;
    }

    public JSONArray put(long value) {
        values.add(value);
        return this;
    }

    public int length() { return values.size(); }

    /** 照 AOSP：对**不存在的下标**也返回 true。 */
    public boolean isNull(int index) {
        Object value = opt(index);
        return value == null || value == JSONObject.NULL;
    }

    /** 照 AOSP：越界 ⇒ JSONException；值是 Java null ⇒ JSONException。JSONObject.NULL 正常返回。 */
    public Object get(int index) throws JSONException {
        if (index < 0 || index >= values.size()) {
            throw new JSONException("Index " + index + " out of range [0.." + values.size() + ")");
        }
        Object value = values.get(index);
        if (value == null) throw new JSONException("Value at " + index + " is null.");
        return value;
    }

    /** 照 AOSP：越界返回 null（**不**抛）。 */
    public Object opt(int index) {
        return index >= 0 && index < values.size() ? values.get(index) : null;
    }

    /** 照 AOSP：越界返回 null，且什么都没删。 */
    public Object remove(int index) {
        if (index < 0 || index >= values.size()) return null;
        return values.remove(index);
    }

    /**
     * 内部工具（**不是**真 API 的替身）：与 AOSP 的 JSONObject.toString / JSONArray.toString 一样紧凑
     * （逗号后没有空格）。真 API 里的对应物是包内的 JSON.toString(Object) + 各自的 toString()。
     * ⚠️ 已知差异：AOSP 的 JSONObject.toString() 在内部失败时**吞掉 JSONException 并返回 null**
     * （它的签名没有 throws，所以只能这么做）；本替身的序列化器不抛，也就不存在那条退路。
     */
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

/**
 * 手写替身（只实现本刀用到的子集，签名逐字照真 org.json）。
 * 键序 = 插入序（LinkedHashMap），方便断言载荷的键集合。
 * 出处与"为什么必须逐字抄"见本组 STUB_JSON_OBJECT 上方那段注释。
 */
public class JSONObject {

    /**
     * 照 AOSP 的哨兵：树里显式 JSON null 就是它（opt(name) 取回来，调用方用 == 判断）。
     * AOSP 明确把 equals(null) == true 当作"API 指定的坏实现"，这里照抄，不顺手改掉。
     */
    public static final Object NULL = new Object() {
        @Override public boolean equals(Object other) { return other == this || other == null; }
        @Override public int hashCode() { return 0; }
        @Override public String toString() { return "null"; }
    };

    private final Map<String, Object> values = new LinkedHashMap<String, Object>();

    public JSONObject() {}

    public int length() { return values.size(); }

    /** 照 AOSP：名字为 null ⇒ JSONException（消息逐字一致）。 */
    String checkName(String name) throws JSONException {
        if (name == null) throw new JSONException("Names must be non-null");
        return name;
    }

    public JSONObject put(String name, boolean value) throws JSONException {
        values.put(checkName(name), Boolean.valueOf(value));
        return this;
    }

    /** 照 AOSP：values.put(checkName(name), JSON.checkDouble(value)) ⇒ NaN / ±Infinity 抛。 */
    public JSONObject put(String name, double value) throws JSONException {
        values.put(checkName(name), Double.valueOf(JSON.checkDouble(value)));
        return this;
    }

    public JSONObject put(String name, int value) throws JSONException {
        values.put(checkName(name), Integer.valueOf(value));
        return this;
    }

    public JSONObject put(String name, long value) throws JSONException {
        values.put(checkName(name), Long.valueOf(value));
        return this;
    }

    /**
     * ⚠️ 这就是漏检的那一个：真 AOSP 声明了 throws JSONException（受检异常）。
     * 语义逐条照抄：Java null ⇒ **删掉**那个键（**不** checkName，AOSP 如此）；Number 先 checkDouble。
     */
    public JSONObject put(String name, Object value) throws JSONException {
        if (value == null) {
            values.remove(name);
            return this;
        }
        if (value instanceof Number) {
            JSON.checkDouble(((Number) value).doubleValue());
        }
        values.put(checkName(name), value);
        return this;
    }

    /** 照 AOSP：名字或值为 null ⇒ 原样返回 this（**不**抛、也**不**删键）。 */
    public JSONObject putOpt(String name, Object value) throws JSONException {
        if (name == null || value == null) return this;
        return put(name, value);
    }

    public Object remove(String name) { return values.remove(name); }

    public Object opt(String name) { return values.get(name); }

    public boolean has(String name) { return values.containsKey(name); }

    /** 照 AOSP：**不存在的键**也算 null ⇒ true（与"键在、值是 Java null"不可区分，AOSP 就是如此）。 */
    public boolean isNull(String name) {
        Object value = values.get(name);
        return value == null || value == NULL;
    }

    /** 照 AOSP：**空对象上返回 null**（不是空数组）。 */
    public JSONArray names() {
        if (values.isEmpty()) return null;
        JSONArray array = new JSONArray();
        for (String key : values.keySet()) array.put(key);
        return array;
    }

    /**
     * 内部工具（**故意不是**真 API 的替身）：真 API 的 quote(String) 是 **public static**，而且还会转义
     * 控制字符。这里保持**包内可见 + 简化转义** —— 方向是"比真机严"：生产代码若真的调用 quote，
     * 本机会**编不过**（暴露），而不会静默跑在一个简化实现上。
     */
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
import org.json.JSONException;
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
    static final String CHANNEL_ADD = RainMusicListWriteChannels.CHANNEL_LIST_ADD;
    static final String CHANNEL_REMOVE = RainMusicListWriteChannels.CHANNEL_LIST_REMOVE;
    static final StringBuilder REPORT = new StringBuilder();
    static final List<String> EMITS = Collections.synchronizedList(new ArrayList<String>());
    /**
     * 第十刀-b：广播载荷的**形状**（{@code channel|arg0=类型|len=…|[i]=类型:值|wire=…}）。
     * 与 {@code EMITS} 分开记：{@code EMITS} 的文本格式是第八 / 九刀那批用例钉住的，
     * 这里只是**多一个观察点**（arg0 到底是 JSONArray 还是 JSONObject、元素是什么类型、
     * 序列化后的 wire 长什么样），不去动既有那几行。
     */
    static final List<String> EMIT_SHAPES = Collections.synchronizedList(new ArrayList<String>());

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

        // ------------------------------------------------------------------
        // 第九刀-a：player_list_add（对象载荷 {position, listInfos}）
        // ------------------------------------------------------------------
        say("probe", "addRegistered", String.valueOf(RainMusicIpcHandlers.get(CHANNEL_ADD) != null));

        // 19) 追加（position = -1、空表）：插 1 行、position=0、提交、广播**对象**且 position 是原值 -1。
        runCase("add-append-default-position", () -> callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "新歌单")))));

        // 20) 空 listInfos ⇒ 0 条 INSERT + 提交 + 广播 {position, listInfos: []}。
        runCase("add-empty-list", () -> callAdd(addArgs(-1L, arr())));

        // 21) **空洞续号**：库里 0,1,5 ⇒ 下一个是 6（不是 3）。桌面 index.ts:74 明写不能直接用 length。
        runCase("add-hole-continues", () -> {
            SQLiteDatabase.seedList("a", "甲", "wy", "s-a", 0L, Long.valueOf(1L));
            SQLiteDatabase.seedList("b", "乙", "wy", "s-b", 1L, Long.valueOf(2L));
            SQLiteDatabase.seedList("c", "丙", "wy", "s-c", 5L, Long.valueOf(3L));
            return callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "新歌单"))));
        });

        // 22) 追加多行：position = order + index（0、1）。
        runCase("add-append-two-rows", () ->
            callAdd(addArgs(9L, arr(obj("id", "n-1", "name", "一"), obj("id", "n-2", "name", "二")))));

        // 23) **插队**（position = 1）：清表 + 全量重写 0..n-1，可空列原样搬回（含 SQL NULL 那一格）。
        runCase("add-insert-front-renumber", () -> {
            SQLiteDatabase.seedList("A", "甲", "wy", "s-a", 0L, Long.valueOf(11L));
            SQLiteDatabase.seedList("B", "乙", JSONObject.NULL, JSONObject.NULL, 1L, JSONObject.NULL);
            SQLiteDatabase.seedList("C", "丙", "kg", "s-c", 2L, Long.valueOf(33L));
            return callAdd(addArgs(1L, arr(obj(
                "id", "X", "name", "新", "source", "tx", "sourceListId", "s-x", "locationUpdateTime", 99L
            ))));
        });

        // 23b) 第十刀-b：**插队重写时读出来的 sourceListId 必须先过 ".0" 归一化**
        //      （桌面 dbHelper.ts:44-49 的 idFixRxp；读通道 RainMusicListChannels.java:283 同款）。
        //      少了它，老库里的 "123.0" 重写完还是 "123.0"，而渲染层走读通道看到的是 123
        //      ⇒ 两侧视图不一致。四行各钉一种：只去末尾、只去一次、不动的原样、NULL 仍是 NULL。
        runCase("add-renumber-dot-zero", () -> {
            SQLiteDatabase.seedList("A", "甲", "wy", "123.0", 0L, Long.valueOf(1L));
            SQLiteDatabase.seedList("B", "乙", "wy", "456.0.0", 1L, Long.valueOf(2L));
            SQLiteDatabase.seedList("C", "丙", "wy", "789", 2L, Long.valueOf(3L));
            SQLiteDatabase.seedList("D", "丁", "wy", JSONObject.NULL, 3L, JSONObject.NULL);
            return callAdd(addArgs(0L, arr(obj("id", "X", "name", "新"))));
        });

        // 24) id 冲突 ⇒ 假库照 SQLite 的 UNIQUE 抛错 ⇒ 不 commit、不广播、**整表回滚**。
        runCase("add-id-conflict", () -> {
            SQLiteDatabase.seedList("A", "甲", "wy", "s-a", 0L, Long.valueOf(1L));
            return callAdd(addArgs(-1L, arr(obj("id", "A", "name", "重名"))));
        });

        // 25) 缺 name ⇒ 参数校验必须在 open / 开事务**之前**抛。为了证明这个**顺序**，这里刻意把库
        //     设成"打不开"：如果实现先开库，拿到的会是 IllegalStateException（打不开数据库）而不是
        //     IllegalArgumentException（缺 name）。同时 events 必须是 "-"（一个事务都没开）。
        runCase("add-missing-name-before-open", () -> {
            RainMusicDatabase.FAIL_OPEN = true;
            return callAdd(addArgs(-1L, arr(obj("id", "n-1"))));
        });

        // 26) 可空列缺席 ⇒ 绑 NULL 哨兵（name 在，所以能插进去）。
        runCase("add-nullable-columns-absent", () -> callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "只有名字")))));

        // 27~40) 参数坏形状（都在开库之前失败）。
        runCase("add-param-missing", () -> callAdd(new ArrayList<Object>()));
        runCase("add-param-bare-array", () -> callAdd(args(arr(obj("id", "n-1", "name", "x")))));
        runCase("add-param-not-object", () -> callAdd(args("n-1")));
        runCase("add-position-missing", () -> callAdd(args(obj("listInfos", arr(obj("id", "n-1", "name", "x"))))));
        runCase("add-position-not-number", () -> callAdd(args(obj("position", "1", "listInfos", arr()))));
        runCase("add-position-fraction", () -> callAdd(args(obj("position", 1.5, "listInfos", arr()))));
        runCase("add-listinfos-missing", () -> callAdd(args(obj("position", Long.valueOf(-1L)))));
        runCase("add-listinfos-not-array", () -> callAdd(args(obj("position", Long.valueOf(-1L), "listInfos", "x"))));
        runCase("add-item-not-object", () -> callAdd(addArgs(-1L, arr("n-1"))));
        runCase("add-id-missing", () -> callAdd(addArgs(-1L, arr(obj("name", "x")))));
        runCase("add-id-not-string", () -> callAdd(addArgs(-1L, arr(obj("id", Long.valueOf(7L), "name", "x")))));
        runCase("add-id-empty", () -> callAdd(addArgs(-1L, arr(obj("id", "", "name", "x")))));
        runCase("add-source-not-string", () -> callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "x", "source", arr())))));
        runCase("add-time-fraction", () -> callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "x", "locationUpdateTime", 1.5)))));

        // 41~42) 库打不开 / 表缺失（都在 open(...) 那一层，不广播）。
        runCase("add-open-failure", () -> {
            RainMusicDatabase.FAIL_OPEN = true;
            return callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "x"))));
        });
        runCase("add-table-missing", () -> {
            RainMusicDatabase.FAIL_REQUIRE_TABLE = true;
            return callAdd(addArgs(-1L, arr(obj("id", "n-1", "name", "x"))));
        });

        // 43) 并发 add：锁在 ⇒ 两个事务不同时开，且**两趟追加的位置不重复**（0,1 与 2,3）。
        concurrencyAddCase("add-concurrent-two-writers");

        // ------------------------------------------------------------------
        // 第十刀-a/b：player_list_remove（裸数组载荷 [ids]，每个 id 三句 DELETE）
        // ------------------------------------------------------------------
        say("probe", "removeRegistered", String.valueOf(RainMusicIpcHandlers.get(CHANNEL_REMOVE) != null));

        // 44) 两个 id：**同一个事务**里恰好六句 DELETE（每个 id 三句、顺序 1→2→3），
        //     没被点名的第三行必须留着（"只删 ids 里那些"），emit 在提交之后。
        runCase("remove-two-ids", () -> {
            SQLiteDatabase.seedList("l-1", "甲", "wy", "s-1", 0L, Long.valueOf(1L));
            SQLiteDatabase.seedList("l-2", "乙", "wy", "s-2", 1L, Long.valueOf(2L));
            SQLiteDatabase.seedList("keep", "留着", "wy", "s-3", 2L, Long.valueOf(3L));
            return callRemove(ids("l-1", "l-2"));
        });

        // 45) 单个 id：三句、一个事务；顺带证明普通 id **不被误拒**（它不是保留 id）。
        runCase("remove-single-id", () -> {
            SQLiteDatabase.seedList("l-1", "甲", "wy", "s-1", 0L, Long.valueOf(1L));
            SQLiteDatabase.seedList("l-2", "乙", "wy", "s-2", 1L, Long.valueOf(2L));
            return callRemove(ids("l-1"));
        });

        // 46) id 不在库里 ⇒ 0 行命中 = **成功**（幂等），三句照样发、照样广播（桌面同款）。
        runCase("remove-unknown-id", () -> callRemove(ids("no-such-id")));

        // 47) **"love" 不被拒**（第十刀-a 的裁定 4）："default" / "temp" 特殊在"有子表行但没有
        //     my_list 父行"；"love" 若因备份导入出现在 my_list 里，删它就是**正常删除**，
        //     拒绝反而会破坏一次合法操作。这里连"真的删掉了"一起钉住。
        runCase("remove-love-allowed", () -> {
            SQLiteDatabase.seedList("love", "我喜欢", "wy", "s-love", 0L, Long.valueOf(1L));
            return callRemove(ids("love"));
        });

        // 48) 空数组 ⇒ 0 条 SQL（连 prepare 都不做）+ 事务照样提交 + 广播一个空数组。
        runCase("remove-empty-array", () -> callRemove(ids()));

        // 49) 保留 id "default"：拒绝，而且**在 open 之前**就拒（库故意设成打不开 ⇒ 拿到的必须是
        //     IllegalArgumentException 而不是"打不开数据库"），events 必须是 "-"。
        runCase("remove-reserved-default", () -> {
            RainMusicDatabase.FAIL_OPEN = true;
            return callRemove(ids("default"));
        });

        // 50) 保留 id "temp" 夹在普通 id 后面：整批被拒（**一句 SQL 都不许发**，不许"先删了前面的"）。
        runCase("remove-reserved-temp-in-list", () -> {
            RainMusicDatabase.FAIL_OPEN = true;
            return callRemove(ids("l-1", "temp"));
        });

        // 51~55) 参数坏形状（全部在开库之前失败）。
        runCase("remove-param-missing", () -> callRemove(new ArrayList<Object>()));
        runCase("remove-param-wrapped-object", () -> callRemove(args(obj("ids", arr("l-1")))));
        runCase("remove-param-item-not-string", () -> callRemove(args(arr(Long.valueOf(7L)))));
        runCase("remove-param-item-empty", () -> callRemove(args(arr(""))));
        runCase("remove-param-item-null", () -> callRemove(args(arr(JSONObject.NULL))));

        // 56) 第 2 句 DELETE 注入失败 ⇒ 不提交、回滚、不广播 —— 而且第一句删掉的那一行**回来了**
        //     （假库照 SQLite 的语义回滚；只数 emitCount 是证明不了"没有删了一半"的）。
        runCase("remove-fail-second-delete", () -> {
            SQLiteDatabase.seedList("l-1", "甲", "wy", "s-1", 0L, Long.valueOf(1L));
            SQLiteDatabase.seedList("l-2", "乙", "wy", "s-2", 1L, Long.valueOf(2L));
            SQLiteDatabase.FAIL_DELETE_INDEX = 1;
            return callRemove(ids("l-1", "l-2"));
        });

        // 57~58) 库打不开 / 三张表缺任何一张（都在 open(...) 那一层，不广播、不开事务）。
        runCase("remove-open-failure", () -> {
            RainMusicDatabase.FAIL_OPEN = true;
            return callRemove(ids("l-1"));
        });
        runCase("remove-table-missing", () -> {
            RainMusicDatabase.FAIL_REQUIRE_TABLE = true;
            return callRemove(ids("l-1"));
        });

        // 59) 并发 remove：两个线程各删两个 id ⇒ 同一时刻只有一个事务开着（锁真的在护第三条临界区）。
        concurrencyRemoveCase("remove-concurrent-two-writers");

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
        // 第十刀-b：载荷的**形状**（arg0 的类型 / 元素类型 / 序列化后的 wire）。
        say(name, "emitShape0", EMIT_SHAPES.isEmpty() ? "-" : EMIT_SHAPES.get(0));
        say(name, "events", SQLiteDatabase.EVENTS.isEmpty() ? "-" : String.join(">", SQLiteDatabase.EVENTS));
        // 第十刀-b：事务条数 / 提交条数（"整批只开一个事务"就是靠这个断言的）。
        say(name, "transactionCount", String.valueOf(count(SQLiteDatabase.EVENTS, "begin")));
        say(name, "commitCount", String.valueOf(count(SQLiteDatabase.EVENTS, "commit")));
        say(name, "executed", String.valueOf(SQLiteDatabase.EXECUTED.size()));
        for (String binding : SQLiteDatabase.EXECUTED) say(name, "binding", binding);
        // 第十刀-b：绑定序（"下标:值"）—— 三句 DELETE 都绑位置参数 1 时的先后。
        say(name, "binds", SQLiteDatabase.BINDS.isEmpty() ? "-" : String.join(",", SQLiteDatabase.BINDS));
        // 第九刀-a：INSERT 的绑定（按执行序）与写完之后**表里到底有什么**（回滚过没有，看这里）。
        say(name, "insertedCount", String.valueOf(SQLiteDatabase.INSERTED.size()));
        for (String row : SQLiteDatabase.INSERTED) say(name, "inserted", row);
        say(name, "rowCount", String.valueOf(SQLiteDatabase.rowCount()));
        for (String row : SQLiteDatabase.dumpList()) say(name, "row", row);
        say(name, "maxOpenTransactions", String.valueOf(SQLiteDatabase.MAX_OPEN_TRANSACTIONS.get()));
        // 第十刀-b：compile 过几句 SQL + 逐句的原文（删除那三句的表名与顺序就靠它）。
        say(name, "sqlSeenCount", String.valueOf(SQLiteDatabase.SQL_SEEN.size()));
        if (SQLiteDatabase.SQL_SEEN.isEmpty()) say(name, "sql", "-");
        else for (String sql : SQLiteDatabase.SQL_SEEN) say(name, "sql", oneLine(sql));
    }

    /** 第十刀-a 的并发场景：两个线程各自删两个**不同 id**。 */
    static void concurrencyRemoveCase(String name) throws Exception {
        reset();
        SQLiteDatabase.RENDEZVOUS = new CountDownLatch(1);
        final List<Object> payloadA = ids("a-1", "a-2");
        final List<Object> payloadB = ids("b-1", "b-2");
        final String[] results = new String[2];
        Thread first = new Thread(() -> { results[0] = attemptRemove(payloadA); }, "probe-remove-a");
        Thread second = new Thread(() -> { results[1] = attemptRemove(payloadB); }, "probe-remove-b");
        first.start();
        second.start();
        first.join(10000);
        second.join(10000);

        say(name, "result0", results[0]);
        say(name, "result1", results[1]);
        say(name, "maxOpenTransactions", String.valueOf(SQLiteDatabase.MAX_OPEN_TRANSACTIONS.get()));
        say(name, "commitCount", String.valueOf(count(SQLiteDatabase.EVENTS, "commit")));
        say(name, "emitCount", String.valueOf(EMITS.size()));
        say(name, "executed", String.valueOf(SQLiteDatabase.EXECUTED.size()));
        say(name, "binds", SQLiteDatabase.BINDS.isEmpty() ? "-" : String.join(",", SQLiteDatabase.BINDS));
    }

    static String attemptRemove(List<Object> payload) {
        try {
            Object value = callRemove(payload);
            return value == null ? "ok" : "ok:" + value.getClass().getSimpleName();
        } catch (Throwable ex) {
            return "threw:" + ex.getClass().getName() + ":" + firstLine(ex.getMessage());
        }
    }

    /** 第九刀-a 的并发场景：两个线程各自 add 两条**不同 id** 的新歌单。 */
    static void concurrencyAddCase(String name) throws Exception {
        reset();
        SQLiteDatabase.RENDEZVOUS = new CountDownLatch(1);
        final List<Object> payloadA = addArgs(-1L, arr(obj("id", "na-1", "name", "并发一"), obj("id", "na-2", "name", "并发二")));
        final List<Object> payloadB = addArgs(-1L, arr(obj("id", "nb-1", "name", "并发三"), obj("id", "nb-2", "name", "并发四")));
        final String[] results = new String[2];
        Thread first = new Thread(() -> { results[0] = attemptAdd(payloadA); }, "probe-add-a");
        Thread second = new Thread(() -> { results[1] = attemptAdd(payloadB); }, "probe-add-b");
        first.start();
        second.start();
        first.join(10000);
        second.join(10000);

        say(name, "result0", results[0]);
        say(name, "result1", results[1]);
        say(name, "maxOpenTransactions", String.valueOf(SQLiteDatabase.MAX_OPEN_TRANSACTIONS.get()));
        say(name, "commitCount", String.valueOf(SQLiteDatabase.EVENTS.stream().filter("commit"::equals).count()));
        say(name, "emitCount", String.valueOf(EMITS.size()));
        say(name, "insertedCount", String.valueOf(SQLiteDatabase.INSERTED.size()));
        for (String row : SQLiteDatabase.INSERTED) say(name, "inserted", row);
        say(name, "rowCount", String.valueOf(SQLiteDatabase.rowCount()));
        for (String row : SQLiteDatabase.dumpList()) say(name, "row", row);
    }

    static String attemptAdd(List<Object> payload) {
        try {
            Object value = callAdd(payload);
            return value == null ? "ok" : "ok:" + value.getClass().getSimpleName();
        } catch (Throwable ex) {
            return "threw:" + ex.getClass().getName() + ":" + firstLine(ex.getMessage());
        }
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

    /** 第九刀-a 的入口：**同一个注册表**，换一条通道名（add 的参数是对象，不是裸数组）。 */
    static Object callAdd(List<Object> payload) throws Exception {
        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(CHANNEL_ADD);
        if (handler == null) throw new IllegalStateException("通道没注册：" + CHANNEL_ADD);
        return handler.handle(payload, new RainMusicIpcHandlers.RequestContext("ipc-probe-add-1", CHANNEL_ADD));
    }

    /** 第十刀-a 的入口：**同一个注册表**，换一条通道名（remove 的参数是**裸字符串数组**）。 */
    static Object callRemove(List<Object> payload) throws Exception {
        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(CHANNEL_REMOVE);
        if (handler == null) throw new IllegalStateException("通道没注册：" + CHANNEL_REMOVE);
        return handler.handle(payload, new RainMusicIpcHandlers.RequestContext("ipc-probe-remove-1", CHANNEL_REMOVE));
    }

    // ---------------------------------------------------------------- 广播记录

    static void recordEmit(String channel, List<Object> emitArgs) {
        SQLiteDatabase.EVENTS.add("emit");
        // 第十刀-b：形状单独记一份（既有那行文本的格式被第八 / 九刀的用例钉住了，不动它）。
        EMIT_SHAPES.add(shapeOf(channel, emitArgs));
        StringBuilder builder = new StringBuilder();
        builder.append(channel).append('|').append(emitArgs == null ? -1 : emitArgs.size()).append('|');
        Object arg0 = (emitArgs == null || emitArgs.isEmpty()) ? null : emitArgs.get(0);
        if (arg0 instanceof JSONArray) {
            // 第八刀的形状：裸数组（update）。
            JSONArray array = (JSONArray) arg0;
            builder.append("array|").append(array.length()).append('|').append(firstIdOf(array)).append('|').append(firstKeysOf(array));
        } else if (arg0 instanceof JSONObject) {
            // 第九刀-a 的形状：对象 {position, listInfos}。⚠️ 四个观察点缺一不可：
            // 键个数、position 的**原值**（折算过的值会让渲染层把"追加"当成"插到第 0 位"）、
            // listInfos 到底是不是数组（包成对象 ⇒ 渲染层 for…of 立刻炸）、以及键集合。
            JSONObject object = (JSONObject) arg0;
            builder.append("object|").append(object.length())
                .append("|pos=").append(String.valueOf(object.opt("position")))
                .append("|listInfos=").append(describeValue(object.opt("listInfos")))
                .append("|keys=").append(String.valueOf(object.names()));
        } else {
            builder.append(arg0 == null ? "none" : arg0.getClass().getSimpleName()).append("|-|-");
        }
        EMITS.add(builder.toString());
    }

    static String describeValue(Object value) {
        if (value == null || value == JSONObject.NULL) return "none";
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            return "array|" + array.length() + "|" + firstIdOf(array) + "|" + firstKeysOf(array);
        }
        if (value instanceof JSONObject) return "object|" + ((JSONObject) value).length();
        return value.getClass().getSimpleName() + "|" + String.valueOf(value);
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
        SQLiteDatabase.INSERTED.clear();
        SQLiteDatabase.SQL_SEEN.clear();
        SQLiteDatabase.BINDS.clear();
        SQLiteDatabase.OPEN_TRANSACTIONS.set(0);
        SQLiteDatabase.MAX_OPEN_TRANSACTIONS.set(0);
        SQLiteDatabase.AFFECTED_ROWS = 1;
        SQLiteDatabase.RENDEZVOUS = null;
        // 第十刀-b：失败注入与"第几句 DELETE"每个场景都从零开始。
        SQLiteDatabase.FAIL_DELETE_INDEX = -1;
        SQLiteDatabase.DELETE_INDEX.set(0);
        // 每个场景都从**空表**开始（需要现有数据的场景自己在 lambda 里 seedList）。
        SQLiteDatabase.resetRows();
        RainMusicDatabase.FAIL_OPEN = false;
        RainMusicDatabase.FAIL_REQUIRE_TABLE = false;
        com.getcapacitor.Logger.LINES.clear();
        EMITS.clear();
        EMIT_SHAPES.clear();
    }

    static JSONObject obj(Object... pairs) throws JSONException {
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

    /** 第九刀-a 的载荷：{@code args = [{position, listInfos}]}（**对象**，不是裸数组）。 */
    static List<Object> addArgs(long position, JSONArray listInfos) throws JSONException {
        List<Object> list = new ArrayList<Object>();
        list.add(obj("position", Long.valueOf(position), "listInfos", listInfos));
        return list;
    }

    /** 第十刀-a 的载荷：{@code args = [ ["l-1", "l-2"] ]}（**裸字符串数组**，不是 {@code [{ids: […]}]}）。 */
    static List<Object> ids(String... values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        List<Object> list = new ArrayList<Object>();
        list.add(array);
        return list;
    }

    static int count(List<String> values, String needle) {
        int total = 0;
        for (String value : values) if (needle.equals(value)) total++;
        return total;
    }

    /**
     * 第十刀-b：广播载荷的**形状**文本（{@code arg0} 的类型、元素类型、序列化后的 wire）。
     * 它回答的是"到底是 JSONArray 还是 JSONObject"这个 update / remove 与 add 之间最容易写错的问题。
     */
    static String shapeOf(String channel, List<Object> emitArgs) {
        Object arg0 = (emitArgs == null || emitArgs.isEmpty()) ? null : emitArgs.get(0);
        StringBuilder builder = new StringBuilder();
        builder.append(channel).append("|arg0=").append(arg0 == null ? "null" : arg0.getClass().getSimpleName());
        if (arg0 instanceof JSONArray) {
            JSONArray array = (JSONArray) arg0;
            builder.append("|len=").append(array.length());
            for (int i = 0; i < array.length(); i++) {
                Object value = array.opt(i);
                builder.append("|[").append(i).append("]=")
                    .append(value == null ? "null" : value.getClass().getSimpleName() + ":" + String.valueOf(value));
            }
            builder.append("|wire=").append(array.toString());
        } else if (arg0 instanceof JSONObject) {
            builder.append("|keys=").append(String.valueOf(((JSONObject) arg0).names()));
        }
        return builder.toString();
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
  // ⚠️ 第九刀-b：`android.database.Cursor` 是第九刀-a 新引入的类型（add 要读 COUNT / MAX / 现有行）。
  'android/database/Cursor.java': STUB_CURSOR,
  'android/database/sqlite/SQLiteDatabase.java': STUB_SQLITE_DATABASE,
  'android/database/sqlite/SQLiteStatement.java': STUB_SQLITE_STATEMENT,
  'org/json/JSONException.java': STUB_JSON_EXCEPTION,
  // ⚠️ 第十一刀起：JSON.java 只提供包内 static 的 checkDouble（照 AOSP 的位置与可见性）。
  'org/json/JSON.java': STUB_JSON,
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

/**
 * ⚠️ 第十一刀（JSONException 漏检修复）的**负向**用例：证明这套替身**不比真机宽松**。
 *
 * 它拿同一套替身去编一个**故意没处理受检异常**的调用方（`put` 既不 catch、也不声明 throws）。
 * 真 org.json 的签名下这**必须**编不过；本文件早先的替身（`put` 不带 `throws`）会让它编过 ——
 * 那正是这次漏检本身：`RainMusicListWriteChannels.java` 那两行在本机"编过了"，却在 CI 上炸。
 *
 * 所以：**这条用例变红 = 替身又变宽松了**（不是环境问题，也不要靠改这条用例来绕过它）。
 * 失败的判据有两条，缺一不可：javac 必须非 0 退出，**且**失败原因必须是那个受检异常本身
 * （否则它可能只是因为别的原因编不过 —— 那这条用例就在骗人）。
 */
test('JVM 探针（第十一刀）：替身不比真机宽松 —— 不处理 JSONException 的调用方必须编不过', { skip: SKIP_REASON }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-stub-strict-'))
  temporaryDirs.push(dir)
  const stubRoot = path.join(dir, 'stub')
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  for (const [relative, source] of Object.entries(STUBS)) {
    const file = path.join(stubRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
  }
  // 故意写坏的调用方：`put` 既不 catch、也不声明 throws（真 API 下必须编不过）。
  const laxFile = path.join(stubRoot, 'com/rainmusic/mobile/ipc/LaxPayloadProbe.java')
  fs.writeFileSync(laxFile, [
    'package com.rainmusic.mobile.ipc;',
    '',
    'import org.json.JSONObject;',
    '',
    'public class LaxPayloadProbe {',
    '    static JSONObject build() {',
    '        JSONObject payload = new JSONObject();',
    '        payload.put("position", 1L);',
    '        return payload;',
    '    }',
    '}',
    '',
  ].join('\n'))
  const compiled = spawnSync('javac', ['-encoding', 'UTF-8', '-sourcepath', stubRoot, '-d', outDir, laxFile], { encoding: 'utf8' })
  const log = `${compiled.stdout ?? ''}${compiled.stderr ?? ''}`
  assert.notEqual(compiled.status, 0, `替身太宽松：不处理 JSONException 的调用方居然编过了 ⇒ 本机探针会系统性漏检这类错误：\n${log}`)
  assert.match(log, /JSONException/, `javac 确实拒绝了，但原因不是那个受检异常 —— 这条用例在骗人：\n${log}`)
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

// ---------------------------------------------------------------------------
// 7. JVM 行为组（第九刀-a）：player_list_add 的场景
// ---------------------------------------------------------------------------

test('JVM 探针（第九刀-a）：注册 + 追加 —— 广播载荷是**对象**、position 是**调用方原值**、commit 之后才 emit', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'probe', 'addRegistered'), 'true', 'add 的 handler 必须也在注册表里')
  assert.equal(field(report, 'add-append-default-position', 'result'), 'null', '契约是 void ⇒ 成功时返回 null')

  // 广播载荷：**对象**、恰 2 个键、position 是**调用方传来的 -1**（不折算）、listInfos 是数组。
  assert.equal(
    field(report, 'add-append-default-position', 'emit0'),
    'player_list_add|1|object|2|pos=-1|listInfos=array|1|n-1|["id","name"]|keys=["position","listInfos"]',
  )

  // 落库那一半：1 条 INSERT、position 被算成 0（空表 ⇒ MAX 是 NULL ⇒ 起点 0）。
  // ⚠️ "广播 -1 / 落库 0" 这一对值必须**同时**成立：position 的折算只发生在库里，不进广播。
  assert.deepEqual(fields(report, 'add-append-default-position', 'inserted'), [
    'id=n-1;name=新歌单;source=null;sourceListId=null;position=0;locationUpdateTime=null',
  ])
  assert.deepEqual(fields(report, 'add-append-default-position', 'row'), [
    'id=n-1;name=新歌单;source=null;sourceListId=null;position=0;locationUpdateTime=null',
  ])
  assert.equal(field(report, 'add-append-default-position', 'rowCount'), '1')

  // 读的是 my_list 的 COUNT（第一句 SQL 就是它）。
  assert.equal(
    normalizeSql(field(report, 'add-append-default-position', 'sql')),
    normalizeSql(javaTextBlock(writeJava, 'SQL_COUNT_LISTS')),
  )

  // 事件序：begin → query:count → query:max → execSQL → commit → end → emit。
  const events = field(report, 'add-append-default-position', 'events')
  const at = order(events)
  assert.equal(at('begin'), 0, `第一个事件必须是 begin：${events}`)
  assert.ok(at('execSQL') > at('query:max'), `先读 MAX(position) 再写：${events}`)
  assert.ok(at('commit') > at('execSQL') && at('end') > at('commit') && at('emit') > at('end'),
    `事务与广播的先后不对（emit 必须在 commit/end 之后）：${events}`)
  assert.equal(field(report, 'add-append-default-position', 'maxOpenTransactions'), '1')
})

test('JVM 探针（第九刀-a）：空 listInfos ⇒ 0 条 INSERT + 提交 + 广播 {position, listInfos: []}', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'add-empty-list', 'result'), 'null')
  assert.equal(field(report, 'add-empty-list', 'insertedCount'), '0', '空数组 ⇒ 一条 INSERT 都不发')
  assert.equal(field(report, 'add-empty-list', 'rowCount'), '0', '表还是空的')
  assert.equal(field(report, 'add-empty-list', 'emitCount'), '1', '空数组同样要广播')
  assert.equal(
    field(report, 'add-empty-list', 'emit0'),
    'player_list_add|1|object|2|pos=-1|listInfos=array|0|-|-|keys=["position","listInfos"]',
    '广播的是空数组（仍然是对象载荷，position 仍然是原值）',
  )
  const events = field(report, 'add-empty-list', 'events')
  assert.ok(!events.includes('execSQL'), `空数组不该有写库：${events}`)
  assert.ok(events.includes('commit') && events.includes('end'), '空数组同样提交成功')
  assert.ok(order(events)('emit') > order(events)('end'))
})

test('JVM 探针（第九刀-a）：空洞续号（库里 0,1,5 ⇒ 下一个 6）+ 追加多行依次 order+index', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  // **空洞**：0,1,5 ⇒ 6（不是 3）。桌面 index.ts:74 明写"不能直接用 userLists.length"。
  assert.deepEqual(fields(report, 'add-hole-continues', 'inserted'), [
    'id=n-1;name=新歌单;source=null;sourceListId=null;position=6;locationUpdateTime=null',
  ])
  assert.deepEqual(fields(report, 'add-hole-continues', 'row').map(row => row.match(/position=(\d+)/)[1]),
    ['0', '1', '5', '6'], '四行的 position 必须是 0/1/5/6（空洞被保留，新行接在最大位置之后）')

  // 一次追加两行：position = order + index ⇒ 0、1（执行序就是参数序）。
  assert.deepEqual(fields(report, 'add-append-two-rows', 'inserted'), [
    'id=n-1;name=一;source=null;sourceListId=null;position=0;locationUpdateTime=null',
    'id=n-2;name=二;source=null;sourceListId=null;position=1;locationUpdateTime=null',
  ])
  // 这一条的 position 参数是 9（>= COUNT=0 ⇒ 追加），广播里必须是**9**而不是折算后的值。
  assert.equal(field(report, 'add-append-two-rows', 'emit0'),
    'player_list_add|1|object|2|pos=9|listInfos=array|2|n-1|["id","name"]|keys=["position","listInfos"]')

  // 可空列缺席 ⇒ 绑 NULL（不是字符串 "null"、也不是 0）。
  assert.deepEqual(fields(report, 'add-nullable-columns-absent', 'inserted'), [
    'id=n-1;name=只有名字;source=null;sourceListId=null;position=0;locationUpdateTime=null',
  ])
  assert.equal(field(report, 'add-nullable-columns-absent', 'emitCount'), '1')
})

test('JVM 探针（第九刀-a）：插队 ⇒ 清表 + 全量重写 position 0..n-1（可空列原样搬回）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'add-insert-front-renumber', 'result'), 'null')
  // execution order = 新顺序：A、X（插在第 1 位）、B、C；position 被重编号成 0..3。
  assert.deepEqual(fields(report, 'add-insert-front-renumber', 'inserted'), [
    'id=A;name=甲;source=wy;sourceListId=s-a;position=0;locationUpdateTime=11',
    'id=X;name=新;source=tx;sourceListId=s-x;position=1;locationUpdateTime=99',
    'id=B;name=乙;source=null;sourceListId=null;position=2;locationUpdateTime=null',
    'id=C;name=丙;source=kg;sourceListId=s-c;position=3;locationUpdateTime=33',
  ])
  // 表里最终也必须是这 4 行（清表之后没有残行、也没有多出旧行）。
  assert.deepEqual(fields(report, 'add-insert-front-renumber', 'row'),
    fields(report, 'add-insert-front-renumber', 'inserted'))
  assert.equal(field(report, 'add-insert-front-renumber', 'rowCount'), '4')
  // B 那一行本来 source/sourceListId/locationUpdateTime 就是 SQL NULL ⇒ 重写回去还是 NULL。
  assert.match(fields(report, 'add-insert-front-renumber', 'inserted')[2], /source=null;sourceListId=null/)
  // 事件序里必须**先清表再插**（5 个 execSQL = 1 个 DELETE + 4 个 INSERT），且 emit 最后。
  const events = field(report, 'add-insert-front-renumber', 'events')
  assert.equal((events.match(/execSQL/g) ?? []).length, 5, `插队分支 = DELETE + 4 条 INSERT：${events}`)
  assert.ok(order(events)('execSQL') > order(events)('query:ordered'), '必须先按 position,rowid 读出现有行')
  assert.ok(order(events)('commit') > order(events)('execSQL') && order(events)('emit') > order(events)('end'))
  assert.equal(field(report, 'add-insert-front-renumber', 'emit0').includes('pos=1'), true, '广播里的 position 还是原值 1')
})

test('JVM 探针（第九刀-a）：id 冲突 ⇒ 回滚（没有 commit）+ 不广播 + 表里没有半批', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.match(field(report, 'add-id-conflict', 'result'), /^threw:/)
  assert.match(field(report, 'add-id-conflict', 'message'), /UNIQUE constraint failed: my_list\.id/)
  const events = field(report, 'add-id-conflict', 'events')
  assert.ok(!events.includes('commit'), '没 markSuccessful ⇒ 回滚')
  assert.ok(events.includes('end'), 'endTransaction 必须被调到')
  assert.equal(field(report, 'add-id-conflict', 'emitCount'), '0', '失败**不许**改本地状态 ⇒ 一条广播都没有')
  assert.equal(field(report, 'add-id-conflict', 'rowCount'), '1', '表里还是原来那一行（回滚生效）')
  assert.deepEqual(fields(report, 'add-id-conflict', 'row'), [
    'id=A;name=甲;source=wy;sourceListId=s-a;position=0;locationUpdateTime=1',
  ])
})

test('JVM 探针（第九刀-a）：缺 name ⇒ 连事务都不开（校验早于 open，而不是靠库的约束兜底）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'add-missing-name-before-open', 'result'), 'threw:java.lang.IllegalArgumentException',
    '库是打不开的，但这条载荷应该先在**参数校验**上失败（顺序证明）')
  assert.match(field(report, 'add-missing-name-before-open', 'message'), /缺少 `name`/)
  assert.match(field(report, 'add-missing-name-before-open', 'message'), /NOT NULL/)
  assert.equal(field(report, 'add-missing-name-before-open', 'events'), '-', '一个事务都不该开')
  assert.equal(field(report, 'add-missing-name-before-open', 'sql'), '-', '一条 SQL 都不该发（连库都不该开）')
  assert.equal(field(report, 'add-missing-name-before-open', 'insertedCount'), '0')
  assert.equal(field(report, 'add-missing-name-before-open', 'emitCount'), '0')
})

test('JVM 探针（第九刀-a）：参数非法 ⇒ IllegalArgumentException 点名字段（14 种坏形状）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const expected = {
    'add-param-missing': /需要一个 `\{position, listInfos\}` 参数/,
    'add-param-bare-array': /必须是对象（`\{position, listInfos\}`）/,
    'add-param-not-object': /必须是对象/,
    'add-position-missing': /缺少 `position` 字段/,
    'add-position-not-number': /`position` 必须是数字/,
    'add-position-fraction': /`position` 必须是整数/,
    'add-listinfos-missing': /缺少 `listInfos` 字段/,
    'add-listinfos-not-array': /`listInfos` 必须是数组/,
    'add-item-not-object': /第 0 个元素必须是对象/,
    'add-id-missing': /第 0 个元素缺少 `id` 字段/,
    'add-id-not-string': /`id` 必须是字符串/,
    'add-id-empty': /`id` 不能是空字符串/,
    'add-source-not-string': /`source` 必须是字符串/,
    'add-time-fraction': /必须是整数毫秒/,
  }
  for (const [section, pattern] of Object.entries(expected)) {
    assert.equal(field(report, section, 'result'), 'threw:java.lang.IllegalArgumentException', `${section} 必须是 IllegalArgumentException`)
    assert.match(field(report, section, 'message'), pattern, `${section} 的消息必须点名`)
    assert.equal(field(report, section, 'events'), '-', `${section} 不该开事务`)
    assert.equal(field(report, section, 'insertedCount'), '0', `${section} 不该发任何 INSERT`)
    assert.equal(field(report, section, 'emitCount'), '0', `${section} 不该广播`)
  }
  // "裸数组"这一种必须把"add 要的是对象、裸数组是 update/remove 的形状"说出来。
  assert.match(field(report, 'add-param-bare-array', 'message'), /裸数组形状属于 player_list_update/)
})

test('JVM 探针（第九刀-a）：库打不开 / 表缺失 ⇒ IllegalStateException，不广播', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'add-open-failure', 'result'), 'threw:java.lang.IllegalStateException')
  assert.match(field(report, 'add-open-failure', 'message'), /打不开数据库/)
  assert.equal(field(report, 'add-open-failure', 'events'), '-', '库都没打开 ⇒ 连事务都不该开')
  assert.equal(field(report, 'add-open-failure', 'emitCount'), '0')

  assert.equal(field(report, 'add-table-missing', 'result'), 'threw:java.lang.IllegalStateException')
  assert.match(field(report, 'add-table-missing', 'message'), /没有表 "my_list"/)
  assert.equal(field(report, 'add-table-missing', 'insertedCount'), '0')
  assert.equal(field(report, 'add-table-missing', 'emitCount'), '0')
})

test('JVM 探针（第九刀-a）：两个线程同时 add ⇒ 位置不重复、同一时刻只有一个事务（读-改-写真的在锁里）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'add-concurrent-two-writers', 'result0'), 'ok')
  assert.equal(field(report, 'add-concurrent-two-writers', 'result1'), 'ok')
  assert.equal(field(report, 'add-concurrent-two-writers', 'maxOpenTransactions'), '1',
    '去锁之后这里会变成 2（两趟 add 各开一个事务）—— 这条断言就是锁的存在证明')
  assert.equal(field(report, 'add-concurrent-two-writers', 'commitCount'), '2')
  assert.equal(field(report, 'add-concurrent-two-writers', 'emitCount'), '2')

  // ⚠️ add 专属：`MAX(position)` 是**读-改-写**，去掉锁之后两趟都会读到空的 MAX ⇒ 都写 0、1，
  // 于是"位置"不再唯一。位置各不相同才是这把锁真正护住的东西（比"同时开几个事务"更贴近业务）。
  const inserted = fields(report, 'add-concurrent-two-writers', 'inserted')
  assert.equal(inserted.length, 4)
  const positions = inserted.map(row => row.match(/position=(\d+)/)[1])
  assert.deepEqual([...positions].sort(), ['0', '1', '2', '3'], `两趟追加的位置不许重复：${positions.join(',')}`)
  assert.equal(field(report, 'add-concurrent-two-writers', 'rowCount'), '4')
  assert.deepEqual(fields(report, 'add-concurrent-two-writers', 'row').map(row => row.match(/position=(\d+)/)[1]),
    ['0', '1', '2', '3'], '表里的顺序也必须是 0..3（没有并列、没有空洞）')
})

// ---------------------------------------------------------------------------
// 9. JVM 行为组（第十刀-b）：player_list_remove 的场景
//    （第十刀-a 只用 %TEMP% 里的临时探针跑过这 11 条；本刀把它们**逐条搬进仓库**，
//     并把替身补上"认识三句 DELETE"的能力 —— 见 STUB_SQLITE_STATEMENT 的类注释。）
// ---------------------------------------------------------------------------

test('JVM 探针（第十刀-a）：注册 + 两个 id —— 一个事务六句 DELETE（每个 id 三句、1→2→3）、commit 之后才 emit', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const s = 'remove-two-ids'
  assert.equal(field(report, 'probe', 'removeRegistered'), 'true', 'remove 的 handler 必须也在注册表里')
  assert.equal(field(report, s, 'result'), 'null', '契约是 void ⇒ 成功时返回 null')

  // 整批删除是**一个**事务（同一时刻只开一个）。
  assert.equal(field(report, s, 'transactionCount'), '1', '整批只开一个事务')
  assert.equal(field(report, s, 'commitCount'), '1')
  assert.equal(field(report, s, 'maxOpenTransactions'), '1')

  // prepare 的是那三句、**各一次**（不是每个 id 重新 prepare 一遍），顺序 = statements.ts 的调用序。
  assert.equal(field(report, s, 'sqlSeenCount'), '3', '只 prepare 三句')
  assert.deepEqual(fields(report, s, 'sql').map(normalizeSql), [
    normalizeSql(javaTextBlock(writeJava, 'SQL_LIST_DELETE')),
    normalizeSql(javaTextBlock(writeJava, 'SQL_MUSIC_INFO_DELETE_BY_LIST_ID')),
    normalizeSql(javaTextBlock(writeJava, 'SQL_MUSIC_INFO_ORDER_DELETE_BY_LIST_ID')),
  ], 'compileStatement 的语句集合与顺序 = statements.ts:49 / :119 / :192')

  // 执行序：**每个 id 三句连着发**（对齐 dbHelper.ts:86-90），表序 1→2→3。
  assert.deepEqual(fields(report, s, 'binding'), [
    'delete|my_list|l-1',
    'delete|my_list_music_info|l-1',
    'delete|my_list_music_info_order|l-1',
    'delete|my_list|l-2',
    'delete|my_list_music_info|l-2',
    'delete|my_list_music_info_order|l-2',
  ], '每个 id 三句 DELETE：my_list → my_list_music_info → my_list_music_info_order')

  // 绑定序：l-1 三连、再 l-2 三连；三句都绑**位置参数 1**。
  const binds = field(report, s, 'binds')
  assert.equal(binds.split(',').map(binding => binding.split(':')[1]).join(','), 'l-1,l-1,l-1,l-2,l-2,l-2',
    '绑定序必须是 l-1,l-1,l-1,l-2,l-2,l-2（每个 id 三句连着发）')
  assert.ok(binds.split(',').every(binding => binding.startsWith('1:')), '三句都绑位置参数 1（各一个 ?）')

  // 只删 ids 里点名的那些：没被点名的第三行必须活着。
  assert.equal(field(report, s, 'rowCount'), '1', '没被点名的第三行必须活着')
  assert.deepEqual(fields(report, s, 'row'), [
    'id=keep;name=留着;source=wy;sourceListId=s-3;position=2;locationUpdateTime=3',
  ])

  // emit 在最后（= 提交 + 三个 close + endTransaction 之后）。
  const events = field(report, s, 'events').split('>')
  assert.equal(events[events.length - 1], 'emit', `emit 必须是最后一个事件：${events.join('>')}`)
  assert.ok(events.indexOf('commit') < events.indexOf('emit'), 'emit 必须在 commit 之后')
  assert.equal(field(report, s, 'emitCount'), '1')
  assert.equal(field(report, s, 'emit0'), 'player_list_remove|1|array|2|-|-', '一个参数、是数组、2 个元素')
})

test('JVM 探针（第十刀-a）：广播载荷是**裸字符串数组**（arg0=JSONArray、元素是 String、wire=["l-1","l-2"]）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  // ⚠️ 这一条是第十刀-a 那台临时探针里唯一"直接看 arg0 类型"的断言，本刀**逐字搬进来**：
  // arg0 必须是 JSONArray（不是 JSONObject）、长度 2、元素是 String、序列化后就是那个数组。
  const shape = field(report, 'remove-two-ids', 'emitShape0')
  assert.match(
    shape,
    /^player_list_remove\|arg0=JSONArray\|len=2\|\[0\]=String:l-1\|\[1\]=String:l-2\|wire=\["l-1","l-2"\]$/,
  )
  assert.equal(/arg0=JSONObject/.test(shape), false, '不能是对象（{ids: […]}）——那是 add 的形状')
  // 单个 id 同理。
  assert.equal(field(report, 'remove-single-id', 'emitShape0'),
    'player_list_remove|arg0=JSONArray|len=1|[0]=String:l-1|wire=["l-1"]')
  // 空数组 ⇒ 仍然是 JSONArray，只是 len=0 / wire=[]（**不是**改发一个对象）。
  assert.match(field(report, 'remove-empty-array', 'emitShape0'), /arg0=JSONArray\|len=0\|wire=\[\]$/)
})

test('JVM 探针（第十刀-a）：单个 id / 不在库里的 id 都不被误拒（0 行命中 = 成功 + 照样广播）', { skip: SKIP_REASON }, () => {
  const report = probeReport()

  assert.equal(field(report, 'remove-single-id', 'result'), 'null', '普通 id 不许被当成保留 id')
  assert.equal(field(report, 'remove-single-id', 'executed'), '3', '单个 id 也是三句')
  assert.deepEqual(fields(report, 'remove-single-id', 'row'), [
    'id=l-2;name=乙;source=wy;sourceListId=s-2;position=1;locationUpdateTime=2',
  ], '只删点名的那个（另一个原样留着）')
  assert.equal(field(report, 'remove-single-id', 'emitCount'), '1')

  // id 不在库里：三句照样发（命中 0 行）⇒ **成功**，而且照样广播（桌面 better-sqlite3 也是静默成功）。
  assert.equal(field(report, 'remove-unknown-id', 'result'), 'null', '命中 0 行不是错误')
  assert.equal(field(report, 'remove-unknown-id', 'executed'), '3', '三句确实发出去了')
  assert.equal(field(report, 'remove-unknown-id', 'emitCount'), '1', '0 行命中也要广播（桌面照样 emit）')
  assert.ok(field(report, 'remove-unknown-id', 'events').includes('commit'))
})

test('JVM 探针（第十刀-a）：`love` **不被拒**（裁定 4）——它在 my_list 里就是一次正常删除', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const s = 'remove-love-allowed'
  // ⚠️ 只有 default / temp 被拒：它们特殊在"有子表行但没有 my_list 父行"。love 若因备份导入出现在
  // my_list 里，删它就是**正常删除** —— 拒绝反而会破坏一次合法操作。
  assert.equal(field(report, s, 'result'), 'null', 'love 不是保留 id，不许被拒')
  assert.equal(field(report, s, 'executed'), '3', '照样三句 DELETE')
  assert.equal(field(report, s, 'rowCount'), '0', '那一行真的被删掉了（不是"拒绝"、也不是"没删到"）')
  assert.equal(field(report, s, 'emitCount'), '1')
  assert.equal(field(report, s, 'emitShape0'), 'player_list_remove|arg0=JSONArray|len=1|[0]=String:love|wire=["love"]')
  // 保留 id 是**两个**常量，不是"任何看起来特殊的 id"。
  assert.match(writeJava, /RESERVED_LIST_ID_DEFAULT = "default"/)
  assert.match(writeJava, /RESERVED_LIST_ID_TEMP = "temp"/)
})

test('JVM 探针（第十刀-a）：空数组 ⇒ 0 条 SQL（连 prepare 都不做）+ 事务照样提交 + 广播空数组', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const s = 'remove-empty-array'
  assert.equal(field(report, s, 'result'), 'null')
  assert.equal(field(report, s, 'sqlSeenCount'), '0', '空数组 ⇒ 一条 SQL 都不发（连 compile 都没有）')
  assert.equal(field(report, s, 'executed'), '0')
  assert.equal(field(report, s, 'binds'), '-', '一次绑定都没有')
  assert.equal(field(report, s, 'transactionCount'), '1', '事务照样开')
  assert.equal(field(report, s, 'commitCount'), '1', '并且照样提交成功')
  assert.equal(field(report, s, 'emitCount'), '1')
  assert.equal(field(report, s, 'emit0'), 'player_list_remove|1|array|0|-|-', '广播的是**空数组**')
})

test('JVM 探针（第十刀-a）：保留 id default / temp ⇒ 校验**早于 open**（一条 SQL、一个连接都没有）', { skip: SKIP_REASON }, () => {
  const report = probeReport()

  // 两个场景都刻意把库设成"打不开"：如果实现先开库，拿到的会是 IllegalStateException（打不开数据库）
  // 而不是 IllegalArgumentException（拒绝保留 id）—— 这条断言就是**顺序**的证明。
  for (const [section, id, index] of [
    ['remove-reserved-default', 'default', 0],
    ['remove-reserved-temp-in-list', 'temp', 1],
  ]) {
    assert.equal(field(report, section, 'result'), 'threw:java.lang.IllegalArgumentException', `${section} 必须是 IllegalArgumentException`)
    const message = field(report, section, 'message')
    assert.match(message, new RegExp('拒绝删除保留列表 `' + id + '`'), `${section} 的消息必须点名是哪个保留 id`)
    assert.match(message, new RegExp('`' + id + '`（`ids` 第 ' + index + ' 个元素）'), `${section} 的消息必须点名第几个元素`)
    assert.match(message, /从不写进/, '消息必须写清"保留列表从不写进 my_list"')
    assert.match(message, /只会清空它的歌曲/, '消息必须写清照抄桌面会发生什么（清空歌曲却删不掉列表）')
    assert.match(message, /有意在这里偏离桌面语义/, '消息必须自报"这是一处有意偏离"')
    assert.equal(field(report, section, 'events'), '-', `${section} 一个事务都不该开`)
    assert.equal(field(report, section, 'sqlSeenCount'), '0', `${section} 一条 SQL 都不该发`)
    assert.equal(field(report, section, 'transactionCount'), '0')
    assert.equal(field(report, section, 'emitCount'), '0', `${section} 参数非法 ⇒ 不广播`)
  }
  // `default` / `temp` 这两个字面量的出处是 src/common/constants.ts 的 LIST_IDS（单一出处没破）。
  assert.match(writeJava, /src\/common\/constants\.ts:25-30/)
})

test('JVM 探针（第十刀-a）：参数非法 ⇒ IllegalArgumentException 点名字段（5 种坏形状）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const expected = {
    'remove-param-missing': /需要一个 `ids` 数组参数/,
    'remove-param-wrapped-object': /参数必须是数组（`ids`）/,
    'remove-param-item-not-string': /第 0 个元素必须是字符串/,
    'remove-param-item-empty': /不能是空字符串/,
    'remove-param-item-null': /第 0 个元素是 null/,
  }
  for (const [section, pattern] of Object.entries(expected)) {
    assert.equal(field(report, section, 'result'), 'threw:java.lang.IllegalArgumentException', `${section} 必须是 IllegalArgumentException`)
    assert.match(field(report, section, 'message'), pattern, `${section} 的消息必须点名`)
    assert.equal(field(report, section, 'events'), '-', `${section} 不该开事务`)
    assert.equal(field(report, section, 'sqlSeenCount'), '0', `${section} 不该发任何 SQL`)
    assert.equal(field(report, section, 'emitCount'), '0', `${section} 不该广播`)
  }
  // "包成对象"这一种必须把"remove 要的是裸数组、对象是 add 的形状"说出来。
  assert.match(field(report, 'remove-param-wrapped-object', 'message'),
    /契约是 args=\[\[ids\]\]，\*\*不是\*\* args=\[\{ids: \[…\]\}\]/)
})

test('JVM 探针（第十刀-a）：第 2 句 DELETE 失败 ⇒ 不提交、**回滚**、不广播（第一句删掉的行走回来）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const s = 'remove-fail-second-delete'
  assert.match(field(report, s, 'result'), /^threw:/)
  assert.match(field(report, s, 'message'), /第 2 句 DELETE 失败/)
  assert.equal(field(report, s, 'commitCount'), '0', '没 markSuccessful ⇒ 回滚')
  assert.equal(field(report, s, 'emitCount'), '0', '失败**不许**改本地状态 ⇒ 一条广播都没有')
  assert.equal(field(report, s, 'executed'), '1', '只发出过第一句')
  const events = field(report, s, 'events').split('>')
  assert.equal(events[events.length - 1], 'end', `最后一个事件必须是 endTransaction（回滚）：${events.join('>')}`)
  // ⚠️ 回滚的**真凭实据**：第一句已经把 l-1 删掉了，endTransaction 之后两行都必须回来。
  assert.equal(field(report, s, 'rowCount'), '2', '回滚必须把第一句删掉的那一行放回来')
  assert.deepEqual(fields(report, s, 'row'), [
    'id=l-1;name=甲;source=wy;sourceListId=s-1;position=0;locationUpdateTime=1',
    'id=l-2;name=乙;source=wy;sourceListId=s-2;position=1;locationUpdateTime=2',
  ])
})

test('JVM 探针（第十刀-a）：库打不开 / 三张表缺任何一张 ⇒ IllegalStateException，不广播、不开事务', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  assert.equal(field(report, 'remove-open-failure', 'result'), 'threw:java.lang.IllegalStateException')
  assert.match(field(report, 'remove-open-failure', 'message'), /打不开数据库/)
  assert.equal(field(report, 'remove-open-failure', 'events'), '-', '库都没打开 ⇒ 连事务都不该开')
  assert.equal(field(report, 'remove-open-failure', 'emitCount'), '0')

  assert.equal(field(report, 'remove-table-missing', 'result'), 'threw:java.lang.IllegalStateException')
  assert.match(field(report, 'remove-table-missing', 'message'), /没有表 "my_list"/)
  assert.equal(field(report, 'remove-table-missing', 'sqlSeenCount'), '0', '表缺失在 open 那一层就失败 ⇒ 一条 SQL 都没有')
  assert.equal(field(report, 'remove-table-missing', 'emitCount'), '0')
  // 三张表都点名进了 open 的 requiredTables（缺第 2/3 句要写的那两张同样在 open 层失败）。
  assert.match(
    blockRange(writeCode, 'private static Object listRemove').body,
    /RainMusicDatabase\.open\(\s*context,\s*RainMusicDatabase\.TABLE_MY_LIST,\s*TABLE_MY_LIST_MUSIC_INFO,\s*TABLE_MY_LIST_MUSIC_INFO_ORDER\s*\)/,
  )
})

test('JVM 探针（第十刀-a）：两个线程同时 remove ⇒ 同一时刻只有一个事务（remove 也在 LIST_WRITE_LOCK 里）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const s = 'remove-concurrent-two-writers'
  assert.equal(field(report, s, 'result0'), 'ok')
  assert.equal(field(report, s, 'result1'), 'ok')
  assert.equal(field(report, s, 'maxOpenTransactions'), '1',
    '去锁之后这里会变成 2（两趟 remove 各开一个事务）—— 这条断言就是第三条临界区的存在证明')
  assert.equal(field(report, s, 'commitCount'), '2')
  assert.equal(field(report, s, 'emitCount'), '2')
  assert.equal(field(report, s, 'executed'), '12', '两趟各 2 个 id × 3 句')
  assert.equal(field(report, s, 'binds'),
    '1:a-1,1:a-1,1:a-1,1:a-2,1:a-2,1:a-2,1:b-1,1:b-1,1:b-1,1:b-2,1:b-2,1:b-2',
    '两趟各自的"每个 id 三句"都完整（没有交错成一个 id 一句）')
})

test('JVM 探针（第十刀-b）：插队整表重写时 sourceListId 的 ".0" 已被归一（老库 "123.0" ⇒ 写回 "123"）', { skip: SKIP_REASON }, () => {
  const report = probeReport()
  const s = 'add-renumber-dot-zero'
  assert.equal(field(report, s, 'result'), 'null')
  // 四行各钉一种：末尾 .0 被去掉、只去**末尾那一次**（"456.0.0" ⇒ "456.0"）、不动的原样、NULL 仍是 NULL。
  assert.deepEqual(fields(report, s, 'inserted'), [
    'id=X;name=新;source=null;sourceListId=null;position=0;locationUpdateTime=null',
    'id=A;name=甲;source=wy;sourceListId=123;position=1;locationUpdateTime=1',
    'id=B;name=乙;source=wy;sourceListId=456.0;position=2;locationUpdateTime=2',
    'id=C;name=丙;source=wy;sourceListId=789;position=3;locationUpdateTime=3',
    'id=D;name=丁;source=wy;sourceListId=null;position=4;locationUpdateTime=null',
  ], '插队重写读出来的 sourceListId 必须先过 `.0` 归一化（与读通道 / 桌面 dbHelper.ts:44-49 同一条规则）')
  // 表里最终也是这 5 行（"123.0" 不许被原样固化回去）。
  assert.deepEqual(fields(report, s, 'row'), fields(report, s, 'inserted'))
  assert.equal(field(report, s, 'rowCount'), '5')
  assert.ok(!fields(report, s, 'row').some(row => /sourceListId=123\.0;/.test(row)), '`123.0` 不许出现在重写后的表里')
})
