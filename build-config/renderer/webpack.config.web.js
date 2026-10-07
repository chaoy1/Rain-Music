/**
 * 面向 Web / Capacitor 的渲染层构建（Android 移植阶段 1）。
 *
 * 为什么需要单独一套配置：
 *   `build-config/renderer/webpack.config.base.js:12` 是 `target: 'electron-renderer'`，
 *   主窗口又是 `nodeIntegration: true / contextIsolation: false / webSecurity: false`
 *   且没有 preload —— 渲染层 bundle 现在能直接吃 Node 内置模块（`node:fs` /
 *   `node:crypto` / `node:zlib` / `node:path` / `node:os`、两个 worker）。
 *   Capacitor 的 WebView 完全没有这些能力，所以必须有一条 target 为 `web`、
 *   并补齐 Node 全局（`Buffer` / `process`）与内置模块 polyfill 的构建。
 *
 * 本文件**不修改**任何 Electron 目标的配置或行为：
 *   - Electron 走 `webpack.config.dev.js` / `webpack.config.prod.js`（输出 `dist/`）；
 *   - 本文件输出 `dist-web/`，只有 `npm run build:web` 与 Capacitor 使用。
 *   两者共用 `webpack.config.base.js` 的别名 / loader / HTML 模板，但互不影响。
 *
 * 阶段 1 的目标只是"能让渲染层拿到一份 web target 的 bundle"，**不是**让它跑通：
 *   下面 `resolve.fallback` 里被标为 `false` 的都是浏览器里不可能实现的 Node 模块
 *   （webpack 会给一个空模块，构建通过、运行必炸）。这些就是后续阶段必须拆掉的
 *   残留，清点见 `docs/android-port-plan.md` 的阶段 1 记录与
 *   `docs/android/native-bridge-needs.md` §2.3 / §4.2。
 */
const path = require('path')
const webpack = require('webpack')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin')

const baseConfig = require('./webpack.config.base')

const isProd = process.env.NODE_ENV === 'production'
const outDir = path.join(__dirname, '../../dist-web')

/**
 * Node 内置模块在 web 目标下的归宿。
 *
 * - 有真实浏览器等价实现的 → 指向已显式加入 `package.json` 的 polyfill 包；
 * - 浏览器不可能实现的 → `false`（webpack 提供空模块，仅保证构建通过）。
 *
 * ⚠️ 只写 `resolve.fallback` 是**不够**的：项目里大量使用 `import ... from 'node:fs'`，
 * 而 webpack 5 会把 `node:` 当成 **URI scheme** 处理，直接抛
 * `UnhandledSchemeError`，**根本不会走 resolve.fallback**（已实测）。
 * 因此下面额外挂了 `NormalModuleReplacementPlugin` 把 `node:` 前缀剥掉，
 * 让它退化成裸名后再由 fallback 接管。
 */
const nodeFallbacks = {
  // ---- 1) 给真 polyfill（构建期 + 运行期都需要）----
  buffer: require.resolve('buffer/'),
  path: require.resolve('path-browserify'),
  os: require.resolve('os-browserify/browser'),
  util: require.resolve('util/'),
  stream: require.resolve('stream-browserify'),
  events: require.resolve('events/'),
  zlib: require.resolve('browserify-zlib'),
  crypto: require.resolve('crypto-browserify'),
  querystring: require.resolve('querystring-es3'),
  url: require.resolve('url/'),
  // ---- 2) 浏览器里不可能实现：构建通过，运行必炸 ----
  // fs/fs.promises：`src/common/utils/nodejs.ts`、worker、下载器、musicMeta。
  fs: false,
  'fs/promises': false,
  // dns：`src/renderer/utils/musicSdk/utils.js:2` 的顶层 import（native-bridge-needs §2.4 认定为死代码，阶段 3 删除）。
  dns: false,
  // 网络：内置音源目前走 vendored needle（Node HTTP 客户端），阶段 3 整层换 fetch/CapacitorHttp。
  http: false,
  https: false,
  net: false,
  tls: false,
  // worker_threads：主进程 dbService 用；渲染层的两个 Worker 是 `new Worker(new URL(...))`（web 目标下 webpack 会打成 Web Worker chunk）。
  worker_threads: false,
  child_process: false,
  cluster: false,
  dgram: false,
  // 其余 Node 专有内置模块
  vm: false,
  module: false,
  inspector: false,
  perf_hooks: false,
  async_hooks: false,
  readline: false,
  repl: false,
  tty: false,
  domain: false,
  sys: false,
  timers: false,
  constants: false,
  assert: false,
  punycode: false,
  string_decoder: false,
}

const resolveFallback = {}
for (const [name, target] of Object.entries(nodeFallbacks)) {
  resolveFallback[name] = target
  resolveFallback[`node:${name}`] = target
}
/** 与 Electron 的 prod 配置一致：提交信息来自 git，脏工作区留空。 */
const gitInfo = { commit_id: '', commit_date: '' }
try {
  const { execSync } = require('child_process')
  if (!execSync('git status --porcelain').toString().trim()) {
    gitInfo.commit_id = execSync('git log -1 --pretty=format:"%H"').toString().trim()
    gitInfo.commit_date = execSync('git log -1 --pretty=format:"%ad" --date=iso-strict').toString().trim()
  }
} catch {}

module.exports = {
  ...baseConfig,

  // 关键差异 1：换掉 electron-renderer。它会往 bundle 里注入 Node 的 require/内置模块。
  target: 'web',

  mode: isProd ? 'production' : 'development',
  devtool: isProd ? 'source-map' : 'eval-source-map',

  // 关键差异 2：不能沿用 base 的 `library: { type: 'commonjs2' }`
  // （那是 Electron 主进程 require 渲染层入口用的），web 目标下入口必须是普通脚本。
  output: {
    filename: isProd ? '[name].[contenthash:8].js' : '[name].js',
    chunkFilename: isProd ? '[name].[contenthash:8].js' : '[name].js',
    path: outDir,
    publicPath: '',
    clean: true,
  },

  // 关键差异 3：Node 内置模块的浏览器归宿。
  resolve: {
    ...baseConfig.resolve,
    fallback: resolveFallback,
  },

  // 关键差异 4：`.node` 原生模块（node-loader）在 web 目标下无意义 —— 直接去掉该规则。
  module: {
    ...baseConfig.module,
    rules: baseConfig.module.rules.filter(({ test }) => String(test) !== String(/\.node$/)),
  },

  plugins: [
    ...baseConfig.plugins,
    // 与 Electron prod 一样带上静态资源（app 图标、字体等）
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.join(__dirname, '../../src/static'),
          to: path.join(outDir, 'static'),
        },
      ],
    }),
    // 关键差异 4.5：把 `node:` 前缀剥掉。
    // webpack 5 把 `node:fs` 当 URI scheme，抛 UnhandledSchemeError 且**不查 fallback**；
    // 项目里 `node:fs` / `node:path` / `node:os` / `node:crypto` / `node:zlib` 到处都是。
    new webpack.NormalModuleReplacementPlugin(/^node:/, resource => {
      resource.request = resource.request.replace(/^node:/, '')
    }),
    // 关键差异 4.6（阶段 3）：HTTP 传输层的**构建期**替换。
    // `src/renderer/platform/http/index.js` 默认是桌面的 needle 适配器；web/Android 换成
    // 同目录的 `web.js`（fetch）。这是构建期而不是运行期选择 —— 运行期按 isDesktopShell
    // 三元选择会把两个实现都打进产物，`vendor/needle` 就仍然留在 Android bundle 里。
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]platform[\\/]http[\\/]index\.js$/,
      resource => {
        resource.request = resource.request.replace(/[\\/]index\.js$/, '/web.js')
      },
    ),
    // 关键差异 4.7（阶段 3 / 线 D）：渲染层 IPC 传输层的**构建期**替换。
    // `src/common/platform/ipcBridge/index.js` 默认是桌面的 electron `ipcRenderer` 透传；
    // web/Android 换成同目录的 `web.js`（占位实现，调用即抛错 —— 阶段 3-5 接原生桥）。
    //
    // 为什么必须换掉：不换的话 `rendererIpc.ts → electron` 会让 npm 包
    // `node_modules/electron` 被整包打进产物（它顶层就用 `__dirname`，而 web 目标里
    // `node.__dirname = false`），`renderer.js` 加载到 `rendererIpc.ts` 那一步就
    // `ReferenceError: __dirname is not defined`，页面完全空白（实测见
    // `docs/android/web-runtime-blockers.md` 阻塞点 #1）。
    //
    // ⚠️ 与上面 4.6（http）不同，这里**必须**用 `beforeResolve` 那一次匹配（裸说明符
    // `@common/platform/ipcBridge` 就是全部），不能靠 `afterResolve` 的绝对路径分支：
    // 本项目里 `@common/*` 是 webpack `resolve.alias` 别名，`rendererIpc.ts` 写的就是
    // `@common/platform/ipcBridge`，**不带 `/index.js`**，`afterResolve` 正则匹配不到；
    // 而 `afterResolve` 里改 `resource.request` 对 webpack 已无意义
    // （`NormalModuleFactory` 用的是早一步定好的 `createData.resource`）。
    // 实测：只写 4.6 那种绝对路径正则时，产物里仍然是 `index.js` → `desktop.js`。
    new webpack.NormalModuleReplacementPlugin(
      /(^|[\\/])@?common[\\/]platform[\\/]ipcBridge([\\/]index\.js)?$/,
      resource => {
        resource.request = '@common/platform/ipcBridge/web'
      },
    ),
    // 关键差异 4.8（阶段 3 / 线 D）：渲染层"裸 ipcRenderer"入口的构建期替换。
    // `src/renderer/platform/ipcRenderer/index.js` 直接 `import { ipcRenderer } from 'electron'`，
    // 是 `node_modules/electron` 进入 web 产物的**第二个**入口（第一个是 4.7 的
    // `src/common/rendererIpc.ts`）。当前调用点只有 `src/renderer/utils/ipc.ts` 的
    // `onFullscreenChanged()`（它需要 Electron 的原始事件对象，不适用 ipcBridge 的
    // `{ event, params }` 契约）。替换成 `./web.js`（访问属性即抛错）。
    //
    // 同 4.7：`@renderer/platform/ipcRenderer` 是 `resolve.alias` 别名，裸说明符不带
    // `/index.js`，必须用 `beforeResolve` 那次匹配（`afterResolve` 改 request 无效）。
    new webpack.NormalModuleReplacementPlugin(
      /(^|[\\/])@?renderer[\\/]platform[\\/]ipcRenderer([\\/]index\.js)?$/,
      resource => {
        resource.request = '@renderer/platform/ipcRenderer/web'
      },
    ),
    // 关键差异 4.9（阶段 3 / 线 E）：`@common/utils/electron`（`shell` / `clipboard`）的
    // 构建期替换 —— 这是阻塞点 #4（`node_modules/electron` 进入 web 产物的**第三个**入口）。
    //
    // 为什么本轮必须做：修完 #3 之后实测，它就是**下一个挂载期同步抛错** ——
    // `src/renderer/core/useApp/useEventListener.ts:26` 的
    // `import { openUrl } from '@common/utils/electron'` 在 App setup 阶段（`app.mount()` 之前）
    // 就会走到 npm 包 `node_modules/electron/index.js` 的 `path.join(__dirname, 'path.txt')`
    // ⇒ `ReferenceError: __dirname is not defined` ⇒ 挂载中断，`#root` 依旧为空。
    //
    // 这里是**替换请求**而不是"新增一层 index.js + 改 import"：桌面实现就是
    // `src/common/utils/electron.ts` 本身（22 个 import 点，本轮一个字都不改），
    // 替身只有 `src/common/platform/electron/web.js` 一个文件，桌面两个构建完全不知道它存在。
    new webpack.NormalModuleReplacementPlugin(
      /(^|[\\/])@?common[\\/]utils[\\/]electron$/,
      resource => {
        resource.request = '@common/platform/electron/web'
      },
    ),
    // 关键差异 4.10（阶段 3 / 线 E-2）：渲染层"挂载期必需通道"降级层的**构建期**替换。
    // `src/renderer/platform/ipcFallback/index.js` 默认是桌面的**逐字透传**实现
    // （`invokeWithFallback(invoke, channel) === invoke(channel)`，第三个 `fallback` 参数
    // 在桌面路径上不存在）；web/Android 换成同目录的 `web.js`（带 `fallback` 的容错版本）。
    //
    // 为什么必须换：`event/index.ts` 的 `registerEvents()` 是**顶层 import 即执行**的
    // （`main.ts:6`），而它碰的 `winMain_get_hot_key` / `winMain_set_hot_key_config` /
    // `winMain_key_down` / `winMain_focus` 在 Android 上**都没有桥**
    // （`ipcBridge/web.js` 调用即抛错）⇒ 模块求值中断 ⇒ `app.mount('#root')` 跑不到
    // （阻塞点 #3，见 `docs/android/web-runtime-blockers.md`）。
    //
    // 这里**只替换 web 构建**：桌面两个构建（`webpack.config.dev.js` / `prod.js`）
    // 完全不知道 `ipcFallback/web.js` 存在，桌面语义（reject 仍是 reject、订阅时机逐字一致）
    // 不受影响。
    //
    // 同 4.7 / 4.8：`@renderer/platform/ipcFallback` 是 `resolve.alias` 别名，裸说明符
    // 不带 `/index.js`，必须用 `beforeResolve` 那次匹配（`afterResolve` 改 request 无效）。
    new webpack.NormalModuleReplacementPlugin(
      /(^|[\\/])@?renderer[\\/]platform[\\/]ipcFallback([\\/]index\.js)?$/,
      resource => {
        resource.request = '@renderer/platform/ipcFallback/web'
      },
    ),
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: isProd ? '"production"' : '"development"',
        PREVIEW_BUILD: `'${process.env.PREVIEW_BUILD}'`,
      },
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      COMMIT_ID: `"${gitInfo.commit_id}"`,
      COMMIT_DATE: `"${gitInfo.commit_date}"`,
    }),
    // 关键差异 5：Node 全局。Electron 渲染层靠 Node 集成才有 `Buffer`/`process`，
    // WebView 里必须显式注入，否则 bundle 一加载就 ReferenceError。
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: require.resolve('process/browser'),
    }),
  ],

  optimization: {
    minimize: isProd,
    minimizer: [
      new TerserPlugin(),
      new CssMinimizerPlugin(),
    ],
    splitChunks: {
      chunks: 'initial',
      minChunks: 2,
    },
  },

  performance: {
    maxEntrypointSize: 1024 * 1024 * 10,
    maxAssetSize: 1024 * 1024 * 20,
    hints: 'warning',
  },

  node: {
    __dirname: false,
    __filename: false,
  },
}
