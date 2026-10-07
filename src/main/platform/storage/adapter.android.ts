/**
 * Rain Music Android 移植 · 阶段 2 / 线 B：**Android（Capacitor）骨架 —— 本轮不接入，只留接口与接入点**
 *
 * ## 为什么是骨架而不是实现
 *
 * 本机没有 Android SDK / 模拟器 / 真机（`docs/android-port-plan.md:8-17` 已确认），
 * 而本轮验收门全部是桌面端的（lint / tsc / 单测 / 打包 / Electron UI 回归）。
 * 写一份**无法验证**的 Capacitor 代码只会把"看起来做完了"变成"其实没人跑过"。
 * 因此本文件只做三件事：
 *
 * 1. 用与 `electron.ts` **完全相同的导出签名**实现 `IStorePlatformAdapter` / `IFileAdapter`，
 *    这样构建期把 `@main/platform/storage/adapter` 指到本文件时，类型检查会立刻暴露缺口。
 * 2. 把每个方法对应的 Capacitor API、以及**行为差异**写清楚（见每个方法的注释）。
 * 3. 标出必须在阶段 3+ 真机验证的点。
 *
 * ## 真实接入时必须先决定的一件事：同步 vs 异步
 *
 * `IStore.set()` 的桌面实现是**同步**的，而 `@capacitor/preferences.set()` 与
 * `@capacitor/filesystem.writeFile()` 都是**异步**的，无法伪装成同步。
 * 本骨架采用的方案（**推荐方案，待真机验证**）：
 *
 * ```
 * 启动期（async）: hydrateStorage() 把所有 store 快照读进 Map
 * 运行期（sync） : loadSync() 直接读 Map  —— 于是 getStore() 仍然是同步的
 * 写入（async）  : saveSync() 把文本推给一个串行化的写队列（不阻塞）
 *                 save()     await 该次写入完成
 * ```
 *
 * 这样做的好处：`globa.rain.appSetting` 这类"启动期同步读"的既有结构不用改；
 * `src/main/utils/index.ts:132` 的 `override()` 调用点可以保持同步。
 *
 * ⚠️ **未验证的假设**（阶段 3 必须实测）：
 * - `Preferences.set()` 的写入持久性/跨重启可见性；
 * - 应用被系统杀掉时，未 flush 的写队列会丢多少次写入（桌面是同步落盘，绝不会丢）；
 * - `Preferences` 在 Android 上底层是 `SharedPreferences`（**全量重写整个 XML**），
 *   单个 key 存一整个 store 的 JSON 会不会有明显开销（`user_api.json` 里含压缩后的脚本）。
 *
 * ## 另一个必须真机验证的点：`Preferences` 与 `Filesystem` 的取舍
 *
 * 契约 §4.3（`docs/android/ipc-contract.md:515-523`）对 `winMain_get_data` / 音效预设的
 * 建议是 `@capacitor/preferences`。本骨架按此执行，但**主题图片**必须走
 * `@capacitor/filesystem`（Preferences 不能存大二进制）。
 *
 * ## 接入点清单（阶段 3 照着改）
 *
 * 1. 装依赖：`@capacitor/preferences`、`@capacitor/filesystem`（见 `capacitor.config.ts` 现有配置）。
 * 2. 实现下面全部 `throw new Error('...not implemented...')` 的方法体。
 * 3. 在应用启动期（`src/main/app.ts` 的 `app_inited` 之前，或 Capacitor 侧的 bootstrap）
 *    `await hydrateStorage()`。
 * 4. 构建期把入口指到本文件：`build-config/main/webpack.config.base.js` 的 `resolve.alias` 加
 *    `'@main/platform/storage/adapter$': path.join(__dirname, '../../src/main/platform/storage/adapter.android.ts')`
 *    （与 `docs/android/ipc-contract.md:682` 给渲染层的 `@platform` 别名是同一手法：
 *    必须构建期替换，否则 webpack 会把 `electron` 打进 Android bundle，直接构建失败）。
 * 5. 把调用点的 `set()` 改成 `await setAsync()`（桌面同步、Android 异步，见 `IStore` 注释）。
 */

import type { IFileAdapter, IStorePlatformAdapter, IThemeFileAdapter, StoreDescriptor } from '@common/storage/types'
import { createGetStore, type Store } from './core'

/**
 * 启动期预加载的 store 文本快照。
 *
 * key 用 `desc.path`（Android 上是逻辑标识，例如 `RainDatas/config_v2.json`）。
 * 之所以要有这份缓存：`getStore()` / `Store.get()` 是**同步** API，而 Capacitor 的存储全是异步，
 * 只能"启动期异步预热 + 运行期同步读缓存"。
 */
const snapshot = new Map<string, string>()

/** 写入队列：保证同一 store 的多次写按调用顺序落盘（桌面版靠同步写天然有序） */
const pendingWrites = new Map<string, Promise<void>>()

/** 是否已经完成 `hydrateStorage()`；未完成时同步读会拿到空内容，属于用法错误 */
let hydrated = false

/**
 * **启动期必须 await 一次**。把全部 store 从 Preferences 读进内存快照。
 *
 * 接入示意（伪代码，阶段 3 落地）：
 * ```ts
 * import { Preferences } from '@capacitor/preferences'
 * export const hydrateStorage = async(names: string[]) => {
 *   for (const name of names) {
 *     const { value } = await Preferences.get({ key: `store:${name}` })
 *     if (value != null) snapshot.set(name, value)
 *   }
 *   hydrated = true
 * }
 * ```
 */
export const hydrateStorage = async(): Promise<void> => {
  throw new Error('[android storage] hydrateStorage 未实现：阶段 3 接入 @capacitor/preferences')
}

/** 具体落点：Preferences 的 key 前缀。与 SQLite 表名区分开，避免撞名 */
const preferencesKey = (desc: StoreDescriptor) => `rain:store:${desc.name}`

/**
 * Android 侧 `IStorePlatformAdapter`。
 *
 * 关键差异（相对桌面）逐条标注在方法上。
 */
export const androidStoreAdapter: IStorePlatformAdapter = {
  kind: 'capacitor',
  /**
   * Android 上"文件是否存在"= "Preferences 里有没有这个 key"。
   * Capacitor Preferences **没有**同步查询 API → 只能查预热好的内存快照。
   */
  hasSyncLoad: false,

  existsSync(desc: StoreDescriptor): boolean {
    return snapshot.has(preferencesKey(desc))
  },

  loadSync(desc: StoreDescriptor): string {
    // 预热完成前读会拿到空串 —— 上游 `parseStore()` 会把它当"没有文件"处理（等价 `store = {}`）。
    // 这比抛错更安全：Android 首版不应因为启动顺序问题直接崩。
    // ⚠️ 但这意味着"启动期同步读"必须在 hydrateStorage() 之后，见文件头接入点 3。
    if (!hydrated) {
      console.warn('[android storage] loadSync called before hydrateStorage(); store will start empty', desc.name)
    }
    return snapshot.get(preferencesKey(desc)) ?? ''
  },

  async load(desc: StoreDescriptor): Promise<string> {
    // 阶段 3：
    //   const { value } = await Preferences.get({ key: preferencesKey(desc) })
    //   return value ?? ''
    throw new Error('[android storage] androidStoreAdapter.load 未实现')
  },

  saveSync(desc: StoreDescriptor, text: string): void {
    // 同步写不可能：Capacitor 全是异步。
    // 这里更新内存快照（后续同步 get() 立刻可见），并把落盘丢进串行队列。
    snapshot.set(preferencesKey(desc), text)
    void enqueueWrite(preferencesKey(desc), text)
  },

  async save(desc: StoreDescriptor, text: string): Promise<void> {
    snapshot.set(preferencesKey(desc), text)
    const task = enqueueWrite(preferencesKey(desc), text)
    await task
  },

  backupSync(desc: StoreDescriptor): Error | null {
    // 桌面这里做的是 `fs.renameSync(x, x + '.bak')`，用于"JSON 解析失败后不丢用户数据"。
    //
    // Android 侧**没有等价需求**：Preferences 里存的是字符串，读回来永远是合法文本，
    // 不存在"文件被写坏导致 JSON.parse 失败"这一类损坏态。
    // 因此这里是有意的空实现 —— 不是漏做。
    //
    // ⚠️ 待确认：若最终选择"store 落在 Filesystem 的 JSON 文件里"（而不是 Preferences），
    // 那么损坏态会重新出现，这里必须实现为 `Filesystem.rename(path -> path + '.bak')`。
    void desc
    return null
  },
}

/**
 * 串行化写队列。
 *
 * 为什么必须串行：桌面版 `Store.set()` 是同步写，**调用顺序 == 落盘顺序**。
 * 若 Android 侧并发 `Preferences.set()`，同一 store 的两次写可能乱序落地，
 * 从而回退到旧数据（Preferences 本身不保证跨调用的顺序）。
 */
const enqueueWrite = async(key: string, text: string): Promise<void> => {
  const previous = pendingWrites.get(key) ?? Promise.resolve()
  const next = previous.then(async() => {
    // 阶段 3：
    //   await Preferences.set({ key, value: text })
    throw new Error(`[android storage] Preferences.set 未实现（key=${key}，len=${text.length}）`)
  })
  // 队列本身不能被 rejection 污染：失败只记日志，保留后续写入能力
  pendingWrites.set(key, next.catch(() => {}))
  return next
}

/**
 * 等待全部待落盘写入完成。
 *
 * **必须在应用进入后台/即将被杀时 await 一次**（对应桌面版的"同步落盘永不丢"）。
 * 接入点：Capacitor `App.addListener('appStateChange')` / `pause`。
 */
export const flushStorage = async(): Promise<void> => {
  await Promise.all(pendingWrites.values())
}

/**
 * Android 侧「配置文件」读写。
 *
 * ⚠️ 这里与 `electronConfigFiles` **语义不同**：桌面这份实现只用于
 * v2.0.0 之前旧数据目录的一次性迁移（`src/main/utils/migrate.ts:11-21,78-115`）。
 * Android 是全新安装，**不存在旧 Electron 数据目录**，因此：
 * - `readJsonOrNull` 永远返回 `null`（没有可迁移的数据）
 * - `writeText` 仍然要真实现（`migrateDataJson()` 会往新目录写 `data.json`）
 * - `copyIfMissing` 可以退化为空操作
 */
export const androidConfigFiles: IFileAdapter = {
  async exists(absPath) {
    // 阶段 3：`const stat = await Filesystem.stat({ path: absPath, directory: Directory.Data })`
    throw new Error('[android storage] androidConfigFiles.exists 未实现')
  },
  async readText(absPath) {
    // 阶段 3：`const { data } = await Filesystem.readFile({ path: absPath, directory: Directory.Data, encoding: Encoding.UTF8 })`
    throw new Error(`[android storage] androidConfigFiles.readText 未实现（${absPath}）`)
  },
  async readJsonOrNull<T>(absPath: string): Promise<T | null> {
    // 建议直接 `return null`（Android 无旧数据可迁移）—— 但需先与产品确认
    // "从桌面版导入设置"这个功能是否要保留；若要保留，这里改成读用户通过 SAF 选中的文件。
    void absPath
    return null
  },
  async writeText(absPath, text) {
    // 阶段 3：`await Filesystem.writeFile({ path: absPath, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })`
    void absPath
    void text
    throw new Error('[android storage] androidConfigFiles.writeText 未实现')
  },
  async copyIfMissing(fromAbsPath, toAbsPath) {
    // Android 无旧数据目录 → 有意空实现
    void fromAbsPath
    void toAbsPath
  },
}

/**
 * Android 侧「主题图片」读写 —— 契约 §4.3 把 `winMain_get_themes` 标为 **C 类需降级**
 * （`docs/android/ipc-contract.md:517`）。
 *
 * 现状（桌面）：主进程只**给路径**（`src/main/utils/index.ts:219` 的
 * `dataPath = joinPath(global.rainDataPath, 'theme_images')`），
 * 真正拷图/删图的是**渲染层**（`ThemeEditModal/index.vue:126,386-390,437,443,479,497,501`），
 * 因为它有 `nodeIntegration`。
 *
 * Android 上渲染层没有 `fs`，所以这批操作必须挪到主进程/桥接层，即本对象。
 * 另外 **路径本身也必须换**：桌面返回的是绝对路径 + `encodePath()`，
 * Android 必须返回 `Capacitor.convertFileSrc()` 能吃的 URL，否则 `<img>` / CSS `url()` 加载不出来。
 *
 * ⚠️ 与契约的差异（需要在阶段 3 决定）：`winMain_get_themes` 的返回结构里
 * `dataPath` 是一个**字符串**。Android 若把它换成 `file://` URL，渲染层
 * `src/renderer/store/utils.ts:18-22` 的 `buildBgUrl()` 会把 URL 再拼一次
 * （`joinPath(dataPath, originUrl)`），会拼坏。**这是一个必须改渲染层的点**
 * ——按本任务"不擅自扩大范围"的要求，这里只登记，不改渲染层。
 */
export const androidThemeFiles: IThemeFileAdapter = {
  async exists(absPath) {
    throw new Error(`[android storage] androidThemeFiles.exists 未实现（${absPath}）`)
  },
  async readText(absPath) {
    throw new Error(`[android storage] androidThemeFiles.readText 未实现（${absPath}）`)
  },
  async readJsonOrNull<T>(absPath: string): Promise<T | null> {
    void absPath
    return null
  },
  async writeText(absPath, text) {
    void absPath
    void text
    throw new Error('[android storage] androidThemeFiles.writeText 未实现')
  },
  async copyIfMissing(fromAbsPath, toAbsPath) {
    void fromAbsPath
    void toAbsPath
  },
  async mkdir(absPath) {
    // 阶段 3：`await Filesystem.mkdir({ path: absPath, directory: Directory.Data, recursive: true })`
    throw new Error(`[android storage] androidThemeFiles.mkdir 未实现（${absPath}）`)
  },
  async copy(fromAbsPath, toAbsPath) {
    // 阶段 3：`Filesystem.copy()`（插件 ≥4 提供）；等价于渲染层现在用的 `copyFile`
    throw new Error(`[android storage] androidThemeFiles.copy 未实现（${fromAbsPath} -> ${toAbsPath}）`)
  },
  async move(fromAbsPath, toAbsPath) {
    // 阶段 3：`Filesystem.rename()`
    throw new Error(`[android storage] androidThemeFiles.move 未实现（${fromAbsPath} -> ${toAbsPath}）`)
  },
  async remove(absPath) {
    // 阶段 3：`Filesystem.deleteFile()`；不存在视为成功（与 `removeFile` 语义一致）
    throw new Error(`[android storage] androidThemeFiles.remove 未实现（${absPath}）`)
  },
}

/**
 * Android 版 `getStore()`，签名与 `electron.ts` 的默认导出**完全一致**。
 *
 * 差异只有两处（都是"桌面专有提示"的降级）：
 * - `showErrorAlert`：Android 没有同步对话框（契约 §3 `dialog.showMessageBoxSync` 一条，
 *   `docs/android/ipc-contract.md:441`），而且 Preferences 不会产生"坏 JSON"，
 *   所以这里是空实现。
 * - `resolvePath`：Android 没有 `global.rainDataPath`，用逻辑标识即可
 *   （真正的落点是 Preferences 的 key，见 `preferencesKey()`）。
 */
const getStore = createGetStore(androidStoreAdapter, {
  resolvePath: name => name + '.json',
  logError: error => { console.error('[android storage]', error) },
  showErrorAlert: () => {},
})

export default getStore
export type { Store }
export { getStore }
