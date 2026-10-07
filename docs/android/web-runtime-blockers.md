# Android Web 运行时阻塞点（阶段 3 / 线 D）

> 本文回答一个问题：**`dist-web/` 到底能不能在"像移动端"的 WebView 里加载起来，以及卡在哪。**
>
> 在写这份文档之前，项目里对 `dist-web` 的判断全是**推测**（"`electron` / `electron-log/node`
> 还在 bundle 里，所以必然启动即炸"）。本轮把 `dist-web` 真的在一个
> `nodeIntegration: false / contextIsolation: true / sandbox: true / webSecurity: true`
> 的 Electron 窗口里用 `http://` 加载起来跑了，下面每一条都是**实测复现**的。

- 相关文档：`docs/android-port-plan.md`（阶段划分）、`docs/android/ipc-contract.md`（IPC 契约）、
  `docs/android/native-bridge-needs.md`（原生桥需求清单）、`docs/android/cleartext-verification.md`、
  `docs/android/storage-adapter.md`。
- 本轮**只修**归类为 **(B) 可直接移除/降级** 与 **(C) 构建期/配置** 的问题；
  **(A) 必须重写** 的一条都没动，只记录（那是阶段 3-5 的正式工作）。

---

## 1. 加载环境（如何做到"像移动端，而不是像桌面"）

桌面主窗口是 `nodeIntegration: true / contextIsolation: false / webSecurity: false`，
`src/main/modules/winMain/main.ts`。**用它加载 `dist-web` 一定测不出问题**，
所以本轮另建了一个临时加载器（跑完即删，不进仓库）。

| 维度 | 桌面主窗口 | 本轮模拟环境 |
| --- | --- | --- |
| `nodeIntegration` | `true` | **`false`** |
| `contextIsolation` | `false` | **`true`** |
| `sandbox` | 默认 | **`true`** |
| `webSecurity` | `false` | **`true`** |
| preload | 无 | **无**（真机 Capacitor 页面也没有 Electron preload） |
| 页面来源 | `file://`（`loadFile`） | **`http://127.0.0.1:<port>/`**（静态服务器） |
| `window.Capacitor` | 不存在 | **最小 mock 注入**（注入在**用户脚本之前**） |
| 错误采集 | DevTools | `window.onerror` / `unhandledrejection` / `console.error|warn` 包装 / 资源加载失败 / `#root` 骨架轮询 |
| `--disable-web-security` 之类放宽开关 | — | **一个都不加**，保持默认 |
| 窗口尺寸 | 用户设置 | `412 x 915`（手机竖屏），缩放系数保持默认 1 |

**为什么用 `http://` 而不是 `file://`**：`file://` 下模块脚本、Web Worker、
`fetch` 相对路径与 CORS 的行为都和真机 WebView 不同（真机 Capacitor 是
`https://localhost` 或 `http://localhost` 的 `WebViewAssetLoader`，不是 `file://`）。

**Capacitor mock 的作用**：`src/renderer/platform/index.ts` 的平台判定是
**原生桥优先**（`hasNativeCapacitorBridge()` 先于 `process.versions.electron`）。
注入 `isNativePlatform() => true` / `getPlatform() => 'android'` 之后，渲染层才真的走
`shell === 'capacitor'` 分支（`isMobileShell === true`、`hasWindowControls === false`）。
**不注入的话，测的是"纯浏览器"路径，不是移动端路径。**

实测确认 mock 生效：`#app-chrome` 里出现了 `data-mobile-title-bar=""` 节点，
即移动端标题栏占位分支被走到（见第 5 节的探针产物）。

### 1.1 搭建时踩到的三个坑（下次复现别再踩）

1. **Electron 必须以"应用目录"启动**（目录里有 `package.json`，`main` 指向加载脚本），
   直接 `electron.exe harness.js` 会退化成默认应用：进程活着、`app.whenReady()` 永不触发、
   没有 renderer 进程、没有任何日志。
2. **加载脚本里必须用裸模块名 `require('electron')`**。用绝对路径
   `require('...\\node_modules\\electron')` 会拿到 npm 包自己的 `index.js`，
   它导出的是**二进制路径字符串**，于是 `app` 是 `undefined`。
3. **`ELECTRON_RUN_AS_NODE` 会污染子进程**：本机 shell 里可能已存在该环境变量，
   必须先删掉再启动 Electron；但 fork 静态服务器时又要给它加上（让子进程以 Node 模式跑）。

### 1.2 "宽容桥"探针（明确隔离，不代表可交付状态）

strict 环境跑到阻塞点 #3 就再也上不去（(A) 类，本轮不修）。为了回答
"**#4、#5 是什么**"，另外做了一次**明确隔离**的探针构建：
在 `%TEMP%` 下写一份独立的 webpack 配置 + 4 个临时替身，把 IPC 桥换成
**宽容版**（不抛错、`invoke` 一律 resolve `{}`），产物输出到 `%TEMP%` 下的临时目录，
**不覆盖 `dist-web/`、不进仓库**。

> ⚠️ 宽容桥会把 IPC 失败变成静默/假数据，正是真正的 `web.js` 刻意避免的"把问题藏起来"。
> 探针产物的唯一用途是勘察后续阻塞点，**不是**修复方案，也不能当 Android 版本用。

---

## 2. 基线实测（改动前，HEAD = `02b15346`）

用 `git stash` 临时收起本轮改动、重新构建 `dist-web` 后实测（测完立即 `git stash pop` 恢复）：

| 项 | 实测值 |
| --- | --- |
| 主 bundle | `dist-web/renderer.fef2a351.js`，**1 111 921 B** |
| `node_modules/electron` 是否进产物 | **是**（`renderer.fef2a351.js` 内含 npm 包的 `index.js`） |
| `__dirname` 出现次数（主 bundle） | 4 |
| `electron-log` 出现次数 | 主 bundle 4 次、两个 worker 各 4 次 |
| `browserify-zlib`（← `node-id3`，下载 worker） | 下载 worker 内仍在 |
| 首个错误 | `Uncaught ReferenceError: __dirname is not defined` |
| 首错位置（sourcemap 还原） | `node_modules/electron/index.js:5`（产物 `index.js:6`） |
| `#root` | `display: none`，`childElementCount === 0`（**从未挂载**） |

**结论：改动前 `dist-web` 在移动端等价环境下 100% 启动即炸，页面全白。**
此前"必然启动即炸"的推测是对的，但**炸点比预期更靠前**：不是"某个功能跑不起来"，
而是 `renderer.js` **在模块加载阶段就断了**，`app.mount('#root')` 那一行永远执行不到。

---

## 3. 顺序化阻塞点清单

> 触发源码位置一律指**我们自己的代码**；node_modules 内部位置只作为错误证据附上。
> 难度：小 = 单文件/单配置；中 = 跨 2-5 个文件或有一次语义决策；大 = 需要原生桥与状态机。

### 阻塞点 #1 —— `electron` npm 包被整个打进 web 产物（启动即全白）

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Uncaught ReferenceError: __dirname is not defined`，栈顶 `webpack-internal:///./node_modules/electron/index.js:6:28`（sourcemap 还原到 `node_modules/electron/index.js:5`，符号名就是 `__dirname`） |
| **触发源码位置** | `src/common/rendererIpc.ts:1` 的 `import { ipcRenderer } from 'electron'`（旧代码）。该模块被 `src/renderer/utils/ipc.ts:1` → `src/renderer/event/index.ts:1` → `src/renderer/main.ts:6` 在**顶层 import** 链上拉到 |
| **归类** | **(C) 配置问题**（构建期可解决） |
| **难度** | 小 |
| **根因** | `target: 'web'` 下 `electron` 既不是 webpack `externals`，也没进 `resolve.fallback`，于是 webpack 老老实实把 **npm 包 `node_modules/electron` 当普通依赖打包**。该包顶层第一件事就是 `path.join(__dirname, 'path.txt')`，而 web 目标里 `node.__dirname = false` ⇒ 加载期直接 `ReferenceError`。整个 `renderer.js` 在这里断掉 |
| **状态** | **已修**（见 §4.1） |

### 阻塞点 #2 —— 同一报错，第二个入口（bundle 里的 `electron` 包位置不同，报错行号一模一样）

| 列 | 内容 |
| --- | --- |
| **具体错误** | 与 #1 完全相同的 `Uncaught ReferenceError: __dirname is not defined`，栈顶仍是 `node_modules/electron/index.js` |
| **触发源码位置** | `src/renderer/utils/ipc.ts:2` 的 `import { ipcRenderer } from 'electron'`（旧代码）。**唯一使用者**是 `onFullscreenChanged()`（`src/renderer/utils/ipc.ts:646-652`） |
| **归类** | **(C) 配置问题** |
| **难度** | 小 |
| **为什么不是"和 #1 同一条"** | #1 是共用层（`src/common/`）的入口，被 `rendererIpc.ts` 拉起；#2 是**渲染层自己**的入口，只服务于"要 Electron 原始事件对象"这一处。两处都修掉，`node_modules/electron` 才彻底离开 Android 产物（实测：修 #1 后产物里仍是同一个包、同一条报错，只是触发 import 换成了 `src/renderer/utils/ipc.ts`） |
| **状态** | **已修**（见 §4.2） |

### 阻塞点 #3 —— `registerEvents()` 在启动期直接调 IPC，Android 侧没有任何通道

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Uncaught Error: Rain Music Android: 渲染层 IPC 桥（src/common/platform/ipcBridge/web.js）尚未实现。…被调用的通道：on("winMain_set_hot_key_config")`；紧随其后一条 `Unhandled (in promise) … invoke("winMain_get_hot_key")` |
| **触发源码位置** | `src/renderer/event/index.ts:18`（`void getHotKeyConfig().then(setHotkeyConfig)` → `invoke`）与 `:20`（`onUpdateHotkey(...)` → `on`）；两者分别经 `src/renderer/utils/ipc.ts:632` 与 `:629` 落到 IPC 桥 |
| **归类** | **(A) 必须重写** |
| **难度** | 大 |
| **为什么严重** | `registerEvents()` 是 `main.ts` **顶层 import 即执行**的（`src/renderer/main.ts:6`）。它在渲染进程启动阶段**同步抛错**，于是 `main.ts` 的模块求值中断，`getSetting().then(...)` 与 `app.mount('#root')` **一行都跑不到** ⇒ 页面依旧全白 |
| **需要什么才能过** | Android 侧至少要有两条通道：`winMain_get_hot_key`（请求/应答）与 `winMain_set_hot_key_config` / `winMain_key_down` / `winMain_focus`（订阅）。快捷键本身在 Android 首版属于"桌面专有"，可以降级为空实现，但**必须先有桥** |
| **状态** | **未修**（(A) 类，本轮不动） |

### 阻塞点 #4 —— `@common/utils/electron` 直接 import Electron 的 `shell` / `clipboard`（探针）

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Uncaught ReferenceError: __dirname is not defined`（同一个 npm 包的第三次进入），栈顶经 `src/common/utils/electron.ts:1` |
| **触发源码位置** | `src/common/utils/electron.ts:1` 的 `import { shell, clipboard } from 'electron'`；本轮被 `src/renderer/core/useApp/useInitUserApi.ts:4`（`import { openUrl }`）在 App setup 阶段拉起 |
| **归类** | **(C) 构建期替换** + 被替换实现属 **(B) 直接降级** |
| **难度** | 中 |
| **实测规模** | 该模块导出 5 个函数：`encodePath`（**纯字符串，与 Electron 无关**，但 main 进程的 3 个文件也在 import 它）、`openDirInExplorer`（→ `shell.showItemInFolder`，Android 无等价物，**(B) 降级为 no-op / 提示**）、`openUrl`（→ `shell.openExternal`，**(B) 降级为 `window.open`**）、`clipboardWriteText`（→ `navigator.clipboard.writeText`，**(B)**，注意是异步）、`clipboardReadText`（→ `navigator.clipboard.readText`，**只有异步 API**，与现有**同步**签名冲突 ⇒ 需要先改调用点的设计，**不建议**在本轮动手）。renderer 侧共 **16 个文件** import 它 |
| **建议做法** | 把 `encodePath` 摘出去放进纯工具模块，其余 4 个按 `src/renderer/platform/http/` 的既有模式做构建期替换。**因为 renderer 侧调用点有 16 个，超出本轮"改动 ≤5 个文件"的边界，本轮只记录、不实施** |
| **状态** | **未修**（探针里用临时替身越过） |

### 阻塞点 #5 —— `electron-log/node`（Node 专有日志）仍在 web 产物里（探针）

| 列 | 内容 |
| --- | --- |
| **具体错误** | 本轮**没有**观察到它自身的加载期崩溃（它被 webpack 的 `fs: false` 兜住），但它带来两个实打实的后果：(a) 主产物里 `electron-log` 出现 4 次、`src/common/utils/download/request.ts` 的 `URL` polyfill 告警等都挂在它拉起的依赖图上；(b) 它是"Node 专有实现被打进移动端产物"的典型残留 |
| **触发源码位置** | `src/common/utils/index.ts:1` `import log from 'electron-log/node'`，并且 `:44-46` **把 `log` 再导出**成 `@common/utils` 的公共 API ⇒ `src/common/error.ts:12,17`、`src/renderer/core/useApp/useDataInit.ts:39,49`、`src/common/utils/nodejs.ts:174` 都成了进入点 |
| **归类** | **(B) 可直接移除/降级**（Android 首版日志写 console 即可；`electron-log` 的 file transport 在 WebView 里没有意义） |
| **难度** | 小-中 |
| **建议做法** | 与 #4 同构：`src/common/platform/log/`（桌面 = `electron-log/node` 透传，web = `console` 包装），`src/common/utils/index.ts` 改为从它 import。**注意 `log` 是被 `export` 出去的公共 API**，改它要连带确认 4 个使用点 |
| **状态** | **未修**（探针里未单独处理；因为它没有自己抛错，不构成启动阻塞） |

### 阻塞点 #6 —— 渲染层数据通道缺口（探针越过 IPC 桥之后暴露）

| 列 | 内容 |
| --- | --- |
| **具体错误** | 探针（宽容桥 `invoke` 一律返回 `{}`）下 `#root` **成功挂载并渲染出完整骨架**（见 §5），但同时在 1 200 ms 前后报出 `TypeError: Cannot read properties of undefined (reading 'id')` 与 `TypeError: list is not iterable` |
| **触发源码位置** | `src/renderer/core/useApp/index.ts:52-71` 的 `getEnvParams()` / `getViewPrevState()` 数据链（`useStatusbarLyric` / `initData` / `handleListAutoUpdate` 分支） |
| **归类** | **(A) 必须重写** |
| **难度** | 大（数据通道 + 各调用方对"空数据"的容错） |
| **说明** | 这两条错误的**具体形状**受宽容桥返回的假数据影响，所以本文只把它们记为"A 类数据通道缺口"的方向，**不作为精确结论**。真正的形状要在 #3 的原生桥落地、拿到真实数据后再测 |
| **状态** | **未修** |

**推进到哪一步为止**：strict 环境下**连续 3 个新阻塞点已全部归类**（#1 C、#2 C、#3 A），
满足任务规定的停止条件；探针环境下**已经渲染出主界面骨架**（§5），
说明 (C) 类与 (B) 类问题修完之后，剩下的就是 (A) 类——且它们不再表现为"全白页"，
而是"页面出来了、某些数据/功能是空的"。

---

## 4. 已修的与未修的

### 4.1 已修 #1：(C) 构建期替换 —— `src/common/platform/ipcBridge/`

新增与 `src/renderer/platform/http/` **完全同构**的一层：

| 文件 | 作用 |
| --- | --- |
| `src/common/platform/ipcBridge/index.js` | 入口，默认 `export { bridge } from './desktop'`。契约表写在文件头 |
| `src/common/platform/ipcBridge/desktop.js` | 桌面：`require('electron')` 拿 `ipcRenderer`，`send / sendSync / invoke / on / once / off / offAll` **逐字透传**（`on/once` 仍按原样把回调包成 `{ event, params }`） |
| `src/common/platform/ipcBridge/web.js` | web/Android：**占位实现，调用即抛错**，错误信息里带**通道名** |

`src/common/rendererIpc.ts` 从"直连 `electron.ipcRenderer`"改为"经 `bridge`"，
**函数签名、参数形状、回调形状、`off` 语义全部不变**。

`build-config/renderer/webpack.config.web.js` 新增"关键差异 4.7"做构建期替换。

### 4.2 已修 #2：(C) 构建期替换 —— `src/renderer/platform/ipcRenderer/`

`onFullscreenChanged()` 需要 **Electron 的原始事件对象**（`(_event: Electron.IpcRendererEvent, isFullscreen) => void`），
而 `ipcBridge.on` 刻意把它包成 `{ event, params }`（两平台通用形状）。
"拿不到原始事件"本身就是平台差异，不该塞进共用契约，所以单独开一个逃生口：

- `src/renderer/platform/ipcRenderer/index.js`：`import { ipcRenderer } from 'electron'` + `export const rawIpcRenderer = ipcRenderer`
- `src/renderer/platform/ipcRenderer/web.js`：`Proxy` 替身，**访问任何属性即抛错**（用 `Proxy` 而不是逐方法重写，是为了不让替身和 Electron 真实的十几条方法越漂越远）

`build-config/renderer/webpack.config.web.js` 新增"关键差异 4.8"做构建期替换。

> **⚠️ 一个 webpack 陷阱（值得单独记住）**：
> `NormalModuleReplacementPlugin` 的 `afterResolve` 阶段**改 `resource.request` 是无效的** ——
> `NormalModuleFactory` 用的是**早一步定好的 `createData.resource`**，只有 `beforeResolve` 阶段
> 改 `request` 才会真正生效。而本项目 `@common/*`、`@renderer/*` 都是 webpack `resolve.alias` 别名，
> **裸说明符不带 `/index.js`**（写的是 `@common/platform/ipcBridge`），
> 所以 `afterResolve` 那种"绝对路径 + `/index.js$`"的写法根本匹配不到。
> 只照抄"关键差异 4.6"（http）的写法会**看起来改了、其实没改**（本轮实测踩到）。

### 4.3 桌面行为为什么没变

| 保证 | 做法 |
| --- | --- |
| 桌面 bundle 不含任何新分支 | 有两个 Electron 构建：`webpack.config.dev.js` / `webpack.config.prod.js`，两者都 **不** 引入本轮新增的任何 webpack 插件；`resolve.alias` / `DefinePlugin` 一律没动 |
| 桌面拿到的实现是"逐字透传" | `ipcBridge/desktop.js` 直接调 `ipcRenderer.*`，没有参数整理、没有异常包装、没有时机变化；`off` 依旧依赖调用方传入**原始 listener**（既有语义，未改） |
| 桌面产物里没有 web 分支 | 构建后实测：`ipcBridge/desktop.js` 存在于桌面产物、`ipcBridge/web.js` 不存在（反之在 web 产物里相反） |
| 用真 UI 测试兜底 | `node build-config/pack.js` 重建 `dist/` 后跑真 Electron UI 测试（结果见 §6） |

---

## 5. 探针产物（"宽容桥"下渲染出的移动端骨架）

探针里 `#root` 的实测状态：`childElementCount = 5`、`display: block`、
`#app-chrome` 内存在 `data-mobile-title-bar=""`（移动端标题栏分支被走到），
侧栏导航（搜索 / 歌单 / 排行榜 / 我的列表 / 设置）、列表页标题、播放栏、空状态文案全部渲染出来。

**这证明的是**：`dist-web` 的 HTML/CSS/Vue 挂载链路本身在移动端等价环境下是可用的；
挡住它的**不是**渲染层，而是 **Node 专有依赖（#1/#2/#4/#5）+ 缺失的 IPC 桥（#3/#6）**。

---

## 6. 验收门结果

**最终交付状态的实测行为**（`dist-web/renderer.191c7a47.js`，1 112 707 B）：
加载后**只剩阻塞点 #3 的两条错误**，`#root` 仍为 `childElementCount = 0 / display: none` —— 这正是预期：
(A) 类的原生桥没写之前，页面不该挂上。改动前的 `__dirname is not defined` 与
`node_modules/electron` 已**完全消失**（可复现：改动前 1 111 921 B 的 `renderer.fef2a351.js` 里含该包，
改动后不含）。

| # | 门 | 结果 |
| --- | --- | --- |
| 1 | `node node_modules\eslint\bin\eslint.js --ext .ts,.js,.vue src` | **0**（exit 0） |
| 2 | 四个 `tsc`（`src/main`、`src/renderer`、`src/renderer-lyric`、`src/common`） | **全 0** |
| 3 | `node --test "tests\unit\*.test.cjs"` | **153 / 153 全绿**（基线一致） |
| 4 | `node build-config/pack.js` | **exit 0** |
| 5 | `npm run build:web`（`NODE_ENV=production`） | **exit 0**，3 warnings（都是既有的：`url` polyfill 缺 `pathToFileURL` / `URL`、产物体积超 10 MiB 提示） |
| 6 | `npm.cmd run test:surfaces` + `npm.cmd run test:window-controls` | **均 exit 0**；`surfaces` 88 PASS / 0 FAIL |
| 7 | 临时脚本与静态服务器 | **全部在 `%TEMP%\rain-webprobe\`**，仓库内零临时文件（见 §7） |

补充实测（按本轮要求额外跑，用来确认桌面没被改坏）：

| 套件 | 结果 |
| --- | --- |
| `npm.cmd run test:playback-queue` | exit 0（首轮曾失败一次，复跑全绿 —— 环境抖动） |
| `npm.cmd run test:ui`（全套） | exit 0，**209 PASS / 0 FAIL** |
| `npm.cmd run test:responsive-layout`（单独复跑） | exit 0，159 PASS / 0 FAIL |

**关于抖动（重要，避免误判成回归）**：以下是首轮**观察到**的失败，复跑后全部消失：

| 套件 | 首轮观察 | 复跑 |
| --- | --- | --- |
| `test:surfaces` | 2 条 FAIL（`mono playlist cards fit within the page`、`mono pagination is visible and fits the page`） | **88 PASS / 0 FAIL** |
| `test:ui`（全套） | 在 `responsive-layout` 的 `828x540 leaderboard` 处 **suite aborted**：`waitFor 'leaderboard provider settled' timed out after 5000ms` → `Error: leaderboard did not finish its initial provider request`（`tests/ui/responsive-layout.electron.cjs:160`） | **exit 0，209 PASS / 0 FAIL** |
| `test:playback-queue` | 一次 renderer 脚本错误（只跑到 `PASS opens queue-custom list`） | **exit 0，全绿** |

判断依据（说明这些不是本轮引入的回归）：

- 三条断言都与本轮改动无关（歌单卡片/pagination 布局、排行榜外部数据请求、队列本地音频）；
- 本轮改动只碰 IPC 传输层，没有动任何布局或数据流；
- `responsive-layout` 那条是**外部数据请求超时**，属网络抖动；
- 该仓库最近一次提交本身就是 `test: make responsive-layout deterministic across environments`，
  说明这类抖动是已知的既有问题。

---

## 7. 清理

- 所有临时件都在 `%TEMP%\rain-webprobe\` 下：`app/`（Electron 加载器 + 静态服务器/探针注入）、
  `probe/`（宽容桥探针配置与替身）、`launch.cjs`、`run*/probe*/baseline/` 输出目录。
- **仓库内没有留下任何临时加载脚本或服务器**：`git status` 只有 3 个改动文件 + 2 个新增目录
  （都是正式代码）。
- 静态服务器用的是 `127.0.0.1` 高位端口（5199 / 5299），只监听本机；Electron 进程只按
  自己 spawn 出来的 PID 清理（`taskkill /PID <pid> /T /F`），**从未按进程名杀进程**。

---

## 8. Android 首版必须重写的最小集合（按优先级）

供阶段 3-5 直接照此排期。**P0 不做完，页面永远挂不上（全白）；P1 不做完，页面能出但功能是空的。**

### P0 · 让 `app.mount('#root')` 能执行到

| 序 | 项 | 对应阻塞点 | 落点 | 难度 |
| --- | --- | --- | --- | --- |
| P0-1 | **IPC 传输桥的原生实现**：`send / invoke / on / off` 四条语义在 Capacitor 侧落地（原生 ↔ WebView 双向消息 + 请求应答配对 + 取消） | #3 | 替换 `src/common/platform/ipcBridge/web.js` 的占位实现；契约见 `docs/android/ipc-contract.md` | 大 |
| P0-2 | **启动期必需通道**：`common_get_app_setting`、`common_set_app_setting`、`winMain_get_hot_key`、`winMain_set_hot_key_config`、`winMain_key_down`、`winMain_focus`、`winMain_on_config_change`、`winMain_get_data`、`common_get_env_params`。其中热键/窗口聚焦类在 Android 首版**允许降级为空实现**，但通道本身必须存在（否则 `registerEvents()` 同步抛错） | #3 · #6 | 原生侧 handler，逐条对照 `docs/android/ipc-contract.md` 的"B 可直接移除"标记 | 大 |
| P0-3 | **存储落点**：设置的同步读 / 异步写（Android 只有异步 API，需要"预热内存快照 + 异步回写"） | #3 · #6 | `src/main/platform/storage/adapter.android.ts` 的骨架已有，需接线 `@capacitor/preferences` | 大 |

### P1 · 让页面不是"空壳"

| 序 | 项 | 对应阻塞点 | 落点 | 难度 |
| --- | --- | --- | --- | --- |
| P1-1 | **`@common/utils/electron` 的平台拆分**：`encodePath` 摘成纯工具；`openUrl → window.open`、`clipboardWriteText → navigator.clipboard`、`openDirInExplorer → no-op/提示`；`clipboardReadText` 因**只有异步 API**需先改调用点设计 | #4 | 新增平台模块 + 改 renderer 侧 **16 个** import 点 | 中 |
| P1-2 | **`electron-log/node` 剥离**：Android 首版日志走 console（或原生 logcat 桥） | #5 | 新增 `src/common/platform/log/`，改 `src/common/utils/index.ts:1,44-46` 与 4 个使用点 | 小-中 |
| P1-3 | **网络层**：`vendor/needle` 已被构建期换掉（`platform/http/web.js`），但要真机验证 **Cookie / User-Agent / Referer 请求头**、**跨域重定向读 `Location`**、**明文 `http://` 端点**这三项 | 未测 | `src/renderer/platform/http/web.js` | 中 |
| P1-4 | **`node-id3` / `browserify-zlib` 剥离**（下载 worker 内的 ID3 写标签）：Android 侧需要原生文件写 + 标签库替代 | 未测（`browserify-zlib` 实测仍在下载 worker 内） | `src/common/utils/download/*`、`src/renderer/worker/download/*` | 中-大 |
| P1-5 | **两个 Worker 的运行时复核**：webpack 已把 `new Worker(new URL(...))` 打成 Web Worker chunk，但**真机 WebView 里 worker 能否加载、`window.Capacitor` 在 worker 里是否可见**都需要真机验证 | 未测 | `src/renderer/worker/index.ts` | 中 |

### P2 · 移动端体验（可以晚于"能跑"）

移动端标题栏占位（`data-mobile-title-bar` 已渲染，需接入真实状态栏/安全区）、
后台播放与音频焦点、`convertFileSrc` 统一处理文件 URL、通知栏媒体控制。

---

## 9. 本机模拟与真机的差异（哪些结论**不能**从本机推广到真机）

**本机模拟能回答的**：加载可行性、Node 专有依赖的残留、模块加载顺序、启动期同步抛错的因果链、
构建期替换是否真的生效。**本机模拟不能回答的**，逐条列清：

1. **没有 Capacitor 原生桥。** `window.Capacitor` 是本机注入的**最小 mock**
   （只有 `isNativePlatform()` / `getPlatform()` / `convertFileSrc()` 和几个空插件桩）。
   它只能证明"平台判定会走 capacitor 分支"，**不能**证明任何 `@capacitor/*` 插件真的可用 ——
   插件名、方法名、返回结构、权限、异常形状**全部未验证**。
   ⇒ 因此 §3 里所有"需要原生通道"的结论只到**方向**为止，具体通道与参数必须在真机上重测。
2. **WebView 内核不同。** 本机用的是 **Electron 42 自带的 Chromium**，尺寸 412x915。
   真机是 **Android System WebView**（版本随设备/系统，可能远低于本机；Android 7 上可能是 Chrome 51 级别）。
   WebView 版本会直接决定 ES 语法、CSS 特性、`Proxy` / `navigator.clipboard` / `ResizeObserver`
   等 API 是否存在。本机跑通**不代表**真机跑通。
3. **没有明文流量策略。** 真机 Android 9+ 默认阻止 `http://`（需要 Network Security Config），
   还要区分 `usesCleartextTraffic` 与 `networkSecurityConfig`。本机是 `http://127.0.0.1` 的本地
   静态服务器，**完全绕过了这一层**。内嵌音源里凡是 `http://` 的端点，
   本机不会报错，真机会 —— 这一项只在 `docs/android/cleartext-verification.md` 里，本机无法验证。
4. **没有 CORS 约束。** 本机静态服务器和页面同源；真机里页面在 `https://localhost`、
   接口在第三方域名，跨域 `fetch` 会被 CORS 拦。`platform/http/web.js` 依赖
   `CapacitorHttp` patch 全局 `fetch` 来绕过 —— 这一条**本机完全没有覆盖**。
5. **`file://` vs Capacitor 的 URL 方案。** 真机文件访问走
   `Capacitor.convertFileSrc()`（`http://localhost/_capacitor_file_/...`），
   本机没有这套映射；主题图片、下载目录、本地歌曲的 URL 语义**必须真机验证**。
6. **没有屏幕/字体/密度差异。** 真机有状态栏、手势导航条、安全区、系统字体缩放、
   深色模式联动、刘海/挖孔。第 5 节那张骨架截图**只能说明布局能渲染出来**，
   不能说明它在 360dp 宽 + 大字体 + 手势条下不溢出。
7. **没有音频与生命周期约束。** 后台播放、来电打断、音频焦点、
   息屏后 WebView 被回收、Capacitor `App.pause/resume` —— 本机（前台、从不暂停）**一律未覆盖**。
8. **`window.Capacitor` 在 Web Worker 里的可见性未验证。** 本机探针只在页面主世界注入过 mock；
   两个 Worker 是在没有 `Capacitor` 的环境里跑的。真机上插件桥能否被 worker 看到，
   直接决定下载 worker（ID3/解码）能不能工作。
9. **`sandbox: true` 不等于 Android WebView 的进程/权限模型。** 本机 Chromium 沙箱的
   文件系统可见性与 Android 应用私有目录（`/data/user/0/<app>/files`）完全是两回事。
10. **`electron.exe` 启动参数与真机无关。** 本机没有任何"让页面更容易跑起来"的放宽开关，
    但"没有加放宽开关"本身**不等于**"真机环境更严格的地方也覆盖到了"（见上面第 2、3、4 条）。

---

## 10. 复现这份结论所需的最小步骤

1. `node build-config/pack.js`（约 3.5 分钟）→ `NODE_ENV=production npm run build:web`（约 1 分钟）。
   > ⚠️ 直接 `node webpack-cli ... --config build-config/renderer/webpack.config.web.js`
   > **不会**进 production 模式（产物名不带 contenthash、不压缩），
   > 必须带 `NODE_ENV=production`（`npm run build:web` 内部用 `cross-env` 设好了）。
2. 用 §1 的环境加载 `dist-web/`（临时加载器 + 静态服务器 + Capacitor mock + 错误钩子，全部放 `%TEMP%`）。
3. 观察 `window.onerror` / `unhandledrejection` 与 `#root` 的 `childElementCount`：
   - `childElementCount === 0 && display === 'none'` ⇒ 仍然卡在 P0；
   - `childElementCount > 0` ⇒ P0 已过，剩下的都是 P1/P2。

---

## 附：本轮改动文件

| 文件 | 状态 |
| --- | --- |
| `build-config/renderer/webpack.config.web.js` | 修改（新增"关键差异 4.7 / 4.8"两条构建期替换 + 注释说明 webpack 的 `beforeResolve` 陷阱） |
| `src/common/rendererIpc.ts` | 修改（改为经 `@common/platform/ipcBridge`，不再直连 `electron`） |
| `src/renderer/utils/ipc.ts` | 修改（`ipcRenderer` 改为经 `@renderer/platform/ipcRenderer`；只影响 `onFullscreenChanged()`） |
| `src/common/platform/ipcBridge/{index,desktop,web}.js` | 新增 |
| `src/renderer/platform/ipcRenderer/{index,web}.js` | 新增 |
