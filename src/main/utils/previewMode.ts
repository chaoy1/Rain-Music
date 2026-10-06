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
 * PREVIEW_NO_PROTOCOL 是构建期标志；RAIN_NO_PROTOCOL_REGISTRATION 是运行期标志，
 * 用于隔离验证，避免测试程序改写系统协议关联。
 */

export const isPreviewNoProtocol = (): boolean => {
  return process.env.PREVIEW_NO_PROTOCOL === '1' || process.env.RAIN_NO_PROTOCOL_REGISTRATION === '1'
}
