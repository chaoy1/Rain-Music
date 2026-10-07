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
