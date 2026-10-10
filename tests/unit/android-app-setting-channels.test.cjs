/**
 * Android 移植 · **P0-2 第一刀（设置通道）** 的契约 / 接线回归网。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：本机没有 Android SDK（`docs/android-port-plan.md` §0），
 * 它**不执行任何 Java** —— 所以它**不能**证明 `common_get_app_setting` /
 * `common_set_app_setting` 在真机上不再是 `IPC_CHANNEL_UNSUPPORTED`。
 * 那件事只能由 CI 的 `gradlew assembleDebug`（编译）→ 真机运行（行为）来证明。
 *
 * 它守的是三类**本机可测、且一旦写错在真机上完全静默**的接线错误：
 *
 * 1. Java 里通道名的字面量必须等于 `src/common/ipcNames.ts` 生成的真实通道名
 *    （键名 `get_app_setting` + 模块前缀 `common`，见 `ipcNames.ts:171-176`）——
 *    错一个字符 ⇒ 真机上就是 `IPC_CHANNEL_UNSUPPORTED`，本机毫无感觉；
 * 2. 存储落点必须与阶段 2b 一致：key = `'rain:store:' + STORE_NAMES.APP_SETTINGS`
 *    （`src/main/platform/storage/adapter.android.ts:95` + `src/common/constants.ts:9`），
 *    且 SharedPreferences 文件名 = `@capacitor/preferences` 的默认 group（P0-3 接线靠它对齐）；
 * 3. 注册**真的被调用**：`RainMusicIpcPlugin.load()` 里调
 *    `RainMusicAppSettingChannels.register(this)`，且 `MainActivity` 仍把插件注册在
 *    `super.onCreate()` **之前**（P0-1 踩过一次"漏提交 ⇒ 真机静默失效"）。
 *
 * 最后一组用例用 JS 侧的桥 + 一个**按 Java 语义实现**的原生替身，锁住这条链在 JS 侧的可观察行为
 * （首次启动不 reject、只广播真的变了的 key、写失败会 reject）。
 * 它是接线检查，**不是** Java 行为验证 —— 替身与 Java 一旦漂移，这组用例不会变红。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const BRIDGE_MODULE = 'src/common/platform/ipcBridge/capacitor.js'
const JAVA_DIR = path.join(__dirname, '../../android/app/src/main/java/com/rainmusic/mobile')
const readJava = relative => fs.readFileSync(path.join(JAVA_DIR, relative), 'utf8')

const channelsJava = readJava('ipc/RainMusicAppSettingChannels.java')
const pluginJava = readJava('ipc/RainMusicIpcPlugin.java')
const activityJava = readJava('MainActivity.java')

/**
 * 去掉注释再匹配。
 *
 * 必须这么做的理由（本用例第一次写就踩了）：`MainActivity.java` 的**类注释**里就写着
 * "registerPlugin(...) 必须在 super.onCreate() 之前"，于是 `indexOf('super.onCreate(')`
 * 会命中注释、把顺序判反 —— 这是"检查代码"的用例里最典型的一类假失败/假通过。
 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 读 Java 里的字符串常量字面量（`static final String X = "…";`）。 */
const javaConstant = (source, name) => {
  const match = source.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]*)"`))
  assert.ok(match, `Java 里找不到常量 ${name}（读法：static final String ${name} = "…"）`)
  return match[1]
}

const { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } = load('src/common/ipcNames.ts', {}, {})
const { STORE_NAMES } = load('src/common/constants.ts', {}, {})

const EXPECTED_GET = CMMON_EVENT_NAME.get_app_setting
const EXPECTED_SET = CMMON_EVENT_NAME.set_app_setting
const EXPECTED_ON_CONFIG_CHANGE = WIN_MAIN_RENDERER_EVENT_NAME.on_config_change
const EXPECTED_STORE_KEY = `rain:store:${STORE_NAMES.APP_SETTINGS}`

test('通道名字面量必须等于 ipcNames.ts 生成的真实通道名（写错就是真机 IPC_CHANNEL_UNSUPPORTED）', () => {
  assert.equal(EXPECTED_GET, 'common_get_app_setting', 'ipcNames.ts 的真实值变了？')
  assert.equal(EXPECTED_SET, 'common_set_app_setting')
  assert.equal(EXPECTED_ON_CONFIG_CHANGE, 'winMain_on_config_change')

  assert.equal(javaConstant(channelsJava, 'CHANNEL_GET'), EXPECTED_GET)
  assert.equal(javaConstant(channelsJava, 'CHANNEL_SET'), EXPECTED_SET)
  assert.equal(javaConstant(channelsJava, 'CHANNEL_ON_CONFIG_CHANGE'), EXPECTED_ON_CONFIG_CHANGE)

  // 常量算出来了还要真的拿去注册 —— 覆盖掉常量但忘了 register 的话，真机上依然是"未注册"。
  // ⚠️ 与下面那条一样**必须去掉注释再匹配**（同一个假通过类：把这两行注释掉，用整份源码匹配依然通过）。
  const channelsCode = stripJavaComments(channelsJava)
  assert.match(channelsCode, /register\(\s*CHANNEL_GET\s*,/)
  assert.match(channelsCode, /register\(\s*CHANNEL_SET\s*,/)
})

test('这一刀只注册两条通道（范围守卫：顺手做别的通道会在本用例变红）', () => {
  // ⚠️ 数注册也要去注释：把 register(...) 整行注释掉之后，数整份源码会**依然得到 2**（注释里就有）。
  const registrations = stripJavaComments(channelsJava).match(/RainMusicIpcHandlers\.register\(/g) ?? []
  assert.equal(registrations.length, 2, '本文件只应注册 common_get_app_setting / common_set_app_setting')

  // P0-1 的插件里不应该出现设置通道的"就地实现"（实现必须都在本文件里）。
  assert.doesNotMatch(stripJavaComments(pluginJava), /RainMusicIpcHandlers\.register\(/)
})

test('存储落点必须与阶段 2b 一致：key = rain:store:config_v2，prefs 文件 = CapacitorStorage', () => {
  assert.equal(EXPECTED_STORE_KEY, 'rain:store:config_v2', '阶段 2b 的 key 规则变了？')
  assert.equal(javaConstant(channelsJava, 'STORE_KEY'), EXPECTED_STORE_KEY)
  // 文件名的依据是 @capacitor/preferences 的默认 group（PreferencesConfiguration.DEFAULTS.group）：
  // 那个插件的 Android 实现就是 getSharedPreferences(group, MODE_PRIVATE) 且键名不加前缀，
  // 所以 P0-3 用默认 group 接 adapter.android.ts 时两边读写同一份数据。
  assert.equal(javaConstant(channelsJava, 'PREFERENCES_FILE'), 'CapacitorStorage')
  assert.match(channelsJava, /@capacitor\/preferences/, '必须先说明"为什么是这个文件名"')
})

test('注册必须发生在 RainMusicIpcPlugin.load() 里；MainActivity 仍先 registerPlugin 再 super.onCreate()', () => {
  // ⚠️ 这里**必须**去掉注释再匹配：`RainMusicIpcPlugin.java` 的注释里就写着这一行，
  // 用整份源码匹配的话，把 `RainMusicAppSettingChannels.register(this);` 整行注释掉
  // **用例依然通过** —— 而那正是真机上 `IPC_CHANNEL_UNSUPPORTED` 的形状（漏注册不会静默，
  // 但"用例假绿"会让它一直漏到真机）。同一个坑第二刀在 `RainMusicDataChannels.register(this)`
  // 上已经踩过一次，写法照 `android-data-channels.test.cjs` 的 stripJavaComments。
  assert.match(
    stripJavaComments(pluginJava),
    /RainMusicAppSettingChannels\.register\(this\)/,
    'load() 里必须注册，否则真机 IPC_CHANNEL_UNSUPPORTED（注释掉不算）',
  )

  // 只看代码、不看注释（注释里就写着这句话，见 stripJavaComments 的说明）。
  const code = stripJavaComments(activityJava)
  const registerPlugin = code.indexOf('registerPlugin(RainMusicIpcPlugin.class)')
  const superOnCreate = code.indexOf('super.onCreate(')
  assert.ok(registerPlugin > -1 && superOnCreate > -1, 'MainActivity 的注册点/父类调用不见了')
  assert.ok(
    registerPlugin < superOnCreate,
    'registerPlugin 必须在 super.onCreate() 之前（P0-1 的这个坑会让真机静默失效）',
  )
})

// ---------------------------------------------------------------------------
// JS 侧接线检查：桥 + "按 Java 语义实现"的原生替身
// ---------------------------------------------------------------------------

/**
 * 原生侧替身，语义与 `RainMusicAppSettingChannels.java` 对齐：
 * 没写过 → 回 `{}`；写 → 只回"真的变了"的 key 的广播（无变化不广播）；写失败 → `ok:false`。
 * 广播**先于**应答发出，与 P0-1 的插件一致（handler 里先 `ctx.emitTo` 再返回）。
 */
const makeNativeSettings = (options = {}) => {
  let setting = options.initial ?? null
  const native = {
    postCalls: [],
    addListenerCalls: 0,
    writtenTexts: [],
    post(envelope) {
      native.postCalls.push(envelope)
      if (envelope.kind !== 'invoke') return Promise.resolve({ accepted: true })

      const { id, channel } = envelope
      const respond = (ok, payload) => native.notify(
        ok
          ? { id, kind: 'response', channel, ok: true, result: payload }
          : { id, kind: 'response', channel, ok: false, error: payload },
      )

      if (channel === EXPECTED_GET) {
        respond(true, setting == null ? {} : { ...setting })
        return Promise.resolve({ accepted: true })
      }
      if (channel === EXPECTED_SET) {
        if (options.failWrite) {
          respond(false, { code: 'IPC_HANDLER_FAILED', message: '写入 rain:store:config_v2 失败：commit() 返回 false' })
          return Promise.resolve({ accepted: true })
        }
        const patch = envelope.args[0] ?? {}
        const changed = {}
        for (const [key, value] of Object.entries(patch)) {
          if (!Object.is(setting?.[key], value)) changed[key] = value
        }
        if (Object.keys(changed).length === 0) {
          respond(true, null)
          return Promise.resolve({ accepted: true })
        }
        setting = { ...(setting ?? {}), ...changed }
        native.writtenTexts.push(JSON.stringify({ version: setting.version ?? '', setting }))
        native.notify({ kind: 'event', channel: EXPECTED_ON_CONFIG_CHANGE, args: [changed] })
        respond(true, null)
        return Promise.resolve({ accepted: true })
      }
      respond(false, { code: 'IPC_CHANNEL_UNSUPPORTED', message: '原生侧还没有注册通道：' + channel })
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
  const native = makeNativeSettings(options)
  const mod = load(BRIDGE_MODULE, {}, {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    __RAIN_CAPACITOR_IPC__: { plugin: native, timeoutMs: 15000 },
  })
  return { mod, native }
}

test('首次启动（还没写过）：common_get_app_setting resolve 成 {}，**不** reject（不误触发渲染层的降级兜底）', async() => {
  const { mod, native } = setup()
  const setting = await mod.bridge.invoke(EXPECTED_GET)

  assert.equal(JSON.stringify(setting), JSON.stringify({}))
  assert.equal(native.postCalls[0].channel, EXPECTED_GET)
  assert.equal(JSON.stringify(native.postCalls[0].args), JSON.stringify([]), '契约：这条 invoke 不带参数')
})

test('common_set_app_setting：只广播"真的变了"的 key，且广播先于应答到达渲染层', async() => {
  const { mod, native } = setup({ initial: { 'common.langId': null, 'player.volume': 1 } })

  const received = []
  const order = []
  mod.bridge.on(EXPECTED_ON_CONFIG_CHANGE, payload => {
    order.push('event')
    received.push(payload.params)
  })

  const result = await mod.bridge.invoke(EXPECTED_SET, { 'common.langId': 'zh-cn', 'player.volume': 1 }).then(value => {
    order.push('response')
    return value
  })

  assert.equal(result, null, '契约：→ void（桥交付 null）')
  assert.equal(JSON.stringify(received), JSON.stringify([{ 'common.langId': 'zh-cn' }]), '未变化的 key 不该进广播')
  assert.equal(JSON.stringify(order), JSON.stringify(['event', 'response']), '广播必须先于应答（与桌面一致）')

  // 再写一次同样的值：Java 侧不落盘、不广播（对齐 AppEvent.ts:38 的 `if (!updatedSettingKeys.length) return`）。
  await mod.bridge.invoke(EXPECTED_SET, { 'common.langId': 'zh-cn' })
  assert.equal(received.length, 1, '没有实际变化时不应广播')
  assert.equal(native.writtenTexts.length, 1, '没有实际变化时不应重复落盘')
})

test('写失败（commit() 返回 false）：调用方拿到 reject，且没有广播（不假装成功）', async() => {
  const { mod, native } = setup({ initial: { 'player.volume': 1 }, failWrite: true })

  const received = []
  mod.bridge.on(EXPECTED_ON_CONFIG_CHANGE, payload => received.push(payload.params))

  const error = await mod.bridge.invoke(EXPECTED_SET, { 'player.volume': 0.5 }).then(
    () => { throw new Error('不应该 resolve：写失败必须 reject') },
    err => err,
  )

  assert.equal(error.code, 'IPC_HANDLER_FAILED')
  assert.match(error.message, /commit\(\) 返回 false/)
  assert.equal(error.channel, EXPECTED_SET)
  assert.deepEqual(received, [], '落盘失败就不能广播变更')
  assert.deepEqual(native.writtenTexts, [], '落盘失败就不能留下"写过"的记录')
})
