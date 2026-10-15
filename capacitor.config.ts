import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置（Android 移植阶段 1）。
 *
 * 关键点：
 * - `webDir` 指向**面向 Web 的渲染层产物** `dist-web/`，由
 *   `build-config/renderer/webpack.config.web.js`（npm run build:web）产出。
 *   绝不能指向 `dist/`：那是 Electron 目标的产物（`target: 'electron-renderer'`，
 *   直接依赖 Node 集成），Capacitor WebView 跑不了。
 * - `appId` 与桌面版同属 `com.rainmusic` 命名空间（桌面版见
 *   `build-config/build-pack.js:16` 的 `com.rainmusic.desktop`），但移动端用
 *   `.mobile`：Android 的 applicationId 是设备上/商店里的应用身份，叫 `.desktop`
 *   在手机上会误导，且与已安装的桌面版同名不利于排查。
 * - HTTP 请求由 CapacitorHttp 接到原生网络栈；明文策略在 Android XML 配置。
 *   配置接通仍须执行 docs/android/cleartext-verification.md 的真机矩阵。
 */
const config: CapacitorConfig = {
  appId: 'com.rainmusic.mobile',
  appName: 'Rain Music',
  webDir: 'dist-web',
  plugins: { CapacitorHttp: { enabled: true } },
  android: { allowMixedContent: true },
}

export default config
