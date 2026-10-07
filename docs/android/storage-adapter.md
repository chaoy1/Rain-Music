# Rain Music Android 移植 · 阶段 2 / 线 B：设置与本地存储的适配层

> 上游：[android-port-plan.md](../android-port-plan.md)（阶段 2「数据层」）、
> [ipc-contract.md](ipc-contract.md) §1.2 / §1.10 / §4.1 / §4.3 / §6.3、
> [native-bridge-needs.md](native-bridge-needs.md) §2.6.3（`buffer` polyfill 结论）。
>
> 本文档是**实施记录 + 结论**，所有结论都给 `文件:行` 证据。
> 行号指**本次改动完成后**的工作区状态。

---

## 0. 一句话结论

桌面版这些数据**全部**落在主进程的 Node `fs` 上（6 个 JSON + 1 个图片目录）。
本轮把它们收敛到一个**构建期可替换的存储适配器**：

```
src/common/storage/types.ts                    ← 契约（平台无关，不含实现）
src/main/platform/storage/core.ts              ← 平台无关内核（Store / 原子写语义 / getStore 单例与损坏恢复）
src/main/platform/storage/electron.ts          ← 桌面实现（默认；逐字等价于原 fs 行为）
src/main/platform/storage/adapter.android.ts   ← Android 骨架（Preferences / Filesystem，未接入）
src/main/platform/storage/adapter.ts           ← 入口（默认导出 electron；Android 用 webpack alias 换）
src/main/utils/store.ts                        ← 旧路径转发层（仅为兼容旧 import）
```

**桌面端行为零变化**，且新增了 `tests/unit/storage-adapter.test.cjs`（8 个用例）守住这一点。

---

## 1. 现状清单：谁在直接读写这些文件

### 1.1 JSON 键值存储（`getStore()` / `Store`）

| # | 文件:行 | 做什么 | 读写路径 |
| --- | --- | --- | --- |
| 1 | `src/main/utils/store.ts:78-106`（改前） | `getStore(name)`：单例 + 损坏恢复（`.bak` + 弹窗） | `<rainDataPath>/<name>.json` |
| 2 | `src/main/utils/store.ts:17-28`（改前） | 原子写：临时文件 → `renameSync` | 同上 |
| 3 | `src/main/utils/store.ts:30-50`（改前） | 构造：`existsSync` → `readFileSync(utf8)` → `JSON.parse` | 同上 |
| 4 | `src/main/utils/index.ts:3,117,132,140,142,160-199` | 应用设置（`config_v2`）、快捷键（`hot_key`） | `getStore()` |
| 5 | `src/main/utils/index.ts:215,227,234,260` | 用户主题记录（`theme`） | `getStore()` |
| 6 | `src/main/modules/winMain/rendererEvent/data.ts:4,8,31` | 渲染层键值存储（`data`）：`winMain_get_data` / `winMain_save_data` | `getStore()` |
| 7 | `src/main/modules/winMain/rendererEvent/soundEffect.ts:4,8,11,15,18` | 音效预设 4 条通道（`sound_effect`：`eqPreset` / `convolutionPreset`） | `getStore()` |
| 8 | `src/main/modules/userApi/utils.ts:3,10,21,41` | 自定义源列表（`user_api`） | `getStore()` |
| 9 | `src/main/utils/winLegacy.ts:5,12,27,39` | 旧版 Windows 提示计数（复用 `data`） | `getStore()` |

> `STORE_NAMES` 全表见 `src/common/constants.ts:8-17`。
> `STORE_NAMES.LRC_RAW` / `LRC_EDITED` 当前**没有**任何 `getStore()` 调用者（歌词已迁到 SQLite）。

### 1.2 配置文件读写（一次性迁移 + 外部导入导出）

| # | 文件:行 | 做什么 | 路径 |
| --- | --- | --- | --- |
| 10 | `src/main/utils/migrate.ts:11-21` | `parseDataFile`：读旧数据目录的 JSON | `<rainOldDataPath>/<name>` |
| 11 | `src/main/utils/migrate.ts:78-88` | `migrateFile`：`copyFile` 旧 `userApi.json` 到 `user_api.json` | 旧 → 新 |
| 12 | `src/main/utils/migrate.ts:94-115` | `migrateDataJson`：旧 `data.json` → 新 `data.json`（`writeFile`） | 旧 → 新 |
| 13 | `src/common/utils/nodejs.ts:148-175` | `saveRainConfigFile` / `readRainConfigFile`（`.rainmc` gzip 存档） | 调用方给路径 |
| 14 | `src/main/utils/dataPath.ts:39-63` | 决定 `global.rainDataPath` / `rainOldDataPath` | Electron `app.getPath('userData')` |

> 13 的调用方是**渲染层 worker**（`src/renderer/worker/main/music.ts`），导出/导入歌单与设置备份用
> （`views/List/MyList/useShare.ts`、`views/Setting/components/SettingBackup.vue`），
> 属于契约 §1.15 的 worker RPC 面，**不在本文档的收敛范围**（见 §5 未验证项）。

### 1.3 主题文件（图片）

| # | 文件:行 | 做什么 |
| --- | --- | --- |
| 15 | `src/main/utils/index.ts:214-221` | `getAllThemes()` 返回 `dataPath = <rainDataPath>/theme_images`（**只是路径**） |
| 16 | `src/main/utils/index.ts:262-269` | `getTheme()` 把 `--background-image` 拼成 `url(<rainDataPath>/theme_images/<name>)` |
| 17 | `src/renderer/views/Setting/components/ThemeEditModal/index.vue:126,386-390` | **渲染层**用 `copyFile` 把用户选的图拷到 `theme_images/temp/` |
| 18 | 同上 `:435-443` | **渲染层**用 `moveFile`/`removeFile` 落盘与清理 |
| 19 | 同上 `:479,497,501` | 同上（另存为 / 删除主题） |
| 20 | `src/renderer/store/utils.ts:18-22,32,36-47` | 渲染层把 `dataPath` 参与 CSS url 拼接 |

> **关键发现**：主题图片的实际文件操作**不在主进程**，而在渲染层，
> 因为主窗口开着 `nodeIntegration: true`（`src/main/modules/winMain/main.ts:120-130`）。
> 主进程只负责"给路径"。这一点直接决定了 §3.3 的结论。

### 1.4 不在本轮范围（明确列出，避免误认为漏做）

| 数据 | 位置 | 为什么不在范围 |
| --- | --- | --- |
| 歌单/歌词/URL 缓存/下载任务/不喜欢 | `src/main/worker/dbService/**`（better-sqlite3） | 阶段 2 / **线 A**（SQLite 落地），另一个任务点 |
| 主题**元数据**的对外 IPC | `winMain_get_themes` / `save_theme` / `remove_theme`（`M:app:126-134`） | 契约 C 类；本轮只换底层存储，不动通道形状 |
| `.rainmc` 导出/导入 | `src/common/utils/nodejs.ts:148-175` | 走渲染层 worker，属 §1.15 面 |

---

## 2. 适配器设计

### 2.1 为什么是这个分层

```
        ┌──────────────────────────── 调用方（主进程业务代码）────────────────────────────┐
        │ src/main/utils/index.ts · rendererEvent/data.ts · rendererEvent/soundEffect.ts   │
        │ src/main/modules/userApi/utils.ts · src/main/utils/winLegacy.ts                  │
        └───────────────────────────────┬─────────────────────────────────────────────────┘
                                        │ import getStore from '@main/platform/storage/adapter'
                        ┌───────────────▼────────────────┐
                        │  adapter.ts  （构建期可替换）   │
                        └───────┬────────────────┬───────┘
                 默认（桌面）    │                │  Android（webpack alias → adapter.android.ts）
                 ┌──────────────▼───┐        ┌───▼──────────────────────────┐
                 │ electron.ts      │        │ adapter.android.ts（骨架）    │
                 │ Node fs 逐字等价  │        │ Preferences / Filesystem     │
                 └──────────┬───────┘        └───┬──────────────────────────┘
                            └────────┬───────────┘
                        ┌────────────▼─────────────┐
                        │ core.ts（平台无关内核）    │
                        │ Store / stringify /       │
                        │ createGetStore            │
                        └────────────┬─────────────┘
                        ┌────────────▼─────────────┐
                        │ @common/storage/types.ts │  契约（IStore 等）
                        └──────────────────────────┘
```

**设计取舍（三条，都有理由）**

1. **入口用 webpack `resolve.alias` 而不是运行期 `if`。**
   与 `ipc-contract.md:682` 给渲染层的 `@platform` 别名同手法。运行期判断会为了"探测平台"
   而 `require('electron')`，`electron` 就被打进 Android bundle → 构建直接失败。
   `adapter.ts` 头部注释写清了具体怎么加这条 alias（本轮**不**建 Android webpack 配置，见 §5）。

2. **契约放在 `src/common/storage/types.ts` 而不是 `src/main/platform/storage/`。**
   理由：契约是**纯类型、零运行时依赖**，放在 `common` 后既不引入 `node:*`，
   也方便未来渲染层/桥接层复用同一份签名。反过来，把实现放 `main`，因为
   桌面版的落点是主进程 `fs`，Android 侧的落点也必须在"业务层"而不是渲染层
   （Capacitor 侧没有主进程，渲染层只能走桥）。

3. **`set()` 保持同步，另给 `setAsync()`。**
   实测桌面调用方依赖同步语义（`winLegacy.ts:27,39` 在同步函数里调用）；
   而 Capacitor 的存储 API 全是异步，无法伪装成同步。
   强行统一成异步会让桌面端多出"未处理 rejection"的新失败模式（原本是同步抛出）。
   因此契约同时给两条路径，**桌面走同步（零行为变化），Android 走异步（调用点加 `await`）**。

### 2.2 契约接口一览

```ts
// src/common/storage/types.ts
interface IStore {
  get: <Value = unknown>(key: string) => Value          // 同步，读内存快照
  has: (key: string) => boolean                          // 同步
  set: (key: string, value: unknown) => void | Promise<void>       // 桌面同步 / Android 异步
  override: (value: Record<string, any>) => void | Promise<void>   // 同上
  setAsync: (key, value) => Promise<void>                // 两端都有，Android 用
  overrideAsync: (value) => Promise<void>
  flush: () => Promise<void>
}

interface IStorePlatformAdapter {
  kind: 'electron' | 'capacitor'
  hasSyncLoad: boolean
  existsSync: (desc: StoreDescriptor) => boolean
  loadSync: (desc) => string          // 桌面 fs.readFileSync
  load: (desc) => Promise<string>
  saveSync: (desc, text) => void      // 桌面 临时文件 + renameSync
  save: (desc, text) => Promise<void>
  backupSync: (desc) => Error | null  // 桌面 fs.renameSync(x, x + '.bak')
}

interface IFileAdapter {                // 配置文件读写语义
  exists / readText / readJsonOrNull / writeText / copyIfMissing
}
interface IThemeFileAdapter extends IFileAdapter {   // 主题图片
  mkdir / copy / move / remove
}
```

### 2.3 桌面实现：逐字等价性对照

| 原实现 | 现实现 | 语义 |
| --- | --- | --- |
| `src/main/utils/store.ts:81` `path.join(global.rainDataPath, name + '.json')` | `electron.ts:169` `resolvePath` | 路径完全一致 |
| `:20,24` `JSON.stringify(store, null, '\t')` + `'utf8'` | `core.ts` 的 `stringify()` | 缩进/编码一致（**这是与 10 个 UI 测试共享的文件格式契约**） |
| `:18,27` 临时文件 `<file>.<rand>.temp` → `renameSync` | `electron.ts:33-45` `writeStoreFileSync` | 原子写一致 |
| `:22-25` `ENOENT` → `mkdirSync(recursive)` → 重写 | 同上 | 一致 |
| `:35` `existsSync` 才读 | `core.ts:57-69` 构造函数的 `existsSync` 前置判断 | 一致（**首启不抛 ENOENT**） |
| `:38,42` `readFileSync(utf8)` + `JSON.parse` | `electron.ts:52-54` + `core.ts` 的 `parseStore` | 一致 |
| `:42,47` 非法 JSON 且 `clearInvalidConfig=false` → 抛 | 同上 | 一致 |
| `:45-48` `typeof store != 'object'` 处理 | 同上 | 一致 |
| `:79` 同名单例 | `core.ts:121` `stores[name]` | 一致 |
| `:86` `log.error(error)` | `electron.ts:171` 注入 | 一致（同一个 `@common/utils` 的 `log`） |
| `:91-92` `renameSync(storePath, storePath + '.bak')` | `electron.ts:70-78` `backupSync` | 一致 |
| `:94-100` `dialog.showMessageBoxSync` + `shell.showItemInFolder` | `electron.ts:172-180` 注入 | 文案逐字一致 |

### 2.4 Android 骨架状态（**仅骨架，未接入，未真机验证**）

`src/main/platform/storage/adapter.android.ts` 做到了：

- ✅ 与 `electron.ts` **完全相同的导出面**（`default` / `getStore` / `Store` 类型 + 3 个适配器对象），
  所以构建期换 alias 后类型检查会立刻指出缺口；
- ✅ 每个未实现方法都带"阶段 3 该写什么 Capacitor API"的注释；
- ✅ 明确了**同步读怎么写**：启动期 `await hydrateStorage()` 把快照读进 `Map`，
  运行期 `loadSync()` 读 Map → 于是 `getStore()` 在 Android 上**仍然可以是同步的**
  （这条是保住 `global.rain.appSetting` 启动期同步结构的关键）；
- ✅ 明确了**写序问题**：`enqueueWrite()` 串行化，理由写在注释里
  （桌面同步写天然保证"调用顺序 == 落盘顺序"，Preferences 不保证跨调用顺序）；
- ✅ 明确了**损坏恢复为什么要空实现**（Preferences 里读回来永远是合法字符串，不存在坏 JSON），
  并注明"若最终改用 Filesystem 存 JSON，这里必须真实现"；
- ⚠️ **所有实际 API 调用都还是 `throw new Error('未实现')`**。本机无 Android SDK / 真机
  （`android-port-plan.md:8-17`），写了也验证不了。

---

## 3. 逐项「能直接搬 / 必须降级」结论

### 3.1 应用设置（`config_v2.json`）→ **走 Preferences，不继续用 JSON 文件**

| 项 | 结论 |
| --- | --- |
| 现状 | `getStore(STORE_NAMES.APP_SETTINGS)`，即 `<RainDatas>/config_v2.json`；结构 `{ version, setting }`（`src/main/utils/index.ts:117-134,140-142`） |
| 建议 | **`@capacitor/preferences`**，key 建议 `rain:store:config_v2`，value 仍是同一份 JSON 文本 |
| 理由 1 | 写入频率高、体积小（`updateSetting` 在 86 处渲染层调用点被触发，见 `ipc-contract.md:87`），Preferences 的 `SharedPreferences` 后端正是为这种场景设计的 |
| 理由 2 | 契约 §4.3 对同域数据（`winMain_get_data` / 音效预设）已给同样建议（`ipc-contract.md:515-523`），保持一致 |
| 理由 3 | 复用同一份 JSON 文本意味着 `mergeSetting` / `migrateSetting` / `defaultSetting` 那一整套逻辑**一行都不用改** |
| ⚠️ 代价 | 需要一次**首启迁移**（若 Play 版本从桌面版导入过数据）——但 Android 是全新安装，实际没有旧文件可迁（见 §3.5） |
| ⚠️ 未验证 | `Preferences` 在单个 key 存整份设置 JSON 的开销；"应用被杀时未 flush 的写丢失"概率 |

**为什么不继续用 `@capacitor/filesystem` 写 JSON 文件**：能保住"整份文件"的心智模型，但
(a) 失去 Preferences 的原子写保证；(b) 还是要自己手写临时文件 + rename 的原子逻辑，
而这正是本适配器要抽象掉的东西；(c) 反而多一次 IO。**除非**最终决定"设置也要能被用户看到/备份成文件"。

### 3.2 JSON 键值存储（`winMain_get_data` / `winMain_save_data`）→ **走 Preferences**

| 项 | 结论 |
| --- | --- |
| 现状 | `getStore(STORE_NAMES.DATA)`，`<RainDatas>/data.json`；9 个键（`DATA_KEYS`，`src/common/constants.ts:37-48`） |
| 建议 | **`@capacitor/preferences`**，**每个 `DATA_KEYS.*` 一个 key**（`rain:data:playInfo` 等），而不是整份 JSON 一个 key |
| 理由 | 这 9 个键的读写频率差异极大：`listScrollPosition` 几乎每次滚动都写，`leaderboardSetting` 一年不动一次。整份 JSON 一个 key 意味着"滚动一次 = 重写全部 9 个键"。逐键存能把写放大降下来 |
| ⚠️ 必须保留的语义 | `winMain_get_data` 的 `playInfo` 分支**不是纯读**：它会做"播放队列恢复校正"并可能回写 store、还要 `await dbService.completePlaybackQueueRestore()`（`src/main/modules/winMain/rendererEvent/data.ts:10-25`）。这段逻辑必须**原样保留在主进程侧**，不能变成"渲染层直接读 Preferences" |
| ⚠️ 写序 | 桌面是同步原子写；Android 必须保证同一 key 的写**串行**（骨架里的 `enqueueWrite`），否则会有"旧值覆盖新值"的丢数据 |
| ⚠️ 与线 A 的边界 | `playInfo` 的恢复校正依赖 SQLite（`global.rain.worker.dbService`）。**线 A 的 SQLite 落地完成后，这条路径才能真机验证** |

### 3.3 主题文件（用户自定义主题的图片）→ **必须降级**，且**必须改渲染层**

这是本轮**唯一一处"从主进程做不干净"**的地方，按任务要求**停下汇报，不擅自扩大**。

**事实**

- 主进程只给路径：`getAllThemes()` 返回 `dataPath`（`src/main/utils/index.ts:219`），
  `getTheme()` 把它拼进 CSS（`:262-269`）。
- **实际的文件操作在渲染层**：`ThemeEditModal/index.vue:126` 直接
  `import { joinPath, extname, copyFile, checkPath, createDir, removeFile, moveFile, basename } from '@common/utils/nodejs'`
  —— 那是 `import fs from 'node:fs'`（`src/common/utils/nodejs.ts:1`）。
  依赖的是 `nodeIntegration: true`（`src/main/modules/winMain/main.ts:120-130`）。
- 渲染层还自己拼 URL：`src/renderer/store/utils.ts:18-22` 的
  `buildBgUrl()` = `url(${encodePath(joinPath(dataPath, originUrl))})`。

**Android 上的三重降级（缺一不可）**

| # | 问题 | 降级方案 | 需要改哪一层 |
| --- | --- | --- | --- |
| 1 | 渲染层没有 `node:fs` | 把 `copyFile/createDir/removeFile/moveFile/extname/basename` 换成 Capacitor `Filesystem` 调用（或改走桥接层 IPC） | **渲染层**（`ThemeEditModal/index.vue`）+ 新增桥接方法 |
| 2 | `dataPath` 是**绝对路径**，WebView 加载不了 | 主进程返回 `Capacitor.convertFileSrc()` 能吃的 URL（或 `Filesystem.getUri()` 的结果） | 主进程（`getAllThemes`）+ **渲染层**（`buildBgUrl`） |
| 3 | `buildBgUrl()` 会**再拼一次** `joinPath(dataPath, originUrl)` | 一旦 `dataPath` 变成 URL，第 2 步的改动会让这里**双重拼接**。必须让 `buildBgUrl` 在拿到 URL 时直接 `url(...)` 透传 | **渲染层**（`src/renderer/store/utils.ts:18-22`） |

**结论（本轮的处置）**：主进程侧已经备好 `IThemeFileAdapter` 与 Android 骨架
（`adapter.android.ts` 的 `androidThemeFiles`），并把上述 3 点在代码注释里逐条登记
（`adapter.android.ts:227-247`）。**但没有改渲染层**——因为：

- 问题 1/2/3 必须**同时**改，否则主题图一定加载不出来，属于"改一半更糟"；
- 契约本来就把 `winMain_get_themes` 列为 **C 类需降级**（`ipc-contract.md:517`）；
- 任务明确要求"若必须改渲染层 → 停下来汇报，不扩大范围"。

> **给阶段 3 的最小可行路径**：`getAllThemes()` 增加一个 `imageUrlBase` 字段（保留旧 `dataPath` 不动），
> 渲染层 `buildBgUrl` 优先用 `imageUrlBase`。这样桌面端 `--background-image` 的 CSS 输出**逐字不变**，
> 只有 Android 侧走新分支。

### 3.4 音效预设（4 条通道）→ **走 Preferences，但需先确认首版是否保留音效**

| 项 | 结论 |
| --- | --- |
| 现状 | 4 条通道：`get/save_sound_effect_eq_preset`、`get/save_sound_effect_convolution_preset`（`src/main/modules/winMain/rendererEvent/soundEffect.ts:7-19`）；落 `<RainDatas>/sound_effect.json`，键 `eqPreset` / `convolutionPreset` |
| 建议 | **`@capacitor/preferences`**，key `rain:store:sound_effect:eqPreset` / `…:convolutionPreset` |
| 理由 | 数据量极小（几十个浮点/条），且**只有用户手动点保存时才写**，没有写放大问题；契约 §4.3 已给同样建议（`ipc-contract.md:520-523`） |
| 可直接搬 | ✅ 存储层能直接搬（走本适配器即可），**不需要**降级 |
| ⚠️ 真正的不确定在别处 | 音效本体在**渲染层 Web Audio**（`src/renderer/components/common/SoundEffectBtn/**`、`useSoundEffect.ts`）。`ConvolverNode` 的脉冲响应读取、`AudioWorklet`（`pitch_shifter.audioWorklet.js`）在 Android WebView 上是否可用**与本适配器无关**，属阶段 3 验证项 |
| 附注 | `pitchShifterPreset` 那两条通道是**注释掉的**（`soundEffect.ts:21-26`），无需移植 |

### 3.5 系统字体 / 系统主题（契约 C 类）→ **能力有等价，但实现必须换**

这两项**不属于本适配器**（它们不落盘），但列在这里因为契约把他们和设置放在同一节（§1.2）。

| 项 | 现状 | Android | 结论 |
| --- | --- | --- | --- |
| **系统字体**（`common_get_system_fonts`） | `src/main/utils/fontManage.ts:6` 用 `font-list` 枚举系统字体；IPC 见 `M:common:22` | ❌ 无等价能力。Android **不提供**"列出所有字体"的公开 API（`Typeface` 只有内置族名 + 用户可通过系统设置更换的内置族） | **降级**：返回内置族名白名单，或直接 `[]`。渲染层已有兜底 `.catch(() => [])`（`R:ipc:227`），所以返回 `[]` 是安全的；同时 UI 应隐藏"自定义歌词字体"入口 |
| **系统主题**（`common_theme_change`） | `src/main/app.ts:208-212` 监听 `nativeTheme.updated` 后广播 | ✅ 有等价能力：`matchMedia('(prefers-color-scheme: dark)')`（WebView 直接可用），或原生 `Configuration.uiMode & UI_MODE_NIGHT_MASK` | **能搬**：渲染层自监听 `matchMedia` 即可，广播通道保留同名以便组件不改（契约同结论，`ipc-contract.md:513`） |
| 附注 | `getTheme()` 里的 `nativeTheme.shouldUseDarkColors`（`src/main/utils/index.ts:249`） | 同上，换成 `matchMedia` 或桥接查询 | 需与"主题系统"一起在阶段 3 处理；**本适配器不涉及** |

### 3.6 汇总表

| 数据 | 落点 | Android 方案 | 能搬 / 需降级 | 需要改渲染层？ |
| --- | --- | --- | --- | --- |
| 应用设置 `config_v2.json` | `src/main/utils/index.ts:117` | Preferences | **能搬**（换后端） | ❌ |
| JSON 键值存储 `data.json` | `rendererEvent/data.ts:8,31` | Preferences（逐键） | **能搬**，但 `playInfo` 恢复语义必须留在主进程 | ❌ |
| 音效预设 `sound_effect.json` | `rendererEvent/soundEffect.ts:7-19` | Preferences | **能搬** | ❌ |
| 自定义源 `user_api.json` | `modules/userApi/utils.ts:10,21` | Preferences（含压缩脚本，注意体积） | **能搬** | ❌ |
| 快捷键 `hot_key.json` | `src/main/utils/index.ts:160-199` | Preferences | ⚠️ **无意义**：Android 无全局快捷键（契约 B 类，`ipc-contract.md:497`），建议不移植 |
| 用户主题记录 `theme.json` | `src/main/utils/index.ts:215,227,234` | Preferences | **能搬** | ❌ |
| 主题图片 `theme_images/**` | 主进程给路径 + **渲染层写文件** | Filesystem + `convertFileSrc` | **必须降级**（3 点同时改） | ✅ **是**（见 §3.3） |
| 旧数据迁移（`config.json` 等） | `src/main/utils/migrate.ts` | 无旧数据 → 空操作 | **可移除** | ❌ |
| 系统字体 | `src/main/utils/fontManage.ts:6` | 无等价 | **需降级**（返回 `[]`/白名单） | ⚠️ 建议隐藏入口 |
| 系统主题 | `src/main/app.ts:208` | `matchMedia` | **能搬** | ❌ |

---

## 4. 验收结果

见本轮汇报正文（五道门 + 逐门命令与输出）。
回归网：`tests/unit/storage-adapter.test.cjs`（新增，8 用例），覆盖
路径、tab 缩进 utf8、`ENOENT` 建目录、原子写不留 `.temp`、损坏 `.bak` 恢复、
`isIgnoredError=false` 抛出、同名单例、`override` 整份替换、异步路径字节一致、写失败 reject。

> 这个测试**实际抓到了一个真 bug**：内核第一版漏了原实现
> `src/main/utils/store.ts:35` 的 `existsSync` 前置判断，
> 导致"首次启动、文件还不存在"会 `readFileSync` 抛 `ENOENT`
> → 被 `getStore()` 当成数据损坏 → 弹错误框 + 生成 `.bak`。
> 已修复（`core.ts:57-69`）并用用例守住。

---

## 5. 未完成 / 未验证（明确登记，不要当成已完成）

### 5.1 Android 侧

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | `adapter.android.ts` 的所有 Capacitor API 调用 | **未实现**（`throw new Error('未实现')`）。本机无 Android SDK / 模拟器 / 真机（`android-port-plan.md:8-17`） |
| 2 | Android webpack 配置（`target: 'web'` + `@main/platform/storage/adapter$` alias） | **未创建**。理由同上：建了无法验证。接入方法已写在 `adapter.ts:20-40` 的注释里 |
| 3 | `@capacitor/preferences` / `@capacitor/filesystem` 依赖 | **未安装**。理由同上（且 `@capacitor/preferences` 是任务明确说"可以先不加"的） |
| 4 | `hydrateStorage()` 的接入时机 | **未接**。建议放在应用 bootstrap 的 `app_inited` 之前；必须早于任何 `getStore()` 调用 |
| 5 | `flushStorage()` 的接入时机 | **未接**。建议接 Capacitor `App.addListener('appStateChange')` / `pause`，对应"桌面同步落盘永不丢" |
| 6 | Preferences 的行为边界 | **未验证**：单 key 存整份 JSON 的开销、跨重启可见性、被杀时未 flush 的写丢失率、是否需要 `SharedPreferences` 之外的方案 |
| 7 | `set()` → `setAsync()` 的调用点改写 | **未做**（Android 侧才有意义）。已知需要改的点：`src/main/utils/index.ts:132,171,184,185,199,227,234`、`rendererEvent/data.ts:22,31`、`rendererEvent/soundEffect.ts:11,18`、`modules/userApi/utils.ts:10,41`、`utils/winLegacy.ts:27,39` |

### 5.2 主体协作风控（重要）

本轮执行期间，**另一个 agent 正在并发重构 `src/main/worker/dbService/**`（阶段 2 / 线 A：SQLite 落地）**。
因此：

- 我在 17:20 与 17:37 两次观察到 `build-config/pack.js` 被并发启动（不是本任务启动的）；
- `node --test tests/unit/*.test.cjs` 的失败用例**全部来自线 A 的范围**（详见汇报正文）；
- 我**没有** kill 任何进程，也没有改线 A 的任何文件。

### 5.3 本轮明确没做（避免被误认为漏做）

| 项 | 原因 |
| --- | --- |
| 不动 `src/renderer/**`（除未改） | §3.3 需要，但任务要求"必须改渲染层 → 停下汇报" |
| 不动 `src/main/worker/dbService/**` | 线 A 范围 |
| 不动 `.rainmc` 导出/导入（`src/common/utils/nodejs.ts:148-175`） | 走渲染层 worker（§1.15），属渲染层 worker 收敛 |
| 不动 `src/main/utils/dataPath.ts` | Windows 便携目录重定向是桌面专有能力；Android 侧不存在这个概念（契约 §3 已把 `app.getPath` 标为"无对应"） |
| 不动 `utils/winLegacy.ts` 的逻辑 | 只在旧 import 路径上做了机械替换；它是 Windows 专有（`process.platform !== 'win32'` 直接 return） |
| 保留 `src/main/utils/store.ts` 作为转发层 | 兜住旧 import 路径；新代码已全部指向 `@main/platform/storage/adapter` |
