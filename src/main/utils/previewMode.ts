/**
 * 预览（魔改调试）模式开关
 *
 * 用途：让「预览构建」在不改动官方发布流程的前提下，做到完全自包含、不污染系统。
 *
 * 判定方式：打包时由 `npm run pack:preview` 注入 `PREVIEW_NO_PROTOCOL=1`，
 * 经 webpack DefinePlugin 直接烧进产物。
 *
 * 注意 1：不要改用命令行开关（如 `--no-deeplink`）来做运行时判定 ——
 *   Electron/Chromium 会在 JS 启动前拒绝无法识别的开关，
 *   实测报错 `bad option: --no-deeplink`，进程直接退出。
 *   若确实需要运行时开关，必须先调用 app.commandLine.appendSwitch() 注册。
 *
 * 注意 2：生产构建的 DefinePlugin 会把整个 `process.env` 静态替换为字面量对象，
 *   因此这里只能按固定键名读取，不可做动态取值。
 *
 * 风格与 `index.ts` 中读取 `process.env.BUILD_WIN7` 保持一致。
 */

export const isPreviewNoProtocol = (): boolean => {
  return process.env.PREVIEW_NO_PROTOCOL === '1'
}
