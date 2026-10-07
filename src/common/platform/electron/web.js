/**
 * Electron 平台原语（`shell` / `clipboard`）的**构建期**平台入口
 * （Android 移植 · 阶段 3 / 线 E）。
 *
 * ## 这一层为什么存在
 *
 * `src/common/utils/electron.ts` 顶层就 `import { shell, clipboard } from 'electron'`。
 * 在 `target: 'web'` 的构建里 `electron` 既不是 externals 也不在 `resolve.fallback`，
 * 于是 **npm 包 `node_modules/electron` 被整个打进 `dist-web/renderer.js`**，
 * 而该包顶层第 6 行是 `path.join(__dirname, 'path.txt')` —— web 目标里
 * `node.__dirname = false` ⇒ **模块加载期直接 `ReferenceError: __dirname is not defined`**。
 *
 * 阶段 3 / 线 D 修掉的是另外两个进入点（`@common/rendererIpc` 与
 * `@renderer/platform/ipcRenderer`，见 `docs/android/web-runtime-blockers.md` 阻塞点 #1/#2）。
 * 这一个（文档里的 #4）当时因为"renderer 侧有 16 个 import 点"被记为"改动面过大、本轮不动"。
 * 本轮实测：**阻塞点 #3 修完之后，它就是下一个"挂载期同步抛错"**，栈顶经
 * `src/renderer/core/useApp/useEventListener.ts:26` 的 `import { openUrl } from '@common/utils/electron'`
 * 在 App setup 阶段抛出。所以必须处理它，页面才可能挂上。
 *
 * ## 为什么是"构建期替换"，而不是改 16 个 import 点
 *
 * 桌面实现**就是** `src/common/utils/electron.ts` 本身，本轮**一个字都没改**：
 * 它有 22 个 import 点（renderer 侧 12 个活 import + main 进程 5 个 + 若干注释掉的），
 * 改它风险大、收益低。这里只做**构建期替换**：
 *
 * - 桌面构建（`webpack.config.dev.js` / `webpack.config.prod.js`）：不认识本目录，
 *   `@common/utils/electron` 照旧解析到 `electron.ts`，行为零变化。
 * - web 构建（`webpack.config.web.js` 的"关键差异 4.9"）：把请求
 *   `@common/utils/electron`（以及任何相对形式 `…/common/utils/electron`）改写成本文件。
 *
 * 于是 **renderer 侧 12 个活 import 一个都不用动**，`node_modules/electron` 也彻底离开
 * Android 产物。本目录因此**只有 `web.js` 一个文件**，没有 `index.js` —— 与
 * `ipcBridge/`（`index.js` + `desktop.js` + `web.js`）**有意不同构**：桌面侧不需要替身，
 * 少一层间接，就少一处可能漂移的地方。
 *
 * ## 逐函数对照（web 侧）
 *
 * | 导出 | 桌面（`electron.ts`） | web / Android | 归类 |
 * | --- | --- | --- | --- |
 * | `encodePath` | 纯字符串（只处理 `%` / `#`） | **同一份实现**（本来就没有平台差异） | — |
 * | `openDirInExplorer` | `shell.showItemInFolder` | **no-op + `console.warn`**（Android 没有"在文件夹中显示"这个语义） | (B) 降级 |
 * | `openUrl` | `shell.openExternal`（只放行 `http(s)`） | `window.open(url)`（`http(s)` 白名单与桌面逐字相同；被拦截时警告） | (C) 降级 |
 * | `clipboardWriteText` | `clipboard.writeText`（同步） | `navigator.clipboard.writeText`（**异步**，签名仍返回 void，失败只 `console.warn`） | (B) 降级 |
 * | `clipboardReadText` | `clipboard.readText`（同步） | **返回 `''`**：Web 只有异步读 API，而这里的签名是**同步**的 | ⚠️ 见下 |
 *
 * ## ⚠️ `clipboardReadText` 是**已知不可移植**的
 *
 * `navigator.clipboard.readText()` 只有 Promise 版本，而 3 个调用点
 * （`components/base/Input.vue`、`components/material/SearchInput.vue`、
 * `views/List/MusicList/components/SearchList.vue`）都按同步取值在用。
 * 本轮**不改调用点**（那要动 3 个组件的交互设计），所以 web 侧退化成"读到空字符串"，
 * 并在每次调用时 `console.warn` 一次，避免"静默无效"。这一条已记入
 * `docs/android/web-runtime-blockers.md`，属阶段 4 的调用点重写工作。
 *
 * ## 未验证
 *
 * `navigator.clipboard` 需要**安全上下文**。真机 Capacitor 页面是 `https://localhost`
 * （安全上下文，可用）；本机 strict 模拟环境是 `http://127.0.0.1` —— Chromium 把
 * `127.0.0.1` 视为潜在可信来源，但**真机 WebView（Android System WebView）是否一致未验证**。
 * `navigator.clipboard` 不存在时本文件走 `console.warn` 分支，不会抛错。
 */

/** 与 `src/common/utils/electron.ts` 的 `encodePath` 逐字相同（纯字符串，无平台差异）。 */
export const encodePath = (path) => {
  return path.replaceAll('%', '%25').replaceAll('#', '%23')
}

/**
 * 在系统文件管理器中定位文件 —— Android 无等价物（`docs/android/ipc-contract.md` §4.3
 * 把 `shell.showItemInFolder` 记为"无'定位文件夹'，降级为用系统应用打开文件或分享"）。
 * 首版做成显式 no-op + 警告，不假装成功。
 * @param {string} dir
 */
export const openDirInExplorer = (dir) => {
  console.warn(`[platform/electron/web] openDirInExplorer("${dir}") 在 Android 上没有等价能力，已忽略。`)
}

/**
 * 用系统浏览器打开 URL —— web 侧退化为 `window.open`（`http(s)` 白名单与桌面一致）。
 * @param {string} url
 */
export const openUrl = async(url) => {
  if (!/^https?:\/\//.test(url)) return
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    console.warn(`[platform/electron/web] openUrl("${url}")：当前环境没有 window.open，已忽略。`)
    return
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    console.warn(`[platform/electron/web] openUrl("${url}")：window.open 被拦截（真机需改走 Capacitor 的 App.openUrl / 浏览器插件）。`)
  }
}

/**
 * 复制文本到剪贴板。
 *
 * 桌面是同步 `clipboard.writeText`；Web 只有异步 `navigator.clipboard.writeText`，
 * 签名保持不变（返回 `void`），失败只警告 —— 调用点（播放栏/歌词页的"复制"按钮）
 * 不需要知道它是异步的。
 * @param {string} str
 */
export const clipboardWriteText = (str) => {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    console.warn('[platform/electron/web] navigator.clipboard.writeText 不可用（需要安全上下文），复制未生效。')
    return
  }
  clipboard.writeText(str).catch(err => {
    console.warn('[platform/electron/web] navigator.clipboard.writeText 失败：', err)
  })
}

/**
 * 从剪贴板读取文本。
 *
 * ⚠️ **web 侧只能返回空串**：浏览器只有 `navigator.clipboard.readText()`（Promise），
 * 而这里的签名是同步的。要真正实现必须改 3 个调用点的设计，见文件头说明。
 * @returns {string}
 */
export const clipboardReadText = () => {
  console.warn('[platform/electron/web] clipboardReadText 在 Web 上只有异步 API（navigator.clipboard.readText），当前返回空串；调用点需改为异步。')
  return ''
}
