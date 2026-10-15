# Rain Music Android 移植 · 交接文档

> 写给接手的模型：这份文档是**自包含**的。读完它应当能不看历史会话就继续推进。
> 项目根：`D:\Documents\Projects\Rain Music\rain-music-desktop`
> 最后更新：2026-10-15，继续完成歌单写入、下载、音源宿主、媒体缓存及播放队列恢复。续开发基线 `b33c2332`；最新验证见 [本轮记录](continuation-2026-10-15.md)，提交与 CI 以 Git / check-runs 为准。下文旧“第几刀”的说明保留为历史证据。
> **2026-10-15 又做了一轮独立复核并把结论写在 [§0](#0-2026-10-15-二次复核独立于上一轮逐条给证据) 与 [§6.1](#61-原生侧完全没有注册而渲染层会调的通道2026-10-15-实测) 里（新结论、纠正过的旧说法、以及缺口清单）。先读那两节，再读下面的历史。**

---

## 0. 2026-10-15 二次复核（独立于上一轮，逐条给证据）

1. **本机门禁在 `2a3e4a7c` 上复跑**：`eslint src` exit 0；`src/{main,renderer,renderer-lyric,common}/tsconfig.json` 四个 `tsc --noEmit` 全部 exit 0；`node --test tests\unit\*.test.cjs` = **tests 455 / pass 455 / fail 0 / skipped 0**（工作区口径，**包含用户另线未提交的测试**，不是提交快照的口径）。
2. **用户 30 项未提交改动未被污染**：与接手快照 `%TEMP%\rain-android-takeover-20261014\protected-files.json` **逐文件 SHA-256 比对，0 处不一致**；`git status --porcelain` 仍为 30 项。
3. **HEAD `2a3e4a7c` 的两条 CI 均为 `completed / success`**（`verify` 116315939345、`debug-apk` 116315940325）；APK 产物 `rain-music-android-debug`（10 101 476 字节）未过期，另有 `rain-music-android-gradle-output` 日志产物。
4. **Android 运行时没有主进程**（本轮新增的实测结论，很重要）：对 `dist-web` 全部 `.js` 做字符串检索，`dbService` / `better-sqlite3` / `CapacitorSQLite` / `createCapacitorSQLiteDriver` / `rain.data.db` / `themeImages` / `IThemeFileAdapter` **全部 ABSENT**。
   ⇒ `src/main/**` 整体是**桌面代码**；Android 的业务层**只有** Java 插件（`android/.../ipc/*.java`）。
   ⇒ §4 阶段 2 里那些 `*.android.ts` 适配器**真机上不会被求值**；`adapter/android.ts` 的「接线清单」不是前进路线；`createCapacitorSQLiteDriver()` 抛 `not implemented yet` **不是**线上缺陷（它那条分支在 Android 产物里根本不存在）。**不要再按那份清单去 hand over。**
5. **测试替身签名已对着真 `android-4.1.1.4.jar` 核对**（§5 遗留待办第 1 条就此关闭）：**没有“替身比真 API 宽松”的缺陷**，全部差异都在更严格一侧。详见 §5。
6. **产物互斥在真实 bundle 上复核通过**：`dist-web` 中 `ipcBridge/desktop` **0 次**、`ipcBridge/capacitor` 命中；`ipcRenderer` 出现的 4 次全部在 `src/renderer/platform/ipcRenderer/web.js` **那句故意抛错的文案里**，不是 Electron 被打了进来。
7. **新增缺口清单**：主题、不喜欢、换源缓存、音效预设、缓存大小/清缓存、另存对话框、系统字体等通道在原生侧**一条都没注册** —— 见 §6.1。这是当前最明确的“未实现功能面”，比“待真机验收”更值得先决策。
8. **对已推送的下载执行层做了一轮独立审查**：确认 **8 处与桌面契约不一致**，其中 **1 处 high**
   （`skip` 检查无条件抛、resume 失败后部分文件永不回收 ⇒ 用户无法自救）。
   **本轮已修 6 处**（第 1、2、3、6、7、8，含那处 high）并做了 **6 个变异验证**；
   剩第 4（部分文件何时回收，**需要先拍板**）与第 5（有界重试，单独立一刀）
   —— 见 **§6.2**、**§6.2.1**、**§6.2.2**。
9. **对歌单写入 / 媒体缓存 / 播放队列恢复做了一轮独立审查**：**没有 blocker**，
   问题集中在 `data_overwire` 的入参宽容度；其中一条（**测试替身比真 API 宽松**，
   `android.util.Base64` 的 MIME 解码器 vs 真 API 的严格解码）**属于 §5 那条最深教训的同类** —— 见 **§6.3**。**全部未修。**
10. **渲染层 / Web 侧也做了一轮独立审查**（这一份回来得比前两份晚很多，中途一度以为丢了 —— 所以**不要因为没等到就当作没审**）：
    **没有 blocker**，但有一条 **high**：自定义源的 HTTP 请求体编码与桌面不一致
    （脚本用 `body` + `Content-Type: application/json` 会被**表单序列化**，头却还是 json）——
    而且**根因在 `platform/http/web.js` 的 `buildRequest` 少了 needle 那条"头是 json 就当 json"的规则**，
    所以**要改两处**。**W1 与 W2 本轮都已修**（W1 含 2 个变异验证：单独改任一处都过不了；
    W2 含 2 个变异验证：初始化成功后的一次脚本错误不再拆掉整个源）。
    仍未修的是：**W3/W4**（medium，W3 是"零个可用平台被当成成功发布"、
    W4 是本地音乐把会话级 `blob:` URL 当身份持久化）、**W5–W9**（low）、
    以及**本轮新发现的 W10**（`formData` 被完全忽略 ⇒ 发空请求）。
    见 **§6.4 / §6.4.1 / §6.4.2 / §6.4.3**。

---

## 1. 目标（逐字引自 goal 对象）

> 用 Capacitor 将 Rain Music 的 Vue 渲染层封装为 Android 版，并重写原 Electron 主进程业务层，使首版支持：听歌（内置 kg/tx/wy 平台 + 自定义源）、歌单管理、下载。Android 界面不得包含 macOS 风格窗口控制按钮（交通灯）。按分阶段推进：阶段0 完成主进程 IPC/Electron API 契约清单；阶段1 Capacitor 工程与平台抽象层；阶段2 数据层（SQLite/存储/设置）；阶段3 音源与播放；阶段4 歌单与下载；阶段5 自定义源；阶段6 打包与验收。每阶段跑通可验证的检查（lint/tsc/单测/构建），并在结束后向用户汇报进展。

**goal 对象**：`goal-4ba37311-4d18-4b76-8965-86c95909c26e`

---

## 2. 工具环境（会话之间分开看：旧 DSH / Codex / 本次 DSH）

1. **每个 shell 调用显式传 `workdir: "D:\Documents\Projects\Rain Music\rain-music-desktop"`**。
   当前 Codex 默认 cwd 是外层 `Rain Music`，真正 Git 根在嵌套目录。
   上一 DSH 会话还遇到过已删除的 `LX Music` 工作区与 `spawn powershell.exe ENOENT`；那是旧环境故障。
2. 当前 Codex 的 **`rg` / `rg --files` 已实测可用**；旧 DSH 的 glob/grep provider 失败不适用于这里。
   PowerShell 下用 `rg -g 'android-*.test.cjs' tests/unit`，不要把通配符拼进未展开的 Windows 路径。
3. 当前 shell 实测为 **PowerShell 7.6.5**；上一会话是 5.1，才不支持 `??` / `Join-String`。
   仍可使用 `npm.cmd` / `npx.cmd`，避开 `.ps1` 执行策略差异。
   另：**绝不要用 `Get-Content -Raw | Set-Content` 改源文件** —— 会按 GBK 重编码**损坏中文注释**（本会话踩过两次）。改文件用 `edit`/`write` 工具。

---

### 2.1 2026-10-15 复核会话实测环境（DSH；与上面的旧 Codex 会话不同）

- **无 Android SDK**：`ANDROID_HOME` / `ANDROID_SDK_ROOT` 均为空，`%LOCALAPPDATA%\Android\Sdk` 不存在
  ⇒ **`assembleDebug` 只能靠 CI**，本机连一条 gradle 任务都跑不了。
- **有 JDK 20**（`D:\Software\java\bin\{java,javac,javap}.exe`）⇒ 真 `javac` / `javap` 探针可以做。
- `%TEMP%\rain-json-probe\vendor\` 里存着**真制品**：`android-4.1.1.4.jar`（12 947 757 B）与
  `android-json-aosp.jar`（18 279 B）。核替身签名就用这两个，**不要再去找 SDK**。
- GitHub check-runs 与 artifacts **可免鉴权读取**（本次实测成功）：
  `/repos/chaoy1/Rain-Music/commits/<sha>/check-runs`、`/check-runs/<id>`、`/actions/runs/<run_id>/artifacts`。
  配额是**每小时**的，超限会 403。
- `.ps1` 脚本**被执行策略拦住**（`PSSecurityException`）⇒ 用
  `Invoke-Expression (Get-Content -LiteralPath <file> -Raw)`，或直接用 bash / `node`。
- **权威数字一律从实际输出解析**（`tests/pass/fail`、lint 的 `0 errors`、CI 的 `conclusion`）。
  本文档里的历史数字是**刻意保留的证据**，不要当现值引用。

## 3. 当前快照

| 项 | 值 |
|---|---|
| 项目根 | `D:\Documents\Projects\Rain Music\rain-music-desktop` |
| 分支 | `master` → `origin https://github.com/chaoy1/Rain-Music.git` |
| 本轮开发基线 | **`b33c23329adbc39f3d9732e690505e5dd17c9c47`**；**2026-10-15 复核时的 HEAD = `2a3e4a7c0dd44e7916eaa2f5ce100854028356a9`**（`feat(android): complete playlists downloads and custom source runtime`），工作区另有用户 30 项未提交改动 |
| 单测（本机，**工作区口径**） | **455 / 455，fail 0、skip 0**（2026-10-15 在 `2a3e4a7c` 上复跑；**包含用户另线未提交的测试**，提交快照的计数以 CI 为准，不要直接引用这个数） |
| lint / 四个 tsc | **`eslint --ext .ts,.js,.vue src` exit 0（`0 errors` / 6 个既有 `View.vue` 属性顺序 warnings）；`src/{main,renderer,renderer-lyric,common}` 四个 tsc 全部 exit 0** |
| **CI `verify`** | `2a3e4a7c` = **completed / success**（check-run `116315939345`）。**改任何代码后必须查新 SHA，不能沿用** |
| **CI `debug-apk`** | `2a3e4a7c` = **completed / success**（check-run `116315940325`，run `38703141603`）；产物 `rain-music-android-debug`（10 101 476 B）**未过期**。**改任何原生代码后必须查新 SHA** |
| 用户的工作区 | **30 项未提交改动**（主题/UI/`tests/ui/*`/`src/lang/*` 等，**不是本线的**） |

### 用户的 30 项未提交改动（必须保护）

它们属于**另一个会话**（主题预设、UI 组件、多个 `tests/ui/*`、`src/lang/*`、`App.vue` 等）。
本会话所有子代理都被明令：**禁止触碰这些文件**、**禁止任何 git 写操作（含 `git add`、含 `git stash`）**、并要求在汇报里贴 `git status --porcelain` 自证。
`git stash` 被特别禁止 —— 它会**把用户未提交的工作一起藏起来**。

**判据**：`git status --porcelain | Where-Object { $_ -notmatch 'android|tests/unit/android|ipc-contract|workflows' }` 应恒为 **30 项**。

接手后新增的共享探针 `tests/unit/json-checked-exception-probe.cjs` 与 `tests/unit/fixtures/android-music-add/` 也属于 Android 本线，
不应被上面的旧路径过滤器误计为用户改动。2026-10-14 已在仓库外保存原有 30 项的 SHA-256 快照；
保护检查应以这些文件逐个 hash 不变为准，不能只看数量。

### 2026-10-14 接手复核与边界

- 已直接查询当前 HEAD 的 GitHub check-runs：
  [`verify`](https://github.com/chaoy1/Rain-Music/actions/runs/38522039142/job/115713727550) 与
  [`debug-apk`](https://github.com/chaoy1/Rain-Music/actions/runs/38522039335/job/115713892490) 均为 `completed / success`。
- `npm.cmd run build:web` 为 exit 0，但仍有 2 个兼容性告警：`common.ts` 的 `pathToFileURL`
  与 `download/request.ts` 的 `URL` 无法从浏览器 `url` polyfill 导出。这些警告不能当作功能通过。
- 桌面 `node build-config/pack.js` 构建为 exit 0；本次未跑 UI 套件或安装包冒烟。
- 产物 source map 的 IPC 实现互斥检查通过：桌面包含 `ipcBridge/desktop.js`、不包含
  `ipcBridge/capacitor.js`；Web 产物相反。
- 新增两套 JSON 替身负向验证：读通道覆盖 `put` / 字符串构造器，合并探针还覆盖
  `JSONObject.get/getString` 与 `JSONArray.get/getJSONObject`。先编过声明 `throws JSONException`
  的调用方，再要求每个未处理异常的调用方因该异常编译失败，避免把替身自身损坏当成成功。
- 在仓库外副本上分别放宽两套替身的 `put` 与字符串构造器：**4 个变异全部被新守卫拒绝**。
  没有在共享仓库中注入变异，也没有改生产代码或用户 UI 文件。
- **“阶段 3 完成”“歌单部分完成”只能描述已有适配代码，不能描述首版功能验收。**
  接手时原生注册的是设置、界面状态、列表读取、两条歌曲查询，以及歌单新建/改名/删除；
  当前已补其余歌曲写入与歌单排序/覆盖、下载、媒体缓存和自定义源本地宿主。
  已有真实Chromium Worker联调；Android 设备搜索与播放端到端验收仍未完成。
- 本机没有找到 Android SDK / `adb`；没有跑本机 `assembleDebug`、安装 APK 或真机验收。
  保留 §8 中 SQLite 双实现、版本与路径的一致性待验事项。

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
- ⚠️ **但这一节的 `*.android.ts` 全部是“桌面侧的接缝”，不是 Android 上跑的代码**：
  这些文件都在 `src/main/**` 下，而 `src/main/**` **不在 Android 产物里**（§0 第 4 条）。
  Android 的数据库是 Java 侧 `RainMusicDatabase.java`（框架 `SQLiteOpenHelper` + `rain.dataSQLite.db`），
  设置是 Java 侧 `RainMusicAppSettingChannels`（落 `CapacitorStorage`）。**读阶段 2 时不要以为 Android 走的是这些 TS 文件。**

### 阶段 3：音源适配与启动链已实现；端到端播放待验
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

### 2026-10-15：歌曲新增与列表广播顺序

- 原生 `RainMusicListMusicAddChannels.java` 注册 `player_list_music_add`，沿用
  `{id, musicInfos, addMusicLocationType}` → void / 同名对象广播；`RainMusicIpcPlugin.load()` 已接线。
- 普通歌单和 `temp` 仅按 ID 去重；默认队列沿用 `RainMusicPlaybackQueueKey`，同时按 ID 与
  规范化曲名/歌手去重。保留第一条完整 metadata；广播原始输入歌曲，由 renderer 再按同一规则过滤。
- `top` 在同事务删除并重建该歌单顺序，不覆盖已有音乐信息；追加沿用末首目标歌曲的原始 order+1，
  不取全表 MAX、不抹平空洞，缺失 order 时回退到 existing.length+1。任何写失败均回滚且不发成功广播。
- `RainMusicListWriteLock.LOCK` 现在同时保护歌单三条 writer、歌曲新增和 default 修复。
  事务提交后锁内将事件登记进 FIFO，`PUBLISH_LOCK` 在 DB 锁外按提交顺序发布。
  每条事件有自己的 ticket；某线程代发其他请求的事件时，发布异常只返回事件所属请求，后续事件继续发布。
  发布失败发生在数据库提交之后，不应把它描述为数据库写失败或已回滚。
- 独立审查先后复现并修复两项：提交 `[a,b]` 而事件 `[b,a]`，以及 A 发布失败却把异常返回给 B。
  复审后无剩余生产逻辑问题；旧锁别名与载荷构造时序注释已同步。
- 新增 11 条测试，运行真实 Java handler 与 Node 内置 SQLite（真实 schema / SQL / 事务）。
  Android 连接、Capacitor 宿主和 JSON 部分仍是替身，不等同 ART / WebView / 真机运行。
  覆盖 default 修复与失败快照回滚、两表回滚、元数据保留、锁外发布、FIFO、错误归属和插件注册。
  11 个对应变异全部在仓库外副本中被断言捕获。
- 全部 IPC Java 文件用真实 Android 4.1.1.4 / AOSP org.json API 加 Capacitor 替身编译为 exit 0；
  这是 API 编译证据，不是 targetSdk 36 的完整 APK 构建。当前 SDK 的实际编译仍须以新提交的 CI 为准。
- 本轮验证日志在 `%TEMP%/rain-android-music-add-20261014/`；原 30 项用户改动的 hash 仍与接手快照一致。

---

## 5. ✅ 曾经的唯一阻塞（已修复并推送）—— 但它留下一条最重要的教训

### 真错误（由 CI annotation 报出，精确到行）

```
android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicListWriteChannels.java:870: error: unreported exception JSONException; must be caught or declared to be thrown
android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicListWriteChannels.java:869: error: unreported exception JSONException; must be caught or declared to be thrown
```

**根因**：`org.json` 的 `JSONObject.put(...)` 抛**受检异常** `JSONException`，那两行没捕获也没声明 ⇒ Java 从来没编译过。

**为什么本机没发现（本会话最深的一条教训）**：各刀用的"真 javac + 手写替身"探针里，**替身把 `put` 声明成了不抛异常的版本** ⇒ **替身比真机宽松**，于是**系统性地**接受了编译器会拒绝的代码。
⇒ **替身必须逐字照抄真实签名（含 `throws`）**，否则"本机编译通过"这句话不成立。

### 修复结果（已提交推送，HEAD `21bffcec`；单测 368/368 全绿）

**修法是"声明 `throws JSONException`"，不是"包装成未受检异常"。** 依据：本文件的**零 `catch` 是被用例钉住的**（`android-list-write-channels.test.cjs:654,671` 断言 `!/catch\s*\(/`），包装必然引入 catch ⇒ 要放宽两条断言。而 `RainMusicIpcHandlers.Handler.handle(...) throws Exception` ⇒ 声明的异常冒泡进 `dispatch` 的 catch ⇒ `ok:false` + 原始异常，正是本文件文档化的语义。
（⚠️ `21bffcec` 的提交信息说异常"is wrapped into the same unchecked type"，**与代码不符** —— 已由后续更正提交记录在案。以代码为准。）

**替身签名已按真产物修正**：出处是本机 `~/.m2` 里真 AOSP org.json 的编译产物（`javap`）+ AOSP libcore 源码，逐条一致。

**仓库外真 javac 证据**（`%TEMP%\rain-json-probe`，非仓库内）：
```
旧宽松替身 + 修复前文件      → exit 0     ← 复现当初的漏检
新严格替身 + 修复前文件      → exit 1，恰好 :869/:870 报 JSONException
新严格替身 + 当前文件        → exit 0
真 AOSP org.json jar + 当前文件 → exit 0
真 android.jar + 真 org.json  → exit 0
整模块 13 文件（修复前）      → 恰好 2 个 error，都在 869/870  ⇒ CI 的 10 条 annotation 上限没有掩盖别的错误
```
**新增负向回归守卫**：用同一套替身编一个"故意不处理 `JSONException`"的调用方，断言 javac 非 0 **且失败原因就是 JSONException** ⇒ 替身一旦再变宽松就会变红（368 例）。

**遗留待办（2026-10-15 已关闭第 1 条）**：

1. ~~测试里的 `android.*` 替身签名**没有对着真 `android.jar` 核过**~~ —— **已核**。
   用 `%TEMP%\rain-json-probe\vendor\android-4.1.1.4.jar`（真 Android 4.1.1.4 `android.jar`）
   对 4 个 `android.*` 替身逐方法 `javap` 比对，结论：**没有“替身比真 API 宽松”的缺陷**，
   所有差异都在**更严格**一侧（替身方法更少、或多了 `throws`）：

   | 替身（`tests/unit/fixtures/`） | 真 API | 结论 |
   |---|---|---|
   | `android-music-add/Cursor.java`：`public final class Cursor` | `public interface android.database.Cursor extends java.io.Closeable` | `getColumnIndexOrThrow` / `isNull` / `getString` / `getLong` / `getInt` / `moveToNext` / `moveToFirst` / `close` **签名逐个吻合**。类 vs 接口的差异只影响“能不能 `new`”，而生产代码**从不** new 它（只有替身自己 new）⇒ 不产生假通过 |
   | `android-music-add/SQLiteDatabase.java` | `public final class … extends SQLiteClosable` | `rawQuery(String,String[])` / `beginTransaction()` / `setTransactionSuccessful()` / `endTransaction()` 逐字吻合；`execSQL(String,Object[])` 真 API 声明 `throws android.database.SQLException`（**未受检**，继承 `RuntimeException`）而替身不声明 ⇒ 无影响；替身 `close() throws Exception` 比真的**更严** ⇒ 只会误报、不会漏报 |
   | `android-playback-restore/Context.java` | `public abstract class android.content.Context` | `MODE_PRIVATE` / `getApplicationContext()` / `getSharedPreferences(String,int)` 逐字吻合；真类是 **abstract** 而替身可 `new` ⇒ 只有**探针脚手架**会 new 它，生产代码从不 new |
   | `android-playback-restore/SharedPreferences.java` | `interface` + 嵌套 `Editor` | 替身是**真 API 的子集**（少了 `getAll` / `getInt` / … ），`putString` 返回 `Editor`、`commit` 返回 `boolean` 与真的一致 ⇒ 更严格，安全 |

   **仍然没有核对的一项**：`com.getcapacitor.*` 那套替身（`Plugin` / `PluginCall` / `JSObject` / `JSArray` / `Logger` …）
   本机**拿不到真的 Capacitor 制品**（`~/.gradle/caches/modules-2` 不存在，无法 `javap`）。
   这一项只能靠 **CI 的 `gradlew assembleDebug`** 兜底 —— 它能抓编译错误，抓不到“替身语义更宽松”。
2. 真 `assembleDebug` 仍未在本机跑过（**无 Android SDK**；`ANDROID_HOME` / `ANDROID_SDK_ROOT` 均为空，
   `%LOCALAPPDATA%\Android\Sdk` 不存在）。本机只有 JDK 20（`javac` / `javap` 可用）。
3. 另两套 org.json 替身负向用例已于 2026-10-14 补齐，并做了仓库外变异验证（见 §3）。

### 复核清单（若要重跑这次修复的验证）

1. **确认修复的最终状态**：跑 `node --test tests\unit\*.test.cjs`，看 `ℹ tests/pass/fail` 三个数。当前目标是 **≥370 且 fail 0**（本次接手前为 368）。
   - 若仍有失败：读失败断言，判断是"替身同步未完成"还是"生产代码还有同类受检异常处"（后者必须修）。
   - **并检查**：`RainMusicListWriteChannels.java` 里**所有** `JSONObject.put` / `JSONArray` 方法 / `new JSONObject(String)` 等受检异常点是否都处理了，**不只那两行**。
2. 若产生新的代码修复，再遵守完整提交门（见 §7）；不要重复提交已经落地的异常声明修复。
3. `57089fe4` 的两项 CI 已确认转绿；以后改原生代码要查询新提交对应的 check-runs，不能沿用本次结果。

---

## 6. 未完成的工作

| 阶段 | 状态 |
|---|---|
| **阶段 3 的播放验收** | 代码链已接通音源、媒体缓存与恢复；真实Chromium联调通过，Android端到端待验 |
| **阶段 4 的歌单部分** | 歌单与歌曲全部既有读写/排序通道已接入；真机多窗口/重启待验 |
| **阶段 4 的下载部分** | 持久化、原生HTTP/断点传输、歌词/MP3标签和文件读取已接入；真机待验 |
| **阶段 5 自定义源** | Worker宿主、lx/rain、8条IPC、本地文件选择、取消/切源已接入；社区脚本兼容矩阵及真机待验 |
| **阶段 6 打包与验收** | 构建门与本地探针已建立；最新SHA CI和设备安装/运行分别核验 |

### 6.1 原生侧**完全没有注册**、而渲染层**会调**的通道（2026-10-15 实测）

做法：脚本化比对 `src/common/ipcNames.ts` 的全部通道（`${模块名}_${键名}`，**注意是键名不是字面量**，
见 `ipcNames.ts:178-183` 那个自改写循环）与 11 个 Java 通道类里 `RainMusicIpcHandlers.register(...)` /
`bind(...)` 的实参。原生登记 **48 条**；下面的差额是**逐条追过调用点**的（`file:line` 为证据）：

| 功能面 | 未注册的通道 | 渲染层调用点（已核） | 现象 |
|---|---|---|---|
| **主题**（7 条） | `winMain_get_themes`、`winMain_save_theme`、`winMain_remove_theme`、`winMain_theme_file_import`、`winMain_theme_file_copy`、`winMain_theme_file_move`、`winMain_theme_file_remove` | `src/renderer/store/utils.ts:33`（`getThemes`）← `SettingBasic.vue:86`、`ThemeSelectorModal.vue:65`、`ThemeEditModal/index.vue:357`（都是**真实调用点**，不是 import 行）；`src/renderer/platform/themeFiles.js` ← 主题图片导入/复制/移动/删除 | **主题列表为空、切换主题无效**；且 `store/utils.ts:38` 的 `void getTheme().then(...)` **没有 `.catch`** ⇒ 打开主题设置页会留下**未处理的 rejection**。主题图片文件操作会拿到 `IPC_CHANNEL_UNSUPPORTED` |
| **不喜欢**（4 条） | `dislike_get/add/overwrite/clear_dislike_music_infos` | `src/renderer/core/dislikeList.ts:8,17,21,25`（真实调用）← `useDataInit.ts:107`（**已有 skippable 兜底**，跳过初始化）、`player/action.ts:651`（"不喜欢这首歌"）、`DislikeListModal.vue:30`（设置页规则编辑） | 初始化被**有意跳过**；但"不喜欢某首歌"与设置页的规则编辑**没有兜底** ⇒ 报错 |
| **换源缓存**（4 条） | `winMain_get/save/clear_other_source`、`winMain_get_other_source_count` | 仅 `src/renderer/core/music/local.ts:21,25,31,44,50,56`（**本地音乐**匹配用） | 运行期"找其他音源"走的是 `core/music/utils.ts:21` 的 `musicSdk.findMusic`，**不走**这 4 条 ⇒ **不属于首版阻塞**；本地音乐功能本来就未开放 |
| **音效预设**（4 条） | `winMain_get/save_sound_effect_eq_preset`、`winMain_get/save_sound_effect_convolution_preset` | `src/renderer/store/soundEffect.ts:16,23,33,46,53,63` ← `components/common/SoundEffectBtn/*.vue` | 进入音效设置并打开预设列表时报错 |
| **启动参数**（1 条） | `common_get_env_params` | `src/renderer/core/useApp/index.ts:103` | **已按设计降级**（`invokeWithFallback` → 渲染层默认值）；这条**不是**缺口，登记在此仅为对齐契约 |
| **初始化握手**（1 条） | `winMain_inited` | `src/renderer/utils/ipc.ts:26`（`sendInited()`） | `send` 到无 handler 的通道 ⇒ **每次启动一条 `console.error`**（`deliver()` 的失败分支，不静默、也不崩）。原生侧没有 `main_window_inited` 的消费者（桌面歌词窗口在 Android 不存在） |

**另外一批同样未注册、但本轮没有逐个追调用点的 C 类通道**：`winMain_get_cache_size`、`winMain_clear_cache`、
`winMain_show_save_dialog`、`winMain_open_dir_in_explorer`、`common_get_system_fonts`、`winMain_set_power_save_blocker`、
`winMain_set_app_name`。它们都是**桌面专有或设置页专属**，需要时按 §4.3 的降级方案补。
（`common_get_system_fonts` 在渲染层已有 `.catch(() => [])`，见 `utils/ipc.ts:230-232`。）

> **结论**：首版范围（听歌 + 歌单管理 + 下载）的通道**已经齐了**；上面这些是**范围之外**的功能面。
> 但其中**主题**是用户明确点过名的方向，而且它是**唯一**会出现"未处理 rejection + 功能静默为空"的一块，
> 所以要么补原生实现，要么在渲染层按既有 `ipcFallback` 体例显式降级 —— 不要让它停在现在这个状态。

### 6.2 下载执行层：独立审查确认的 8 处与桌面不一致（**本轮修了 6 处，剩 2 处**；2026-10-15）

审查对象：提交 `2a3e4a7c` 的 `RainMusicDownloadTaskChannels.java`。方法：把原生行为逐条与桌面
`src/renderer/worker/download/download.ts`、`src/common/utils/musicMeta/mp3Meta.js` 对照。
**下面每一条都是"实现与桌面契约不一致"，不是"本机跑不过"** —— 现有用例全部通过，缺口是**覆盖真空**。

| # | 严重度 | 原生位置（`…/ipc/RainMusicDownloadTaskChannels.java`） | 桌面依据 | 差异与后果 |
|---|---|---|---|---|
| 1 | **high** | `:151` `if (task.skip \|\| …)` 实为 `if (task.skip && task.file.exists()) throw` | `download.ts:73-84` | 桌面的"跳过已存在文件"检查**在 `downloaded == 0` 分支里**，且只把 `size > 100` 当"已存在"（≤100 字节视为没有，直接重下）。原生是**无条件**抛。⇒ `downloaded > 0` 的重试、以及 ≤100 字节的残留，桌面能继续、Android 直接 `error`；若残留来自"文件已改名但 DB 没来得及记完成"（下载 store 的写入是 **100 ms 节流**，`store/download/action.ts:24-28`），这条记录会**永远**下不了 —— 唯一出路是用户自己去关掉"跳过已存在文件" |
| 2 | medium | `:271-273` | `mp3Meta.js:17,29-36` | 桌面封面下载**失败就 `delete meta.APIC` 然后照写标签**（非 `http` 的 APIC 也走这条）；原生封面一失败就抛，整个 `write_meta` 作废 ⇒ 一次封面 404 / 超时 / **webp**（原生只认 JPEG/PNG）/ 超过 8 MiB，会让**标题、歌手、专辑和 USLT 歌词全部写不进去** |
| 3 | medium | `:183`、`:188` + catch `:221-223` | `download.ts:145-155` | 桌面在 `err.message.startsWith('Resume failed')` 时**先删掉那个不完整的文件再重启**；原生 resume 校验失败只抛，`.part` / `.resume` 原样留着 ⇒ 下次重试发出**一模一样**的 `Range` + `If-Range`、得到一模一样的失败 ⇒ **永久卡死**（而 `:131-133` 的 `remove` 又刻意保留这两个文件） |
| 4 | medium | `:131-133`（注释"`A .part` is retained too"）、`:152-153` | `download.ts:317-325` | 桌面 `removeTask` 会删掉未完成的媒体文件；原生**从不回收** `.part` / `.resume` / `.resume.part` / `.meta.part`。下载目录是**应用私有目录**、用户看不见 ⇒ 空间**只能靠清应用数据**回收 |
| 5 | low | `:221-223` | `download.ts:130-143,167-178` | 桌面失败**最多重试 3 次**（`retryNum > 2`）并延时 1 s，`ENOTFOUND` 还会发 `refreshUrl`；原生一次失败直接 `error` ⇒ 移动网络抖动下 Android 失败而桌面能自愈 |
| 6 | low | `:266` | `mp3Meta.js:9-12` | 桌面 USLT 的 `language` 是 **`'zho'`**；原生写 `'eng'` ⇒ 同一首歌两个平台带不同的歌词帧 |
| 7 | low | `:271` | `mp3Meta.js:28` | 桌面给 `music.126.net` 的封面 URL 追加 `param=500y500`；原生没有 ⇒ 网易云封面按 CDN 默认尺寸取（图不一样），也是第 2 条的额外触发源 |
| 8 | low | `:215-219` | 桌面没有"先改名再删清单"这一步 | `move(part, task.file)` **先提交**、`manifest.delete()` 后执行，两步都在 `synchronized(gate)` 里；删清单失败会抛进 `catch`，把**已经成功的下载**报成 `error` ⇒ 文件在、状态是失败，且没有可恢复路径 |

> **审查者引用错了一个路径**：它给的 `Downloader.ts:301-310` —— **这个文件不存在**。
> 真正的桌面依据是 `src/renderer/worker/download/download.ts:145-155`。
> **"依据优先于权威"对审查结果同样适用**：本节每一行都是我按上表两侧路径复核过的。
> （这也解释了为什么"子代理说的"不能直接当结论。）

#### 6.2.1 本轮已修（第 1、2、3、6、7、8 处）

改的全在 `RainMusicDownloadTaskChannels.java` 一个文件里，主题是**"一次失败或一次续传之后，任务必须还能恢复"**：

1. **第 1 处（high）**：`transfer()` 里的 skip 检查改成桌面那条三门条件
   —— `task.downloaded == 0 && task.skip && file.isFile() && file.length() > 100`。
   为此 `Task` 多带一个 `downloaded` 字段，由 `start()` 从 `downloadInfo.downloaded` 读（新增
   `number()`：**缺省当 0，类型不对大声抛**），`update_url()` 换 URL 时把它带过去。
   `skip == false` 分支不预先删文件 —— 下面的 `move()` 是**原子替换**，等价于桌面的先删后写（已写进注释）。
2. **第 3 处**：新增 `resumeRejected(part, manifest, offset, message)`，在**四个**"服务器明确拒绝这次续传"的
   抛出点（编码异常、重定向目标变了、`Content-Range` 非法、range/校验子对不上）先删掉
   `.part` / `.resume` / `.resume.part` **再**抛同一条错误。
   - **只**对这些场合调用：5xx / 超时 / 断流这类**瞬时**错误**不丢进度**。
   - `offset <= 0` 时没有 `.part` 可丢，直接返回原错误。
   - **清理失败不吞**：把它并进错误信息（"…；且无法清理部分下载文件：<路径>"），
     所以调用方看到的仍是一条大声的失败，而不是"重置成功"。
3. **第 2 处**：封面改成**尽力而为** —— 取图/识别格式失败只**丢掉 APIC**，标签其余部分照写
   （桌面 `mp3Meta.js:29-36` 就是这个形状）。非 http(s) 的 APIC 也由此自然落到"丢掉继续写"。
   为此把代理求值提到 try 外（代理坏了仍然大声抛），并新增 `coverUrl()`（第 7 处）。
4. **第 6 处**：USLT 的 `language` 由 `'eng'` 改成桌面用的 `'zho'`。
5. **第 7 处**：新增 `coverUrl()`，对含 `music.126.net` 的封面 URL 追加 `param=500y500`
   （分隔符按 URL 里有没有 `?` 选 `&`/`?`，与 `mp3Meta.js:28` 一致）。
6. **第 8 处**：完成路径改成**先删清单、再改名**。删不动就抛，而那时媒体文件还没提交
   ⇒ 这次失败是"什么都没发生"（`.part` 还在、可重试），而不是"文件已经落盘了却报 error"。

**证据**：

- 探针 `tests/unit/fixtures/android-download-runtime/DownloadRuntimeProbe.java` 新增/改写了断言：
  `tiny`（≤100 字节残留必须能下）/ `existing`（>100 字节且 `downloaded==0` 必须被保住）/
  `resumed`（`downloaded>0` 时不能被自己的文件挡住）/ 被拒续传必须丢掉 `.part` 与 `.resume`
  并且**再试一次必须成功**（`bad` 那条）/ `changed-etag`、`redirect` 也要丢清单 /
  USLT 的 `zho`（**只在 ID3 标签区间内**按字节找，避免碰随机音频数据）/
  `music.126.net` 必须带 `param=500y500`（服务器记下真实 query 再比对）/
  封面 403 后**标签仍要写成**、其余帧不许丢、`APIC` 不许嵌入。
- `tests/unit/android-download-runtime-native.test.cjs` 新增第 3 个用例，用**源码顺序**钉住第 8 处
  （"先删清单再改名"）。之所以用源码顺序：JVM 探针**没法**只让 `delete()` 失败、而让更早的
  清单**写入**成功（把清单做成非空目录会让写入就先炸），所以这条排序性质在这台机器上
  **无法用运行时断言表达** —— 与仓库里 `MainActivity` 注册顺序的做法同型，**不是**在测实现细节。
- **6 个变异全部被捕获**（注入在仓库外副本 `%TEMP%\rain-dl-mut\<kind>\`，用
  `RAIN_DOWNLOAD_JAVA_SOURCE` 指过去；一处在仓库文件上都没改）：

  | 变异 | 被哪条断言抓住 |
  |---|---|
  | 还原无条件 skip 检查 | `tiny missing complete`（error 文本正是 "Destination already exists"） |
  | `resumeRejected` 不删部分文件 | `a rejected resume must discard the unusable partial` |
  | USLT 写回 `eng` | `USLT language must match the desktop (zho, not eng)` |
  | 让封面失败重新中断整个写入 | `java.io.IOException: Cover HTTP 403` 直接穿出 `write_meta` |
  | 去掉 `param=500y500`（换成 999x999） | `a music.126.net cover must get the desktop's param=500y500 rewrite` |
  | 换回"先改名再删清单" | `the manifest must be deleted BEFORE the rename…` |

#### 6.2.2 仍然没修（第 4、5 处）—— **需要先拍板，不是漏掉**

- **第 4 处（部分文件永不回收）**：`cancel()` 保留 `.part` / `.resume` 是**代码里写明的有意选择**
  （"删掉记录再重建可以安全续传"），而桌面 `removeTask` 会回收。两个方向都有道理：
  保留 = 省流量；回收 = 省空间（且用户看不见那个私有目录）。
  **本轮不动它**，因为改错方向会退化一个明确写下来的特性。要改的话请先定：删除记录时
  是"保留进度"还是"释放空间"，或者给一条显式的清理入口。`.meta.part` 在失败路径上**已经**会删。
- **第 5 处（没有有界重试）**：桌面失败会**重试 3 次**（`retryNum > 2`，延时 1 s，`ENOTFOUND` 还会
  发 `refreshUrl`），原生一次失败直接 `error`。补它要同时定"重试期间怎么发事件"
  （进度事件会重复、`error` 只该在最后一次发），而且会改动 façade 与 store 的现有期望
  ⇒ 单独立一刀，别混在本次的"可恢复性"修复里。

**审查同时确认了这些部分是对的**（记下来，避免下一个人重查一遍）：

- `RainMusicDownloadChannels.java` 的 SQL 文本、13 列顺序、`isComplate` 拼写、
  `ORDER BY "position" ASC`、7 列 UPDATE 的 set 与 where，与 `statements.ts:7-72` **逐字一致**；
  追加取行数、`top` 取 `0..n-1`（含空 `top` 的压紧）与 `index.ts:70-83` 一致。
- 事务（`beginTransaction` / `setTransactionSuccessful` / `finally endTransaction`）、
  与歌单写通道**共用同一把** `RainMusicListWriteLock.LOCK`、**不发任何广播**（桌面 `download.ts` 也不发）
  —— 都符合"提交后再发、锁外发"的规矩。
- 失败形状诚实：坏 `musicInfo` JSON 冒泡、缺表 / 打不开库抛 `IllegalStateException`、
  重复主键与批中 SQL 失败都回滚、`update` 未知 id 是 0 行的空操作
  （与 better-sqlite3 行为一致，**不是**静默成功）；所有 `JSONObject.put` 的受检异常都处理了。
- `JSArray.toList()` 确实返回裸 org.json 对象（对着**已安装**的
  `node_modules/@capacitor/android/.../JSArray.java:28-40`、`PluginCall.java:306-320` 核过），
  渲染层的参数形状（`[params]` / `[list]` / `[ids]` / `[]`）与 `ipcBridge/capacitor.js` 的 `normalizeArgs` 对得上。
- 频道名与 `ipcNames.ts:143-154` 一致；URL 身份两侧都走 `toExternalForm()`（**没有**百分号编码不一致的缺口）；
  `safeFile` 的目录穿越防御用"带尾分隔符的前缀比较"。
- Range / 206 / `.part` 的运算**没有 off-by-one**；`id` + 原始 URL + 重定向目标三者绑定正确。
- 原子改名（temp + `Os.rename`，改名先 fsync）、`Properties.store` 之后 `getFD().sync()`、
  ID3 头（synchsafe 长度）与 v2.2/2.3/2.4 帧头算术都正确。
- **编码对齐**：GBK 两侧都不写 BOM（实测 `iconv-lite` 的 `addBOM` 对 GBK 是空操作），UTF-8 BOM 与桌面一致。
- `.mp3` 判定用 `toLowerCase(Locale.ROOT)`，两个文件里没有 `trim()` / 默认 Locale 比较
  ⇒ **§8 第 2 类（Java/JS 去重键不等价）缺陷在下载执行层不存在**。

### 6.3 歌单写入 / 媒体缓存 / 播放队列恢复：独立审查确认的问题（**已确认、未修**；2026-10-15）

审查对象：`RainMusicListMutationChannels.java`、`RainMusicMediaCacheChannels.java`、`RainMusicPlaybackQueueRestore.java`。
审查者另外用**真 Java + 真 SQLite** 探针跑了 16 个作者用例之外的场景（`%TEMP%\rain-review-probe\probe.cjs`）。
**结论：没有 blocker** —— 去重键、事务原子性、提交→广播 FIFO、快照同事务、base64 歌词语义、恢复顺序都**忠实**。
问题集中在 `data_overwire` 的**入参宽容度**，以及两处**替身/校验的严格度**：

| # | 严重度 | 位置 | 桌面依据 | 差异 | 我复核到什么程度 |
|---|---|---|---|---|---|
| L1 | medium | `RainMusicListMutationChannels.java:170`（`ListRow(JSONObject)` 用 `string(o,"id",true)` / `string(o,"name",false)` / `nullableString(…)`） | `src/main/event/ListEvent.ts:18-31` 的 `fixListIdType`（把数值型 `sourceListId`/`id` 转成字符串后再覆盖）；`.../list/statements.ts:30`（数值绑进 TEXT 列靠 affinity 也能写） | 旧备份 / 分享导入里带**数值型** id 时，桌面归一化后照常导入，Android **整单拒绝**（渲染层确实能产出这种载荷：`SettingBackup.vue:108-128` 直接透传 `list.id`） | **两侧代码都读过，成立** |
| L2 | medium | `:121` `if (groups.containsKey(row.id)) throw … "Duplicate or reserved list id"` | `.../list/index.ts:401-417`（不按 id 过滤，任何 userList id 都插） | `data_overwire` 的 userList 里出现 `default` / `temp` 会让**整单失败**；桌面会插进去。而这条拒绝**没有文档**（`ipc-contract.md:129` 只写了 `player_list_remove` 的保留 id；`continuation-2026-10-15.md:7` 只写了重复 id 回滚） | **已复核**。并同意审查者的判断：**保留 id 的拒绝本身站得住** —— 真插进去以后 `player_list_remove` 又拒绝保留 id ⇒ 那一行**永远删不掉**。所以这里要的是**拍板 + 写进文档**，不是照桌面改 |
| L3 | low | `:59` 拒绝 `fromId == toId` | `.../list/index.ts:292-324` 允许同歌单移动 | 同歌单移动在桌面合法、Android 直接拒 | **未逐行复核**。审查者说当前 UI 到不了（`useListInfo.js:12`、`FavoriteButton.vue:44` 已排除源歌单）⇒ 先记为"待确认的死输入" |
| L4 | low | `:16,21,33` 在 `player_list_music_clear` 上广播 | `winRendererEvent.ts:51-53` 桌面把 `list_music_clear` 发在 `player_list_data_overwire` 上，**而桌面自己的订阅者挂在 `list_music_clear`**（`rendererListManage.ts:239`） | 桌面这条广播**自己接不到**；Android 选了唯一能被消费的那个 | **未复核**。`clearListMusics` 当前**没有活调用者** ⇒ 记录为**有意分歧**即可，别为它改代码 |
| L5 | low | `:164` `meta=object(o.opt("meta")).toString()` ⇒ `meta:null` 抛 "Expected object" | `.../list/index.ts:44` 的 `JSON.stringify(info.meta)` ⇒ 落库成文本 `"null"`；而 Android 自己的**读**路径容忍 NULL meta（`RainMusicListMusicGetChannels.java:574-588`） | 一条 meta 为 NULL 的行，会让它**所在的歌单再也写不进去** | **部分复核**（写侧的 `string/object` 用法读了；读侧的容忍未读） |
| L6 | low，**但属于本项目最深的那条教训** | `RainMusicMediaCacheChannels.java:107` 用**严格**的 `android.util.Base64.decode(text, DEFAULT)` | `src/main/worker/dbService/modules/lyric/index.ts:49-54,80-81` 用 `Buffer.from(text,'base64')`（**宽容**） | **测试替身比真 API 宽松**：`android-media-cache-channels.test.cjs:47` 把 `decode` 实现成 `java.util.Base64.getMimeDecoder().decode(text)` —— MIME 解码器**忽略字母表外的字符**，而真 `android.util.Base64.decode(String,DEFAULT)` 对坏 base64 **抛 `IllegalArgumentException`** ⇒ 一条坏歌词行在**真机上抛错**、在桌面上返回宽容解码的文本 | **已复核**（替身源码 + 真 `android-4.1.1.4.jar` 的 `javap` ABI）。**这就是 §5 那条"替身必须逐字照抄真实行为"的同类问题**，只是这次差在**行为**而不是**签名** ⇒ **CI 编译抓不到**。两件事要分开做：(a) 先把替身改成与真 API 同严格（否则本机结论继续不成立）；(b) 再决定坏 base64 到底该抛还是该宽容 |
| L7 | low | `RainMusicPlaybackQueueRestore.java:16-20`：非整数 `index` 抛错 | `.../list/index.ts:210-216` 返回 `-1`（容忍垃圾） | 损坏的 `playInfo` 会让启动期 `get_data` **抛**，而桌面返回 `null` | **前半已复核**（restore 的抛错代码读了）。⚠️ 审查者给的第二个位置 `RainMusicDataChannels.java:129-131` **对不上** —— 那几行是 `saveData` 的"缺 `data` 字段"报错，**不是** playInfo 类型校验 |

> **两位审查者一共给错了两处引用**（`Downloader.ts:301-310` 那个文件根本不存在；`RainMusicDataChannels.java:129-131` 对不上）。
> **引用本身不是证据** —— 本文档只保留我实际复核过的 `file:line`。**"依据优先于权威"对审查结果同样适用。**

**审查确认"没问题"的部分**（记下来，省下一次重查；两位审查者的结论一致）：

- **命名**：8 条 mutation + 13 条媒体缓存通道名与桌面键名派生的名字**逐个一致**；
  `ipcNames.ts:178-183` 是拿**键名**拼前缀，所以 `winMain_get_palyer_lyric`（那个拼错的）**确实是**真通道名 ——
  "拼写属于 ABI"的注释是对的。
- **广播**：8 条 mutation 的广播载荷 = 调用方原载荷，且**只在提交之后、锁之外**发
  （探针实测 `locked=false`、`commits>0`）；失败路径**不发**。
- **原子性**：每一条多表 mutation 失败时**所有表一起回滚**且不发广播（探针：`rollbacks=1`、`events=[]`、DB 复原）。
- **FIFO**：前一个事件发布失败**不会**吃掉后面的事件，失败只返回给**它自己那张票**
  （`android-music-add-channels.test.cjs:171` 的 `QueueFailureProbe.java` 已证）。
- **去重等价**：`dedupe()` 与 `filterPlaybackQueueAdditions` / 普通 id 集合过滤**等价**
  （复用已复核的 NFKC + JS `trim` + `Locale.ROOT` 键）。
- **顺序语义**：追加 = 末行 order+1 且**保留空洞**；`top` = 删 order + 重编号；
  `update_position` = 整表重编号 + `Math.min(position,len)`，**负数 = len+position**；
  `music_update_position` 在写 SQL 之前就拒掉未知/重复 id。
- **`data_overwire` 步骤序**（`my_list` 删+插 position=index → 两张音乐表清空 → default/temp/user 顺序写入、
  order 每个歌单从 0 重新开始）与 `overwriteListData` **一致**；`tempList` 只在键缺失/为 JSON null 时回落到读库（`??` 语义）；
  `love` 被接受。
- **媒体缓存**：13 通道、载荷形状对齐 `rendererEvent/music.ts:7-58` 与 `utils/ipc.ts:502-544`；
  **不发广播**；三个新文件里 **`catch` 数为 0**；UTF-8 base64 用 `NO_WRAP`；保存是追加；
  每种类型**最后一行胜出**；计数是**行数**；raw/edited 隔离（含历史 edited 行）；
  `get_palyer_lyric` 在主歌词为空时回落 raw 且**总是**带 `rawlrcInfo`；缺表/计数失败**大声抛**。
- **恢复**：严格 JSON 校验（尾部垃圾拒绝）；无快照时回落读库；先按 musicId、再按快照下标定位；
  再按 id + 身份键与**去重后的当前队列**重新比对；未命中返回 `null`（**不是**半成品对象）且**不删快照**；
  persist→complete 的顺序与 `data.ts:7-25` 一致，`complete()` 先按键删再清 `queueStartupRestorePending`
  （与 `dbService/index.ts:218-221` 同序），两个调用者都持列表锁 ⇒ **不会删掉更新的队列状态的快照**。

### 6.4 渲染层 / Web 侧：独立审查确认的问题（**W1、W2 本轮已修**；2026-10-15）

审查对象：提交 `2a3e4a7c` 的渲染层新代码（`userApi/{host,worker-runtime,web,contract}.js`、
`platform/download/{android,pure}.ts`、`filePicker/web.js`、`fs/web.js`、`fileUrl/web.js`、
`musicMetadata/web.js`、`workers/web.ts`、`webpack.config.web.js`）。作者自己的 23 个用例全过。
**结论：没有 blocker，但有一条 high，而且它正打在首版范围的「自定义源」上。**

| # | 严重度 | 位置 | 桌面依据 | 差异与后果 | 我复核了吗 |
|---|---|---|---|---|---|
| **W1** | **high** | `src/renderer/platform/userApi/web.js:38` —— 把 `json: false` **写死**给每一次社区脚本请求 | `src/main/modules/userApi/renderer/preload.js:172-188`（**只有** `form`/`formData` 才置 `json = false`，`body` **不置**）+ `vendor/needle/lib/needle.js:305-306` | 脚本用 `body`（对象）+ `Content-Type: application/json` 发 POST 时，桌面发 `{"a":1}`、Android 发 `a=1`，而**头仍然是 json** ⇒ 服务器按 JSON 解析直接失败。**一整类社区音源脚本在 Android 上不可用** | **已复核 + 本轮已修** —— 见 §6.4.1 |
| W2 | medium | `userApi/host.js:123` + `worker-runtime.js:31-32` | `preload.js:163` `if (isInitedApi) return` | 初始化**成功之后**，脚本里任何一次未捕获错误 / 未处理 rejection 都走 `fatal` ⇒ 状态翻假、worker 终止、在途请求 reject、弹"源码初始化失败"。**一个本来能用的源被一次异步小错毁掉** | **已复核 + 本轮已修** —— 见 §6.4.3 |
| W3 | medium | `userApi/contract.js:18-22`（经 `host.js:115-119`） | — | `filterSources` 会留下 `actions` 被过滤**空**的平台，而"一个可用平台都没有"也被当**成功**发布（`{status:true,sources:{}}`）⇒ 就绪闸门打开、`assertApiSupport()` 为真，但 `userApi.apis[source]` 里没有 `getMusicUrl` ⇒ 播放死在后面的 TypeError 上，而不是在初始化时就明确报错 | 未复核 |
| W4 | medium | `filePicker/web.js:27` + `selectedFiles.js:2` + `renderer/utils/music.ts:83,90-91` | — | 选择器返回的是**会话级 `blob:` URL**，全仓只有 `UserApiModal.vue:95` 会释放；本地音乐那条路把 blob URL **当成歌曲身份持久化** ⇒ 重载后是一堆**永远播不了的歌**，且 File 句柄泄漏整场 | 未复核 |
| W5 | low | `userApi/worker-runtime.js:25` 的能力黑名单 | — | 漏了 `navigator.sendBeacon`（Beacon 是 `[Exposed=(Window,Worker)]`）⇒ 脚本仍可绕过父侧那条被校验的 HTTP 通道直接外联 | 未复核（需真机 WebView） |
| W6 | low | `filePicker/web.js:7` + `views/Setting/components/SettingDownload.vue:31-38` | — | `openDirectory` 明确 reject，但那个调用点**没有 `.catch`** ⇒ Android 上点"选择保存目录"**静默无反应** | 未复核 |
| W7 | low | `filePicker/web.js:34` | — | 取消判定靠 `focus` + 300 ms 定时器读 `input.files`；WebView 若"先 focus、后填 FileList"，会把**真选择当成取消**静默丢掉 | 未复核（需真机） |
| W8 | low（**旧问题**，不是本次引入） | `build-config/renderer/webpack.config.web.js:46-96` + `src/common/utils/index.ts:1` | — | web 产物里**仍然有 `electron-log` 的 Node 构建**（`src/node/*`、File transport、`fs` 被替成空模块）⇒ 配置里"没有任何 Node-only 模块能进 web 产物"这句话对**日志**这条不成立（只在真写日志时才炸，而且被 electron-log 自己吞掉） | 未复核 |
| W9 | low（文档 vs 代码） | `docs/android/user-api-host.md:23` vs `userApi/host.js:192` | — | 文档说 `user_api_status` 事件能观察到 `initing`，而 host **刻意不发布**这个状态（发了会让渲染层就绪闸门按终态失败结算）；另外"移除活动源"的失败事件不带 `apiInfo`，渲染层会静默忽略 | 未复核 |
| **W10** | medium（**本轮新发现**，不在原审查清单里） | `userApi/web.js` 的 `userApiHttpRequest` | `preload.js:180-185`（桌面把 `formData` 交给 needle 发 multipart） | 适配器**完全忽略 `formData`**：既不把它当 data，也不置 `json`，等于发一个**没有 body** 的请求。桌面那条路是能用的 ⇒ 用 `formData` 的社区脚本在 Android 上会静默发出空请求 | 已复核（我改 W1 时读出来的）。**本轮没修**：修它需要 `platform/http/web.js` 支持原样 body（`FormData`/`Blob`/`URLSearchParams` 直传 + 不自动写 Content-Type，让 fetch 自己产生 multipart boundary），那是另一件事，已登记 |

#### 6.4.1 本轮已修：W1（自定义源的请求体编码）

**根因有两处，必须同时改**（这是审查者没说全的地方）：

1. `src/renderer/platform/http/web.js` 的 `buildRequest` 里原来是
   `const json = options.json === true` —— **完全没有实现** needle 那条
   "`options.json !== false` 且（小写）`content-type` **字面等于** `application/json` 就算 json"
   的规则（`vendor/needle/lib/needle.js:305-306`）。只把 `userApi/web.js` 的 `json: false` 去掉
   **不够** —— 请求照样会被表单序列化。
   现在补成 `Boolean(explicitJson) || (explicitJson !== false && headerValue(headers,'content-type') === 'application/json')`，
   并新增 `headerValue()` 做**大小写不敏感**取值（needle 那边 headers 是规范化成小写的）。
   **两条容易踩的细节，都照抄了 needle**：
   - 比较是**字面相等**：`application/json; charset=utf-8` **不**触发（放宽它就会与桌面产生新的不一致）；
   - 下面那条 `Accept` 规则用的是 **`options.json`（选项本身）**，不是这个派生值 —— needle 源码就是
     这么写的，混用会给"靠头推导出 json"的请求多加一个 `Accept`。这一点**只有真的去读 needle 才能发现**。
2. `src/renderer/platform/userApi/web.js` 的 `userApiHttpRequest` 把 `json: false` **写死**在每次请求上
   （显式 `false` 会压过上面那条规则）。改成与桌面 `preload.js:172-188` 同形：
   `body` ⇒ 不置 json（交给 Content-Type 推导）；`form` ⇒ 显式 `json: false`。
   顺带把数据选择从 `options.body ?? options.form` 改成与桌面一致的**真值链**
   （`if (body) … else if (form) …`），并且**不转发脚本的 `json`** —— 桌面那份解构里根本没有它。

**调用点审计**（这是修之前必须做的，它决定严重度上限）：全仓**只有两个** `transport.request` 调用者 ——
`src/renderer/utils/request.js:23` 与 `userApi/web.js:35`。
`request.js` 自己的 `body`/`form`/`formData` 形状与桌面**逐字相同**（`request.js:10-20`），
且它的 `httpRequest` 是**显式**传 `json: format === 'json'`（`request.js:136`）⇒ **内置音源不受影响**。
所以实际受影响面就是**自定义源**（已修），加上"任何显式写 `Content-Type: application/json` 且不传 json
的渲染层调用点"—— 本轮没有发现别的，但两边修完后这类调用点**都**归到同一条 needle 规则上了。

**证据**：

- `tests/unit/web-http-transport.test.cjs` 新增一条用例，四个断言分别钉住：
  头推导出 json 时对象 body 走 `JSON.stringify` **且调用方给的头原样保留**、**不补 `Accept`**、
  `json: false` 压过头、带 `charset` 的**不**触发、头名大小写不敏感。
- `tests/unit/android-user-api-web.test.cjs` 新增一条**真 HTTP 服务器**的集成用例：
  `body` + `Content-Type: application/json` 到了服务端必须是 `{"a":1,"b":"x y"}` 而不是 `a=1&b=x+y`。
- **两个变异都被捕获**（在 `%TEMP%\rain-w1-mut\<kind>\` 的整份 `src/` 副本里注入，用 `NODE_PATH`
  指回仓库的 `node_modules`；仓库文件一个字节都没动）：

  | 变异 | 结果 |
  |---|---|
  | 把 `buildRequest` 改回 `options.json === true` | 传输用例 fail 1（`actual: 'a=1&b=x+y'`）**且** 集成用例 fail 1 |
  | 让 `userApi/web.js` 对 `body` 重新写死 `json: false` | 传输用例 **fail 0**（说明它只测传输规则）、集成用例 fail 1 |

  第二条尤其重要：它证明**这个修复是两处的**，只改一处过不了集成用例。

> ⚠️ **踩过的坑（写在这里省下一次）**：变异工装一开始用
> `Get-Content -Raw` 读文件，**把副本里的中文注释按 GBK 重新编码、文件直接坏掉**，
> 于是 13 个用例全红、看起来像"变异被捕获"（其实是假信号）。
> 改成 `[System.IO.File]::ReadAllText/WriteAllText` + `UTF8Encoding($false)` 之后才拿到上表这种
> **"只红该红的那条"** 的结果。**假绿和假红都要警惕：失败数量不合理时先怀疑工装。**



#### 6.4.2 当时的原始分析（保留为历史证据 —— 注意其中第 2 条已被本轮审计**推翻并取代**）

> 下面这三条是**修之前**写的。第 1、3 条与 §6.4.1 一致；**第 2 条说"没有做调用点审计"已经过时** ——
> 审计在 §6.4.1 里做了（结论：全仓只有两个 `transport.request` 调用者，内置音源不受影响）。

1. **根不只在 `userApi/web.js:38`**，还在 `src/renderer/platform/http/web.js:220`：
   那里是 `const json = options.json === true` —— **完全没实现** needle 那条
   "`options.json !== false` 且 `content-type == 'application/json'` 就按 JSON 发"的规则（`needle.js:305-306`）。
   ⇒ 就算把 `userApi/web.js` 的 `json: false` 改成"不传"，请求**照样**会被表单序列化。
   **修法必须是两处**：(a) `buildRequest` 补上 needle 的规则；(b) `userApi/web.js` 对齐桌面的选项形状
   （`body` 不置 `json`，只有 `form`/`formData` 才置 `false`）。
2. **爆炸半径**（决定它算不算首版阻塞）：内置音源**不受影响** ——
   `src/renderer/utils/request.js:136` 是**显式**传 `json: format === 'json'`（默认就是 `true`），不依赖头推导。
   **自定义源受影响**（`userApi/web.js` 强制 false）。
   还剩一类：渲染层里任何 `request({ body: …, headers: { 'Content-Type': 'application/json' } })`
   且**不显式传 `json`** 的调用点 —— ~~**本轮没有做这个调用点审计**，**下一轮要先做**~~
   **已在 §6.4.1 做完**：全仓只有两个 `transport.request` 调用者，没发现别的这类调用点。
3. **needle 的比较是字面相等** `== 'application/json'`，
   所以 `application/json; charset=utf-8` **不触发**它。修的时候要**照抄这条**（否则引入新的不一致），
   并用一个**对照 needle 本体的用例**钉住，别凭直觉。

#### 6.4.3 本轮已修：W2（初始化成功后的脚本错误不再拆掉整个源）

**桌面依据**：`src/main/modules/userApi/renderer/preload.js:161-166` 的 `onError()` **第一行**就是
`if (isInitedApi) return` —— 已经初始化成功之后，脚本自己的错误**不再**上报成初始化失败。

**为什么在 Android 上后果特别大**：`worker-runtime.js:31-32` 把 worker 的 `error` 与
`unhandledrejection` **都**接到 `fatal` 上，而 `host.js` 原来的 `case 'fatal'` **没有**任何守卫。
社区脚本里一次"发了不管的异步调用"（`lx.request(...)` 不带 catch 之类的常见写法）出错，
就会把一个**本来完全能用**的源拆掉：状态翻假 → worker 终止 → 在途请求全部 reject →
渲染层弹"源码初始化失败"。

**改法**（`host.js`）：

- 新增 `isInitialized()`（就是 `status.status === true` —— `status` 只有**成功**那条会置 true），
  以及 `ignorePostInitError()`；
- `case 'fatal'` 与 `createSession(...)` 的 **error 回调**两处都加守卫：
  已初始化 ⇒ 忽略（**不 stop、不改 status、不发事件**），未初始化 ⇒ 照旧 `fail()`；
- **与桌面唯一的差别**：忽略时留一条 `console.warn`（同一文案只报一次）。桌面那条路径是**直接丢掉**的，
  但完全静默会让人以为"这个源从来没出过错"。
- **只管脚本来源的失败**：host/worker 之间的**协议**异常（`onMessage` 的 `default` 分支）仍然大声失败 ——
  那说明两侧版本不一致，不是脚本的问题。

**证据**：

- `tests/unit/android-user-api-host.test.cjs` 新增一条用例：用**假 session**（而不是真 worker）
  精确制造"init 成功 → 紧接着一条脚本来源的 fatal"，断言
  `status.status === true`、`terminate` 调用次数为 0、**只发布了一条**状态事件且它是成功。
  用真 worker 测不准：Node 的 `worker_threads` 夹具**不会**产生 `unhandledrejection`，
  所以那条路径在夹具里根本触发不了。
- **2 个变异都被捕获**（注入在 `%TEMP%\rain-w2-mut\<kind>\` 的 `src/` 副本里，
  用 `RAIN_USER_API_TEST_ROOT` + `NODE_PATH` 指过去）：
  `isInitialized()` 改成恒 `false`、以及单独删掉 `fatal` 那一处守卫 —— 两个都是一样的
  `fail 1`，失败的正是新用例那条断言。**"只红该红的那条"**，说明它真的在守这个性质。
- ⚠️ **工装第二次骗了我**：第一次跑出 `fail 9`（连"初始化前就报错"的老用例都红了），
  看上去像"变异影响面很大"，其实是**忘了设 `NODE_PATH`** ⇒ 副本里的 `utils.js`
  `Cannot find module 'crypto-js'` ⇒ 模块加载失败 ⇒ 9 个用例全红。
  **判据很朴素：失败数量和失败原因要能对上。对不上就先怀疑工装，别急着写结论。**



**对 6.4 这一轮审查确认"没问题"的部分**（省下一次重查）：

- **沙箱边界**：`lx` 与 `rain` 是同一个冻结对象；白名单 `['tx','kg','wy','local']` 封闭；
  `Object.hasOwn` 挡住 `__proto__`/`constructor`；脚本在自己的 worker realm 里改
  `Array.prototype.includes` 也**越不过**宿主那层的白名单（`filterSources` 拿宿主的数组过滤）。
- **播放 URL 只来自所选自定义源**：`apis()` 在 `apiSource` 为 `user_api_*` 时返回 `userApi.apis[source]`
  （`musicSdk/api-source.js:18-19`），内置 tx/kg/wy 的 `getMusicUrl` 也走 `apis(source)`；
  `winMain_get_music_url` **只是缓存**。
- **就绪闸门**只在最终 init 结果上打开；失败路径有防重复结算（`useInitUserApi.ts:148`、`apiSource.ts:31`）。
- **不泄漏 worker/port**：`stop()` 会 settle + abort + terminate；过期结果被 `generation` 拦住，
  worker 回包还额外按每请求 token 校验。
- **私有 MessagePort 从不挂到 `globalThis`**，`worker.onmessage` 也没被赋值
  ⇒ 脚本里的全局 `postMessage` 到不了宿主协议。
- **没有 HTML/eval 注入面**：`src/renderer` 与 `src/common` 里**没有** `v-html`/`innerHTML`/`dangerously*`；
  所有源侧 URL 都过 `httpUrl`（协议、主机名、禁 userinfo、2048 上限）；歌词按长度截断、按文本渲染。
- **产物互斥（工件级证据）**：每个 web chunk 的 source map 里只有 web 实现，没有对应桌面实现；
  没有 `vendor/needle`、没有 `node_modules/electron`、没有裸 `ipcRenderer`/`contextBridge`；
  桌面 `dist/` 里也没有任何 web 专属字符串（`"Directory selection requires Android"`、
  `"_capacitor_file_"` 等）。
- **文件 URL 往返**：只做**一层** `encodeURIComponent` 是对的 ——
  Capacitor 原生 `convertFileSrc` 是纯拼接（`@capacitor/android/.../native-bridge.js:168-181`），
  本地服务器用 `Uri.getPath()` 解码（`WebViewLocalServer.java:667` → `AndroidProtocolHandler.java:66-70`）
  ⇒ 空格 / `#` / `%` / 非 ASCII 都能活；worker 回落分支构造的形状与原生一致。
- **`fs/web`** 优先直接读已选 File，404 → `ENOENT`、其它状态 → 明确错误、
  没有 Content-Length 时用真实大小、写类操作抛明确的"not implemented"；对 Capacitor 文件服务器发 HEAD 是安全的。
- **下载 façade 的假设与原生信封吻合**：`RainMusicDownloadTaskChannels.java:141` 总是回 `id` + `token`；
  `start` 从不返回 null；`ready` 之前到达的事件会排队；pause/remove/error 会丢弃回调；按 id 串行化命令。
- **桥的 15 s 超时不会覆盖更新的结果**：超时/取消/已应答的 id 先从 `pending` 移除，迟到只 warn；
  user-api 通道**完全绕过**原生超时（宿主自己 15 s init / 20 s request / 60 s HTTP，128 请求 + 64 HTTP 上限）。

### 下载部分的已知要点
- Android下载由主WebView façade转原生执行器，下载Worker/Node文件与socket实现仅留给桌面构建。
- 纯列表与媒体解析仍在Web Worker；本地文件经Capacitor URL读取，元数据使用浏览器parseBuffer。
- `docs/android/web-runtime-blockers.md` 有"Android 首版必须重写的最小集合"（P0 表）可依

### 已接入的实际代码入口（以下四项本轮已实现；后续以联合验收为主）

1. **继续补其余歌单歌曲写通道与排序**：以 `src/main/modules/commonRenderers/list/rendererEvent.ts`、
   `src/main/worker/dbService/modules/list/` 和 `src/renderer/store/list/listManage/rendererListManage.ts` 为契约来源。
   `RainMusicListMutationChannels` 已完成八条剩余写通道，并接入共用 monitor / 提交顺序广播协调器。
2. **下载任务持久化**：先重写 `winMain_download_list_get/add/update/remove/clear` 五条既有 IPC。
   来源是 `src/main/modules/winMain/rendererEvent/download.ts` 与
   `src/main/worker/dbService/modules/download/{index,dbHelper,statements}.ts`。
   表结构在 `src/main/worker/dbService/tables.ts` 的 `download_list`；类型在
   `src/common/types/download_list.d.ts`。保留既有拼写 `isComplate`、13 列读写形状、
   `ORDER BY position ASC`，并区分记录删除与音频文件删除。
   `top` 插入须在同事务更新旧记录顺序；状态更新 SQL 不应覆盖 position / quality / musicInfo。
3. **下载执行与文件访问**：消费者在 `src/renderer/store/download/action.ts`。
   下载 worker 暴露 `checkList/createDownloadTasks/updateUrl/startTask/pauseTask/removeTask/writeMeta/saveLrc`
   八个方法（`src/renderer/worker/download/{download,common}.ts`）。
   Android 适配需在主 WebView 使用原生桥，不能假定 Web Worker 能访问 Capacitor。
   原生HTTP/文件探针已覆盖进度、取消/暂停、失败、执行器重建续传和写入；设备仍须验证重启恢复与播放 URL 映射。
4. **自定义源宿主 + 联合验收**：遵守既有 `lx` / `rain` 双名与平台白名单，
   验证导入、初始化、URL 解析、下载和播放整条链；最后按 §6 的明文/CORS/文件映射矩阵做真机验收。

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
且 tests >= 基线（**工作区口径 455**，2026-10-15 复跑值；提交快照口径以 CI 为准）
```

- **必须从实际运行输出解析 `tests/pass/fail` 三个数**，不能只看 exit code。
  （旧文写的是 `ℹ tests/pass/fail`；本机 Node 输出的是 `? tests` 那种行 —— **认数字，不要认前缀字符**。）
- **若首跑红：复跑一次**。仍红 ⇒ 当真失败；转绿 ⇒ 抖动（本会话确认存在抖动）。**不许"一直重试到绿"**。
- **注意基线里含用户另线未提交的测试**：数量对不对要连 `git status --porcelain` 一起看，别把"用户又加了测试"当成"我漏了测试"。
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

另有 2 条**曾登记为“待真机回答”**（原写在 `src/main/worker/dbService/adapter/android.ts` 的「未验证清单」里）。
**2026-10-15 复核后这两条在当前架构下已经不成立**，但仍要看清它们的边界：

- 插件用 **SQLCipher**、原生用框架 `SQLiteOpenHelper`，**同一文件**两套实现打开是否安全 ——
  **当前不可达**：`@capacitor-community/sqlite` 的驱动只在 `createCapacitorSQLiteDriver()` 里被构造，
  而 `src/main/**` 不在 Android 产物中（§0 第 4 条的 ABSENT 证据）⇒ 真机上**只有**框架
  `SQLiteOpenHelper` 一侧在开库。**若**以后把主进程业务层搬进 WebView（或改用插件走 SQL），
  这条会**立刻**重新生效，届时必须按原清单实测。
- 插件**不写 `user_version`** ⇒ 若插件先建库（`user_version=0`）而原生 `onUpgrade(0→4)` **抛错**，
  用户会看到"打不开" —— 同上，**当前不可达**；但 `onUpgrade` **抛错不猜迁移**的既定策略本身是对的
  （`RainMusicDatabase.java:589-594`），不要为了"看起来能升级"去放宽它。
- ~~另需对齐：**`user_version` 应为 4**（阶段 2a 的 `createConnection({version: 1})` 是占位）~~
  —— **已关闭**。现在版本号只有一个出处链：`tables.ts:231 DB_VERSION='4'`
  → 原生 `RainMusicDatabase.SCHEMA_VERSION_TEXT="4"`（`SCHEMA_VERSION = Integer.parseInt(...)`）
  → JS 侧 `adapter/android.ts ANDROID_DB_VERSION = Number(DB_VERSION)`。**没有残留的字面量 `1`。**
  另有守卫用例逐字锁死：`tests/unit/android-list-channels.test.cjs:263-289`（12 条 DDL 与 `tables.ts` 逐字一致、顺序一致）、
  `:291-323`（`SCHEMA_VERSION_TEXT == DB_VERSION`）、`:325-332`（`DATABASE_NAME == 'rain.dataSQLite.db'`
  且桌面仍是 `rain.data.db`）。**库路径两边一致这件事现在是被测试钉住的，不是靠人记。**

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
node --test tests\unit\*.test.cjs                                      # 单测（当前基线 381）
node build-config\pack.js                                              # 桌面构建
npm.cmd run build:web                                                  # web 构建
npm.cmd run test:surfaces ; npm.cmd run test:window-controls           # UI 套件
npx.cmd cap sync android                                               # Capacitor 同步
```

---

## 10. 一句话总结现状

**歌单全部既有通道、下载存储/执行、自定义源宿主、媒体缓存及播放队列恢复已有实现。
本轮具体门禁与证据见 `continuation-2026-10-15.md`；APK 编译必须查询新 SHA 的 CI。**

**2026-10-15 复核补充（这四句是这一轮的结论）**：

1. **首版三件事（听歌 / 歌单管理 / 下载）的通道已经齐了**；本机门禁全绿、`2a3e4a7c` 的
   `verify` 与 `debug-apk` 都是 success、APK 产物未过期。
2. **Android 上只有 Java 插件在跑** —— `src/main/**` 不在 Android 产物里（§0 第 4 条）。
   以后读任何 `*.android.ts` 的说明，先问一句"它到底是不是 Android 上会被求值的代码"。
3. **范围之外仍然缺一圈通道**：**主题（7 条，且会留下未处理 rejection）**、不喜欢（4 条）、
   音效预设（4 条）等，见 §6.1。其中主题是用户点过名的方向 —— 要么补原生实现，要么显式降级。
4. **剩余验收仍然是设备侧**：设备端搜索/播放/下载/重启恢复、系统文件选择（SAF）、
   HTTP/CORS/请求头/明文流量、`convertFileSrc()` 映射、后台保活。
   ~~SQLite 路径与版本一致性~~ **已关闭**（§8，被 3 组守卫用例钉住）。
5. **本轮实际修掉了 8 处**：§6.2 的下载执行层 6 处（含那处 high）+ §6.4 的 W1、W2（两处都在自定义源这条首版链上），
   每修一处都配了断言与**变异验证**（下载 6 个、W1 两个、W2 两个，逐个被对应断言捕获）。
   两节都留了"仍然没修、并且说明了为什么"的清单。**下一轮的第一优先**是：
   - **§6.4 的 W3**（medium：`filterSources` 会留下 `actions` 为空的平台，
     而"一个可用平台都没有"也被当成功发布 ⇒ 播放死在后面的 TypeError 上，而不是初始化时明确报错）；
   - 然后是 **§6.3 的 L1 / L2 / L6** —— 尤其 **L6 要先把替身改成与真 API 同严格**，
     否则本机关于"坏歌词行"的结论继续不成立；
   - 再往后是 §6.2 剩下的第 4、5 处、§6.4 的 W4 与 W10。

**APK 能编出来与首版功能可用是两项不同的验收，当前不能把后者标为完成。**
