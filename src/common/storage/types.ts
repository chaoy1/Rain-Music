/**
 * Rain Music Android 移植 · 阶段 2 / 线 B：本地存储契约（平台无关）
 *
 * ## 这份文件解决什么问题
 *
 * 桌面版把「应用设置 / JSON 键值存储 / 主题文件记录 / 音效预设」**全部**直接写在主进程的 Node `fs` 上。
 * 实测的落盘点是 6 个 JSON 文件 + 1 个图片目录，全部挂在 `global.rainDataPath` 下
 * （`src/main/utils/dataPath.ts:41-59`，默认 `%APPDATA%\<app>\RainDatas`）：
 *
 * | 文件 | store 名（`src/common/constants.ts:8-17`） | 直接读写的代码 |
 * | --- | --- | --- |
 * | `config_v2.json` | `APP_SETTINGS` | `src/main/utils/index.ts:117-134` |
 * | `data.json` | `DATA` | `src/main/modules/winMain/rendererEvent/data.ts:8,31` |
 * | `hot_key.json` | `HOTKEY` | `src/main/utils/index.ts:160-199` |
 * | `user_api.json` | `USER_API` | `src/main/modules/userApi/utils.ts:10,21,41` |
 * | `theme.json` | `THEME` | `src/main/utils/index.ts:215,227,234,260` |
 * | `sound_effect.json` | `SOUND_EFFECT` | `src/main/modules/winMain/rendererEvent/soundEffect.ts:8,11,15,18` |
 * | `theme_images/**` | —（图片目录） | `src/main/utils/index.ts:219,268`（路径）+ 渲染层 `ThemeEditModal/index.vue`（写文件） |
 *
 * 本文件只定义**契约**，不含实现，也不 import `node:*` / `electron` / `@capacitor/*`。
 * `src/main/platform/storage/electron.ts`（桌面）与 `.../android.ts`（Android 骨架）
 * 实现同一套签名；`.../adapter.ts` 是构建期可替换的入口。
 *
 * ## 与渲染层 `src/renderer/platform/` 的关系
 *
 * 阶段 1a 已在渲染层建立平台判定（`src/renderer/platform/index.ts`）。本文件是**主进程侧**的
 * 存储契约，刻意分开：Capacitor 侧没有"主进程"，渲染层的存储访问应当继续走 IPC / 桥接层。
 *
 * ## `set` 到底是同步还是异步（读这段再改代码）
 *
 * 实测：**桌面版 `Store.set()` / `override()` 是同步的，而且调用方依赖这一点**
 * （`src/main/modules/winLegacy.ts:27,39` 在同步函数里调用 `set()`；
 * `src/main/utils/index.ts:132` 的 `override()` 之后没有 await）。
 * 因此桌面实现 `set()` 是**同步 `void`，写失败同步抛出**。
 *
 * Android 侧唯一可行的键值落点是 `@capacitor/preferences`（纯异步）或
 * `@capacitor/filesystem`（纯异步），**不可能**同步。所以契约里给了
 * `setAsync()` / `overrideAsync()` / `flush()`：语义与 `set()` 完全相同，只是异步。
 * 迁到 Android 时把调用点从 `set()` 改成 `await setAsync()` 即可。
 */

/** JSON 键值存储（等价于原 `src/main/utils/store.ts` 的 `Store` 类） */
export interface IStore {
  /**
   * 读一个键。**同步**：读的是内存快照，不碰磁盘
   * （文件在初始化时已经整份读进内存，`src/main/utils/store.ts:30-50`）。
   */
  get: <Value = unknown>(key: string) => Value

  /** 键是否存在。**同步**，语义是 `key in store`（含值为 `undefined` 的键） */
  has: (key: string) => boolean

  /**
   * 写一个键并落盘。
   *
   * - **桌面实现：同步**，落盘完成才返回，写失败**同步抛出**（现有行为，保持不变）。
   * - Android 实现：返回 `Promise<void>`，写失败以 rejection 表达。
   *
   * 返回类型是 `void | Promise<void>` 以便两端共用签名；桌面分支永远返回 `void`，
   * TS 里 `void` 类型不强制 `await`，因此不会引入"未处理的 Promise"告警。
   */
  set: (key: string, value: unknown) => void | Promise<void>

  /** 整份覆盖并落盘。语义同 `set()`（桌面同步，Android 异步） */
  override: (value: Record<string, any>) => void | Promise<void>

  /** 与 `set()` 等价，但**保证异步**。桌面与 Android 都实现，方便调用点统一改写 */
  setAsync: (key: string, value: unknown) => Promise<void>

  /** 与 `override()` 等价，但**保证异步** */
  overrideAsync: (value: Record<string, any>) => Promise<void>

  /** 等待所有尚未落盘的写入完成。桌面同步实现直接 resolve */
  flush: () => Promise<void>
}

/** 单个 JSON store 的落盘位置描述 */
export interface StoreDescriptor {
  /** store 名，即 `STORE_NAMES.*`；文件名是 `${name}.json`（`src/main/utils/store.ts:81`） */
  name: string
  /** 该 store 的绝对文件路径（桌面）、或 Android 侧的逻辑标识 */
  path: string
  /**
   * 解析失败时是否静默回退到 `{}`（原 `Store` 构造函数的 `clearInvalidConfig`）。
   * `false` 时解析失败要抛出（`src/main/utils/store.ts:42,47`），由 `getStore()` 做备份恢复。
   */
  clearInvalidConfig: boolean
}

/**
 * 平台存储适配器：把「JSON store 的字节读写」与「损坏文件备份」这两件**平台相关**的事注入进来。
 *
 * 桌面实现 `electron.ts` 逐字复刻 `src/main/utils/store.ts` 的 Node `fs` 行为：
 * 临时文件 + `renameSync` 的原子写（`:17-28`）、`ENOENT` 时建目录（`:22-25`）、
 * `.bak` 备份（`:92`）。
 *
 * Android 实现 `android.ts` 用 `@capacitor/preferences`（键值）与 `@capacitor/filesystem`（配置文件/主题图）。
 */
export interface IStorePlatformAdapter {
  /** 平台标识，仅用于日志与调试 */
  readonly kind: 'electron' | 'capacitor'

  /**
   * 该 store 的落盘文件是否**已存在**（桌面用 `fs.existsSync`，`store.ts:35`）。
   * 该调用是同步的，只用于启动分支判断。
   */
  existsSync: (desc: StoreDescriptor) => boolean

  /**
   * **同步**读原始文本。桌面用 `fs.readFileSync(x, 'utf8')`（`store.ts:38,42`）。
   * Android 无法同步读文件 → 必须抛错（`createStore()` 会据此走异步初始化分支）。
   */
  loadSync: (desc: StoreDescriptor) => string

  /**
   * 该适配器是否**支持**同步读盘。桌面 `true`；Android `false`。
   *
   * 存在的意义：让"Android 侧不小心同步创建 Store"变成一条可读的错误信息，
   * 而不是运行时才炸。
   */
  readonly hasSyncLoad: boolean

  /** 异步读原始文本。Android 走 Preferences / Filesystem；桌面用它实现「异步重建」 */
  load: (desc: StoreDescriptor) => Promise<string>

  /**
   * 写入原始文本，**同步**完成（桌面：临时文件 + `renameSync`，`store.ts:17-28`）。
   * 写失败同步抛出 —— 调用方依赖这一点。
   */
  saveSync: (desc: StoreDescriptor, text: string) => void

  /** 写入原始文本，异步完成（Android 必填；桌面把它包成 Promise） */
  save: (desc: StoreDescriptor, text: string) => Promise<void>

  /**
   * 把损坏的 store 文件备份到 `<path>.bak`（`store.ts:91-92`）。
   * 返回非 null 表示备份本身失败（调用方只记日志，不中断启动）。
   */
  backupSync: (desc: StoreDescriptor) => Error | null
}

/**
 * 配置文件读写语义：文件（或一组文件）的文本/二进制读写。
 *
 * 桌面用 Node `fs`；Android 用 `@capacitor/filesystem`。
 * 这里刻意**不做路径虚拟化** —— 路径字符串由调用方按平台自己算
 * （桌面是 `global.rainDataPath`，Android 是 Filesystem 的 relative path）。
 * 原因：Capacitor Filesystem 的 `Directory` 枚举与 Node 绝对路径无法一一映射，
 * 强行虚拟化只会把两边的错误处理都搞乱。
 */
export interface IFileAdapter {
  /** 路径/文件是否存在（对应 `@common/utils/nodejs.ts:18-32` 的 `checkPath`） */
  exists: (absPath: string) => Promise<boolean>

  /** 读文本（utf8）；不存在时 reject */
  readText: (absPath: string) => Promise<string>

  /** 读 JSON，不存在/解析失败时返回 `null`（对应 `migrate.ts:11-21` 的 `parseDataFile`） */
  readJsonOrNull: <T>(absPath: string) => Promise<T | null>

  /** 写文本（utf8，**非原子**；对应 `migrate.ts:112` 的一次性迁移写） */
  writeText: (absPath: string, text: string) => Promise<void>

  /** 目标不存在且源存在时复制（对应 `migrate.ts:78-88` 的 `migrateFile`），失败只记日志 */
  copyIfMissing: (fromAbsPath: string, toAbsPath: string) => Promise<void>
}

/**
 * 平台文件系统适配器：给「主题图片目录」这类**图片/二进制**场景用。
 *
 * 与 `IFileAdapter` 分开的理由：`IFileAdapter` 只服务于配置 JSON 的迁移（一次性、纯文本），
 * 而这里服务的是主题图片（长期、二进制、需要目录操作、路径要能被 WebView 直接加载）。
 * 两者在 Android 上的落点也不同（Preferences vs Filesystem External/Data）。
 */
export interface IThemeFileAdapter extends IFileAdapter {
  /**
   * 把一个**路径**转成渲染层（`<img src>` / CSS `url()`）能直接加载的 URL 基址。
   *
   * 阶段 3 / 线 C 新增。存在的理由：桌面渲染层用 `encodePath()`（= `pathToFileURL()`）
   * 把绝对路径转成 `file:///…`；WebView 里这条路走不通（也拿不到真实路径），
   * Android 必须用 `Capacitor.convertFileSrc()` 得到 `http://localhost/_capacitor_file_/…`。
   * 两者都是"把这个目录变成可加载的 URL 基址"，正好是本接口的边界。
   *
   * - 桌面（`electron.ts`）：**identity** —— 原样返回，渲染层仍按老代码走
   *   `encodePath(joinPath(dataPath, name))`，CSS 输出逐字不变（这是硬约束）。
   * - Android（`adapter.android.ts`）：`Capacitor.convertFileSrc(absPath)`（骨架，未验证）。
   */
  toUrlBase: (absPath: string) => string

  /** 递归创建目录（对应 `ThemeEditModal/index.vue:389` 的 `createDir`） */
  mkdir: (absPath: string) => Promise<void>

  /** 复制文件（对应 `ThemeEditModal/index.vue:390,501` 的 `copyFile`） */
  copy: (fromAbsPath: string, toAbsPath: string) => Promise<void>

  /** 移动/重命名（对应 `ThemeEditModal/index.vue:437,497` 的 `moveFile`） */
  move: (fromAbsPath: string, toAbsPath: string) => Promise<void>

  /** 删除文件，不存在视为成功（对应 `ThemeEditModal/index.vue:364,399,443,479` 的 `removeFile`） */
  remove: (absPath: string) => Promise<void>
}
