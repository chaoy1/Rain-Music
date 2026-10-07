/**
 * 渲染层平台抽象层的唯一入口（Android 移植 · 阶段 1a）。
 *
 * ## 为什么这里需要"平台判定"
 *
 * 桌面版主窗口是 `frame: false` 的无边框窗口（`src/main/modules/winMain/main.ts:104-130`），
 * macOS 风格的"交通灯"（`src/renderer/components/layout/Toolbar/TrafficLights.vue`）是用户
 * 关闭 / 最小化 / 全屏的**唯一**入口。Android（Capacitor WebView）既没有窗口边框，也没有
 * `winMain_close` / `winMain_min` / `winMain_fullscreen` 这三个通道（`docs/android/ipc-contract.md`
 * §5.2，三者均属"B 可直接移除"），所以渲染出来的只会是三个按不动的假按钮。
 *
 * ## 为什么是"不渲染"而不是"删组件"
 *
 * 1. 组件本体必须留给桌面端 —— 删掉它，桌面版用户就无法关闭窗口（`docs/android-port-plan.md:50`
 *    要求的是"移动端不渲染自绘标题栏"，不是"移除组件"）。
 * 2. 两个挂载点（`Aside/index.vue`、`PlayDetail/index.vue`）都包在容器里，条件渲染的改动面极小；
 *    组件内部还带着桌面端的焦点 / 悬停 / 失焦行为，这些在 Android 上只会变成死代码。
 * 3. 于是约定：**组件保留、渲染点收口**。判定只发生在本文件这一个地方，Android 分支以后
 *    只改这里（或按 `docs/android/ipc-contract.md` §6.1 的建议，改成构建期别名 `@platform`
 *    指向 `capacitor.ts`，把 `electron` 相关模块彻底排除出 Android bundle）。
 *
 * ## 判定依据（不要用 userAgent）
 *
 * - **Electron 桌面壳**：主窗口 `nodeIntegration: true` / `contextIsolation: false`
 *   （`src/main/modules/winMain/main.ts:120-130`），渲染层拿到的是真正的 Electron `process`，
 *   因此 `process.versions.electron` 一定存在。注意主窗口**没有 preload**，`window.rain`
 *   是渲染层自己在 `src/renderer/core/globalData.ts:4` 造出来的状态容器、两端都有，
 *   **不能**拿它当桌面信号（`docs/android/ipc-contract.md:653` 已更正这一点）。
 * - **Capacitor WebView**：原生桥会在页面脚本之前注入 `window.Capacitor`。
 * - 两者都不满足时（例如纯浏览器里跑构建产物）返回 `unknown`，按"非桌面壳"处理。
 */

interface CapacitorBridge {
  getPlatform?: () => string
  isNativePlatform?: () => boolean
}

interface ShellScope {
  Capacitor?: CapacitorBridge
  process?: {
    versions?: {
      electron?: string
    }
  }
}

// 用属性访问而不是裸标识符：Android WebView 里 `process` / `Capacitor` 可能完全不存在，
// 裸写 `process.versions` 会直接抛 ReferenceError。
const scope = globalThis as unknown as ShellScope

/**
 * Electron 渲染进程：`process.versions.electron` 是 Electron 注入的版本号。
 * webpack 5 不再 polyfill `process`（target `electron-renderer`，见
 * `build-config/renderer/webpack.config.base.js:12`），所以这里读到的就是宿主对象。
 */
const isElectronRenderer = (): boolean => {
  const version = scope.process?.versions?.electron
  return typeof version === 'string' && version.length > 0
}

/** Capacitor 原生桥：只有真正的原生 WebView 才会注入（纯浏览器里 `isNativePlatform()` 为 false）。 */
const hasNativeCapacitorBridge = (): boolean => {
  const bridge = scope.Capacitor
  if (bridge == null) return false
  if (typeof bridge.isNativePlatform === 'function') return bridge.isNativePlatform()
  return typeof bridge.getPlatform === 'function' && bridge.getPlatform() !== 'web'
}

export type PlatformShell = 'electron' | 'capacitor' | 'unknown'

/**
 * 当前渲染层跑在哪种壳里。一次判定、运行期不再变化。
 *
 * 判定顺序是**原生桥优先**：只要 Capacitor 原生壳在，就按移动端处理 —— 万一将来某个
 * polyfill 让 `process.versions.electron` 在 WebView 里也出现，也绝不能在 Android 上渲染出
 * 三个按不动的 macOS 窗口按钮。反过来桌面 Electron 里不会有原生桥，判定不受影响。
 */
export const shell: PlatformShell = hasNativeCapacitorBridge()
  ? 'capacitor'
  : isElectronRenderer() ? 'electron' : 'unknown'

/** Electron 桌面壳（桌面版全部行为都挂在这个开关上）。 */
export const isDesktopShell = shell === 'electron'

/** Capacitor 原生壳（Android 首版）。纯浏览器调试时两者都为 false。 */
export const isMobileShell = shell === 'capacitor'

/**
 * 平台能力开关：是否渲染窗口控制（交通灯）。
 * 与 `isDesktopShell` 同义，按 `docs/android/ipc-contract.md` §6.1 的命名预留；
 * 后续阶段的 `capabilities.ts`（hasTray / hasGlobalShortcut / hasDesktopLyric …）从这里长出来。
 */
export const hasWindowControls = isDesktopShell
