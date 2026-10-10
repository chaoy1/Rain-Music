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
| **状态** | **已修**（阶段 3 / 线 E-2；见 §4.4。注意：修掉它之后**并没有**挂载成功 —— 挡住挂载的是另一件事，见 #7） |

### 阻塞点 #7 —— `getSetting()` 的 rejection 没有人接，`app.mount('#root')` 仍在 `.then` 里

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Unhandled (in promise) Error: Rain Music Android: 渲染层 IPC 桥（src/common/platform/ipcBridge/web.js）尚未实现。…被调用的通道：invoke("common_get_app_setting")`。**这是修完 #3 之后渲染层里唯一的一条错误/未处理 rejection**（`window.onerror` 0 条、`console.error` 0 条） |
| **触发源码位置** | `src/renderer/main.ts:42` 的 `void getSetting().then(setting => { … app.mount('#root') /* :89 */ })` —— `getSetting()`（`src/renderer/utils/ipc.ts:13` → `common_get_app_setting`）**没有 `.catch`，也没有 `else` 分支** |
| **归类** | **(A) 必须重写**（通道本身；`docs/android/ipc-contract.md` §4.1「设置 / 环境 / 初始化握手」，`common_get_app_setting` 在其中） |
| **难度** | 中（**接线**）+ 大（真正的原生桥） |
| **为什么它比 #3 更隐蔽** | #3 是"同步抛错打断模块求值"，改成逐条容错就过去了；这一条是"**挂载依赖的数据拿不到**"—— Promise 正常 reject，`main.ts` 的模块求值**没有中断**（`registerEvents` 之后的 import 与顶层代码全都跑完了），但 `.then` 回调永远不执行 ⇒ `app.mount()` 永远不执行 ⇒ 页面仍然是全白，且**没有任何同步异常**留下痕迹（只有一条未处理 rejection） |
| **需要什么才能过** | 两条路，**只能选一条**：① `main.ts:42` 在取值点显式降级（"拿不到设置时用渲染层默认设置继续挂载"）；② 原生桥真正实现 `common_get_app_setting`。①是**本轮就已经准备好的东西**：`src/renderer/platform/ipcFallback/web.js` 的头注释整段就是在论证这件事，但 `main.ts` 至今**没有 import 它**（该模块在本轮之前是惰性的） |
| **状态** | **已修**（阶段 3 / 线 F；§4.5 实测：降级告警出现、`Set lang zh-cn` 出现、`.then` 回调整段执行到 `app.mount('#root')`，`#root` 被 Vue 标记为容器。**但页面仍未渲染** —— 挡住它的是新记录在案的 **#8**） |

### 阻塞点 #8 —— `app.mount('#root')` 执行了，但 Vue 一个 DOM 都没渲染（无异常、无告警）

| 列 | 内容 |
| --- | --- |
| **具体错误** | **没有错误**。这正是它难查的原因：`window.onerror` **0 条**、`unhandledrejection` 与 `console.error` 里**没有一条**来自 Vue 渲染链路、`console.warn` 里也没有 Vue 的告警。实测状态是"静默空渲染"：`#root` 拿到了 Vue 的挂载标记（`data-v-app=""`）却**没有任何子节点**（`childElementCount = 0` / `display: none` / `rect 0x0`），`#app-chrome` 不存在 |
| **触发源码位置** | `src/renderer/main.ts:129` 的 `app.mount('#root')`（`.then` 回调内的最后一行）。它前面的每一步都跑到了：`main.ts:101` 打了 `Set lang zh-cn`、`main.ts:120` `initSetting(setting)`、`main.ts:127` `initPlugins(app)`（注册 Dialog / SvgIcon / Tips = 39 个组件 + 插件）、`main.ts:128` `mountComponents(app)` 均已执行 |
| **归类** | **(A) 必须重写**（渲染链路上的阻塞点；不是 IPC 通道缺口，修 IPC 无法绕过） |
| **难度** | 中（定位）+ 待定（修复面；见下"需要什么才能过"） |
| **实测证据（阶段 3 / 线 F，强制重挂载探针）** | 在页面主世界对同一个 app 实例做"改 `app.config.errorHandler` + `warnHandler`、包 `console.error` / `console.warn`、清空 `#root`、再 `app.mount(root)`"，得到：`app._instance === null`（**根组件实例从未创建**）、`proxy.subTree === null`（**渲染产物为空**）、`afterMountChildren = 0`、`#root` 的 `outerHTML` 只有 `<div id="root" style="display:none" data-v-app=""></div>`；而 `errorHandler` / `warnHandler` / `console.error` / `console.warn` 四条钩子**一条都没触发**。`require.context` 注册的 39 个组件也确实在 `app._context.components` 里（`RouterLink` / `BaseMusicList` / …），说明 `initPlugins` + `mountComponents` 是成功的 |
| **为什么它不是 #7 没修对** | #7 的验收点是"`app.mount()` 这一行到底有没有被执行到"。本节的证据是**执行到了**：`#root` 上的 `data-v-app=""` 只有 `app.mount()` 会写；更直接的证据是 `main.ts:101` 的 `Set lang zh-cn` 出现在渲染进程 console 里（那行在 `app.mount()` 之前 28 行，同一个 `.then` 回调里）。所以 #7 的改动**按自己的验收标准已经通过**，挡住画面的是**另一条通道**：Vue 的挂载/渲染没有产出 |
| **需要什么才能过** | 把"根组件 setup 是否真的被调用"与"`App.vue` 的编译产物是否被 `createApp` 拿到"两件事分别证伪。**下一步的最小实验**（本轮未做，避免超出"最小任务"范围）：① 用同一个页面里的 Vue，`createApp({ render: () => h('div', 'x') }).mount(容器)` 做对照 —— 若对照也不渲染，问题在 Vue 运行时/构建模式，不在业务组件；② 若对照能渲染，则逐个短路 `main.ts:127-128`（`initPlugins` / `mountComponents`）与 `App.vue` 的 `useApp()`，找出让根组件 setup 静默不产出的那一个。注意 `App.vue` 的模板**确实在产物里**（`app-chrome` / `wallpaper-layer` / `data-mobile-title-bar` 字符串各出现 1 次，`__name` 出现 39 次），所以**不是**"模板没编进去" |
| **根因（阶段 3 / 线 G 已确证）** | `App.vue` 的 `setup()` 是**同步**执行的，而它的同步调用图里有 **9 处无条件调用平台通道**的地方（清单见 §4.6）；这些通道在 web / Capacitor 侧是**刻意做成"调用/访问即抛错"**的占位实现 ⇒ 异常穿出 `setup()` ⇒ Vue 的 `handleError` 只打一条 `console.error(err)`、**不经过 `window.onerror`**（所以那时"uncaught 0 条"并不等于"没有异常"）⇒ 根组件的 setup 结果没被采纳 ⇒ 空注释 vnode。**这是 #3 的同类遗漏**：#3 修掉了 `registerEvents()` 的顶层注册，这一条是 `useApp()` 的同步调用图 |
| **状态** | **已修**（阶段 3 / 线 G）：9 处全部改用 `src/renderer/platform/ipcFallback/subscribe.ts` 的同一套降级入口。实测 `#root.childElementCount = 3` / `display: block`，侧栏、播放栏、`#app-chrome` 全部渲染（§4.6） |

### 阻塞点 #9 —— `getEnvParams()` 的 rejection 没有人接，挂载后**整段初始化**不执行（#7 的同构遗漏）

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Unhandled (in promise) Error: …被调用的通道：invoke("common_get_env_params")`。**没有同步异常**：`app.mount('#root')` 已经执行、界面已经渲染（这正是它现在才暴露出来的原因 —— #8 修好之前根本走不到这里），但 `useApp/index.ts:52` 的 `void getEnvParams().then(async(envParams) => { … })` **既没有 `.catch` 也没有 `else`** ⇒ `.then` 回调一整段不执行 |
| **触发源码位置** | `src/renderer/core/useApp/index.ts:52` 的 `void getEnvParams().then(...)`（`getEnvParams` = `src/renderer/utils/ipc.ts` → `common_get_env_params`）。**改动后这一行在 `:102`**（前面插入了降级说明注释；行号以线 H 之后的文件为准）。同一处 `.then` 里被跳过的还有：`applyWallpaper()`、`getViewPrevState()` + `router.replace()`、`initData()`（我的列表 / 下载列表）、`initPlayer()`、`handleEnvParams()`（启动参数）、`initDeeplink()`、`initStatusbarLyric()`、`sendInited()`、`handleListAutoUpdate()` |
| **归类** | **(A) 必须重写**（通道本身；`docs/android/ipc-contract.md` §4.1「设置 / 环境 / 初始化握手」，`common_get_env_params` 在其中） |
| **难度** | 小（**接线**，与 #7 的修法逐字同构）+ 大（真正的原生桥） |
| **为什么它和 #7 是同一个形状** | #7 是"挂载依赖的数据拿不到 ⇒ `app.mount()` 永不执行"；这一条是"挂载后初始化依赖的数据拿不到 ⇒ 初始化永不执行"。两者都只需要在**取值点**显式降级（`platform/ipcFallback` 的 `invokeWithFallback`），页面从"全白"变成"出来了但列表/播放器是空的" |
| **需要什么才能过** | 两条路，**只能选一条**：① `useApp/index.ts:52` 在取值点显式降级（拿不到 `envParams` 就用"没有 cmdParams / 没有 wallpaper / 没有 deeplink"的空对象继续，并保证 `initData()` / `initPlayer()` / `sendInited()` 仍然执行）；② 原生桥真正实现 `common_get_env_params`。①是**本轮就已经在用的那一层**（与 #7 的 `/src/renderer/main.ts:82` 完全同构） |
| **状态** | **已修（接线）**（阶段 3 / 线 H，§4.7 实测；**通道本身仍是 (A) 类**，要等原生桥）：`useApp/index.ts:102` 已按 #7 逐字同构接上 `invokeWithFallback` + "没有启动参数"的 `envParams` 兜底。降级告警出现、`common_get_env_params` 的未处理 rejection 消失、**`.then` 回调确实开始执行**（`applyWallpaper()` 跑到）；但它在**紧接着的 `await getViewPrevState()` 一行**就中断（`winMain_get_data`，新记录为 **#10**）⇒ 页面与上一轮**逐像素相同**，`initData()` / `initPlayer()` / `sendInited()` 这一段仍未执行 |

### 阻塞点 #10 —— `.then` 回调的**第二行**没人接：`getViewPrevState()` 的 rejection（#9 修好之后立刻暴露的同构遗漏）

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Unhandled (in promise) Error: …被调用的通道：invoke("winMain_get_data")`。**没有同步异常**。它是 #9 修好之后**新出现**的那条未处理 rejection（取代了原来那条 `common_get_env_params`，见 §4.7 的两轮对照） |
| **触发源码位置** | `src/renderer/core/useApp/index.ts:109` 的 `const state = await getViewPrevState()`（`src/renderer/utils/ipc.ts:224` → `WIN_MAIN_RENDERER_EVENT_NAME.get_data` = `winMain_get_data`，目录里的 `DATA_KEYS.viewPrevState`）。**线 I 改动后这一段在 `:148`**（前面插入了降级说明注释；行号以线 I 之后的文件为准）。它在 `invokeWithFallback(...).then(async(envParams) => { … })` 的**第二行之后**：`applyWallpaper(envParams.wallpaper)` 已经执行，`await` 一 reject，整个 async 回调就结束 ⇒ 后面的 `router.replace()`（`:113`）、`initData()`（`:116`）、`initPlayer()` / `handleEnvParams()` / `initDeeplink()` / `initStatusbarLyric()` / `sendInited()`（`:117-121`）、`handleListAutoUpdate()`（`:123`）**一行都跑不到** |
| **归类** | **(A) 必须重写**（通道本身；`docs/android/ipc-contract.md` §4.1 的 `winMain_get_data`。与 §8 的 **P0-7** / 阻塞点 **#6** 是同一条数据通道） |
| **难度** | 小（**接线**，与 #9 同构）+ 大（真正的原生桥 + 各调用方"空数据怎么继续"的形状决策） |
| **为什么它现在才暴露** | `useApp/index.ts:109` 在 #9 修好之前**不可达**（`.then` 回调整段不执行），所以 `winMain_get_data` 的失败那时只以**另一处调用点**的原始 `console.error` 出现（两轮共有的那一条；既然未修基线里也在，它就不可能来自本行）。#9 的降级把回调推进了一行，这一条才第一次以"未处理 rejection"的形状露出来 |
| **需要什么才能过** | 两条路，**只能选一条**：① `useApp/index.ts:109` 在取值点显式降级 —— 渲染层默认值/形状是现成的（`src/renderer/utils/ipc.ts:225` 已经写了 `?? { ...DEFAULT_SETTING.viewPrevState }` 的兜底**值**，但它只兜"resolve 成 null/undefined"，**兜不住 reject**；`utils/data.ts` 里 `getListPrevSelectId()` 等同类取值也都假设这条通道可用）。**注意这里有一个真实语义选择**：拿不到 `viewPrevState` 时"用默认 query 路由过去"与"**跳过 `router.replace()` 这一步**"并不等价，必须先按数据形状决定，且不许用假 query 让它看起来成功；② 原生桥真正实现 `winMain_get_data` |
| **状态** | **已修（接线）**（阶段 3 / 线 I，§4.8 同源 A/B 实测；**通道本身仍是 (A) 类**，要等原生桥）：`useApp/index.ts:148` 已按 #9 逐字同构接上 `invokeWithFallback`，兜底值是 **`null`**（= "这次没拿到上次的视图"，**不是** `DEFAULT_SETTING.viewPrevState`）⇒ `state == null` 时**整个 `router.replace()` 一步跳过**，回调**继续往下走**。实测：`winMain_get_data` 的未处理 rejection **消失**、降级 `console.warn` **+1**（`winMain_get_data`）、回调**确实越过了这一行**（新出现两条来自 `initData()` 内部链路的 rejection，见 **#11**）；但 `router.replace()` / `initData()` 之后的 `initPlayer()` / `sendInited()` 这一段**仍未跑完**，页面与 A **逐像素相同**（§4.8） |

### 阻塞点 #11 —— `initData()` **同步段**里 `registerAction()` 用裸 `rendererOn("player_list_data_overwire")`，订阅同步抛错 ⇒ `initData()` 整个 reject ⇒ `.then` 回调（`initPlayer` / `sendInited` / …）不执行（#10 修好之后暴露）

| 列 | 内容 |
| --- | --- |
| **具体错误** | `Unhandled (in promise) Error: …被调用的通道：on("player_list_data_overwire")`。**没有同步异常**。它是 #10 修好之后**新出现**的两条之一（另一条 `winMain_set_user_api` 见下），也是**唯一阻断初始化**的那条：`initData()` 返回的 Promise reject，而调用点 `src/renderer/core/useApp/index.ts:157` 是 `void initData().then(() => { … })` —— **只有 `.then`、没有 `.catch`** ⇒ `initPlayer()` / `handleEnvParams()` / `initDeeplink()` / `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()` 一行都不执行 |
| **触发源码位置** | `src/renderer/core/useApp/useDataInit.ts:42` 的 `unregister = registerAction(…)` → `src/renderer/store/list/action.ts:15 registerAction()` → `src/renderer/store/list/listManage/rendererListManage.ts:228` 的 `rendererOn(PLAYER_EVENT_NAME.list_data_overwire, list_data_overwrite)`。`rendererOn` 在 `src/common/platform/ipcBridge/web.js` 里是"调用即同步抛错"的占位实现（与 #3 / #8 同一个形状），而 `useDataInit` 返回的是 **async** 函数 ⇒ 这个**同步 throw 变成 `initData()` 的 rejection**，只是发生在挂载之后的异步链里。它**在 `await getUserLists()`（`useDataInit.ts:45`）之前**，所以 `player_list_get` 这一次**根本没有被调用** —— B 轮未处理 rejection 里没有它，正是"链在这里就断了"的直接证据（原始栈经 sourcemap 还原落在 `rendererListManage.ts` ← `store/list/action.ts`，见 §4.8） |
| **归类** | **(A) 必须重写**（`player_list_data_overwire` 是主进程 `commonRenderers/list` 的列表广播通道，Android 侧要原生桥）+ **小接线**（与 #8 同构：`subscribeSkippable`；同时 `initData()` 的调用点需要一个明确的"失败也要继续"的形状，否则这一步之后的整段初始化都会被吃掉） |
| **难度** | 小（接线）+ 大（通道） |
| **为什么它现在才暴露** | `initData()` 在 #10 修好之前**不可达**（整个 `.then` 回调不执行）⇒ 它的失败那时完全看不见 |
| **需要什么才能过** | 两条路，**只能选一条**：① `registerAction()` 里这一组订阅（`rendererListManage.ts:228-239` 共 12 条 `rendererOn`）改走 `subscribeSkippable`（A 类 ⇒ `console.error` 降级 + 跳过订阅，与 §4.6 的 9 处逐字同构），并给 `useApp/index.ts:157` 补上"失败也继续"的形状；② 原生桥真正实现这一整组列表广播（`list_data_overwire` / `list_add` / `list_remove` / `list_music_*` …） |
| **状态** | **未修**（本轮按任务书"下一条 (A) 类不要修"只记录） |

> **同时新暴露、但**不阻断**的一条**（不单独编号 —— 避免把"能继续"的和"断链"的混在一起）：
> `invoke("winMain_set_user_api")`，来自 `src/renderer/core/apiSource.ts:42` 的 `void setUserApiAction(apiId)`
>  —— **故意不 await** 的内置音源写回（`apiSource.ts:38-44` 的 else 分支；`/^user_api/` 分支那条走 `:26` 的
> `await … .catch(…)`，`useInitUserApi` 里那条 `await setUserApi(…)` 又由 `useDataInit.ts:38` 的 `.catch()` 接住，
> 所以只有这条 `void` 的会变成未处理 rejection）。归属 **(A)**（`ipc-contract.md` §4.1「自定义源」），
> 修法与 #9 / #10 同层，但它**不会**阻断 `initData()`。

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

### 4.4 已修 #3（阶段 3 / 线 E-2）：`ipcFallback` 接线 + 实测

**接线（`src/renderer/event/index.ts`）**：`registerEvents()` 里那 4 条热键/窗口通道全部改走
`@renderer/platform/ipcFallback`，其中每条都是 **(B) 类 = 桌面专有、Android 直接移除**
（`docs/android/ipc-contract.md` §4.2「全局快捷键」7 条 +「窗口按钮/全屏/尺寸」组）：

| 通道 | 桌面 | Android（web 桥） | 依据 |
| --- | --- | --- | --- |
| `winMain_get_hot_key` | `await invokeSkippable(...)` 拿到真实配置 | `fallback` 生效 ⇒ 返回 `undefined` ⇒ **跳过该取值**，`window.rain.appHotKeyConfig` 保持 `globalData.ts:8-17` 的空配置 | §4.2（B） |
| `winMain_set_hot_key_config` | `bridge.on` 逐字订阅 | 同步抛错被 `ipcFallback` 归一化为 rejection ⇒ **跳过该注册** | §4.2（B） |
| `winMain_key_down` | 同上 | 同上 | §4.2（B） |
| `winMain_focus` | 同上 | 同上（Android 是单窗口 WebView，没有"窗口重新聚焦"语义） | §4.2（B） |

关键实现约定（都写在代码注释里）：

- 三个平台实现**签名必须一致** `invokeWithFallback(invoke, channel, fallback)`；桌面端
  **不读** `fallback`，但参数必须留在签名里（否则 TS 调用方拿到 `TS2554`）。
- `ipcFallback/web.js` **归一化**两种失败形状：`bridge.on` 的**同步抛错** 与
  `rendererInvoke` 的**异步 reject** 走同一条 `.catch`（`Promise.resolve().then(() => invoke(channel))`）。
- **不假装成功**：`fallback` 返回 `undefined`，调用方 `await` + `if (value)`；**不接链式 `.then`**
  （否则 web 侧会把 `undefined` 塞进 `setHotkeyConfig` 的析构）。三条订阅通道失败时
  **不注册假 listener、不动 `window.key_event` / `window.app_event`**。
- 构建期替换："关键差异 4.10"把 `@renderer/platform/ipcFallback` 换成 `/web`（仅 web 构建）。
  实测产物：web bundle 含 `[renderer/platform/ipcFallback]` 与 `已使用渲染层默认值继续挂载`，
  桌面 `dist/renderer.js` **不含**这两串 ⇒ 替换生效且桌面未受影响。

**实测（strict 环境，`nodeIntegration:false / contextIsolation:true / sandbox:true / webSecurity:true`，
无 preload，`http://127.0.0.1:5299/` 静态服务器，CDP 在页面脚本前注入最小 `window.Capacitor` mock）：**

| 项 | 实测值 |
| --- | --- |
| 产物 | `dist-web/renderer.0e3fc0c8.js`，1 113 515 B |
| `window.onerror`（uncaught） | **0 条** ⇒ **不再有阻断挂载的同步抛错** |
| `console.error` | **0 条** |
| `unhandledrejection` | **1 条**，且**只剩** `invoke("common_get_app_setting")`（见 #7） |
| `console.warn` | 8 条 = 4 条 `ipcFallback` 降级提示 + 4 条 `event/index.ts` 跳过提示（一一对应上表 4 条通道） |
| `#root` | `childElementCount = 0`、`display: none`、`rect 0x0`、无 `#app-chrome` —— **仍未挂载**（原因是 #7，不是 #3） |
| `capturePage()` PNG | `597 x 1280`（窗口 412x915，本机 DPR = 1.449），4752 B，画面为空白页 |
| mock 生效 | `window.Capacitor.getPlatform() === 'android'`、`isNativePlatform() === true` |

> **结论（不要误读）**：#3 **已修**（同步抛错消失了、4 条通道各自降级、模块求值不再中断），
> 但"页面挂上"这个**更大的验收目标仍未达成**，挡住它的是 #7 —— 一条 **异步、无异常** 的
> "挂载依赖的数据拿不到"。这正是任务书里 "若仍挂载不上：如实汇报新首错" 的情形；
> 本轮**没有**为了让它过而加空实现或放宽环境。

### 4.5 已修 #7（阶段 3 / 线 F）：`getSetting()` 在取值点降级 —— 实测"回调确实执行到了"，但页面仍未渲染

**改动**：`src/renderer/main.ts:82` 的裸 `void getSetting().then(...)` 改为
`void invokeWithFallback(async () => getSetting(), CMMON_EVENT_NAME.get_app_setting, () => ({ ...defaultSetting })).then(...)`。
桌面语义未变（`ipcFallback` 默认路径逐字透传、不读 `fallback`），Android 侧取不到设置就带
`@common/defaultSetting` 继续走到 `app.mount('#root')`。

**产物**：`npm run build:web`（`NODE_ENV=production`）**exit 0**，2 warnings（与 §6 门 5 同样两条既有 warning），
主 bundle `dist-web/renderer.1ed89747.js`，**1 113 660 B**。

**实测（strict 环境）**：`nodeIntegration:false / contextIsolation:true / sandbox:true / webSecurity:true`，
无 preload，`http://127.0.0.1:<随机高位端口>/` 静态服务器，Electron **42.11.6** / Chrome 148.0.7778.280 / Node 24.19.0，
注入最小 `window.Capacitor` mock（`isNativePlatform()=>true`、`getPlatform()=>'android'`），窗口 412x915（本机 DPR 1.4493 ⇒ 截图 597x1319）。

> **注入方式的一处必要替代（如实记录）**：文档 §1 原方案用 CDP `Page.addScriptToEvaluateOnNewDocument`。
> 本机 Electron 42 里 `webContents.debugger.attach()` 能成功，但所有**渲染进程**的 CDP 命令
> （`Page.enable`、`Runtime.evaluate`）**全部超时**（`CDP Page.enable timed out after 6000ms`），因此改用
> **静态服务器在 `index.html` 的 `<head>` 最前面插入同一段注入脚本**（`<script>` 立即执行，仍早于
> `<script defer src="renderer.*.js">`）。页面上下文、注入时机（页面脚本之前）、加载来源（`http://127.0.0.1`）、
> webPreferences 与"不加任何放宽开关"这四点都与原方案一致；探针里的 `__rainStrictInjectedAt` 早于 App 脚本即证明时机正确。
> 页面读取改用 `webContents.executeJavaScript`。

| 项 | 实测值 |
| --- | --- |
| 产物 | `dist-web/renderer.1ed89747.js`，1 113 660 B |
| 平台判定 | `window.Capacitor` 存在、`getPlatform() === 'android'`、`isNativePlatform() === true`；`<html>` class = `android android-14 transparent` |
| `window.onerror`（uncaught，含资源失败） | **0 条** |
| `unhandledrejection` | **1 条** —— `invoke("common_set_app_setting")`（`main.ts:100` 的语言写回，**故意保留的诚实失败**，见 #7 条目与 `main.ts` 注释） |
| `console.error` | **2 条** —— `on("winMain_on_config_change")`、`invoke("winMain_get_data")`（都是新走到的启动期通道） |
| `console.warn` | **9 条** = `ipcFallback` 降级 5 条（`winMain_get_hot_key` / **`common_get_app_setting`** / `winMain_set_hot_key_config` / `winMain_key_down` / `winMain_focus`）+ `event/index.ts` 跳过 4 条（上列 4 条订阅/取值通道） |
| **#7 的关键证据** | `console.warn` 里出现 **`[renderer/platform/ipcFallback] 平台通道 "common_get_app_setting" 取值失败（通道未实现），已使用渲染层默认值继续挂载`**，随后渲染进程 console 打出 **`Set lang zh-cn`**（`main.ts:101`）⇒ `.then` 回调确实执行了，`app.mount()` 那一行确实被走到 |
| `#root` | `childElementCount = 0`、`computedDisplay = none`、`rect 0x0`、`#app-chrome` 不存在 ⇒ **仍未挂载** |
| `#root` 的 Vue 标记 | `data-v-app=""` **在**（只有 `app.mount()` 会写），但 `root.__vue_app__._instance === null` 且 `proxy.subTree === null` ⇒ **挂载调用了，渲染产物为空**（见 #8） |
| 侧栏导航文字 / 播放栏 / "我的列表" | **一个都没有**：`navLabels = []`、`playBarText = null`、`viewText = null`、`body.innerText` 为空 |
| 其它 DOM | `#left` / `#toolbar` / `#view` / `#player` / `[data-mobile-title-bar]` 全部**不存在**；页面元素总数 50、样式表 1 张 |
| Worker | 渲染进程 console 出现 `hello main worker` / `hello download worker` ⇒ 两个 Worker 在主世界里**没有同步抛错** |
| `capturePage()` PNG | **597 x 1319**，4 893 B，画面为**纯白空页**（无可辨认的应用界面：没有侧栏、没有播放栏、没有任何文字） |

> **结论（不要误读）**：#7 **已修**并按自己的验收标准通过 —— 卡住挂载的"取值点"降级已经生效，
> `.then` 回调整段执行到 `app.mount('#root')`，`#root` 也被 Vue 认领。但"页面挂上"这个**更大的验收目标仍未达成**：
> 现在挡住它的是 **#8** —— 一条**完全静默**的"挂载调用了、渲染没产出"（`window.onerror` 0 条、
> `unhandledrejection` 与 `console.error` 里都没有 Vue 渲染链路的痕迹）。本轮**没有**修它（(A) 类，且超出最小任务范围）。

---

### 4.6 已修 #8（阶段 3 / 线 G）：`setup()` 同步调用图上的 9 处平台通道逐条降级 —— **strict 环境首次挂载成功**

**改动**：新增 `src/renderer/platform/ipcFallback/subscribe.ts`（把原先散在
`event/index.ts:129-134` 与 `useEventListener.ts` 里的"可跳过取值 / 订阅"收敛成**唯一实现**：
`invokeSkippable` / `subscribeSkippable` / `reportChannelSkipped`），然后把
`App.vue setup()` **同步调用图**里所有"无条件、同步调用平台通道"的点逐个接到它上面：

| # | 同步调用路径 | 通道 | 归类 | 处理方式 |
| --- | --- | --- | --- | --- |
| 1 | `useApp/index.ts:43` → `useEventListener.ts:94` | `winMain_on_config_change` | A | `subscribeSkippable(…, 'A', …)` 降级（跳过订阅，`console.error`） |
| 2 | `useEventListener.ts:100` | `winMain_focus` | B | `subscribeSkippable(…, 'B', …)`（`console.warn`） |
| 3 | `useEventListener.ts:103` | `winMain_fullscreen_state` | B | 同上（该通道走裸 `ipcRenderer` Proxy，"访问即抛错" ⇒ `reason=failed`） |
| 4 | `useEventListener.ts:106` | `common_theme_change` | C | `subscribeSkippable(…, 'C', …)`（`console.error`） |
| 5 | `useApp/index.ts:44` → `usePlayer/index.ts:14` → `usePlayer.ts:47` → `useLyric.ts:18` → `core/lyric.ts:85 init()` → `:109` | `winMain_process_new_desktop_lyric_client` | B | 跳过订阅；`desktopLyricPort` 保持 `null` ⇒ `sendDesktopLyricInfo()` 是空操作 |
| 6 | `useApp/index.ts:44` → `usePlayer/index.ts:15` → `usePlayStatus.ts:70` | `winMain_player_action_on_button_click` | B | 跳过订阅；返回的取消订阅函数仍是空操作（`onBeforeUnmount` 会调用） |
| 7 | `useApp/index.ts:46` → `useDataInit.ts:25` → `useInitUserApi.ts:25` | `winMain_user_api_status` | A | `subscribeSkippable(…, 'A', …)` |
| 8 | `useInitUserApi.ts:145` | `winMain_user_api_show_update_alert` | A | 同上 |
| 9 | `useApp/index.ts:47` → `useDeeplink/index.ts:53` | `common_deeplink` | C | `subscribeSkippable(…, 'C', …)`（Android 侧由 `@capacitor/app` 的 `appUrlOpen` 换成同名广播） |

**已确认"不是"setup 期同步抛错**（逐个查过，不改）：`useStatusbarLyric()`（只挂本地
`window.app_event`）、`useHandleEnvParams()`、`usePlayerDetailTransition()`、
`usePlayer/*` 与 `plugins/player` 其余 composable（都不 import `@renderer/utils/ipc`）；
`useSettingSync.ts:15 setWindowSize` / `usePlayStatus.ts` 的三条 `watch` /
`usePlayer.ts:73 setPowerSaveBlocker`（`isPlay.value === false`）/ `usePlayProgress.ts`
的 `delaySavePlayInfo` / `useApp/index.ts:67 sendInited` 都在 `watch` 回调、`.then` 或
事件处理器里，**不在同步段**。`rendererInvoke` 本身是 `async`，同步 throw 会变成
rejection 而不是同步异常 —— 所以只有 `rendererOn` / `rendererOnce` / `rendererSend` /
`rendererSendSync` / 裸 `ipcRenderer` 这五类才是"setup 期同步抛错"的来源。

**产物**：`npm run build:web`（`NODE_ENV=production`）**exit 0**，2 warnings（与 §6 门 5 同样两条既有 warning），
主 bundle `dist-web/renderer.8c3ba79a.js`，**1 114 227 B**。

**实测（strict 环境）**：与 §4.5 完全同一套环境 —— `nodeIntegration:false / contextIsolation:true /
sandbox:true / webSecurity:true`、无 preload、`http://127.0.0.1:5321/?os=android&osver=14`
（静态服务器 + **内联注入在 `<head>` 最前**的 Capacitor mock，理由同 §4.5）、
Electron **42.11.6** / Chrome 148.0.7778.280 / Node 24.19.0、窗口 412x915
（本机当前缩放 ⇒ 截图 618x1373）。

| 项 | 实测值 |
| --- | --- |
| 平台判定 | `window.Capacitor` 存在、`getPlatform() === 'android'`、`isNativePlatform() === true`；`<html>` class = **`android android-14 transparent`** |
| **`#root.childElementCount`** | **3**（`#wallpaper-layer` / `#container` / `#icons`）⇒ **P0 已过** |
| `#root` 的 `display` | **`block`**（不再是 `none`；`App.vue` 的 `onMounted` 已经跑到） |
| `#root` 的 `outerHTML`（前 2 000 字符） | `<div id="root" style="display: block;" data-v-app=""><div id="wallpaper-layer" class=""></div> <div id="container" class="view-container"><div id="app-chrome" class=""><div class="Muf8X" id="left" data-glass="">…`（后面是完整的侧栏 `<ul>`） |
| `window.onerror`（uncaught） | **0 条** |
| `unhandledrejection` | **3 条**（全部是 (A) 类数据通道，**均不阻断挂载**）：① ② ③ 见下 |
| `console.error` | **7 条** = 5 条是本次新增的降级痕迹（`winMain_on_config_change` / `common_theme_change` / `winMain_user_api_status` / `winMain_user_api_show_update_alert` / `common_deeplink`）+ 2 条既有失败（`invoke("winMain_fullscreen_state")`、`invoke("winMain_get_data")`） |
| `console.warn` | **22 条** = `ipcFallback` 适配器告警 11 条 + 各调用点的"已跳过"告警 11 条（4 处 B 类 + `winMain_get_hot_key` 取值 + `event/index.ts` 的 4 条 B 类 + `core/lyric.ts` / `usePlayStatus.ts` 各 1 条） |
| `unhandledrejection` 逐条 | ① `invoke("common_set_app_setting")`（`main.ts:100` 语言写回，**故意保留的诚实失败**，同 §4.5）② `invoke("common_get_env_params")`（**新记录为 #9**）③ `invoke("common_set_app_setting")`（`main.ts:111-118` 的窗口尺寸/标准播放写回） |
| 侧栏导航文字 | **`["搜索", "歌单", "排行榜", "我的列表", "设置"]`**（`#left a` 的文字，实测有值） |
| 播放栏文本 | **`"R\nM\n列表循环播放"`**（`#player` 的 `innerText`） |
| `#app-chrome` / `#left` / `#player` / `#toolbar` / `#view` | **全部存在**（`true`）；`[data-mobile-title-bar]` 也存在 ⇒ 移动端标题栏分支被走到 |
| `body.innerText`（前 600 字符） | `Rain\nMusic\n搜索\n歌单\n排行榜\n我的列表\n设置\n歌单\nR\nM\n列表循环播放\n15 分钟\n30 分钟\n60 分钟\n自定义时间\n分钟\n开始计时` |
| 页面元素总数 / 样式表 | 283 / 1 |
| `capturePage()` PNG | **618 x 1373**，**433 005 B**（对比 §4.5 的 4 893 B 纯白页）；画面是**可辨认的应用界面**：左侧栏 "Rain Music" + 搜索 / 歌单 / 排行榜 / 我的列表 / 设置，顶部标题"歌单"，右侧列表区（空状态），底部播放栏 |

> **一处必须更正的旧判据（重要）**：#8 的"实测证据（阶段 3 / 线 F）"里把
> `root.__vue_app__._instance === null` 当作"根组件实例从未创建"的证据 —— 这在
> **production 构建里不成立**：Vue 的 `app.mount()` 只在 `__DEV__` 或
> `__FEATURE_PROD_DEVTOOLS__` 下才写 `app._instance`，本仓库的 web 产物是
> `NODE_ENV=production`，所以**修好之后它依然是 `null`**（本次实测确认）。
> 判断"有没有渲染"必须看 **DOM**（`#root.childElementCount` / `#app-chrome` / `#left` 的 `innerText`），
> 不要看 `_instance` / `subTree`。

> **结论**：**#8 已修，strict 环境的"首次挂载"验收点达成** —— `#root.childElementCount = 3`、
> `display: block`、侧栏 / 播放栏 / 移动端标题栏占位全部渲染，`window.onerror` 0 条。
> 页面**不再是全白**，但**仍是"半空壳"**：`getEnvParams()` 的 rejection 没人接（**#9**），
> 所以"我的列表 / 下载列表 / 播放器 / 深链 / `sendInited`"这一整段初始化没有执行。
> 这与 §5 探针骨架的结论一致：剩下的都是 (A) 类**数据通道**（#6 / #9），
> 不再是"挂不上"，而是"挂上了但某些数据是空的"。

---

### 4.7 已修 #9（阶段 3 / 线 H）：`getEnvParams()` 在取值点降级 —— 回调**确实开始执行**，但在下一行被 #10 挡住

**改动**：`src/renderer/core/useApp/index.ts:102` 的裸 `void getEnvParams().then(...)` 改为

```ts
void invokeWithFallback(async() => getEnvParams(), CMMON_EVENT_NAME.get_env_params, (): Rain.EnvParams => ({
  cmdParams: {},
  deeplink: null,
  wallpaper: null,
})).then(async(envParams: Rain.EnvParams) => { … })
```

新增两个 import（`@renderer/platform/ipcFallback` 的 `invokeWithFallback`、`@common/ipcNames` 的
`CMMON_EVENT_NAME`），此外**零改动**。与 #7 的 `src/renderer/main.ts:82` 逐字同构。

**兜底值是"这次启动确实没有启动参数"，不是编造的假数据**：`cmdParams: {}` 就是主进程
`src/main/utils/index.ts:19 parseEnvParams()` 在**一个 `-flag` 都没有**时的返回值，`deeplink: null` 是同一个
函数的默认值，`wallpaper: null` 是 `Rain.EnvParams.wallpaper` 写明的"取不到时为 null"。

**`envParams` 的三个消费点逐条**（这就是"哪些步骤要跳过、哪些照跑"的决策依据，也写在源文件注释块里）：

| 消费点 | 读什么 | 兜底后的行为 | 要不要"跳过" |
| --- | --- | --- | --- |
| `applyWallpaper(envParams.wallpaper)`（`:107`） | `wallpaper` | `null` ⇒ 立即 `return`，`wallpaperUrl` 保持空串、壁纸层不加 `.show`（`App.vue` 既有的回退分支） | 不需要：`null` 本来就是"没有壁纸"的正常输入 |
| `handleEnvParams(envParams)`（`useHandleEnvParams.ts:83-86`） | `envParams.cmdParams.search` / `.play` | `cmdParams: {}` ⇒ 两个都是 `undefined`，两个处理函数各自 `return` | 不需要 —— 但**兜底值必须带 `cmdParams`**：给 `{}` 会让这里变成 `undefined.search` 的 TypeError，等于"用一个假对象把失败换成另一种崩" |
| `initDeeplink(envParams)`（`useDeeplink/index.ts:75-86`） | `envParams.deeplink` | `null` ⇒ 跳过深链处理，只把 `isInited` 置 true | 不需要：`isInited = true` 正是"没有深链可处理"的正常分支 |

⇒ **没有任何一步被静默跳过，也没有任何一步拿到伪造的"成功数据"**；三步都以"本次没有启动参数"这一真实情形继续。

**桌面语义没有变化（逐条）**：`platform/ipcFallback` 默认路径（`./index.js` → `./desktop.js`）是
`invoke(channel)` **逐字透传**、第三个 `fallback` 参数桌面端**根本不读** ⇒ 兜底值在桌面端永远不会被构造；
桌面端 `invokeWithFallback(...)` 返回的就是 `getEnvParams()` 那个 Promise，调用时机/参数/时序与改动前一致；
桌面端 `common_get_env_params` 若真的 reject，仍然是**未处理的 rejection（大声失败）、下面的初始化照旧不执行** ——
与改动前完全一致（理由与 #7 相同：主进程自己提供的通道坏掉 = IPC 整体是坏的，保持大声失败更有诊断价值）。

> **桌面侧的两条产物级旁证（本轮实测，用来代替"只凭代码读一遍"）**：
> ① `dist-web/renderer.67626fba.js` 里含 web 适配器的降级文案（`已使用渲染层默认值继续挂载` **1** 次、
> 桥的占位实现 `尚未实现` **2** 次 = `ipcBridge/web.js` + `ipcRenderer/web.js`），
> 而**桌面产物 `dist/renderer.js` 里这两串都是 0 次** ⇒ 桌面 bundle 里根本没有那套降级实现，
> 本次传进去的 `fallback` 在桌面端是**不可达的死代码**；
> ② 桌面回归 `npm.cmd run test:surfaces`（88 PASS / 0 FAIL）与 `test:window-controls`（6/6 PASS）
> 都跑在**含本次改动的桌面产物**上并 exit 0（见 §6 门 6）。

**产物**：`npm run build:web`（`NODE_ENV=production`）**exit 0**，2 warnings（与 §6 门 5 同样两条既有 warning）。
为了做**同源对照**，本轮额外把这一行临时改回裸 `getEnvParams()` 重新构建了一次（测完立刻逐字还原，
`git diff -- src/renderer/core/useApp/index.ts` 为空可验），得到"除本行外一切相同"的基线产物：

| 产物 | bundle | 字节 |
| --- | --- | --- |
| **A**：#9 未修（同源对照基线，本轮重建） | `dist-web/renderer.72eb15be.js` | 1 114 213 B |
| **B**：#9 已修（本轮交付） | `dist-web/renderer.67626fba.js` | 1 114 296 B（比 A **+83 B**） |

> 为什么不用上一轮那个基线产物做对照：`dist-web/renderer.8c3ba79a.js`（§4.6 记录的 1 114 227 B）已被
> webpack 的 `output.clean` 清掉，而且它构建于仓库里**另一处并行改动**的较早状态（本轮重建的同源基线 A 就是
> 1 114 213 B，与它差 14 B），字节数已经不同源。A 的意义是"**只差本行**"，所以下面的逐项对照用它；
> 同时 A 的实测计数与 §4.6 记录的上一轮数字**逐项一致**，两条路互为交叉验证。

**实测（strict 环境）**：与 §4.5 / §4.6 完全同一套 —— `nodeIntegration:false / contextIsolation:true /
sandbox:true / webSecurity:true`、**无 preload**、`http://127.0.0.1:<port>/?os=android&osver=14`
（静态服务器 + **内联注入在 `<head>` 最前**的 Capacitor mock，理由同 §4.5）、
Electron **42.11.6** / Chrome 148.0.7778.280 / Node 24.19.0、窗口 412x915、**不加任何放宽开关**；
A 与 B 用**同一份加载脚本、同一等待时间（加载完成后 6 000 ms）**，只有产物不同（A 走 5418、B 走 5417），
读取一律用 `webContents.executeJavaScript`（`window.__rainReport()`）。

| 项 | **A**：#9 未修 | **B**：#9 已修 |
| --- | --- | --- |
| 平台判定 | `window.Capacitor` 存在、`getPlatform() === 'android'`、`isNativePlatform() === true`；`<html>` class = `android android-14 transparent` | 同（逐字符相同） |
| **`#root.childElementCount`** | **3** | **3** |
| **`#root` 的 `display`** | **`block`** | **`block`** |
| `#root` 的 `outerHTML`（前 200 字符） | `<div id="root" style="display: block;" data-v-app=""><div id="wallpaper-layer" class=""></div> <div id="container" class="view-container"><div id="app-chrome" class=""><div class="Muf8X" id="left" dat…` | **逐字符相同** |
| `window.onerror`（uncaught，含资源失败） | **0 条** | **0 条** |
| `unhandledrejection` 条数 | **3** | **3** |
| `unhandledrejection` **逐条** | ① `invoke("common_set_app_setting")`（`main.ts:100` 语言写回）② **`invoke("common_get_env_params")`**（#9）③ `invoke("common_set_app_setting")`（`main.ts:111-118`） | ① `invoke("common_set_app_setting")` ② **`invoke("winMain_get_data")`**（← 本轮的 **#10**，来自 `useApp/index.ts:109`）③ `invoke("common_set_app_setting")` |
| `console.error` | **7 条**（5 条 `ipcFallback` 降级痕迹 + `winMain_fullscreen_state` + **另一处调用点**的 `winMain_get_data`；与 §4.6 记录一致） | **7 条**，逐条与 A 相同 |
| `console.warn` | **22 条** | **23 条**（+1 = `[renderer/platform/ipcFallback] 平台通道 "common_get_env_params" 取值失败（通道未实现），已使用渲染层默认值继续挂载…` —— **#9 降级的可观测痕迹**；A 的 22 条里没有这一条） |
| 侧栏导航文字（`#left a` 的 `innerText`） | `["搜索","歌单","排行榜","我的列表","设置"]` | **同** |
| 播放栏文本（`#player.innerText`） | `"R\nM\n列表循环播放"` | **同** |
| `#app-chrome` / `#left` / `#toolbar` / `#view` / `#player` / `[data-mobile-title-bar]` | 全部**存在**（`true`） | **同** |
| `body.innerText`（前 600 字符） | `Rain\nMusic\n搜索\n歌单\n排行榜\n我的列表\n设置\n歌单\nR\nM\n列表循环播放\n15 分钟\n30 分钟\n…` | **同** |
| 页面元素总数 / 样式表 | 283 / 1 | **283 / 1** |
| `capturePage()` PNG | **597 x 1280**，**397 137 B** | **597 x 1280**，**397 137 B**，**SHA256 与 A 完全相同**（`1e7d65bcba20b938…91440391`）⇒ 画面**逐像素相同** |

> **PNG 尺寸的一处如实说明**：本节的两轮都是 **597 x 1280**，与 §4.6 记录的 618 x 1373、§4.5 记录的
> 597 x 1319 不同 —— 那是本机窗口缩放/内容区在不同时段的变化（§4.6 自己就标了"本机当前缩放"）。
> 本节的两轮是**同一台机器、同一次实测、同一份加载脚本**下拍的，所以 A/B 的逐像素比较不受影响。
> A 的首帧捕获偶发一次 `UnknownVizError`（合成器还没出帧），重试后得到；两轮 PNG 逐字节相同。
>
> **画面内容**（B 的 PNG，与 A 相同）：左侧栏 "Rain Music" + 搜索 / 歌单 / 排行榜 / 我的列表 / 设置，
> 顶部标题"歌单"，右侧列表区（**空状态**），底部播放栏（`R M` 占位块 + 播放控制图标）。

> **结论（诚实版）**：#9 的降级接线**按自己的验收标准通过了** —— 降级告警出现、`common_get_env_params`
> 的未处理 rejection 消失、`.then` 回调**确实开始执行**（`applyWallpaper()` 跑到）。
> 但**页面没有变完整**：回调在**紧接着的一行** `const state = await getViewPrevState()`（`:109`）
> 就被 `winMain_get_data` 的 rejection 中断，所以 `router.replace()` / `initData()` / `initPlayer()` /
> `handleEnvParams()` / `initDeeplink()` / `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()`
> **仍未执行**。两轮 PNG **逐字节相同**，是"这一轮没有把界面往前推"的直接证据 ——
> 这与任务书的预期一致（#6 也是数据通道），本轮**没有**为了"看起来有进展"放宽环境或塞假数据。
> 下一条是 **#10**（同一形状、下一个通道：`getViewPrevState()` → `winMain_get_data`），
> 它与 §8 的 **P0-7** / 阻塞点 **#6** 是同一条数据通道。

---

### 4.8 已修 #10（阶段 3 / 线 I）：`getViewPrevState()` 在取值点降级 —— 回调**继续往下走**（进了 `initData()`），但页面**逐像素相同**

**改动**：`src/renderer/core/useApp/index.ts` 的

```ts
const state = await getViewPrevState()
```

改为

```ts
const state = await invokeWithFallback(async() => getViewPrevState(), WIN_MAIN_RENDERER_EVENT_NAME.get_data, () => null)
if (state != null) {
  const isRemovedLoveList = (state.query as { id?: string }).id === LEGACY_LOVE_LIST_ID
  await router.replace({ path: '/list', query: state.url === '/list' && !isRemovedLoveList ? state.query : {} })
}
```

新增 `WIN_MAIN_RENDERER_EVENT_NAME` 到**已有的** `@common/ipcNames` import，此外**零改动**
（本轮只改这一个 `src` 文件）。与 #9 的 `useApp/index.ts:100` 逐字同构。

**降级值为什么是 `null`，而不是 `{ ...DEFAULT_SETTING.viewPrevState }`（本轮唯一的语义选择）**：

`getViewPrevState()` 自己已经写了 `?? { ...DEFAULT_SETTING.viewPrevState }`（`utils/ipc.ts:225`），
但那只兜"通道 **resolve** 成 null/undefined"，**兜不住 reject**。这里**故意不复用那个默认值**：
`{ url: '/list', query: {} }` 的语义是"上次停在 `/list`"——那是一份**声称自己知道用户上次在哪里的断言**。
取不到就是取不到：拿它去 `router.replace()` 等于把用户带到一个**他从未选择的页面**，
并让后面的 `initData()` / `initPlayer()` 在伪造的路由状态上跑。所以：

| 分支 | 行为 | 依据 |
| --- | --- | --- |
| `state == null`（Android 取不到） | **整个 `router.replace()` 一步跳过**，应用停在它自己**当前的真实路由**上；后面的 `initData()` 等**照跑** | "降级但继续"；`src/renderer/router.ts:65` 的 `/:pathMatch(.*)*` → `redirect: '/list'` 是一条**真实存在**的路由规则，不是这里编出来的 query |
| `state != null`（桌面 / 通道可用） | `isRemovedLoveList` 判断 + `router.replace()`，与改动前**逐字相同** | — |

**桌面语义没有变化（逐条）**：

1. `platform/ipcFallback` 默认路径（`./index.js` → `./desktop.js`）是 `invoke(channel)` **逐字透传**、
   第三个 `fallback` 参数桌面端**根本不读** ⇒ `null` 这个兜底值在桌面端**永远不会被构造**，
   `if (state != null)` 在桌面端**恒为真**，括号里两行与改动前逐字相同；
2. 桌面端 `invokeWithFallback(...)` 返回的就是 `getViewPrevState()` 那个 Promise，
   调用时机、参数、时序、`await` 位置与改动前一致；
3. 桌面端 `winMain_get_data` 若真的 reject，仍然是**未处理的 rejection（大声失败）、
   下面的初始化照旧不执行** —— 与改动前完全一致，没有变成"跳过路由恢复还能继续"
   （理由与 #7 / #9 相同：主进程自己提供的通道坏掉 = IPC 整体是坏的，保持大声失败更有诊断价值）。

**产物**：`npm.cmd run build:web`（`NODE_ENV=production`）**exit 0**，2 warnings（与门 5 同样两条既有 warning）。

| 产物 | bundle | 字节 |
| --- | --- | --- |
| **A**：#10 未修（同源对照基线，本轮重建） | `dist-web/renderer.67626fba.js` | 1 114 296 B |
| **B**：#10 已修（本轮交付） | `dist-web/renderer.d789b60e.js` | 1 114 355 B（比 A **+59 B**） |

> **A 是"只差这一处"的严格同源基线**：把 `:148` 临时改回裸 `const state = await getViewPrevState()` 后重新构建，
> 得到的产物与 **§4.7 交付的那个 bundle 逐字节相同**（同 hash `67626fba`、同 1 114 296 B）——
> 也就是说 §4.7 的 B 列实测数据**本身就是**本轮的 A 列，两次独立构建互为交叉验证
> （A 不在仓库里存活：webpack 的 `output.clean` 会清掉旧产物，所以本轮必须重建）。
> 构完立即**逐字节还原**（还原前后 SHA256 均为 `59B9267C…06111D`，见 §7）。

**实测（strict 环境）**：与 §4.5 / §4.6 / §4.7 完全同一套 —— `nodeIntegration:false / contextIsolation:true /
sandbox:true / webSecurity:true`、**无 preload**、`http://127.0.0.1:<port>/?os=android&osver=14`
（静态服务器 + **内联注入在 `<head>` 最前**的 Capacitor mock，理由同 §4.5）、
Electron **42.11.6** / Chrome 148.0.7778.280 / Node 24.19.0、窗口 412x915、**不加任何放宽开关**；
A 与 B 用**同一份加载脚本、同一等待时间（加载完成后 6 000 ms）**，只有产物不同（A 走 5422、B 走 5423），
读取一律用 `webContents.executeJavaScript`（`window.__rainReport()`）。
**两轮各跑了两次**（第一轮 5420 / 5421，第二轮 5422 / 5423，第二轮额外采集了 rejection 的原始栈），
下面表里的数字**两次逐项一致**。

| 项 | **A**：#10 未修 | **B**：#10 已修 |
| --- | --- | --- |
| 平台判定 | `window.Capacitor` 存在、`getPlatform() === 'android'`、`isNativePlatform() === true`；`<html>` class = `android android-14 transparent` | 同（逐字符相同） |
| **`#root.childElementCount`** | **3** | **3** |
| **`#root` 的 `display`** | **`block`** | **`block`** |
| `#root` 的 `outerHTML`（前 200 字符） | `<div id="root" style="display: block;" data-v-app=""><div id="wallpaper-layer" class=""></div> <div id="container" class="view-container"><div id="app-chrome" class=""><div class="Muf8X" id="left" dat` | **逐字符相同** |
| `location.hash` | `#/` | `#/`（`router.replace()` 被跳过 ⇒ 停在真实路由上，与 A 相同） |
| **`window.onerror`（uncaught，含资源失败）** | **0 条** | **0 条** |
| **`unhandledrejection` 条数** | **3** | **4** |
| **`unhandledrejection` 逐条** | ① `invoke("common_set_app_setting")` ② **`invoke("winMain_get_data")`**（← #10 本身） ③ `invoke("common_set_app_setting")` | ① `invoke("common_set_app_setting")` ② **`invoke("winMain_set_user_api")`**（新，不阻断，见 #11 的注） ③ **`on("player_list_data_overwire")`**（新，**就是新记录的 #11**） ④ `invoke("common_set_app_setting")` |
| `unhandledrejection` 消息原文 | 三条的固定前缀**逐字相同**：`Rain Music Android: 渲染层 IPC 桥（src/common/platform/ipcBridge/web.js）尚未实现。Capacitor WebView 没有 Electron 的 ipcRenderer，需要原生侧提供等价通道（见 docs/android/ipc-contract.md）。 被调用的通道：` + 上表括号里的 `invoke("…")` / `on("…")` | 同一条固定前缀 + 上表 B 的四个通道调用 |
| `unhandledrejection` 原始栈（sourcemap 还原，列 0 近似） | ② → `src/renderer/utils/ipc.ts`（`getViewPrevState()`）← `src/renderer/core/useApp/index.ts`（`.then` 回调） | ② → `src/renderer/utils/ipc.ts`（`setUserApi()`）← `src/renderer/core/apiSource.ts`（`:42` 的 `void setUserApiAction(apiId)`）；③ → `src/renderer/store/list/listManage/rendererListManage.ts`（`rendererOn(list_data_overwire)`）← `src/renderer/store/list/action.ts`（`registerAction()`） |
| `console.error` | **7 条**（5 条 `ipcFallback` 订阅降级痕迹 + `winMain_fullscreen_state` + **另一处调用点**的 `winMain_get_data`） | **7 条**，逐条与 A 相同（**没有变化**：那一处 `console.error` 来自另一个调用点，与本行无关） |
| `console.warn` | **23 条** | **24 条**（+1 = `[renderer/platform/ipcFallback] 平台通道 "winMain_get_data" 取值失败（通道未实现），已使用渲染层默认值继续挂载…` —— **#10 降级的可观测痕迹**，其余 23 条与 A 逐条相同） |
| 侧栏导航文字（`#left a` 的 `innerText`） | `["搜索","歌单","排行榜","我的列表","设置"]` | **同** |
| 播放栏文本（`#player.innerText`） | `"R\nM\n列表循环播放"` | **同** |
| `#app-chrome` / `#left` / `#toolbar` / `#view` / `#player` / `[data-mobile-title-bar]` | 全部**存在**（`true`） | **同** |
| `body.innerText`（前 600 字符） | `Rain\nMusic\n搜索\n歌单\n排行榜\n我的列表\n设置\n歌单\nR\nM\n列表循环播放\n15 分钟\n30 分钟\n60 分钟\n自定义时间\n分钟\n开始计时` | **逐字符相同** |
| 页面元素总数 / 样式表 | 283 / 1 | **283 / 1** |
| `capturePage()` PNG | **597 x 1280**，**397 137 B**，`1e7d65bcba20b938…91440391` | **597 x 1280**，**397 137 B**，**SHA256 与 A 完全相同**（`1e7d65bcba20b938f13449ec8a33f26b77e6ece284dc39dae738215291440391`）⇒ 画面**逐像素相同** |

> **PNG 尺寸的如实说明**：本节两轮都是 **597 x 1280**，与 §4.7 记录的 597 x 1280 **一致**
> （§4.6 的 618 x 1373、§4.5 的 597 x 1319 是本机不同时段的窗口缩放差异）。
> A 的 SHA256 与 §4.7 记录的 B 的 SHA256 **完全相同**，再次印证这三个"产物/画面"在逐字节意义上是同一个东西。
>
> **画面内容**（A、B 相同）：左侧栏 "Rain Music" + 搜索 / 歌单 / 排行榜 / 我的列表 / 设置，
> 顶部标题"歌单"，右侧列表区（**空状态**），底部播放栏（`R M` 占位块 + 播放控制图标）。

> **结论（诚实版）**：#10 的降级接线**按自己的验收标准通过了** ——
> `winMain_get_data` 的未处理 rejection **消失**、降级告警出现（`console.warn` **+1**）、
> `winMain_get_data` 的**另一处**调用点（`console.error` 那条）**不受影响**，
> 而且回调**确实越过了这一行**：B 轮多出两条来自 `initData()` 内部链路的 rejection
> （`winMain_set_user_api` / `player_list_data_overwire`），A 轮里这两条**完全不存在** ——
> 这是"初始化第一次真的跑进了 `initData()`"的直接证据（`router.replace()` 被**故意**跳过，
> 不是被异常打断的）。
>
> **但页面没有变完整**：两轮 PNG **逐字节相同**，`#root` / 侧栏 / 播放栏 / `body.innerText` / 元素总数
> 全部一致。原因是回调**下一步**就断在 **#11**：`initData()` 在它的**同步段**
> （`useDataInit.ts:42 registerAction()` → `rendererListManage.ts:228 rendererOn("player_list_data_overwire")`）
> 同步抛错 ⇒ `initData()` 整个 reject ⇒ `void initData().then(…)`（`useApp/index.ts:157`，
> **没有 `.catch`**）后面那一段（`initPlayer()` / `handleEnvParams()` / `initDeeplink()` /
> `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()`）**一行都没跑**。
> 这与任务书的预期一致（后面还有 #6 / P0-7 的数据形状问题），本轮**没有**为了"看起来有进展"
> 放宽环境或塞假数据（`router.replace()` 那一步就是**主动跳过**的，不是伪造一个默认 query）。

---

## 5. 探针产物（"宽容桥"下渲染出的移动端骨架）

探针里 `#root` 的实测状态：`childElementCount = 5`、`display: block`、
`#app-chrome` 内存在 `data-mobile-title-bar=""`（移动端标题栏分支被走到），
侧栏导航（搜索 / 歌单 / 排行榜 / 我的列表 / 设置）、列表页标题、播放栏、空状态文案全部渲染出来。

**这证明的是**：`dist-web` 的 HTML/CSS/Vue 挂载链路本身在移动端等价环境下是可用的；
挡住它的**不是**渲染层，而是 **Node 专有依赖（#1/#2/#4/#5）+ 缺失的 IPC 桥（#3/#6）**。

---

## 6. 验收门结果

> 本节的表在**阶段 3 / 线 D**（`renderer.191c7a47.js`）跑过一次；下面的数字已在
> **阶段 3 / 线 E-2**（`renderer.0e3fc0c8.js`，1 113 515 B）重跑并更新，两轮结论一致；
> **阶段 3 / 线 G**（`renderer.8c3ba79a.js`，1 114 227 B）又全量重跑一次，门 1~6 结果不变，
> **门 7 由"未达成"变为"达成"**；
> **阶段 3 / 线 H**（`renderer.67626fba.js`，1 114 296 B）再跑一遍，门 1~7 结果**不变**
> （门 3 的基线此时是 **155 / 155** —— 仓库里**另一处并行改动**新增过测试，与本节改动无关），
> 门 7 的实测数据更新与两轮对照见 **§4.7**；
> **阶段 3 / 线 I**（`renderer.d789b60e.js`，1 114 355 B）又全量重跑：门 1~6 结果**不变**
> （门 1 仍 0 errors / 6 warnings，且 6 条 warning 全在 `src/renderer/components/layout/View.vue`，
> **不是本轮改的文件**、也不是本轮引入；门 3 = **155 / 155**；门 5 产物换成 `renderer.d789b60e.js`），
> 门 7 的实测数据更新与 A/B 对照见 **§4.8**。线 I 的 A 基线产物
> `renderer.67626fba.js` 与线 H 的交付产物**逐字节相同**，所以线 H 的实测数字就是线 I 的 A 列。

**最终交付状态的实测行为（阶段 3 / 线 G 更新）**：strict 环境下 `window.onerror` **0 条**、
`unhandledrejection` **3 条**（`common_set_app_setting` ×2 + **`common_get_env_params`**，见 #7 / #9）、
`console.error` **7 条**（5 条是本次新增的降级痕迹 + 2 条既有失败）、
`console.warn` **22 条**，而 **`#root` 为 `childElementCount = 3` / `display: block`**
（侧栏"搜索 / 歌单 / 排行榜 / 我的列表 / 设置"、播放栏、`#app-chrome` 全部渲染）——
**#3 / #7 / #8 均已修，"首次挂载"达成**；剩下的失败集中在 (A) 类数据通道（#6 / **#9**）。
改动前的 `__dirname is not defined` 与 `node_modules/electron` 已**完全消失**
（可复现：改动前 1 111 921 B 的 `renderer.fef2a351.js` 里含该包，改动后不含）。

**（阶段 3 / 线 H 更新）**：#9 的**降级接线**已修（§4.7），所以"当前交付状态"的 strict 实测是
`unhandledrejection` **3 条**（`common_set_app_setting` ×2 + **`winMain_get_data`**，后者是新记录的 **#10**）、
`console.error` **7 条**、`console.warn` **23 条**（+1 就是 #9 的降级痕迹）、
`#root` 仍为 `childElementCount = 3` / `display = block`、PNG 597x1280 且与"未修 #9"的同源基线
**逐字节相同** —— 也就是说 **"挂载成功"没变、页面也没变完整**，卡住它的是 #10（与 #6 同一条数据通道）。

**（阶段 3 / 线 I 更新）**：#10 的**降级接线**已修（§4.8），所以"当前交付状态"的 strict 实测是
`unhandledrejection` **4 条**（`common_set_app_setting` ×2 + **`winMain_set_user_api`** + **`on("player_list_data_overwire")`**，
后两条取代了原来的 `winMain_get_data`，是新记录的 **#11** 及其附带项）、
`console.error` **7 条**（与线 H 逐条相同）、`console.warn` **24 条**（+1 就是 #10 的降级痕迹）、
`#root` 仍为 `childElementCount = 3` / `display = block`、PNG 597x1280 且与"未修 #10"的同源基线
**逐字节相同** —— **"挂载成功"没变、页面也没变完整**，但初始化**第一次真的进了 `initData()`**
（证据就是那两条新 rejection），卡住它的是 **#11**。

| # | 门 | 结果（阶段 3 / 线 E-2 重跑，线 H / 线 I 复核不变） |
| --- | --- | --- |
| 1 | `node node_modules\eslint\bin\eslint.js --ext .ts,.js,.vue src` | **0**（exit 0；线 H 复跑仍 0 errors / 6 warnings，warning 全在 `src/renderer/components/layout/View.vue`，**不是本轮改的文件**；**线 I 复跑同**：0 errors / 6 warnings，同样的 6 条，**不是本轮引入**） |
| 2 | 四个 `tsc`（`src/main`、`src/renderer`、`src/renderer-lyric`、`src/common`） | **全 0**（线 H 复跑同；**线 I 复跑**：额外把 `src/lang` 也跑了一遍，**5 个 tsconfig 全部 exit 0**） |
| 3 | `node --test "tests\unit\*.test.cjs"` | **153 / 153 全绿**（阶段 3 / 线 E-2 时）；**线 H 复跑 = 155 / 155**（仓库里另一处并行改动新增了测试）；**线 I 复跑 = 155 / 155**（`ℹ tests 155 / pass 155 / fail 0`），**exit 0** |
| 4 | `node build-config/pack.js` | **exit 0**（线 H 复跑同；**线 I 复跑同**，见门 6） |
| 5 | `npm run build:web`（`NODE_ENV=production`） | **exit 0**，2 warnings（都是既有的：`url` polyfill 缺 `pathToFileURL` / `URL`）；线 H 复跑同（产物 `renderer.67626fba.js`，1 114 296 B）；**线 I 复跑同**（产物 `renderer.d789b60e.js`，1 114 355 B） |
| 6 | `npm.cmd run test:surfaces` + `npm.cmd run test:window-controls` | `window-controls` **exit 0（6/6 PASS）**；`surfaces` 在线 H 是 88 PASS / 0 FAIL，**线 I 复跑为 exit 1**（FAIL 集合见下面「线 I 的门 6」），**判定与本轮改动无关**（理由三条，见下），按任务书**未修**（那是仓库里另一处并行改动的文件） |
| 7 | strict 环境**实测挂载成功** | ✅ **达成**（阶段 3 / 线 G）：`#root.childElementCount = 3`、`display = block`、`#app-chrome` / `#left` / `#toolbar` / `#view` / `#player` / `[data-mobile-title-bar]` 全部存在，侧栏导航文字 `["搜索","歌单","排行榜","我的列表","设置"]`、播放栏文本 `"R\nM\n列表循环播放"`、`window.onerror` **0 条**、PNG 618x1373（433 005 B，可辨认的应用界面）。细节与逐条数据见 §4.6。**线 H 复验（§4.7）**：同样的判据全部成立（PNG 597x1280，本机缩放差异见 §4.7 的说明），但页面**没有变完整** —— 卡住它的是 #10。**线 I 复验（§4.8）**：判据仍全部成立，PNG **597x1280 / 397 137 B** 且与同源基线 A **SHA256 完全相同** —— 初始化确实往前推进了（进了 `initData()`），但页面**仍然逐像素相同**，现在卡住它的是 **#11** |

**（阶段 3 / 线 I 的门 6：`test:surfaces` exit 1 —— 如实记录 + 相关性判定）**

`node build-config/pack.js` **exit 0**；`npm.cmd run test:window-controls` **exit 0（6/6 PASS）**；
但 `npm.cmd run test:surfaces` **exit 1**。同一份 `dist/` 连跑两次的 FAIL 集合是：

| 次 | FAIL 集合 |
| --- | --- |
| 第 1 次 | `mono /search provides subtle physical press feedback`、`mono /songList/list provides subtle physical press feedback`、`mono_dark /songList/list provides subtle physical press feedback`（**3 条**） |
| 第 2 次 | 上面 3 条 **+** `mono playlist cards fit within the page`、`mono pagination is visible and fits the page`、`mono /leaderboard provides subtle physical press feedback`、`mono_dark /leaderboard provides subtle physical press feedback`、`mono /leaderboard restores button geometry after release`（**8 条**） |

**判定：与本轮改动无关。** 三条理由：

1. **桌面路径可证明逐句相同**：`ipcFallback` 的默认实现就是 `invoke(channel)` 逐字透传，而
   `getViewPrevState()` 自带 `?? { ...DEFAULT_SETTING.viewPrevState }`（`utils/ipc.ts:225`）⇒ 桌面端
   `state` **不可能是 null/undefined** ⇒ 本轮新增的 `if (state != null)` 在桌面端**恒为真**，
   括号里的两条语句、执行顺序与时序与改动前完全一致（本轮改动里**没有** CSS / DOM / 布局）。
2. **失败的断言只读 CSS**：`tests/ui/refined-surfaces.electron.cjs:65` 断的是
   `Number(getComputedStyle(qaControl).scale) < .99`，也就是 `controls.less:15-16` 的 `:active { scale: .97 }`，
   与本轮改的 IPC 取值点无关。本机实测那两个会把 `scale` 压成 `none` 的覆写**都不生效**：
   `@media (prefers-reduced-motion: reduce)`（`controls.less:31-33`）在本机是 **`reduced: false` /
   `no-preference: true`**（Electron 42.11.6 / Chrome 148.0.7778.280 里实测），另一条
   `#container.reduce-control-motion`（`:27-28`）依赖一个**构建产物里根本不存在**的 class
   （`dist/renderer.js` 里 `reduce-control-motion` 出现 **0** 次，只在 CSS 里出现 3 次）。
   剩下的可能都落在**别人正在改的文件**里：测试挑元素的表达式
   `#view button:not(:disabled), #view [role=tab], #view [data-ui-control]:not([disabled])`
   **没有排除** `[aria-disabled='true']`（而 `controls.less:22` 对它是 `scale: none`），也没有考虑 DOM 顺序变化 ——
   `src/renderer/components/base/Btn.vue`、`src/renderer/assets/styles/index.less` 与多个 view 组件
   正是仓库里**另一处并行改动**（30+ 项未提交）正在动的东西。
3. **同一份产物、连跑两次结果不同**（3 条 → 8 条，第 2 次是第 1 次的超集），期间**源码一个字节都没变**
   ⇒ 至少那 5 条**不是当前源码的确定性后果**；§6 早就记录过这个套件在本仓库的抖动
   （"首轮 2 条 FAIL → 复跑 88 PASS / 0 FAIL"）。

按任务书**没有**去修这些断言（那属于别人的改动范围），也**没有**用 `git stash`。

补充实测（阶段 3 / 线 D 时按当时要求额外跑，用来确认桌面没被改坏）：

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
  `probe/`（宽容桥探针配置与替身）、`launch.cjs`、`run*/probe*/baseline/` 输出目录；
  阶段 3 / 线 E-2 的那一套在 `%TEMP%\rain-webprobe\e2\`（`app/harness.cjs` + `app/server.cjs` +
  `app/package.json` + `launch.cjs` + `run/`），**跑完已删除**（`app/`、`mini/`、`run/` 是
  线 D 遗留的探针，本线未复用、未改动）。
- **仓库内没有留下任何临时加载脚本或服务器**：`git status` 只有 3 个改动文件 + 2 个新增目录
  （都是正式代码）。（线 E-2 新增的改动：`src/renderer/event/index.ts`、
  `build-config/renderer/webpack.config.web.js`、`src/renderer/platform/ipcFallback/*`、
  `.eslintrc.base.cjs`、本文件。）
- 静态服务器用的是 `127.0.0.1` 高位端口（5199 / 5299），只监听本机；Electron 进程只按
  自己 spawn 出来的 PID 清理（`taskkill /PID <pid> /T /F`），**从未按进程名杀进程**。
- 阶段 3 / 线 F 的临时件在 `%TEMP%\rain-strict\`（`app/main.cjs`、`app/package.json`、`launch.ps1`、
  `dump.cjs`、`out/`，Electron 的 `userData` 也重定向到 `out/userdata`），**跑完已删除**；
  仓库内没有任何临时加载脚本或服务器。清理同样只按自己记录的 PID（`taskkill /PID <pid> /T /F`），
  没有按映像名杀过任何进程。
- 阶段 3 / 线 G 的临时件在 `%TEMP%\rain-mount\`（`app/main.cjs` + `app/inject.js` +
  `app/package.json` + `run.cmd` + `out/`，`userData` 同样重定向到 `out/userdata`），
  **跑完已删除**；仓库内没有任何临时加载脚本或服务器。启动脚本把 `ELECTRON_RUN_AS_NODE`
  清掉后再以**应用目录**（含 `package.json`）启动 `node_modules/electron/dist/electron.exe`，
  并用 `cmd /c run.cmd` 等待（PowerShell 的 `&` 不等 GUI 子系统进程；本机环境块里同时存在
  `no_proxy` / `NO_PROXY` 会让 `Start-Process` 直接报"已添加项"，所以两者都不用）。
  清理只按 `out/electron.pid`（由加载脚本自己写入的**主进程 PID**）→ `taskkill /PID <pid> /T /F`。
- 阶段 3 / 线 H 的临时件在 `%TEMP%\rain-env9\`（`app/main.cjs`（加载器 + 本进程内的静态服务器 +
  `<head>` 内联注入 + `executeJavaScript` 报告 + `capturePage`）、`app/inject.js`（错误钩子 +
  最小 Capacitor mock + `window.__rainReport()`）、`app/package.json`、`run.cmd`、
  `out-baseline/`、`out-fixed/`（两轮的 `report.json` / `shot.png` / `versions.json` / `electron.pid`）、
  外加两个产物快照 `baseline-dist/`、`fixed-dist/` 和"修复后源文件"的逐字节备份 `useApp-index.fixed.ts`），
  **跑完已删除**；仓库内没有任何临时加载脚本或服务器。启动同样走 `cmd /c run.cmd`（清 `ELECTRON_RUN_AS_NODE`
  → 以**应用目录**启动 `node_modules/electron/dist/electron.exe`），清理只按 `out-*/electron.pid`
  （加载脚本自己写入的主进程 PID）→ `taskkill /PID <pid> /T /F`，**没有按映像名杀过任何进程**。
  为做同源对照临时改过一次 `useApp/index.ts`（改回裸 `getEnvParams()` 构建基线产物），
  **构完立即逐字节还原**，用 `git diff` 为空验证。
- 阶段 3 / 线 I 的临时件在 `%TEMP%\rain-prevstate\`（`app/main.cjs`（加载器 + **本进程内**的静态服务器 +
  `<head>` 内联注入 + `executeJavaScript` 报告 + `capturePage`）、`app/inject.js`（错误钩子 + 栈采集 +
  最小 Capacitor mock + `window.__rainReport()`）、`app/package.json`、`summarize.cjs`、`mapsrc.cjs`、
  `out/`、`out2/`（两轮的 `A|B.json` / `A|B.png`）、两个产物快照 `baseline-dist/`、`fixed-dist/`、
  以及"修复后源文件"的逐字节备份 `useApp-index.fixed.ts` + `gate1.log` / `gate2.log`），
  **跑完已删除**；仓库内没有任何临时加载脚本或服务器。
  与线 H 的唯一形式差异：静态服务器**不再 fork 子进程**，直接用 Electron 主进程的 `http` 建
  （省掉给子进程设 `ELECTRON_RUN_AS_NODE` 这一步）；页面来源仍是 `http://127.0.0.1:<port>/`，
  webPreferences 与"不加任何放宽开关"逐条一致。
  为做同源对照临时改过一次 `useApp/index.ts`（`:148` 改回裸 `await getViewPrevState()` 构建基线产物），
  **构完立即逐字节还原**：改动前后 SHA256 均为 `59B9267C21EBBEBA4311BC5EB471F49B360B7966A7A5CA264ECAAFEA2E06111D`；
  还原用的是**测前留的逐字节备份**（`useApp-index.fixed.ts`），不是重新手写。
  Electron 以**应用目录**（含 `package.json`）启动、进程按 `Start-Process -PassThru` 拿到的 PID
  等待/退出，**没有按映像名杀过任何进程**。
  另有一个**只回答一个问题**的小探针在 `%TEMP%\rain-prevstate\rm\`（`main.cjs` + `package.json`）：
  在 Electron 42 里读 `matchMedia('(prefers-reduced-motion: reduce)').matches`，用来判定
  `controls.less` 的 reduced-motion 覆写是否可能生效（结果 `reduced: false` / `no-preference: true`，
  见门 6 的理由 2），**跑完同样已删除**。

---

## 8. Android 首版必须重写的最小集合（按优先级）

供阶段 3-5 直接照此排期。**P0 不做完，页面永远挂不上（全白）；P1 不做完，页面能出但功能是空的。**

> **阶段 3 / 线 E-2 的更新**：#3 的"注册期同步抛错"已经在**渲染层**解决（逐条容错，见 §4.4），
> 所以 P0-2 里"热键/窗口聚焦类通道必须存在，否则 `registerEvents()` 同步抛错"这一条
> **不再是挂载的前提**；真正卡住挂载的现在是 **P0-4**。
>
> **阶段 3 / 线 G 的更新（P0 已完成）**：#7（P0-4）与 #8（P0-5）都已修，
> `App.vue setup()` 同步调用图上的 **9 处**平台通道全部逐条降级（§4.6），
> strict 环境**首次挂载成功**（`#root.childElementCount = 3`）。下面 P0 表里
> **P0-1 / P0-2 / P0-3 仍然是"真机能用"的前提**（它们决定"数据是不是空的"），
> 但**不再是"页面能不能出来"的前提** —— 页面已经出得来了。
>
> **阶段 3 / 线 H 的更新**：**P0-6（#9）已修**（§4.7）—— `getEnvParams()` 的降级接线生效，
> `.then` 回调开始执行；但它在**下一行**就被 **P0-7**（`getViewPrevState()` → `winMain_get_data`）
> 挡住，所以"列表数据 / 播放器 / 深链 / `sendInited`"这一段**仍然没有跑**、页面仍与上一轮逐像素相同。
> **下一个要做的（也是唯一能推动画面的）是 P0-7**（新记录为 **#10**）；本轮按任务书"下一条 (A) 类不要修"未动它。
>
> **阶段 3 / 线 I 的更新**：**P0-7（#10）已修**（§4.8）—— 回调**第一次真的走进了 `initData()`**
> （证据：新出现两条来自 `initData()` 链路的未处理 rejection）。但它紧接着被 **#11** 挡住：
> `initData()` 的**同步段**（`registerAction()` → `rendererOn("player_list_data_overwire")`）同步抛错，
> 而调用点 `useApp/index.ts:157` 只有 `.then` 没有 `.catch` ⇒ `initPlayer()` / `handleEnvParams()` /
> `initDeeplink()` / `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()` **一行都没跑**，
> 页面与 A 轮**逐像素相同**。**下一个能推动画面的（也是唯一一条）是 #11**；
> 本轮按任务书"下一条 (A) 类不要修"未动它。

### P0 · 让 `app.mount('#root')` 能执行到（阶段 3 / 线 G：本条已达成）

| 序 | 项 | 对应阻塞点 | 落点 | 难度 |
| --- | --- | --- | --- | --- |
| P0-1 | **IPC 传输桥的原生实现**：`send / invoke / on / off` 四条语义在 Capacitor 侧落地（原生 ↔ WebView 双向消息 + 请求应答配对 + 取消） | #3（注册期已由渲染层容错绕开）· #7 | 替换 `src/common/platform/ipcBridge/web.js` 的占位实现；契约见 `docs/android/ipc-contract.md` | 大 |
| P0-2 | **启动期必需通道**：`common_get_app_setting`、`common_set_app_setting`、`winMain_get_hot_key`、`winMain_set_hot_key_config`、`winMain_key_down`、`winMain_focus`、`winMain_on_config_change`、`winMain_get_data`、`common_get_env_params`。其中热键与窗口聚焦类在 Android 首版**允许降级为空实现** | #3 · #6 · #7 | 原生侧 handler，逐条对照 `docs/android/ipc-contract.md` 的"B 可直接移除"标记 | 大 |
| P0-3 | **存储落点**：设置的同步读 / 异步写（Android 只有异步 API，需要"预热内存快照 + 异步回写"） | #7 · #6 | `src/main/platform/storage/adapter.android.ts` 的骨架已有，需接线 `@capacitor/preferences` | 大 |
| P0-4 | **`getSetting()` 的降级接线**：`src/renderer/main.ts:82` 已改为 `invokeWithFallback(...)`，**已修**（阶段 3 / 线 F，见 §4.5）：`common_get_app_setting` 取不到时用 `@common/defaultSetting` 继续挂载，`.then` 回调确实执行到 `app.mount('#root')` | #7（已修） | 已完成 | 小 |
| **P0-5** | **Vue 挂载/渲染不产出**：根因确证为 `App.vue setup()` 同步调用图上的 9 处平台通道同步抛错（详见 §4.6 的清单），已**逐条降级** | #8（已修） | 已完成：新增 `src/renderer/platform/ipcFallback/subscribe.ts`，9 处调用点接上它 | 已完成 |
| **P0-6** | **`getEnvParams()` 的降级接线**：`useApp/index.ts:102` 的 `void getEnvParams().then(...)` 没有 `.catch` ⇒ `.then` 回调整段（列表数据 / 播放器 / 深链 / `sendInited`）不执行，页面"出来了但是空的"。**这是 #8 修好之后新暴露出来的第一个点** | #9 | **已修（阶段 3 / 线 H，见 §4.7）**：已改成 `invokeWithFallback` + "没有启动参数"的 `envParams` 兜底（与 `main.ts:82` 的 #7 修法逐字同构）。实测回调**确实开始执行**，但在下一行被 **#10** 挡住 | 小 |
| **P0-7** | **`invoke("winMain_get_data")` 的接线**（`useDataInit` 链 / `getViewPrevState()`） | #6 · **#10**（线 H 新增：它就是这条通道在 `.then` 回调里的第一次出现） | 同 P0-6，需要按数据形状逐个决定"空值怎么继续"；**已修（阶段 3 / 线 I，见 §4.8）**：取值点改走 `invokeWithFallback`，兜底值 `null` ⇒ **跳过 `router.replace()`**（不编默认 query）、回调继续。实测回调**确实进了 `initData()`**，但在那里被 **#11** 挡住 | 小（接线）+ 大（通道） |
| **P0-8** | **`initData()` 的"失败也要继续"形状**：它的**同步段**里 `registerAction()` 用裸 `rendererOn("player_list_data_overwire")`（`rendererListManage.ts:228`，共 12 条 `rendererOn`）同步抛错 ⇒ `initData()` 整个 reject，而调用点**只有 `.then` 没有 `.catch`** ⇒ `initPlayer()` / `handleEnvParams()` / `initDeeplink()` / `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()` 全部不执行 | **#11**（本轮新增） | 同 #8：这一组订阅改走 `subscribeSkippable`；另外给 `useApp/index.ts:157` 补一个明确的失败分支。**这是页面从"半空壳"再往前推的下一道门** | 小（接线）+ 大（通道） |

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
   > ⚠️ **补充判据（阶段 3 / 线 E-2 实测得出）**：`childElementCount === 0` **不足以**判断
   > "卡在同步抛错"。修完 #3 之后 `window.onerror` 可以是 **0 条**，但页面依然全白 ——
   > 因为挡住挂载的是**未处理的 promise rejection**（#7）。所以这三样必须一起看：
   > `window.onerror`、`unhandledrejection`、`#root`。
   >
   > ⚠️ **补充判据 2（阶段 3 / 线 G 实测得出）**：
   > 1. **不要**用 `#root.__vue_app__._instance`（或 `subTree`）判断"有没有渲染" ——
   >    production 构建下它**恒为 `null`**，修好之后也一样（见 §4.6 的更正）。
   >    只看 DOM：`childElementCount`、`#app-chrome`、`#left` 的 `innerText`。
   > 2. `console.error` / `console.warn` 里带 `[renderer/platform/ipcFallback]` 且写着
   >    "已跳过…（reason=unsupported|failed）"的行，是**正常的降级痕迹**（"不假装成功"的
   >    可观测证据），不是故障；要看的是 `unhandledrejection` 与 `window.onerror`。
   > 3. `app.mount('#root')` 之后 `#root` 的 `display` 由 `App.vue` 的 `onMounted` 从
   >    `none` 改成 `block` —— 所以 `display: none` 是"`onMounted` 没跑到"的证据，
   >    它比 `data-v-app=""` 更能说明问题（后者只要 `app.mount()` 被调用就会写上）。
   >
   > ⚠️ **补充判据 3（阶段 3 / 线 H 实测得出）—— 怎么判断"某条通道的降级接线有没有把初始化往前推"**：
   > **不能**只看"未处理 rejection 的条数变没变"（两次都可能是 3 条，只是**换了通道**）。
   > 做法是**同源对照**：把那一行临时改回改动前的写法、重新构建一份基线产物（改完立即逐字还原，
   > 用 `git diff` 为空验证），再用**同一份加载脚本、同一等待时间**各跑一遍，逐项对比
   > ①`unhandledrejection` 的**通道名**、②`console.warn/error` 逐条、③`#root` 的
   > `childElementCount` / `display` / `outerHTML` 与 `#left` / `#player` 的 `innerText`、
   > ④`capturePage()` 的 PNG（两轮若**逐字节相同**，就是"这一轮没有把画面往前推"的直接证据）。
   > 本轮的结果：降级痕迹出现 + 回调开始执行，但 PNG 逐字节相同 ⇒ 如实记为"没有明显改善"（§4.7）。
   >
   > ⚠️ **补充判据 4（阶段 3 / 线 I 实测得出）—— "未处理 rejection 的条数变多"不等于变坏**：
   > 线 I 里 B 轮比 A 轮**多了一条** rejection（3 → 4），但那是**初始化往前走**的证据：
   > `winMain_get_data` 那条消失、`initData()` 内部链路的两条冒出来。
   > 判读顺序应该是：① **消失的通道**是不是你刚接的那条；② **降级告警有没有 +1**（"不假装成功"的痕迹）；
   > ③ **新出现的通道**来自哪一行（用 `unhandledrejection` 的 `reason.stack` + `.map` 还原源码位置，
   > 比只看消息文本可靠）；④ PNG 有没有变。线 I 的结果：①②③ 都成立、④ 没有 ⇒
   > 如实记为"接线生效、初始化推进了一行（进了 `initData()`），但页面**没有**更完整"（§4.8）。

---

## 附：改动文件

### 阶段 3 / 线 D（原表）

| 文件 | 状态 |
| --- | --- |
| `build-config/renderer/webpack.config.web.js` | 修改（新增"关键差异 4.7 / 4.8"两条构建期替换 + 注释说明 webpack 的 `beforeResolve` 陷阱） |
| `src/common/rendererIpc.ts` | 修改（改为经 `@common/platform/ipcBridge`，不再直连 `electron`） |
| `src/renderer/utils/ipc.ts` | 修改（`ipcRenderer` 改为经 `@renderer/platform/ipcRenderer`；只影响 `onFullscreenChanged()`） |
| `src/common/platform/ipcBridge/{index,desktop,web}.js` | 新增 |
| `src/renderer/platform/ipcRenderer/{index,web}.js` | 新增 |

### 阶段 3 / 线 E-2（本轮）

| 文件 | 状态 |
| --- | --- |
| `src/renderer/event/index.ts` | 修改（4 条热键/窗口通道改走 `ipcFallback`：`invokeSkippable` + `subscribe`；`registerEvents` 变 `async`，末尾 `void registerEvents()`） |
| `build-config/renderer/webpack.config.web.js` | 修改（新增"关键差异 4.10"：`@renderer/platform/ipcFallback` → `/web`，仅 web 构建） |
| `src/renderer/platform/ipcFallback/desktop.js` | 修改（**恢复三参签名** `(invoke, channel, fallback)`，`fallback` 桌面端不读 + `no-unused-vars` 局部豁免） |
| `src/renderer/platform/ipcFallback/web.js` | 修改（同步抛错/异步 reject 归一化：`Promise.resolve().then(() => invoke(channel)).catch(...)`；过期注释更正） |
| `src/renderer/platform/ipcFallback/index.js` | 修改（说明 `InvokeFallbackInfo` 无法从 `.js` 转发 —— `export type` 在 `.js` 里是 `TS8008`） |
| `.eslintrc.base.cjs` | 修改（`no-confusing-void-expression` 打开 `ignoreVoidOperator`：官方认可的"故意丢弃 Promise"写法，见文件内注释） |
| `docs/android/web-runtime-blockers.md` | 修改（#3 标为已修并补 §4.4 实测；新增 #7；更新 §6 / §7 / §8 / §10） |
| `src/common/platform/electron/web.js`、`src/renderer/platform/http/*` | **未改**（线 E 上半段产物，本轮只引用） |

### 阶段 3 / 线 F（#7 验收 + #8 记录）

| 文件 | 状态 |
| --- | --- |
| `docs/android/web-runtime-blockers.md` | 修改（#7 标为已修并补 §4.5 实测；新增 #8；更新 §6 门 7 / §8 的 P0-4 与新增 P0-5 / 本表） |
| **`src/**`** | **未改**（线 F 只做验收与记录，任务书明确"不要改任何 src 文件"、"下一条 (A) 类不要修"） |
| 临时加载器（`%TEMP%\rain-strict\`：`app/main.cjs` + `app/package.json` + `launch.ps1` + `dump.cjs` + `out/`） | 仓库外，**跑完已删除**（见 §7） |

### 阶段 3 / 线 G（#8 修复 + 首次挂载验收）

| 文件 | 状态 |
| --- | --- |
| `src/renderer/platform/ipcFallback/subscribe.ts` | **新增**（把 `event/index.ts` 与 `useEventListener.ts` 里两份重复的"可跳过取值 / 订阅"收敛成唯一实现：`invokeSkippable` / `subscribeSkippable` / `reportChannelSkipped`；本文件**不做**构建期替换，只依赖已被替换的 `invokeWithFallback`） |
| `src/renderer/event/index.ts` | 修改（删除本地的 `FallbackInfo` / `reportChannelSkipped` / `invokeSkippable` / `resolveAfterRegister` / `subscribe`，改用共享实现；**调用序列、时机、参数逐字未变**；#3 的论证保留并补一句指向共享模块） |
| `src/renderer/core/useApp/useEventListener.ts` | 修改（4 条订阅改走 `subscribeSkippable`；本地的 `subscribe` 删除） |
| `src/renderer/core/lyric.ts` | 修改（`init()` 里的 `onNewDesktopLyricProcess` 改走 `subscribeSkippable`，通道 `winMain_process_new_desktop_lyric_client`，B 类） |
| `src/renderer/core/useApp/usePlayer/usePlayStatus.ts` | 修改（`onPlayerAction`，通道 `winMain_player_action_on_button_click`，B 类） |
| `src/renderer/core/useApp/useInitUserApi.ts` | 修改（`onUserApiStatus` + `onShowUserApiUpdateAlert`，A 类） |
| `src/renderer/core/useApp/useDeeplink/index.ts` | 修改（`onDeeplink`，通道 `common_deeplink`，C 类） |
| `docs/android/web-runtime-blockers.md` | 修改（#8 标为已修并补 §4.6 实测与"9 处清单"；新增 #9；更新 §6 门 7 / §7 / §8 / §10 / 本表） |
| `build-config/renderer/webpack.config.web.js` | **未改**（4.10 的正则以 `$` 结尾，只替换裸说明符 `@renderer/platform/ipcFallback`，新增的 `…/subscribe` 不受影响 —— 已在产物里实测） |
| 临时加载器（`%TEMP%\rain-mount\`：`app/main.cjs` + `app/inject.js` + `app/package.json` + `run.cmd` + `out/`） | 仓库外，**跑完已删除**（见 §7） |

### 阶段 3 / 线 H（#9 修复 + 同源对照实测）

| 文件 | 状态 |
| --- | --- |
| `src/renderer/core/useApp/index.ts` | 修改（**唯一改的 src 文件**）：`:52` 的裸 `void getEnvParams().then(...)` 改为 `invokeWithFallback(async() => getEnvParams(), CMMON_EVENT_NAME.get_env_params, () => ({ cmdParams: {}, deeplink: null, wallpaper: null }))`（阻塞点 #9），并新增两个 import；文件内写清"兜底值是「没有启动参数」"、三个消费点各自的降级行为、桌面语义逐条未变、以及"本回调里还有 `getViewPrevState()`"的指向 |
| `docs/android/web-runtime-blockers.md` | 修改（#9 标为已修并补 §4.7 两轮对照实测；新增 **#10**；更新 §6 门 1~7 / §7 清理 / §8 的更新块与 P0-6·P0-7 / §10 补充判据 3 / 本表） |
| `src/**`（**其余全部**） | **未改**（工作区里另外 30 项未提交改动属于另一个会话，本轮一个字节都没碰；见 §7 的同源对照说明） |
| 临时加载器（`%TEMP%\rain-env9\`：`app/main.cjs` + `app/inject.js` + `app/package.json` + `run.cmd` + `out-baseline/` + `out-fixed/` + `baseline-dist/` + `fixed-dist/` + `useApp-index.fixed.ts`） | 仓库外，**跑完已删除**（见 §7） |

### 阶段 3 / 线 I（#10 修复 + 同源对照实测）

| 文件 | 状态 |
| --- | --- |
| `src/renderer/core/useApp/index.ts` | 修改（**唯一改的 src 文件**）：`:109` 的裸 `const state = await getViewPrevState()` 改为 `invokeWithFallback(async() => getViewPrevState(), WIN_MAIN_RENDERER_EVENT_NAME.get_data, () => null)` + `if (state != null) { … }`（阻塞点 #10），并把 `WIN_MAIN_RENDERER_EVENT_NAME` 加进**已有的** `@common/ipcNames` import；文件内写清"兜底值为什么是 `null` 而不是 `DEFAULT_SETTING.viewPrevState`"、"`state == null` 时跳过整个 `router.replace()`"、桌面语义逐条未变、以及"`initData()` 自己没有降级点、不替它塞假数据" |
| `docs/android/web-runtime-blockers.md` | 修改（#10 标为已修并补 §4.8 两轮 A/B 对照实测；新增 **#11**（含"不阻断的 `winMain_set_user_api`"注）；更新 §6 门 1~7 / §7 清理 / §8 的线 I 更新块与 P0-7·新增 P0-8 / §10 补充判据 4 / 本表） |
| `src/**`（**其余全部**） | **未改**（工作区里另外 30+ 项未提交改动属于另一个会话，本轮一个字节都没碰；`git status --porcelain` 里本轮的改动只有上面两个文件，见 §7） |
| 临时加载器（`%TEMP%\rain-prevstate\`：`app/main.cjs` + `app/inject.js` + `app/package.json` + `summarize.cjs` + `mapsrc.cjs` + `out/` + `out2/` + `baseline-dist/` + `fixed-dist/` + `useApp-index.fixed.ts` + `gate1.log` + `gate2.log`） | 仓库外，**跑完已删除**（见 §7） |
