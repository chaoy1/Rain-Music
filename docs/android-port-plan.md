# Rain Music Android 版移植方案

> 决策（用户已确认）：**路径 A —— 用 Capacitor 封装本项目的 Vue 渲染层，重写原 Electron 主进程业务层**。
> 首版范围（用户已确认）：**听歌（内置 kg/tx/wy + 自定义源） + 歌单管理 + 下载**。
> 硬性要求：**Android 界面不得包含 macOS 风格窗口控制按钮（交通灯）**。

## 0. 本机工具链现状（2026-10-07 实测）

| 项 | 状态 |
| --- | --- |
| JDK | ✅ 20.0.2（`C:\Program Files\Common Files\Oracle\Java\javapath`） |
| Node / npm | ✅ v24.18.0 / 11.16.0 |
| **Android SDK** | ❌ **未安装**（无 `ANDROID_HOME`、无 SDK 目录） |
| Gradle / adb / sdkmanager | ❌ 未安装（Capacitor 用 Gradle wrapper，可自动下载） |
| Android Studio | ❌ 未安装 |

**结论：可以在本机完成全部工程与业务代码，但无法在本机产出 APK。**

> **决定（用户已确认，2026-10-07）：走 CI 出包。**
> 在 `.github/workflows/` 加一个 Android 工作流，在 runner 上装 JDK + Android SDK（`android-actions/setup-android` 或 `sdkmanager`），执行 `npx cap sync android` + `./gradlew assembleDebug`（必要时 `assembleRelease`），把 APK 作为 artifact 上传。
>
> **实施时机**：Capacitor 工程（`android/`、`capacitor.config.*`）一旦存在就立刻加该工作流，让 Android 编译**从阶段 1 起持续验证**，而不是等到阶段 6 才发现编译不过。
>
> 本机因此**不需要**安装 Android SDK；备用出路是届时在本机装 SDK（cmdline-tools + `platform-tools` + `platforms;android-3x` + `build-tools;3x.x`，约 2–4 GB，需接受许可）。

## 1. 为什么这是"重写业务层"而不是"套个壳"

现状（实测）：

- 技术栈：`electron@42.11.6` + `electron-builder` + **`better-sqlite3`（原生 Node 模块）** + `electron-log`。
- 打包目标只有 win/linux/mac，**没有任何 web/android/capacitor/cordova 目标**。
- 渲染层与主进程通过大量 IPC 通信：`ipcRenderer` 30 处、`@renderer/utils/ipc` 41 处。
- `src/main/utils/previewMode.ts` 只是"预览版安装包跳过协议注册"的**构建开关**，不是能脱离 Electron 运行的浏览器构建。

因此下面这些**必须**在 Android 侧重新落脚：

| 现在（Electron 主进程） | Android 侧替代 |
| --- | --- |
| `better-sqlite3` + `src/main/worker/dbService/**` | WebView 侧 SQLite（Capacitor SQLite 插件，或 JS 版 SQLite）+ 迁移同一套 schema/迁移逻辑 |
| `worker_threads` 里跑的 dbService / main worker | 无 worker 或改用 Web Worker |
| 音乐 SDK 网络层（依赖 Node `undici` / `crypto` / 自定义 request） | 改用 `fetch` + WebCrypto，重写 request/加密适配 |
| 自定义源（`userApi`）：独立 `BrowserWindow` + preload 暴露 `lx`/`rain` | WebView / iframe / worker 提供等价的 `lx` API 宿主 |
| 下载管理（Node `fs`、`node:path`） | Capacitor Filesystem + 原生下载 |
| 托盘、全局快捷键、原生菜单、原生窗口、协议注册 | Android 无对应概念，直接移除或换为 Intent/通知 |
| 桌面歌词窗口（独立 `BrowserWindow`） | Android 通知栏歌词 / 悬浮窗（首版可不做） |

**可复用的部分**：`src/renderer/**` 的 Vue 组件与页面、主题系统、i18n、`src/common/**` 的纯逻辑（类型、常量、工具、`playbackQueue` 等无 Node 依赖的部分）。当前活跃的响应式布局工作（`tests/ui/responsive-layout.electron.cjs`）对移动端是有用铺垫。

## 2. 阶段划分与验收

| 阶段 | 交付物 | 验收 |
| --- | --- | --- |
| **0. 契约清单** | `docs/android/ipc-contract.md`：主进程对外暴露的**全部** IPC 通道 + Electron API 使用点，按"必须重写 / 可直接移除 / 需降级"分类，并标注渲染层依赖它的位置 | 清单覆盖渲染层实际用到的每个通道；能据此写出桥接层接口 |
| **1. 工程与抽象层** | Capacitor 工程（`android/`、`capacitor.config.*`）+ `src/renderer/platform/**` 抽象层：把渲染层对 `window.rain` 的调用收敛到一个可替换的适配器；**移除交通灯**（移动端不渲染自绘标题栏） | 桌面版行为不回归（lint/tsc/单测 + 现有 Electron UI 测试）；Android 端能启动到界面 |
| **2. 数据层** | SQLite 落地 + schema/迁移对齐 + 设置与本地存储 | 迁移单测通过；能读写歌单 |
| **3. 音源与播放** | kg/tx/wy 元数据 + 播放 URL 解析（含自定义源供给 URL 的路径）；HTML5 Audio 播放、队列（复用 `playbackQueue`） | 能搜索到歌并播放 |
| **4. 歌单与下载** | 歌单增删改、排序（复用播放队列/自定义列表排序逻辑）；下载管理与落盘 | 歌单可用；下载完成并能播放本地文件 |
| **5. 自定义源** | `lx`/`rain` API 宿主（必须保留 `lx` 兼容，见 `docs/custom-source.md`） | 能导入并初始化社区音源脚本 |
| **6. 打包与验收** | APK（CI 或本地 SDK）；真机冒烟 | 安装、启动、听歌、歌单、下载全通 |

## 3. 必须守住的不变量（血泪教训，勿重犯）

1. **自定义源全局名 `lx` 必须保留**（`preload.js` 里同一对象以 `lx` 与 `rain` 双暴露）。社区脚本普遍读 `globalThis.lx`；移除会导致脚本初始化失败。见 `docs/custom-source.md`。
2. **平台 id 是封闭白名单**：`allSources = ['tx','kg','wy','local']`（kw/mg/bd/xm 已按用户要求删除）。自定义源无法引入新平台 id。
3. **播放 URL 永远来自自定义源**：内置 tx/kg/wy 只提供元数据；`api-source-info.ts` 的内置接口清单为空数组。
4. **URL 缓存会失效**：`music_url` 是带签名的短时效直链（实测过期后 HTTP 410），缓存必须能自愈（重试时 `isRefresh`、放弃时清该条）。
5. **改名前先查第三方契约**：任何"看起来像品牌残留"的全局名/文件扩展名/协议，先确认它是不是对外契约。

## 4. 风险

- **工程量**：阶段 2–5 合计是数周到数月量级；网络层（音乐 SDK）与自定义源宿主是最不确定的两块。
- **平台接口失效**：kg/tx/wy 的第三方接口随时可能变更，Android 版需要与桌面版同步维护。
- **本机无 SDK**：不强依赖 CI 的话，本机需先装 SDK 才能出 APK。
- **首版范围大**（听歌+歌单+下载）意味着第一次可用的时间点较晚；若想更早看到东西，可把阶段 1 单独发一个"界面可跑"的预览包。

## 5. 阶段 1 待验证项：Android 明文流量 + CORS 真机矩阵（**当前最大风险**）

> 来源：`docs/android/native-bridge-needs.md` §2.6.4、§3「第 2 件」、§5 第 3 条（那里明确标注**全部未验证**）。
> 本节在阶段 1（Capacitor 工程 + 面向 Web 的渲染层构建落地）时登记，**只登记、不改网络层代码**。

### 5.1 问题本身

- `CapacitorHttp`（v5+ 内置于 `@capacitor/core`）走**应用进程的原生网络栈**，因此可以绕开 WebView 的 **CORS** 限制；但它**绕不开 Android 的明文流量策略**（Network Security Config / `android:usesCleartextTraffic`）。Android 9（API 28）起默认禁止明文 HTTP。
- 本工程 targetSdk = **36**（`android/variables.gradle`），远高于 API 28。
- **阶段 1 实测（Capacitor 8.5.2 生成）**：`android/app/src/main/AndroidManifest.xml` 里**没有** `android:usesCleartextTraffic` 属性，也不存在 `res/xml/network_security_config.xml`。
  → 即：**不在清单里显式放开，明文请求在真机上会被系统直接拦掉**（`ERR_CLEARTEXT_NOT_PERMITTED`）。
  → 社区常说的「Capacitor 生成的 manifest 默认带 `usesCleartextTraffic="true"`」在本版本**不成立**（该结论版本相关），必须以真机实测为准，**不能假定**。

### 5.2 事实：约 28 处 `http://` 明文请求 URL（含 wy 核心路径）

按 `native-bridge-needs.md` §2.6.4 的口径复核（非注释行、只算活模块）得到同一结论：

| 口径 | 处数 |
| --- | --- |
| 全库非注释 `http://` 命中（含 XML 命名空间之外的 UI/主进程） | 55 |
| 减：`src/main/**` 的 3 处 dev-only URL | 52 |
| 减：已判定不影响产物的死文件（`kg/temp/songList-new.js` 12、3 个 `api-test.js` 7、`kg/album.js` 2） | 31 |
| 减：3 处只是 `Referer` 头里的字符串 | **28 处真实明文请求 URL** |

其中最关键的一处是 **wy 的核心数据路径**：`src/renderer/utils/musicSdk/wy/utils/index.js:5` 的
`http://interface.music.163.com/eapi/batch` —— 搜索、热搜、歌手、歌单、歌词**全部**走它。
其余分布在 kg（`songList.js` 11、`comment.js` 3、`singer.js` 3、`lyric.js` 2、`leaderboard.js` 2、`hotSearch.js`/`pic.js`/`musicInfo.js`/`musicSearch.js` 各 1）与 tx（`songList.js` 2、`comment.js` 1）。

**结论：明文流量一旦被拦，kg / wy / tx 三个内置音源会一起不可用**，不是个别接口降级 —— 这就是它排在第一优先级的理由。

### 5.3 阶段 1 必须完成的验证（最小矩阵）

1. **真机/模拟器 + `chrome://inspect`**，对同一端点做三列对照，记录成功/失败与错误码：
   - 页面里直接 `fetch`（预期：CORS 失败）
   - 开启 `plugins.CapacitorHttp.enabled = true` 后的 `fetch`（patch 版）
   - 直接调用 `CapacitorHttp.request(...)`
   - 另加一个纯 `https://` 端点作对照

   端点至少覆盖：`http://interface.music.163.com/eapi/batch`（wy 核心）、`http://songsearch.kugou.com/song_search_v2`（kg 搜索）、`http://lyrics.kugou.com/search`（kg 歌词）、`http://c.y.qq.com/...`（tx）。
2. **记录 manifest 实际值**：`android:usesCleartextTraffic` 是否存在、`res/xml/network_security_config.xml` 是否存在及其内容。
3. **若明文被拦**：验证 **白名单式 `network_security_config`**（只对 `interface.music.163.com`、`*.kugou.com`、`c.y.qq.com` 等开明文，而不是全局 `usesCleartextTraffic=true`）。Network Security Config 是**应用级**的，同时覆盖 WebView 与 CapacitorHttp 两条路。
4. **顺带一起验**：`native-bridge-needs.md` §3 第 1 件 —— `src/renderer/utils/request.js` 整层换成 `fetch`/`CapacitorHttp` 之后，wy 的 `eapi`/`weapi`（AES-ECB + MD5 + 纯 JS BigInt 的 `RSA_NO_PADDING`）链路是否仍然通；`weapi` 的 `encSecKey` 必须恒为 256 个 hex 字符（前导零补齐）。
5. **验收产物**：一张「端点 × 请求方式 × 成败 × 错误码」表，据此定 `AndroidManifest.xml` / `network_security_config.xml` 的最终配置。

> 这一步**不需要**先改渲染层网络代码：第 1–3 条可以在最小 Capacitor 工程（或本工程的 `dist-web` 空壳页）里用一次性脚本完成，属于纯真机行为验证。
