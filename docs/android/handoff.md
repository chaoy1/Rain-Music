# Rain Music Android 移植 · 交接文档

> 写给接手的模型：这份文档是**自包含**的。读完它应当能不看历史会话就继续推进。
> 项目根：`D:\Documents\Projects\Rain Music\rain-music-desktop`
> 最后更新：本会话结束前（HEAD = 见下方"当前快照"）

---

## 1. 目标（逐字引自 goal 对象）

> 用 Capacitor 将 Rain Music 的 Vue 渲染层封装为 Android 版，并重写原 Electron 主进程业务层，使首版支持：听歌（内置 kg/tx/wy 平台 + 自定义源）、歌单管理、下载。Android 界面不得包含 macOS 风格窗口控制按钮（交通灯）。按分阶段推进：阶段0 完成主进程 IPC/Electron API 契约清单；阶段1 Capacitor 工程与平台抽象层；阶段2 数据层（SQLite/存储/设置）；阶段3 音源与播放；阶段4 歌单与下载；阶段5 自定义源；阶段6 打包与验收。每阶段跑通可验证的检查（lint/tsc/单测/构建），并在结束后向用户汇报进展。

**goal 对象**：`goal-4ba37311-4d18-4b76-8965-86c95909c26e`

---

## 2. ⚠️ 工具环境的三个硬性前提（不知道这三条会立刻卡住）

1. **每个 `pwsh` 调用都必须显式传 `workdir: "D:\Documents\Projects\Rain Music\rain-music-desktop"`**
   —— DSH 会话工作区指向的是**已删除**的旧路径 `D:\Documents\Projects\LX Music`，不传 workdir 会得到 `spawn powershell.exe ENOENT`。
2. **`glob` / `grep` 工具不可用**（ripgrep provider 失败）⇒ 用 `Select-String`。
3. **PowerShell 5.1**：不支持 `??`、**没有 `Join-String`**；`npx` 被执行策略拒 ⇒ 用 `npx.cmd`。
   另：**绝不要用 `Get-Content -Raw | Set-Content` 改源文件** —— 会按 GBK 重编码**损坏中文注释**（本会话踩过两次）。改文件用 `edit`/`write` 工具。

---

## 3. 当前快照

| 项 | 值 |
|---|---|
| 项目根 | `D:\Documents\Projects\Rain Music\rain-music-desktop` |
| 分支 | `master` → `origin https://github.com/chaoy1/Rain-Music.git` |
| 本地提交 | **17 次**（`5876f229` → `1061a4e3` 为最近一次已推送的） |
| 单测（本机） | **367 / 367 全绿**（基线随各刀增长：155 → 367） |
| lint / 四个 tsc | **0 / 全 0** |
| **CI `verify`** | ✅ **success** |
| **CI `debug-apk`** | ❌ **红**（真缺陷已定位到行，修复进行中 —— 见 §5） |
| 用户的工作区 | **30 项未提交改动**（主题/UI/`tests/ui/*`/`src/lang/*` 等，**不是本线的**） |

### 用户的 30 项未提交改动（必须保护）

它们属于**另一个会话**（主题预设、UI 组件、多个 `tests/ui/*`、`src/lang/*`、`App.vue` 等）。
本会话所有子代理都被明令：**禁止触碰这些文件**、**禁止任何 git 写操作（含 `git add`、含 `git stash`）**、并要求在汇报里贴 `git status --porcelain` 自证。
`git stash` 被特别禁止 —— 它会**把用户未提交的工作一起藏起来**。

**判据**：`git status --porcelain | Where-Object { $_ -notmatch 'android|tests/unit/android|ipc-contract|workflows' }` 应恒为 **30 项**。

---

## 4. 已完成的工作

### 阶段 0：IPC 契约清单 ✅
`docs/android/ipc-contract.md`（753 行、128 个通道，分类 **A 必须重写 52 / B 可移除 26 / C 降级 19**）。
配套文档：`docs/android/{native-bridge-needs,storage-adapter,cleartext-verification,web-runtime-blockers}.md` 与 `docs/android-port-plan.md`。

### 阶段 1：Capacitor 工程 + 平台抽象层 ✅
- Capacitor 8.5.2（`@capacitor/{core,cli,android}`），`capacitor.config.ts`，`webDir: 'dist-web'`，`appId: 'com.rainmusic.mobile'`
- Android 工程 `android/`：AGP 8.13.0 / Gradle 8.14.3 / compileSdk & targetSdk 36 / `JavaVersion.VERSION_21`
- **Android 界面不含 macOS 风格交通灯**（`src/renderer/platform/WindowControls.vue`，桌面 DOM 实测未变）
- web 目标构建：`build-config/renderer/webpack.config.web.js` + `npm run build:web`
- CI 出 APK：`.github/workflows/build-android.yml`

### 阶段 2：数据层 ✅
- SQL 适配器抽象：`src/main/worker/dbService/adapter/{types,serialize,better-sqlite3,android,index}.ts`
- 存储适配器：`src/common/storage/types.ts`、`src/main/platform/storage/{core,electron,adapter,adapter.android}.ts`；`src/main/utils/store.ts` 变成 15 行转发
- **对外契约 0 改动**

### 阶段 3：音源与播放 ✅
- 网络层抽象：`src/renderer/platform/http/{index,desktop,web}.js`（**构建期替换**，不是运行期三元）
- 纯 JS `RSA_NO_PADDING`：`src/common/utils/crypto/rsaNoPadding.js`（与 `node:crypto` **逐字节一致**）
- `src/common/utils/zlib.js`（pako 是唯一入口）
- **运行时启动：8 条启动阻塞点全部实测勘定并修复** ⇒ 界面从"**启动即全白**"到"**挂载成功 + 初始化链全程跑通**"
  1. 整包 `electron` 被打进 web 产物（顶层 `__dirname` ⇒ bundle 在 import 阶段即断）— (C)
  2. 第二个 `electron` 入口（`utils/ipc.ts`）— (C)
  3. `event/index.ts` 顶层同步抛错打断 `main.ts` 求值 — (A)
  4. `@common/utils/electron` — (C)+(B)
  5. `main.ts` 挂载链 `void getSetting().then(…)` 无 `.catch` — (A)
  6. `setup()` 期同步抛错 ⇒ `instance.render` 停在 NOOP（**完全静默**，一次扫 9 处）— (A)
  7. `getEnvParams()` 无 `.catch` — (A)
  8. `getViewPrevState()` → `winMain_get_data` — (A)
  （9. `initData()` 的失败传播形状 — (A)）
- 完整勘定记录在 `docs/android/web-runtime-blockers.md`（含 A/B/C 归类、难度、A/B 对照实测、P0 最小重写集合、**10 条"本机模拟不能推广到真机"的差异**）

### P0-1 真原生传输桥 ✅
- JS 侧 `src/common/platform/ipcBridge/capacitor.js`（635 行）
- 原生侧 `android/.../ipc/{RainMusicIpcPlugin,RainMusicIpcHandlers}.java`
- **单入口 + 单事件信封协议**：JS→原生唯一 `@PluginMethod post`；原生→JS 唯一事件 `ipcMessage`
- **只按 id 配对** ⇒ 乱序回包天然正确；超时 15000 ms（仓库既有惯例）；失败不静默
- **产物互斥双向自证**（桌面产物含 `ipcRenderer`、0 次 `ipcBridge/capacitor`；web 产物反之）
- `MainActivity.java` 的 `registerPlugin(...)` **必须在 `super.onCreate()` 之前**（我漏提交过一次 ⇒ 真机会静默失效而 CI 照绿）

### P0-2 / 阶段 4 的通道（已推送）✅
| 通道组 | 文件 | 要点 |
|---|---|---|
| 设置 ×2（`common_get_app_setting`/`common_set_app_setting`）| `RainMusicAppSettingChannels.java` | 落点 `CapacitorStorage` / 键 `rain:store:config_v2` |
| `winMain_get_data` / `winMain_save_data` | `RainMusicDataChannels.java` | 键 `rain:store:data`；**注意：这条通道没有 SQL 落点** |
| **共享存储锁** | `RainMusicStoreLock.java` | `commit()` 是**文件级**写入 ⇒ 两个通道写同一文件的不同键也必须**共用一把锁**（各自加锁会静默丢数据）|
| `player_list_get` + 默认列合并写回 + 同事务快照 | `RainMusicListChannels.java` / `RainMusicListMusicGetChannels.java` | SQLite `rain.dataSQLite.db`；合并 = 单事务 DELETE+INSERT，失败冒泡 |
| 纯读列表 | `RainMusicListMusicChannels.java` | |
| **歌单三条写通道** | `RainMusicListWriteChannels.java` | `update`（改名，4 列，SET 无 position）/ `add`（**两分支**：追加取 `MAX(position)+1` 允许空洞 / 插队整表重写+重编号；广播是**对象** `{position,listInfos}`）/ `remove`（**三表同事务**；**拒绝保留 id** `default`/`temp`，防**静默清空试听列表**；广播是**裸数组**）|

### CI 自诊断 ✅（本会话后期的关键投入）
`.github/workflows/build-test.yml` 与 `build-android.yml` 现在会把**失败文本送进 check annotation**（**免 token 可读**）：
- `verify` 被拆成 `typecheck` / `test:unit` / `build` 三步（`continue-on-error` + 尾部 60 行进 job summary + 失败发一条 `::error`），末尾聚合步骤始终打印矩阵
- gradle 步保留真实退出码同时 tee 输出，失败时发**最多 10 条** annotation（GitHub 每步只渲染 10 条）+ 完整日志 artifact
- **step id 只能用下划线** —— GitHub 表达式不支持连字符属性访问，`steps.my-step.outcome` 会被解析成**减法**、值变空，导致聚合步骤**无论成败都失败**（我踩过）
- 读 annotation 的方法：
  ```
  GET https://api.github.com/repos/chaoy1/Rain-Music/commits/master/check-runs
  GET https://api.github.com/repos/chaoy1/Rain-Music/check-runs/<id>/annotations
  ```
  （未鉴权有**小时配额**，超限会 403；配额恢复后可用）

---

## 5. 🔴 当前唯一阻塞：CI `debug-apk` 红（修复进行中）

### 真错误（由 CI annotation 报出，精确到行）

```
android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicListWriteChannels.java:870: error: unreported exception JSONException; must be caught or declared to be thrown
android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicListWriteChannels.java:869: error: unreported exception JSONException; must be caught or declared to be thrown
```

**根因**：`org.json` 的 `JSONObject.put(...)` 抛**受检异常** `JSONException`，那两行没捕获也没声明 ⇒ Java 从来没编译过。

**为什么本机没发现（本会话最深的一条教训）**：各刀用的"真 javac + 手写替身"探针里，**替身把 `put` 声明成了不抛异常的版本** ⇒ **替身比真机宽松**，于是**系统性地**接受了编译器会拒绝的代码。
⇒ **替身必须逐字照抄真实签名（含 `throws`）**，否则"本机编译通过"这句话不成立。

### 修复的当前状态（未提交）

工作区有 **3 个文件的未提交改动**（属本修复）：
```
 M android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicListWriteChannels.java   ← 处理受检异常
 M tests/unit/android-list-write-channels.test.cjs                                     ← 替身签名补 throws
 M tests/unit/android-playback-queue-merge.test.cjs                                    ← 另一份替身同步
```
子代理（`c8f9f596-4df3-4683-99ba-83932d3a49aa`）在收尾时**被中断**，最后一次观测：
- 曾达到 **368 / 368 全绿**（367 + 1 新用例）
- 但随后又在编辑 ⇒ 观测到 **357 tests / 1 fail**（中途态）

### 立即要做的三件事

1. **确认修复的最终状态**：跑 `node --test tests\unit\*.test.cjs`，看 `ℹ tests/pass/fail` 三个数。目标是 **≥368 且 fail 0**。
   - 若仍有失败：读失败断言，判断是"替身同步未完成"还是"生产代码还有同类受检异常处"（后者必须修）。
   - **并检查**：`RainMusicListWriteChannels.java` 里**所有** `JSONObject.put` / `JSONArray` 方法 / `new JSONObject(String)` 等受检异常点是否都处理了，**不只那两行**。
2. **用完整判据提交**（见 §7 的提交门），推送。
3. **等 CI 跑完，读 annotation 确认 `debug-apk` 转绿**（`verify` 已是 success）。

---

## 6. 未完成的工作

| 阶段 | 状态 |
|---|---|
| **阶段 4 的歌单部分** | ✅ 完成（改名 / 新建 / 删除三条写通道） |
| **阶段 4 的下载部分** | ❌ **未开始**（首版三大功能的最后一块） |
| **阶段 5 自定义源** | ❌ 未开始（P0-1 桥已就位，自定义源的宿主需要接） |
| **阶段 6 打包与验收** | ❌ 未开始（**APK 已在 CI 稳定产出过**，但真机验收未做） |

### 下载部分的已知要点
- 两个 Web Worker（`window.rain.worker` = Comlink over Web Worker，13 个方法，**承载全部下载写入**），依赖 `nodeIntegrationInWorker`
- `browserify-zlib` 仍在（← `node-id3`）；`common/utils/download/*`、`musicMeta/*` 仍是 `fs/http/https`
- `docs/android/web-runtime-blockers.md` 有"Android 首版必须重写的最小集合"（P0 表）可依

### 阶段 5 的已知要点
- 契约要求**同时暴露 `lx` 与 `rain`**（社区脚本读 `globalThis.lx`）—— `preload.js` 已这么做
- 平台 id 是**封闭白名单** `['tx','kg','wy','local']`，自定义源不能新增平台
- 播放 URL **只来自所选自定义源**（`api-source-info.ts` 的内置列表是空数组；内置 tx/kg/wy 只提供元数据）

### 阶段 6 的已知要点
- **真机验收必须做** `docs/android/cleartext-verification.md`（638 行）里的矩阵：**明文流量（约 28 处 `http://`）**、CORS、`convertFileSrc()` 映射、WebView 内核差异、worker 里 `window.Capacitor` 的可见性
- 该文档的 §"本机模拟与真机的差异"列了 **10 条不能从本机推广到真机**的结论

---

## 7. 必须遵守的验证纪律（本会话沉淀，请沿用）

### 7.1 三层验证边界

| 层次 | 手段 |
|---|---|
| JS/TS 侧 | 本机：lint / 四个 tsc / 单测 / `pack.js` / `build:web` / UI 套件 / **产物互斥** |
| 原生编译 | **只能由 CI**（`gradlew assembleDebug`）—— 本机**无 Android SDK** |
| 注册正确性 + 真机运行时 | **两者本机与 CI 都验不了** —— 只能靠人审、测试网、真机 |

**"CI 绿 ≠ 功能对"**：`MainActivity` 漏提交那次就是这类（CI 全绿而真机静默失效）。

### 7.2 提交门（三条件，**缺一不可**）

```
静默 >3 分钟（目标文件 mtime 不再变化）
且 node --test tests\unit\*.test.cjs 的 fail = 0
且 tests >= 基线（当前 367）
```

- **必须从实际运行输出解析 `ℹ tests/pass/fail` 三个数**，不能只看 exit code。
- **若首跑红：复跑一次**。仍红 ⇒ 当真失败；转绿 ⇒ 抖动（本会话确认存在抖动）。**不许"一直重试到绿"**。
- **本会话我犯过一次错**：门里只检查了"静默"没检查 `fail 0` ⇒ 推出去了一个红状态。**别重犯**。

### 7.3 变异自证

- 每个新用例都要**注入错误看它是否变红**（本会话靠这个抓出过**多处假通过**，例如"断言匹配到注释行"）。
- **变异注入放仓库外的副本工程**（`%TEMP%`），**不要在仓库文件上注入再还原** —— 那会篡改共享文件、抹掉并行工作（本会话发生过一次：变异批次把另一刀的实现抹掉，还把 MUTATION 注入留在了文件里）。
- 探针产物**一律放 `%TEMP%`**；仓库根**不许**留 `.tmp-*`（已清理过两次）。
- **替身签名必须逐字照抄真实 API**（含 `throws`）—— 见 §5 的教训。

### 7.4 两段式拆分（本会话验证有效的调度方式）

长任务反复中止（本会话 **10+ 次**），而拆小后成功率高得多。对"实现 + 机械适配既有守卫"这类任务：
- **a 段：只做实现**，**允许既有守卫暂时变红**，但要求**逐条归因**（"守卫未同步" vs "实现缺陷"；**后者必须修到绿**）
- **b 段：同步守卫/替身/契约**，让全套回绿

### 7.5 其他不变量

- **绝不假装成功**：坏 JSON 不返回 `{}`、坏 DB 不返回空数组、写失败不返回假 id。**"空 / 坏 / 表缺失"三态必须可分辨**。
- **emit 在事务提交之后、锁之外**；失败路径不 emit；写通道**零 `catch`**（失败大声抛出）。
- **注释不能说谎**：过期的行号/断言/文案要同步改（本会话靠这条修过多处）。
- **依据优先于权威**：子代理多次纠正过我的**错误前提**（如"`getWinMain_get_data` 需要 SQL"——其实不需要）、**错误行号**、**过度的校验规则**（如"拒绝负数 position"——其实负数属追加分支）。请继续鼓励这个行为。

---

## 8. 本会话拦截的 4 类"跨边界缺陷"（各自自洽但合起来错）

这三类都**本机测不到、CI 编译测不到**，只有**跨边界核对**才能发现 —— 请对同类风险保持敏感：

| # | 缺陷 | 不拦截的后果 |
|---|---|---|
| 1 | 产物互斥（桌面/Android 实现混入对方产物）| 桌面运行时走 Android 分支 ⇒ "莫名超时" |
| 2 | **去重键 Java/JS 不等价**（JS `trim()` 吃所有 Unicode 空白、`toLowerCase()` 与区域无关；Java 的 `trim()` 只吃 ≤U+0020、`toLowerCase()` 依赖默认 Locale）| 合并集合与渲染层不一致 ⇒ **能播的歌变成播不了** |
| 3 | **库文件名被插件改写**（`@capacitor-community/sqlite` 的 `getDatabaseName()` 砍掉 `.db` 再拼 `SQLite.db` ⇒ `rain.data.db` 实为 **`rain.dataSQLite.db`**）| 两侧各开一份库 ⇒ **"歌单丢了"** |
| 4 | **删除保留 id**（`default`/`temp` 有子表行但 `my_list` 里没有父行）| `my_list` 删 0 行（看似成功）+ 子表真删 ⇒ **静默清空试听列表** |

另有 2 条**已登记待真机回答**（在 `src/main/worker/dbService/adapter/android.ts` 的「未验证清单」）：
- 插件用 **SQLCipher**、原生用框架 `SQLiteOpenHelper`，**同一文件**两套实现打开是否安全
- 插件**不写 `user_version`** ⇒ 若插件先建库（`user_version=0`）而原生 `onUpgrade(0→4)` **抛错**，用户会看到"打不开"
- 另需对齐：**`user_version` 应为 4**（阶段 2a 的 `createConnection({version: 1})` 是占位）；库路径两边必须一致

---

## 9. 验证命令速查

```powershell
# 全部以 workdir: "D:\Documents\Projects\Rain Music\rain-music-desktop" 执行
node node_modules\eslint\bin\eslint.js --ext .ts,.js,.vue src          # lint（门：0 errors）
node node_modules\typescript\bin\tsc -p src\main\tsconfig.json --noEmit          # 四个 tsc
node node_modules\typescript\bin\tsc -p src\renderer\tsconfig.json --noEmit
node node_modules\typescript\bin\tsc -p src\renderer-lyric\tsconfig.json --noEmit
node node_modules\typescript\bin\tsc -p src\common\tsconfig.json --noEmit
# ⚠️ 不要用根 tsconfig.json（它没有 paths 映射，有 889 个既有错误，不是门）
node --test tests\unit\*.test.cjs                                      # 单测（当前基线 367）
node build-config\pack.js                                              # 桌面构建
npm.cmd run build:web                                                  # web 构建
npm.cmd run test:surfaces ; npm.cmd run test:window-controls           # UI 套件
npx.cmd cap sync android                                               # Capacitor 同步
```

---

## 10. 一句话总结现状

**阶段 0–3 与阶段 4 的歌单部分已完成并推送**（17 次本地提交、`verify` CI 绿、单测 367/367、界面已能挂载并跑通初始化链）；
**当前唯一阻塞是 `debug-apk` 的 Java 编译错误**（受检 `JSONException`，已定位到 `RainMusicListWriteChannels.java:869-870`，修复在 3 个未提交文件里，最后一次观测为中途态）；
**修完并确认 CI 双绿后，剩下的是阶段 4 的下载部分、阶段 5 自定义源、阶段 6 真机验收。**
