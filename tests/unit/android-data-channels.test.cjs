/**
 * Android 移植 · **P0-2 第二刀（`winMain_get_data`）** 的契约 / 接线回归网。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**不执行任何 Java** —— 所以它**不能**证明 `winMain_get_data` 在真机上不再是
 * `IPC_CHANNEL_UNSUPPORTED`，也不能证明 SharedPreferences 真的读写成功。那两件事只能由
 * CI 的 `gradlew assembleDebug`（编译）→ 真机运行（行为）来证明。
 *
 * 它守的是一组**本机可测、且一旦写错在真机上完全静默**的接线错误：
 *
 * 1. Java 里通道名的字面量必须等于 `src/common/ipcNames.ts` 生成的真实通道名
 *    （键名 `get_data` + 模块前缀 `winMain`，见 `ipcNames.ts:171-176`）——
 *    错一个字符 ⇒ 真机上就是 `IPC_CHANNEL_UNSUPPORTED`，本机毫无感觉；
 * 2. 落点必须与阶段 2b 已落地的骨架一致：key = `'rain:store:' + STORE_NAMES.DATA`
 *    （`adapter.android.ts:95` + `src/common/constants.ts:10`），且 SharedPreferences 文件名
 *    与第一刀的设置通道**是同一个** `CapacitorStorage`（同一套 store 命名空间）；
 * 3. **本通道没有 SQL 落点，而且代码里不许假装有**：阶段 2a 的 `tables.ts` 一共 9 张表，
 *    没有任何 kv 表（唯一 kv 形状的 `db_info` 是"数据库 schema 版本"元数据表，
 *    `migrate.ts:86-103` / `db.ts:15` 专用）。这组用例把"表结构与 `tables.ts` 逐字一致"
 *    落成可执行的断言：**9 张表的名字一张不多一张不少**、`db_info` 的列没被挪用、
 *    Java 里一行 SQL / 一个 `android.database.sqlite` import 都没有。
 *    ⚠️ 如果将来线 A 真的给 renderer 的 data store 加了一张 kv 表，**这组用例会变红** ——
 *    那正是"本刀的落点判断该重新评审"的信号，不是误报；
 * 4. 注册**真的被调用**：`RainMusicIpcPlugin.load()` 里调 `RainMusicDataChannels.register(this)`，
 *    且 `MainActivity` 仍把插件注册在 `super.onCreate()` **之前**（P0-1 踩过一次
 *    "漏提交 ⇒ 真机静默失效"）；
 * 5. 范围守卫：本刀只注册 1 条通道（不碰 `save_data` / `player_list_*` / `dislike_*`）。
 *
 * 最后一组用例用 JS 侧的桥 + 一个**按 Java 语义实现**的原生替身，锁住这条链在 JS 侧的可观察行为
 * （首启返回 null 而不是 reject、坏文本 reject 而不是伪装成"空"、参数缺失大声失败）。
 * 它是接线检查，**不是** Java 行为验证 —— 替身与 Java 一旦漂移，这组用例不会变红。
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
const EXPECTED_STORE_KEY = `rain:store:${STORE_NAMES.DATA}`

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED）', () => {
  assert.equal(EXPECTED_CHANNEL, 'winMain_get_data', 'ipcNames.ts 的真实值变了？')
  assert.equal(javaConstant(dataJava, 'CHANNEL_GET_DATA'), EXPECTED_CHANNEL)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量但忘了 register 的话，真机上依然是"未注册"。
  assert.match(dataJava, /register\(\s*CHANNEL_GET_DATA\s*,/)
})

test('范围守卫：本刀只注册 1 条通道，且不在插件里就地实现', () => {
  const registrations = dataJava.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(registrations.length, 1, '本文件只应注册 winMain_get_data（save_data 是下一刀）')

  // 本刀不做这三组（任务书明确排除）。**必须看代码、不看注释** —— 类注释里就写着这三个名字
  // （用来登记"别的通道一条不做"），直接匹配源码会假失败。
  const dataCode = stripJavaComments(dataJava)
  for (const forbidden of ['RainMusicIpcHandlers.register("winMain_save_data"', 'player_list_', 'dislike_']) {
    assert.ok(!dataCode.includes(forbidden), `本刀不应出现 ${forbidden}`)
  }

  // P0-1 的插件里不应该出现"就地实现"（实现必须都在各自的通道文件里）。
  assert.doesNotMatch(pluginJava, /RainMusicIpcHandlers\.register\(/)

  // 两条通道文件合计 3 条：第一刀的 2 条 + 本刀的 1 条。
  const settingRegistrations = settingJava.match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(settingRegistrations.length, 2, '第一刀的设置通道不该被本刀改动')
  assert.equal(registrations.length + settingRegistrations.length, 3)
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
  for (const forbidden of [/\bdbService\s*[.(]/, /resolvePlaybackQueueRestoreIndex\s*\(/, /completePlaybackQueueRestore\s*\(/]) {
    assert.doesNotMatch(stripJavaComments(dataJava), forbidden, `不该调用 ${forbidden}（那是主进程的事）`)
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
// JS 侧接线检查：桥 + "按 Java 语义实现"的原生替身
// ---------------------------------------------------------------------------

/**
 * 原生侧替身，语义与 `RainMusicDataChannels.java` 对齐：
 * 没写过 store → resolve `null`；文本不是合法 JSON 对象 → `ok:false`（**不是** null）；
 * 键不存在 → `null`；参数不是非空字符串 → `ok:false`。
 */
const makeNativeData = (options = {}) => {
  const native = {
    postCalls: [],
    addListenerCalls: 0,
    post(envelope) {
      native.postCalls.push(envelope)
      if (envelope.kind !== 'invoke') return Promise.resolve({ accepted: true })

      const { id, channel } = envelope
      const respond = (ok, payload) => native.notify(
        ok
          ? { id, kind: 'response', channel, ok: true, result: payload }
          : { id, kind: 'response', channel, ok: false, error: payload },
      )

      if (channel !== EXPECTED_CHANNEL) {
        respond(false, { code: 'IPC_CHANNEL_UNSUPPORTED', message: '原生侧还没有注册通道：' + channel })
        return Promise.resolve({ accepted: true })
      }

      const arg = Array.isArray(envelope.args) ? envelope.args[0] : undefined
      if (typeof arg !== 'string' || arg === '') {
        // Java: IllegalArgumentException（参数缺失 / 不是非空字符串）。
        respond(false, { code: 'IPC_HANDLER_FAILED', message: `${EXPECTED_CHANNEL} 需要一个字符串参数 path` })
        return Promise.resolve({ accepted: true })
      }

      if (options.storeText == null) {
        // Java: Preferences 里还没有 rain:store:data（首启）→ null。
        respond(true, null)
        return Promise.resolve({ accepted: true })
      }

      let store
      try {
        store = JSON.parse(options.storeText)
        if (store === null || typeof store !== 'object' || Array.isArray(store)) throw new Error('not an object')
      } catch (error) {
        // Java: IllegalStateException("… 里的文本不是合法的 JSON 对象 …") → ok:false，且**不覆盖**。
        respond(false, {
          code: 'IPC_HANDLER_FAILED',
          message: `${EXPECTED_STORE_KEY} 里的文本不是合法的 JSON 对象：${error.message}`,
        })
        return Promise.resolve({ accepted: true })
      }

      respond(true, Object.hasOwn(store, arg) ? store[arg] : null)
      return Promise.resolve({ accepted: true })
    },
    addListener(eventName, listener) {
      native.addListenerCalls++
      if (eventName === 'ipcMessage') native.listener = listener
      return { remove: () => { native.listener = null } }
    },
    notify(payload) {
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
