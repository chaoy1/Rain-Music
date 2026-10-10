/**
 * Android 移植 · **P0-2 第二刀（`winMain_get_data`）+ 第三刀（`winMain_save_data`）**
 * 的契约 / 接线回归网（两条通道在同一个 Java 文件里，所以也在同一个用例文件里）。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**不执行任何 Java** —— 所以它**不能**证明这两条通道在真机上不再是
 * `IPC_CHANNEL_UNSUPPORTED`，也不能证明 SharedPreferences 真的读写成功、那把锁真的生效。
 * 那几件事只能由 CI 的 `gradlew assembleDebug`（编译）→ 真机运行（行为）来证明。
 *
 * 它守的是一组**本机可测、且一旦写错在真机上完全静默**的接线错误：
 *
 * 1. Java 里通道名的字面量必须等于 `src/common/ipcNames.ts` 生成的真实通道名
 *    （键名 `get_data` / `save_data` + 模块前缀 `winMain`，见 `ipcNames.ts:171-176`）——
 *    错一个字符 ⇒ 真机上就是 `IPC_CHANNEL_UNSUPPORTED`（读）或**彻底静默**（写：`send` 是单向的，
 *    P0-1 对未注册的 send 通道只在 logcat 里留一行 warn），本机毫无感觉；
 * 2. 落点必须与阶段 2b 已落地的骨架一致：key = `'rain:store:' + STORE_NAMES.DATA`
 *    （`adapter.android.ts:95` + `src/common/constants.ts:10`），且 SharedPreferences 文件名
 *    与第一刀的设置通道**是同一个** `CapacitorStorage`（同一套 store 命名空间）；
 * 3. **这两条通道没有 SQL 落点，而且代码里不许假装有**：阶段 2a 的 `tables.ts` 一共 9 张表，
 *    没有任何 kv 表（唯一 kv 形状的 `db_info` 是"数据库 schema 版本"元数据表，
 *    `migrate.ts:86-103` / `db.ts:15` 专用）。这组用例把"表结构与 `tables.ts` 逐字一致"
 *    落成可执行的断言：**9 张表的名字一张不多一张不少**、`db_info` 的列没被挪用、
 *    Java 里一行 SQL / 一个 `android.database.sqlite` import 都没有。
 *    ⚠️ 如果将来线 A 真的给 renderer 的 data store 加了一张 kv 表，**这组用例会变红** ——
 *    那正是"本刀的落点判断该重新评审"的信号，不是误报；
 * 4. 注册**真的被调用**：`RainMusicIpcPlugin.load()` 里调 `RainMusicDataChannels.register(this)`，
 *    且 `MainActivity` 仍把插件注册在 `super.onCreate()` **之前**（P0-1 踩过一次
 *    "漏提交 ⇒ 真机静默失效"）；**匹配前必须去掉注释**（第二刀第一次自测就是被这个坑抓到的）；
 * 5. 范围守卫：本文件只注册这 2 条通道（不碰 `player_list_*` / `dislike_*`）；
 * 6. **写通道（第三刀）的四条本机可测的硬要求**：参数形状是 `args=[{path, data}]`；
 *    读-改-写整段在**与设置通道共用的那一把锁**里（`RainMusicStoreLock.WRITE_LOCK`）；
 *    写失败（`commit()` 返回 false）与坏 JSON 都**抛错**、坏数据**不被覆盖**；
 *    这条通道**不广播任何东西**（尤其不广播 `winMain_on_config_change`）。
 *
 * 最后一组用例用 JS 侧的桥 + 一个**按 Java 语义实现**的原生替身，锁住这条链在 JS 侧的可观察行为
 * （首启返回 null 而不是 reject、坏文本 reject 而不是伪装成"空"、参数缺失大声失败、
 * 写通道是单向 `send` 且不带应答、写入不广播）。它是接线检查，**不是** Java 行为验证 ——
 * 替身与 Java 一旦漂移，这组用例不会变红（所以每条替身语义旁边都有对应的 Java 源码断言）。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const ROOT = path.join(__dirname, '../..')
const BRIDGE_MODULE = 'src/common/platform/ipcBridge/capacitor.js'
const JAVA_DIR = path.join(ROOT, 'android/app/src/main/java/com/rainmusic/mobile')

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readJava = relative => read(path.join('android/app/src/main/java/com/rainmusic/mobile', relative))

const dataJava = readJava('ipc/RainMusicDataChannels.java')
const settingJava = readJava('ipc/RainMusicAppSettingChannels.java')
const lockJava = readJava('ipc/RainMusicStoreLock.java')
const pluginJava = readJava('ipc/RainMusicIpcPlugin.java')
const activityJava = readJava('MainActivity.java')

const tablesTs = read('src/main/worker/dbService/tables.ts')
const adapterAndroidTs = read('src/main/platform/storage/adapter.android.ts')

/**
 * 去掉注释再匹配。
 *
 * 必须这么做的理由（第一刀写这个用例时踩过）：`MainActivity.java` 的**类注释**里就写着
 * "registerPlugin(...) 必须在 super.onCreate() 之前"，于是 `indexOf('super.onCreate(')`
 * 会命中注释、把顺序判反 —— 这是"检查代码"的用例里最典型的一类假失败/假通过。
 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 再去掉字符串字面量（只用于"这段代码有没有 SQL 执行面"这类判断，见下面 SQL 那组用例）。 */
const stripJavaStrings = source => source.replace(/"(?:\\.|[^"\\])*"/g, '""')

/** 读 Java 里的字符串常量字面量（`static final String X = "…";`）。 */
const javaConstant = (source, name) => {
  const match = source.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]*)"`))
  assert.ok(match, `Java 里找不到常量 ${name}（读法：static final String ${name} = "…"）`)
  return match[1]
}

const { WIN_MAIN_RENDERER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})
const { STORE_NAMES, DATA_KEYS } = load('src/common/constants.ts', {}, {})

const EXPECTED_CHANNEL = WIN_MAIN_RENDERER_EVENT_NAME.get_data
const EXPECTED_SAVE_CHANNEL = WIN_MAIN_RENDERER_EVENT_NAME.save_data
/** 设置通道的广播名：数据 store 的写**绝不能**碰它（那次广播会把差异合并进 appSetting）。 */
const EXPECTED_ON_CONFIG_CHANGE = WIN_MAIN_RENDERER_EVENT_NAME.on_config_change
const EXPECTED_STORE_KEY = `rain:store:${STORE_NAMES.DATA}`

/** 去掉注释后的 Java 源码 —— 凡"这段代码存在吗"的断言都必须用它（见 stripJavaComments）。 */
const dataCode = stripJavaComments(dataJava)

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED / 静默）', () => {
  assert.equal(EXPECTED_CHANNEL, 'winMain_get_data', 'ipcNames.ts 的真实值变了？')
  assert.equal(javaConstant(dataJava, 'CHANNEL_GET_DATA'), EXPECTED_CHANNEL)
  assert.equal(EXPECTED_SAVE_CHANNEL, 'winMain_save_data', 'ipcNames.ts 的真实值变了？')
  assert.equal(javaConstant(dataJava, 'CHANNEL_SAVE_DATA'), EXPECTED_SAVE_CHANNEL)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量但忘了 register 的话，真机上依然是"未注册"。
  // ⚠️ 必须去掉注释再匹配：注释里就写着这两行，用整份源码匹配的话把它们注释掉**用例依然通过**
  // （第一刀在 MainActivity 的顺序判断上、第二刀在 `RainMusicDataChannels.register(this)` 上
  // 都踩过这个坑；写通道更糟 —— `send` 单向，漏注册在渲染层连报错都没有）。
  assert.match(dataCode, /register\(\s*CHANNEL_GET_DATA\s*,/)
  assert.match(dataCode, /register\(\s*CHANNEL_SAVE_DATA\s*,/)
})

test('范围守卫：本文件只注册 2 条通道（读 + 写），且不在插件里就地实现', () => {
  // ⚠️ 数注册**必须用去注释后的源码**：把 `RainMusicIpcHandlers.register(CHANNEL_SAVE_DATA, …)` 整行
  // 注释掉之后，用整份源码数的结果**依然是 2**（注释里就有这一行）—— 变绿假通过，
  // 而真机上写通道就是"未注册"（`send` 单向 ⇒ 渲染层连报错都没有）。这个坑是变异注入 M6 抓到的。
  const registrations = dataCode.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(registrations.length, 2, '本文件只应注册 winMain_get_data + winMain_save_data')

  // 这两组通道本刀**不做**（任务书明确排除）。**必须看代码、不看注释** —— 类注释里就写着这两个名字
  // （用来登记"别的通道一条不做"），直接匹配源码会假失败。
  for (const forbidden of ['player_list_', 'dislike_']) {
    assert.ok(!dataCode.includes(forbidden), `本刀不应出现 ${forbidden}`)
  }

  // 写通道只能用常量注册，不许写死字面量（`register("winMain_save_data"`）：字面量一旦与
  // ipcNames.ts 漂移，本机测不出来，而它是一条**单向**通道（渲染层看不见 `IPC_CHANNEL_UNSUPPORTED`）。
  assert.ok(!dataCode.includes('RainMusicIpcHandlers.register("winMain_'), '注册必须走常量')

  // P0-1 的插件里不应该出现"就地实现"（实现必须都在各自的通道文件里）。
  assert.doesNotMatch(stripJavaComments(pluginJava), /RainMusicIpcHandlers\.register\(/)

  // 两条通道文件合计 4 条：第一刀的 2 条 + 本文件的 2 条。
  const settingRegistrations = stripJavaComments(settingJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(settingRegistrations.length, 2, '第一刀的设置通道不该被本刀改动')
  assert.equal(registrations.length + settingRegistrations.length, 4)
})

test('落点必须与阶段 2b 一致：key = rain:store:data，且与第一刀同一份 CapacitorStorage', () => {
  assert.equal(EXPECTED_STORE_KEY, 'rain:store:data', '阶段 2b 的 key 规则变了？')
  assert.equal(javaConstant(dataJava, 'STORE_KEY'), EXPECTED_STORE_KEY)

  // key 规则的唯一出处：adapter.android.ts 的 preferencesKey()。它变了，两边就会各写各的。
  assert.match(
    adapterAndroidTs,
    /const preferencesKey = \(desc: StoreDescriptor\) => `rain:store:\$\{desc\.name\}`/,
    'adapter.android.ts 的 preferencesKey() 规则变了 → Java 侧的 STORE_KEY 必须同步',
  )

  // 同一份 SharedPreferences 文件（= @capacitor/preferences 的默认 group），否则同一套 store 会分家。
  assert.equal(javaConstant(dataJava, 'PREFERENCES_FILE'), 'CapacitorStorage')
  assert.equal(
    javaConstant(dataJava, 'PREFERENCES_FILE'),
    javaConstant(settingJava, 'PREFERENCES_FILE'),
    '两条通道必须落在同一份 Preferences 文件上',
  )
  assert.match(dataJava, /@capacitor\/preferences/, '必须先说明"为什么是这个文件名"')
})

test('本通道没有 SQL 落点：tables.ts 的表一张不多不少、db_info 列没被挪用、Java 里没有 SQL', () => {
  // 只认 tables.set('名称', …) —— 文件开头那一大段是**注释掉的旧 schema**，
  // 直接全文 grep CREATE TABLE 会把注释也算进来（第一刀那条注释教训的同构问题）。
  // 这份注册表里 12 个键 = 9 张表 + 3 个索引（索引 DDL 也挂在同一个 Map 里）。
  const registered = [...tablesTs.matchAll(/tables\.set\('([^']+)'/g)].map(match => match[1])
  assert.deepEqual(
    [...registered].sort(),
    [
      'db_info',
      'dislike_list',
      'download_list',
      'index_music_info_other_source',
      'index_my_list_music_info',
      'index_my_list_music_info_order',
      'lyric',
      'music_info_other_source',
      'music_url',
      'my_list',
      'my_list_music_info',
      'my_list_music_info_order',
    ],
    '阶段 2a 的表结构变了 → 本刀的"这条通道没有 SQL 落点"结论必须重新评审',
  )
  assert.ok(
    !registered.some(name => /kv|store|key_value|app_data|preference/i.test(name)),
    '出现了 kv 形状的表 → renderer 的 data store 落点决策必须重新评审（本刀按 Preferences 落地）',
  )

  // 唯一"kv 形状"的表是 db_info，它属于**数据库 schema 版本元数据**（migrate.ts:86-103、db.ts:15），
  // 不是 renderer 的 data store。这里把它的列钉住：证明本刀没有为了抄近路去改表结构。
  const dbInfo = tablesTs.match(/tables\.set\('db_info',\s*`([\s\S]*?)`\)/)[1]
  assert.deepEqual(
    [...dbInfo.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)/g)].map(match => match[1]),
    ['id', 'field_name', 'field_value'],
    'db_info 的列变了 → 与阶段 2a 的表结构不再逐字一致',
  )

  // Java 侧不许出现 SQL / SQLite 的**执行面**：落点不是它，就不要留"半截 SQL"误导下一刀。
  // ⚠️ 必须先去掉注释**和字符串字面量**：那条 playInfo 的 warn 正文里要能点名
  // "线 A 的 SQLite 驱动也未实现"（否则读日志的人不知道校正为什么没做），
  // 把字符串也算进来的话这条用例就是假失败。
  const sqlSurface = stripJavaStrings(stripJavaComments(dataJava)).toLowerCase()
  for (const forbidden of [
    'android.database',
    'sqlitedatabase',
    'sqliteopenhelper',
    'rawquery',
    'execsql',
    'pragma',
    'create table',
    'insert into',
    'select ',
  ]) {
    assert.ok(!sqlSurface.includes(forbidden), `winMain_get_data 不该出现 ${forbidden}`)
  }
})

test('注册必须发生在 RainMusicIpcPlugin.load() 里；MainActivity 仍先 registerPlugin 再 super.onCreate()', () => {
  // ⚠️ 这里**必须**去掉注释再匹配：本刀的第一次自测就是被这个坑抓到的 ——
  // 把 `RainMusicDataChannels.register(this);` 整行注释掉之后，用整份源码匹配的用例**依然通过**
  // （注释里就写着这一行），而那正是真机上 `IPC_CHANNEL_UNSUPPORTED` 的形状。
  // 第一刀在 `MainActivity` 的顺序判断上踩过同一个坑（见上面的 stripJavaComments）。
  assert.match(
    stripJavaComments(pluginJava),
    /RainMusicDataChannels\.register\(this\)/,
    'load() 里必须注册，否则真机 IPC_CHANNEL_UNSUPPORTED（注释掉不算）',
  )

  // 只看代码、不看注释（注释里就写着这句话，见 stripJavaComments 的说明）。
  const activityCode = stripJavaComments(activityJava)
  const registerPlugin = activityCode.indexOf('registerPlugin(RainMusicIpcPlugin.class)')
  const superOnCreate = activityCode.indexOf('super.onCreate(')
  assert.ok(registerPlugin > -1 && superOnCreate > -1, 'MainActivity 的注册点/父类调用不见了')
  assert.ok(
    registerPlugin < superOnCreate,
    'registerPlugin 必须在 super.onCreate() 之前（P0-1 的这个坑会让真机静默失效）',
  )
})

test('playInfo 的"播放队列恢复校正"没有做，但必须**大声**说明（不静默跳过）', () => {
  // 桌面 M:data:11-24 会调 dbService.resolvePlaybackQueueRestoreIndex / getListMusics 并回写；
  // Android 侧没有主进程、线 A 的 SQLite 驱动仍是 throw（adapter/android.ts:53-58）⇒ 原样返回。
  assert.match(dataJava, /Logger\.warn\(/, 'playInfo 分支必须留下 warn，而不是静默返回')
  assert.match(dataJava, /播放队列恢复校正/, 'warn 里必须点名"校正没有执行"')

  // 也不许假装做了：Java 里不能**调用**恢复 API（字符串里提到它们是允许的 —— 那条 warn 的正文
  // 就必须点名"桌面那一支依赖主进程的 dbService"，否则读日志的人不知道为什么没做校正）。
  // ⚠️ 第三刀给写通道加的那条 info 正文里同样点名了 `dbService.completePlaybackQueueRestore()`
  // （不点名的话读日志的人不知道桌面多做了什么），所以这里必须**连字符串字面量一起去掉**，
  // 否则这条用例会因为"注释/文案里提到了它"而假失败。
  for (const forbidden of [/\bdbService\s*[.(]/, /resolvePlaybackQueueRestoreIndex\s*\(/, /completePlaybackQueueRestore\s*\(/]) {
    assert.doesNotMatch(stripJavaStrings(stripJavaComments(dataJava)), forbidden, `不该调用 ${forbidden}（那是主进程的事）`)
  }

  // 这条 warn 的依据（桌面那一支确实存在）——顺便钉住"引用没写错文件"。
  const desktopDataHandler = read('src/main/modules/winMain/rendererEvent/data.ts')
  assert.match(desktopDataHandler, /resolvePlaybackQueueRestoreIndex/)
  assert.equal(javaConstant(dataJava, 'DATA_KEY_PLAY_INFO'), DATA_KEYS.playInfo)
  assert.equal(DATA_KEYS.playInfo, 'playInfo')
})

test('null 是可接受的答案：9 个调用方的兜底还在（谁删了兜底，这条用例就变红）', () => {
  const ipcTs = read('src/renderer/utils/ipc.ts')
  // 4 个 `?? { ...DEFAULT_SETTING.x }`
  for (const name of ['getLeaderboardSetting', 'getSongListSetting', 'getSearchSetting', 'getViewPrevState']) {
    assert.match(
      ipcTs,
      new RegExp(`${name} = async\\(\\) => \\{[\\s\\S]{0,400}?\\?\\? \\{`),
      `${name} 的 ?? 默认值兜底不见了 → 返回 null 会变成真机上的白屏/异常`,
    )
  }
  // 其余 5 个消费点
  assert.match(read('src/renderer/store/search/action.ts'), /\?\? \[\]/, '搜索历史少了 ?? [] 兜底')
  assert.match(read('src/renderer/utils/data.ts'), /\?\? \{\}/, '列表位置信息少了 ?? {} 兜底')
  assert.match(read('src/renderer/utils/data.ts'), /\?\? LIST_IDS\.DEFAULT/, '上次选中的列表 id 少了兜底')
  assert.match(read('src/renderer/core/useApp/useDataInit.ts'), /info\?\.listId/, 'playInfo 的取值点少了可选链兜底')
  assert.match(
    read('src/renderer/core/useApp/index.ts'),
    /invokeWithFallback\([\s\S]{0,200}WIN_MAIN_RENDERER_EVENT_NAME\.get_data/,
    'getViewPrevState() 的 invokeWithFallback 兜底不见了',
  )
})

test('JS 侧零改动：这条通道在渲染层走 rendererInvoke（不是 sendSync），桥不认识通道名', () => {
  // 契约是 mainHandle（invoke）。Capacitor 没有同步 IPC，若有人在渲染层改成 sendSync 就是真机死路。
  const ipcTs = read('src/renderer/utils/ipc.ts')
  assert.match(
    ipcTs,
    /rendererInvoke<string, [^>]*>\(WIN_MAIN_RENDERER_EVENT_NAME\.get_data,/,
    '9 处封装都应走 rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.get_data, …)',
  )
  assert.equal((ipcTs.match(/WIN_MAIN_RENDERER_EVENT_NAME\.get_data/g) ?? []).length, 9, '契约是 9 处封装')

  // 桥是通道无关的（唯一的原生入口 post）：所以这条通道**不需要**改 JS 侧任何文件。
  const bridge = read('src/common/platform/ipcBridge/capacitor.js')
  assert.ok(!bridge.includes('winMain_get_data'), '桥里不该出现通道名（那意味着有人加了通道白名单）')
})

// ---------------------------------------------------------------------------
// 写通道（第三刀）的源码级守卫：参数形状 / 锁 / 失败路径 / 不广播
// ---------------------------------------------------------------------------

test('写通道的参数形状：args=[{path, data}]（9 处 rendererSend，不是 [path, data]，不是 invoke/sendSync）', () => {
  const ipcTs = read('src/renderer/utils/ipc.ts')
  assert.equal((ipcTs.match(/WIN_MAIN_RENDERER_EVENT_NAME\.save_data/g) ?? []).length, 9, '契约 :198 是 9 处封装')

  // 9 处必须是 rendererSend(save_data, {path: DATA_KEYS.x, data})：写成 [path, data] 会让 Java 把
  // 字符串当对象；写成 rendererSendSync 在 Capacitor 上是结构性死路（桥的 sendSync 直接抛）。
  for (const key of [
    'playInfo',
    'searchHistoryList',
    'listScrollPosition',
    'listPrevSelectId',
    'listUpdateInfo',
    'leaderboardSetting',
    'songListSetting',
    'searchSetting',
    'viewPrevState',
  ]) {
    assert.match(
      ipcTs,
      new RegExp(`rendererSend\\(WIN_MAIN_RENDERER_EVENT_NAME\\.save_data, \\{\\s*path: DATA_KEYS\\.${key},`),
      `DATA_KEYS.${key} 的写封装必须走 rendererSend(save_data, {path, data})`,
    )
  }
  assert.ok(!/rendererSendSync\(\s*WIN_MAIN_RENDERER_EVENT_NAME\.save_data/.test(ipcTs), '写通道不能走 sendSync')

  // 桌面侧的形状（本刀没有改 JS，只把"抄的是哪一行"钉住：契约 :198 指向 M:data:30）。
  const desktop = read('src/main/modules/winMain/rendererEvent/data.ts')
  assert.match(desktop, /WIN_MAIN_RENDERER_EVENT_NAME\.save_data/)
  assert.match(desktop, /getStore\(STORE_NAMES\.DATA\)\.set\(path, data\)/, '桌面写的就是 data store 的一个键')

  // Java 侧：args[0] 是**对象**，字段名就是契约里的 path / data。
  assert.match(dataCode, /FIELD_PATH = "path"/)
  assert.match(dataCode, /FIELD_DATA = "data"/)
  assert.match(dataCode, /payload\.opt\(FIELD_PATH\)/)
  assert.match(dataCode, /payload\.opt\(FIELD_DATA\)/)
})

test('写通道用同一个 STORE_KEY / 同一份 CapacitorStorage 读写（不是自己发明一个 key）', () => {
  assert.match(dataCode, /prefs\.getString\(STORE_KEY, null\)/, '写通道必须从同一个 key 读回整份文本')
  assert.match(
    dataCode,
    /putString\(STORE_KEY, store\.toString\(\)\)\.commit\(\)/,
    '写回同一个 key，并且用**同步**的 commit()（能回报成功与否，apply() 不能）',
  )
  assert.equal(javaConstant(dataJava, 'PREFERENCES_FILE'), javaConstant(settingJava, 'PREFERENCES_FILE'))
  assert.match(dataCode, /getSharedPreferences\(PREFERENCES_FILE, Context\.MODE_PRIVATE\)/)
})

test('写通道的「读-改-写」整段在锁里，而且就是设置通道那把锁（各自一把挡不住跨 key 丢更新）', () => {
  // 1. 写通道确实用了共用锁。
  assert.match(
    dataCode,
    /synchronized\s*\(\s*RainMusicStoreLock\.WRITE_LOCK\s*\)\s*\{/,
    '写通道的读-改-写必须在 RainMusicStoreLock.WRITE_LOCK 里',
  )

  // 2. 读与写都在**同一个**临界区里（先读后写；否则就是 TOCTOU，两个并发写照样丢）。
  const lockAt = dataCode.indexOf('synchronized (RainMusicStoreLock.WRITE_LOCK)')
  const readAt = dataCode.indexOf('prefs.getString(STORE_KEY, null)')
  const writeAt = dataCode.indexOf('putString(STORE_KEY')
  assert.ok(lockAt > -1 && readAt > lockAt, '读必须在锁内（锁外读 = 拿到旧文本再覆盖）')
  assert.ok(writeAt > readAt, '写必须在读之后、同一个锁内')

  // 3. 两个通道文件都不许再"自己造一把锁"（那正是本刀要避免的静默缺陷）。
  for (const [name, source] of [['RainMusicDataChannels', dataJava], ['RainMusicAppSettingChannels', settingJava]]) {
    assert.doesNotMatch(stripJavaComments(source), /=\s*new Object\(\)/, `${name} 不该自己造锁`)
  }

  // 4. 设置通道那把锁就是**同一个对象**（别名），而且它仍然只在写路径上用。
  const settingCode = stripJavaComments(settingJava)
  assert.match(
    settingCode,
    /WRITE_LOCK\s*=\s*RainMusicStoreLock\.WRITE_LOCK\s*;/,
    '设置通道的 WRITE_LOCK 必须是别名，否则两把锁互不相识',
  )
  assert.match(settingCode, /synchronized\s*\(\s*WRITE_LOCK\s*\)/, '设置通道仍要串行化自己的读-改-写')

  // 5. 全仓库只有一把这样的锁：`new Object()` 只出现在 RainMusicStoreLock 里，而且只有一个
  //    （⚠️ 必须去掉注释：那份类注释里就写着"不要改回 new Object()"）。
  const lockCode = stripJavaComments(lockJava)
  assert.equal((lockCode.match(/new Object\(\)/g) ?? []).length, 1, '锁只能有一个实例')
  assert.match(lockCode, /static final Object WRITE_LOCK = new Object\(\)/)

  // 6. 读通道**不入锁**（它只读；文件里 synchronized 只应出现一次，就在写通道里）。
  assert.equal((dataCode.match(/synchronized/g) ?? []).length, 1, '读通道不该入锁，写通道只应有一处 synchronized')
  // 7. 锁的理由必须写在代码里（改这把锁的人得知道为什么不能拆开）。
  assert.match(lockJava, /跨 key/, '锁的类注释必须说明"为什么不能各自一把锁"')
})

test('写通道的失败路径：坏 JSON 不覆盖、commit() false 抛错、参数不对抛错（都不假装成功）', () => {
  // 首启从空 store 开始；只要文本已存在，一律走 parseStoreText（坏了就抛，**不覆盖**）。
  assert.match(
    dataCode,
    /text == null \? new JSONObject\(\) : parseStoreText\(text\)/,
    '首启从空 store 开始，已有文本一律走那个"坏了就抛"的解析器',
  )
  // commit() 的返回值必须被检查，false ⇒ 抛错（不许 `prefs.edit()…commit();` 之后当没事发生）。
  assert.match(
    dataCode,
    /if\s*\(!prefs\.edit\(\)\.putString\(STORE_KEY[\s\S]{0,80}?commit\(\)\)\s*\{[\s\S]{0,600}?throw new IllegalStateException/,
    'commit() 返回 false 必须抛错',
  )
  // 参数：缺 data 字段抛错。
  assert.match(
    dataCode,
    /if\s*\(!payload\.has\(FIELD_DATA\)\)\s*\{[\s\S]{0,800}?throw new IllegalArgumentException/,
    '缺 data 字段必须抛错（{path} ≠ {path, data:null}）',
  )
  // data 为 JSON null 必须过 jsonValue()（org.json 的 put(name, null) 会**删键**）。
  assert.match(dataCode, /jsonValue\(payload\.opt\(FIELD_DATA\)\)/, 'data 必须过 jsonValue()')
  assert.match(dataCode, /return value == null \? JSONObject\.NULL : value/, 'jsonValue 存的是 JSONObject.NULL')

  // 坏数据的失败不能"顺手重建"：写通道里不许出现任何形式的吞异常/回退空 store。
  assert.doesNotMatch(dataCode, /catch\s*\([^)]*\)\s*\{\s*\}/, '不许吞异常（空 catch）')
  assert.match(
    dataCode,
    /private static JSONObject parseStoreText[\s\S]{0,500}?throw new IllegalStateException/,
    '坏数据必须抛出（既不给 null 也不给 {}，更不重建）',
  )
})

test('写通道不广播任何东西（尤其不广播 winMain_on_config_change），且不假装做了队列恢复收尾', () => {
  const from = dataCode.indexOf('private static Object saveData')
  assert.ok(from > -1, '找不到 saveData')
  // ⚠️ dataCode 是**去掉注释后**的源码，所以不能用 `// ----` 那种段落注释来切边界；
  // 用下一个方法声明当边界（这一段里就是 requireContext）。
  const to = dataCode.indexOf('private static Context requireContext', from)
  assert.ok(to > from, '找不到 saveData 的结尾')
  const saveBody = dataCode.slice(from, to)

  for (const forbidden of ['emitTo', 'ctx.emit', 'CHANNEL_ON_CONFIG_CHANGE']) {
    assert.ok(!saveBody.includes(forbidden), `写通道不该广播（出现 ${forbidden}）`)
  }
  assert.ok(
    !dataCode.includes('CHANNEL_ON_CONFIG_CHANGE'),
    '整个数据通道文件都不该出现设置通道的广播名（那是 config_v2 的事）',
  )

  // playInfo 那一支：桌面会调 dbService.completePlaybackQueueRestore()，Android 侧没有这条链 ⇒
  // 必须**大声**说明（Logger.info），而且**不许真的去调**。
  assert.match(saveBody, /Logger\.info\(/, 'playInfo 的写分支必须留下 info，而不是静默跳过')
  // ⚠️ 必须去掉字符串字面量再查调用：那条 info 的正文里就写着 `dbService.completePlaybackQueueRestore()`
  // （否则读日志的人不知道桌面多做了什么），把它算进来的话这条用例是假失败。
  const saveCode = stripJavaStrings(saveBody)
  for (const forbidden of [/\bdbService\s*[.(]/, /completePlaybackQueueRestore\s*\(/]) {
    assert.doesNotMatch(saveCode, forbidden, `不该调用 ${forbidden}（那是主进程的事）`)
  }
  assert.match(saveCode, /DATA_KEY_PLAY_INFO\.equals\(path\)/, '只有 playInfo 才需要那条说明')
  // 判断条件与桌面 data.ts:32 同源（data.listId != 'default' || data.musicId）。
  assert.equal(javaConstant(dataJava, 'LIST_ID_DEFAULT'), 'default')
  assert.equal(DATA_KEYS.playInfo, 'playInfo')
})

// ---------------------------------------------------------------------------
// JS 侧接线检查：桥 + "按 Java 语义实现"的原生替身
// ---------------------------------------------------------------------------

/**
 * 原生侧替身，语义与 `RainMusicDataChannels.java` 对齐（每条旁边写清它抄的是 Java 的哪一段）：
 *
 * - **读通道**：没写过 store → resolve `null`；文本不是合法 JSON 对象 → `ok:false`（**不是** null）；
 *   键不存在 → `null`；参数不是非空字符串 → `ok:false`；
 * - **写通道**：`args=[{path, data}]`；首启从空 store 开始；读-改-写（别的键留着）；
 *   `data:null` 写成一个 JSON null（**不是**删键）；缺 `data` 字段 / 坏 JSON / `commit()` false → `ok:false`；
 *   成功与失败都**不广播**；
 * - **两种 kind**（P0-1 的 `RainMusicIpcPlugin.dispatch`）：`invoke` 会回应答；`send` 是**单向**的 ——
 *   handler 照样执行，但成功不回应答、异常只进 logcat（`runHandler` 的 `!expectsResponse` 分支）。
 *   写通道在渲染层就是 `send`，所以下面所有 `reject(...)` 都只有 invoke 才真的回给渲染层。
 */
const makeNativeData = (options = {}) => {
  /** store 文本（可变）。null = 从没写过（首启）。 */
  const state = { storeText: options.storeText ?? null }

  const native = {
    postCalls: [],
    addListenerCalls: 0,
    /** 原生 → 渲染层真正发出的消息条数（用来断言"单向 send 一条都不发"）。 */
    notifies: 0,
    /** 每次成功落盘后的整份文本（用来断言"失败时不落盘"）。 */
    writtenTexts: [],
    /** 收到过 send 的**未注册**通道名（P0-1 对这种情况只 warn，不回错 —— 写通道漏注册的真机形状）。 */
    unregisteredSends: [],
    /** 当前 store 文本（用来断言"坏数据没被覆盖"）。 */
    storeText: () => state.storeText,

    post(envelope) {
      native.postCalls.push(envelope)
      const kind = envelope.kind
      if (kind !== 'invoke' && kind !== 'send') return Promise.resolve({ accepted: true })

      const { id, channel } = envelope
      // P0-1：`send` 是单向的 ⇒ 只有 invoke 才把结果/错误回给渲染层（见上面替身说明的第三条）。
      const accept = payload => {
        if (kind !== 'invoke') return
        native.notify({ id, kind: 'response', channel, ok: true, result: payload })
      }
      const reject = (code, message) => {
        if (kind !== 'invoke') return
        native.notify({ id, kind: 'response', channel, ok: false, error: { code, message } })
      }

      if (channel !== EXPECTED_CHANNEL && channel !== EXPECTED_SAVE_CHANNEL) {
        // 未注册：invoke 立刻 IPC_CHANNEL_UNSUPPORTED（插件 dispatch）；send **只 warn**。
        native.unregisteredSends.push(channel)
        reject('IPC_CHANNEL_UNSUPPORTED', '原生侧还没有注册通道：' + channel)
        return Promise.resolve({ accepted: true })
      }

      if (channel === EXPECTED_SAVE_CHANNEL) {
        native.handleSave(envelope.args, reject, accept)
        return Promise.resolve({ accepted: true })
      }

      native.handleGet(envelope.args, reject, accept)
      return Promise.resolve({ accepted: true })
    },

    /** 读通道（Java `getData`）。 */
    handleGet(args, reject, accept) {
      const arg = Array.isArray(args) ? args[0] : undefined
      if (typeof arg !== 'string' || arg === '') {
        // Java: IllegalArgumentException（参数缺失 / 不是非空字符串）。
        reject('IPC_HANDLER_FAILED', `${EXPECTED_CHANNEL} 需要一个字符串参数 path`)
        return
      }

      if (state.storeText == null) {
        // Java: Preferences 里还没有 rain:store:data（首启）→ null。
        accept(null)
        return
      }

      let store
      try {
        store = JSON.parse(state.storeText)
        if (store === null || typeof store !== 'object' || Array.isArray(store)) throw new Error('not an object')
      } catch (error) {
        // Java: IllegalStateException("… 里的文本不是合法的 JSON 对象 …") → ok:false，且**不覆盖**。
        reject('IPC_HANDLER_FAILED', `${EXPECTED_STORE_KEY} 里的文本不是合法的 JSON 对象：${error.message}`)
        return
      }

      accept(Object.hasOwn(store, arg) ? store[arg] : null)
    },

    /** 写通道（Java `saveData`）。 */
    handleSave(args, reject, accept) {
      // 传输层是 JSON：`{data: undefined}` 在信封里会让 `data` 这个字段**整个消失**（真机也一样）
      // ⇒ 先过一遍 JSON，替身才和真机的可观察行为同形。
      const raw = Array.isArray(args) ? args[0] : undefined
      if (raw == null) {
        // Java: readSavePayload → IllegalArgumentException（"需要一个 {path, data} 对象参数"）。
        reject('IPC_HANDLER_FAILED', `${EXPECTED_SAVE_CHANNEL} 需要一个 {path, data} 对象参数`)
        return
      }
      const payload = JSON.parse(JSON.stringify(raw))
      if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
        // Java: readSavePayload → IllegalArgumentException（"参数必须是对象"）。
        reject('IPC_HANDLER_FAILED', `${EXPECTED_SAVE_CHANNEL} 的参数必须是对象`)
        return
      }
      if (typeof payload.path !== 'string' || payload.path === '') {
        // Java: requirePath → IllegalArgumentException（缺 path / 不是字符串 / 空串）。
        reject('IPC_HANDLER_FAILED', `${EXPECTED_SAVE_CHANNEL} 的 \`path\` 必须是非空字符串`)
        return
      }
      if (!Object.hasOwn(payload, 'data')) {
        // Java: `!payload.has(FIELD_DATA)` → IllegalArgumentException。
        // {path} 与 {path, data:null} 不是一回事（见类注释「写通道 3」）。
        reject('IPC_HANDLER_FAILED', `${EXPECTED_SAVE_CHANNEL} 的参数缺少 \`data\` 字段`)
        return
      }

      // Java: text == null ? {} : parseStoreText(text) —— 首启从空 store 开始，坏了就抛（**不覆盖**）。
      let store = {}
      if (state.storeText != null) {
        try {
          store = JSON.parse(state.storeText)
          if (store === null || typeof store !== 'object' || Array.isArray(store)) throw new Error('not an object')
        } catch (error) {
          reject('IPC_HANDLER_FAILED', `${EXPECTED_STORE_KEY} 里的文本不是合法的 JSON 对象：${error.message}`)
          return
        }
      }

      if (options.failWrite) {
        // Java: `!prefs.edit()…commit()` → IllegalStateException（**不落盘、不假装成功**）。
        reject('IPC_HANDLER_FAILED', `写入 ${EXPECTED_STORE_KEY} 失败：SharedPreferences.commit() 返回 false`)
        return
      }

      // Java: store.put(path, jsonValue(data)) —— JSON null 必须存成 null，而不是把键删掉。
      store[payload.path] = payload.data
      state.storeText = JSON.stringify(store)
      native.writtenTexts.push(state.storeText)
      // 契约 :198 是 `void`，桌面 data.ts:30-33 **一个事件都不发** ⇒ 这里什么都不广播。
      accept(null)
    },

    addListener(eventName, listener) {
      native.addListenerCalls++
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
  const native = makeNativeData(options)
  const mod = load(BRIDGE_MODULE, {}, {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native, timeoutMs: 15000 },
  })
  return { mod, native }
}

test('契约形状：rendererInvoke(channel, path) ⇒ args=[path]（且是字符串，不是 [null]）', async() => {
  const { mod, native } = setup({ storeText: JSON.stringify({ [DATA_KEYS.viewPrevState]: { name: 'list' } }) })

  const value = await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.viewPrevState)

  assert.equal(native.postCalls[0].channel, EXPECTED_CHANNEL)
  assert.equal(native.postCalls[0].kind, 'invoke')
  // ⚠️ 用 JSON.stringify 比较：`args` 是 vm 上下文里造的数组，跨 realm 的 deepStrictEqual 会因为
  // 原型不同而假失败（第一刀的用例同样绕开了这一点）。
  assert.equal(JSON.stringify(native.postCalls[0].args), JSON.stringify([DATA_KEYS.viewPrevState]))
  assert.equal(typeof native.postCalls[0].args[0], 'string', 'args[0] 必须是字符串（Java 侧会拒绝非字符串）')
  assert.equal(JSON.stringify(value), JSON.stringify({ name: 'list' }))
})

test('首次启动（还没有任何写入方）：resolve 成 null，**不** reject（不误触发兜底之外的失败路径）', async() => {
  const { mod } = setup()
  const value = await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.playInfo)
  assert.equal(value, null)
})

test('键存在但没写过这一个键：同样是 null（"空"就是"空"，不是错误）', async() => {
  const { mod } = setup({ storeText: JSON.stringify({ [DATA_KEYS.searchSetting]: { source: 'tx' } }) })
  assert.equal(await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.listPrevSelectId), null)
  assert.deepEqual(await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.searchSetting), { source: 'tx' })
})

test('存储坏了：调用方拿到 reject（ok:false），**绝不** resolve 成 null 假装"没有数据"', async() => {
  const { mod } = setup({ storeText: '{ 这不是 JSON' })

  const error = await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.viewPrevState).then(
    () => { throw new Error('不应该 resolve：坏数据必须 reject，否则"坏了"会被伪装成"空的"') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /不是合法的 JSON 对象/)
  assert.equal(error.channel, EXPECTED_CHANNEL)
})

test('参数缺失 / 传 null：大声失败（ok:false），而不是静默返回 null', async() => {
  const { mod } = setup({ storeText: '{}' })

  for (const call of [() => mod.bridge.invoke(EXPECTED_CHANNEL), () => mod.bridge.invoke(EXPECTED_CHANNEL, null)]) {
    const error = await call().then(
      () => { throw new Error('不应该 resolve：参数不对必须 reject') },
      err => err,
    )
    assert.equal(error.code, 'IPC_HANDLER_FAILED')
    assert.match(error.message, /需要一个字符串参数 path/)
  }
})

test('playInfo 走的是同一条读路径（原样返回），没有被 JS 侧特判', async() => {
  const stored = { listId: 'default', index: 7, musicId: 'x', musicName: 'n', musicSinger: 's' }
  const { mod, native } = setup({ storeText: JSON.stringify({ [DATA_KEYS.playInfo]: stored }) })

  assert.deepEqual(await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.playInfo), stored)
  // 只发了一次 invoke，没有"校正"用的第二条通道（Android 侧没有可用的 dbService）。
  assert.equal(native.postCalls.length, 1)
  assert.equal(native.postCalls[0].channel, EXPECTED_CHANNEL)
})

// ---------------------------------------------------------------------------
// 写通道（第三刀）的 JS 侧接线检查
// ---------------------------------------------------------------------------

test('写通道在渲染层是**单向 send**：信封是 [{path, data}]，不回应答、不广播', async() => {
  const { mod, native } = setup()
  const events = []
  mod.bridge.on(EXPECTED_ON_CONFIG_CHANGE, payload => events.push(payload))
  mod.bridge.on(EXPECTED_SAVE_CHANNEL, payload => events.push(payload))

  const data = { listId: 'default', index: 3, musicId: 'x' }
  mod.bridge.send(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.playInfo, data })
  await Promise.resolve()

  const call = native.postCalls[0]
  assert.equal(call.kind, 'send', '契约 :198 的 9 处封装全是 rendererSend ⇒ kind 必须是 send（不是 invoke）')
  assert.equal(call.channel, EXPECTED_SAVE_CHANNEL)
  assert.equal(
    JSON.stringify(call.args),
    JSON.stringify([{ path: DATA_KEYS.playInfo, data }]),
    'args 必须是 [{path, data}] —— 写成 [path, data] 会让 Java 把字符串当对象，真机上每条 save 都失败',
  )
  assert.deepEqual(events, [], '写通道不广播任何事件（尤其不广播 winMain_on_config_change）')
  assert.equal(native.notifies, 0, '单向 send 一条应答都不该收到（P0-1 对 send 不回应答）')
  assert.equal(native.writtenTexts.length, 1, 'send 也要真的落盘（handler 在 P0-1 里照样执行）')
  assert.equal(native.storeText(), JSON.stringify({ [DATA_KEYS.playInfo]: data }), '首启从空 store 开始写')
})

test('写通道的读-改-写不丢别的键，且 JSON null 是"值"而不是"删键"（两条通道共用同一个 key）', async() => {
  const before = { [DATA_KEYS.viewPrevState]: { name: 'list' }, [DATA_KEYS.listPrevSelectId]: null }
  const { mod, native } = setup({ storeText: JSON.stringify(before) })

  await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.searchSetting, data: { source: 'tx' } })
  assert.equal(
    JSON.stringify(JSON.parse(native.storeText())),
    JSON.stringify({ ...before, [DATA_KEYS.searchSetting]: { source: 'tx' } }),
    '写一个键不能把别的键丢掉（桌面的 Store.set 也是改整份对象再落盘）',
  )

  // 显式 null：Java 用 jsonValue() 存成 JSONObject.NULL —— 键必须**还在**（org.json 的 put(name,null) 会删键）。
  await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.listPrevSelectId, data: null })
  const after = JSON.parse(native.storeText())
  assert.ok(Object.hasOwn(after, DATA_KEYS.listPrevSelectId), 'data:null 必须写成 JSON null，不能把键删掉')
  assert.equal(after[DATA_KEYS.listPrevSelectId], null)

  // 写完立刻读：同一个 key、同一条链（SharedPreferences 是进程级单实例 + commit 先更新内存）。
  assert.deepEqual(await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.searchSetting), { source: 'tx' })
  assert.equal(await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.listPrevSelectId), null)
})

test('写通道首启（还没有任何写入方）：从空 store 开始写，而不是失败', async() => {
  const { mod, native } = setup()
  assert.equal(native.storeText(), null, '前提取自"从没写过"')

  await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.viewPrevState, data: { name: 'list' } })

  assert.equal(native.storeText(), JSON.stringify({ [DATA_KEYS.viewPrevState]: { name: 'list' } }))
  // 这一条正是第三刀存在的理由：第二刀落地后首装只能读到 null。
  assert.deepEqual(await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.viewPrevState), { name: 'list' })
})

test('写通道遇到坏数据：ok:false 且**原样留着**（绝不"从空 store 重建"把用户数据抹掉）', async() => {
  const broken = '{ 这不是 JSON'
  const { mod, native } = setup({ storeText: broken })

  const error = await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.playInfo, data: {} }).then(
    () => { throw new Error('不应该 resolve：坏数据必须 reject') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /不是合法的 JSON 对象/)
  assert.equal(error.channel, EXPECTED_SAVE_CHANNEL)
  assert.equal(native.storeText(), broken, '坏数据必须原样留着（Android 侧没有 .bak 留底，覆盖就是无备份丢数据）')
  assert.deepEqual(native.writtenTexts, [], '坏数据上不该留下任何"写过"的痕迹')
})

test('写通道写失败（commit() 返回 false）：ok:false，且没有落盘、没有广播', async() => {
  const before = JSON.stringify({ [DATA_KEYS.viewPrevState]: { name: 'a' } })
  const { mod, native } = setup({ storeText: before, failWrite: true })

  const events = []
  mod.bridge.on(EXPECTED_ON_CONFIG_CHANGE, payload => events.push(payload))

  const error = await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.viewPrevState, data: { name: 'b' } }).then(
    () => { throw new Error('不应该 resolve：写失败必须 reject') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /commit\(\) 返回 false/)
  assert.equal(native.storeText(), before, '没落盘就不能改变存储')
  assert.deepEqual(native.writtenTexts, [])
  assert.deepEqual(events, [], '写失败更不该广播')
})

test('写通道参数不对：不是对象 / 缺 path / 缺 data 字段 ⇒ ok:false（不猜、不静默写错）', async() => {
  const cases = [
    [[], /需要一个 \{path, data\} 对象参数/],
    [['playInfo'], /参数必须是对象/],
    [[{ data: {} }], /`path` 必须是非空字符串/],
    [[{ path: DATA_KEYS.playInfo }], /缺少 `data` 字段/],
  ]

  for (const [args, pattern] of cases) {
    const { mod, native } = setup({ storeText: '{}' })
    const error = await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, ...args).then(
      () => { throw new Error(`不应该 resolve：${JSON.stringify(args)} 参数不对必须 reject`) },
      err => err,
    )
    assert.equal(error.code, 'IPC_HANDLER_FAILED')
    assert.match(error.message, pattern)
    assert.deepEqual(native.writtenTexts, [], '参数不对时一个字节都不该写')
  }
})

test('写 playInfo：不触发任何广播（桌面也不广播；恢复收尾在 Android 上没有落点）', async() => {
  const { mod, native } = setup()
  const events = []
  mod.bridge.on(EXPECTED_ON_CONFIG_CHANGE, payload => events.push(payload))

  await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL, {
    path: DATA_KEYS.playInfo,
    data: { listId: 'default', index: 1, musicId: 'x', musicName: 'n', musicSinger: 's' },
  })

  assert.deepEqual(events, [])
  assert.equal(native.writtenTexts.length, 1, '但该写的还是要写下去')
})

test('写通道漏注册在真机上是**静默**的（send 到未注册通道只有 logcat）—— 所以注册断言才是命门', async() => {
  const { mod, native } = setup()
  const events = []
  mod.bridge.on(EXPECTED_SAVE_CHANNEL, payload => events.push(payload))

  // 用一个"名字很像但没注册"的通道，模拟 CHANNEL_SAVE_DATA 写错一个字符 / register 被注释掉的形状。
  mod.bridge.send('winMain_save_data_NOT_REGISTERED', { path: DATA_KEYS.playInfo, data: {} })
  await Promise.resolve()

  assert.deepEqual(native.unregisteredSends, ['winMain_save_data_NOT_REGISTERED'])
  assert.equal(native.notifies, 0, 'send 到未注册通道：P0-1 只 Logger.warn，渲染层什么都收不到')
  assert.deepEqual(events, [])
  assert.deepEqual(native.writtenTexts, [], '没写进去 —— 而渲染层不会知道')

  // 对照：invoke 到未注册通道会立刻拿到 IPC_CHANNEL_UNSUPPORTED（读通道就是这种形状）。
  const error = await mod.bridge.invoke(EXPECTED_SAVE_CHANNEL + '_NOT_REGISTERED', { path: 'x', data: 1 }).then(
    () => { throw new Error('不应该 resolve') },
    err => err,
  )
  assert.equal(error.code, 'IPC_CHANNEL_UNSUPPORTED')
})

test('两条通道互不串味：读信封是 [path]（字符串），写信封是 [{path, data}]（对象）', async() => {
  const { mod, native } = setup({ storeText: JSON.stringify({ [DATA_KEYS.viewPrevState]: { name: 'list' } }) })

  await mod.bridge.invoke(EXPECTED_CHANNEL, DATA_KEYS.viewPrevState)
  mod.bridge.send(EXPECTED_SAVE_CHANNEL, { path: DATA_KEYS.viewPrevState, data: { name: 'other' } })
  await Promise.resolve()

  assert.equal(native.postCalls.length, 2)
  assert.equal(native.postCalls[0].channel, EXPECTED_CHANNEL)
  assert.equal(JSON.stringify(native.postCalls[0].args), JSON.stringify([DATA_KEYS.viewPrevState]))
  assert.equal(native.postCalls[1].channel, EXPECTED_SAVE_CHANNEL)
  assert.equal(
    JSON.stringify(native.postCalls[1].args),
    JSON.stringify([{ path: DATA_KEYS.viewPrevState, data: { name: 'other' } }]),
  )
  assert.notEqual(EXPECTED_CHANNEL, EXPECTED_SAVE_CHANNEL, '两条通道名不能相同')
})
