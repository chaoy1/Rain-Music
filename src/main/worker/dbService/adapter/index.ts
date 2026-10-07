import { createCapacitorSQLiteDriver } from './android'
import { createBetterSqlite3Driver } from './better-sqlite3'
import { SerializedSQLAdapter } from './serialize'
import { type SQLAdapter, type SQLAdapterOptions, type SQLAdapterType } from './types'

interface CapacitorBridge {
  getPlatform?: () => string
  isNativePlatform?: () => boolean
}

interface AdapterScope {
  Capacitor?: CapacitorBridge
  window?: {
    Capacitor?: CapacitorBridge
  }
}

// 用属性访问而不是裸标识符：Android WebView / Worker 里 `Capacitor` 可能完全不存在，
// 裸写会直接抛 ReferenceError（与 `src/renderer/platform/index.ts` 同一套判定习惯）。
const scope = globalThis as unknown as AdapterScope

/** 显式注入的平台类型。Android 启动流程（或构建期别名）可以覆盖自动判定。 */
let injectedType: SQLAdapterType | null = null

/**
 * 显式指定适配器类型（Android 侧注入点）。传 `null` 恢复自动判定。
 * 桌面版**不要**调用它 —— 桌面路径必须保持默认。
 */
export const setSQLAdapterType = (type: SQLAdapterType | null) => {
  injectedType = type
}

/**
 * Capacitor 原生桥：只有真正的原生 WebView 才会注入
 * （纯浏览器 / Electron 里 `isNativePlatform()` 为 false 或桥不存在）。
 */
const hasNativeCapacitorBridge = (): boolean => {
  const bridge = scope.Capacitor ?? scope.window?.Capacitor
  if (bridge == null) return false
  if (typeof bridge.isNativePlatform === 'function') return bridge.isNativePlatform()
  return typeof bridge.getPlatform === 'function' && bridge.getPlatform() !== 'web'
}

/**
 * 自动判定：**桌面是默认值**，只有确认跑在 Capacitor 原生壳里才切到 Android。
 * 判定顺序与渲染层一致（原生桥优先），且刻意做成"不确定就是桌面"——
 * Android 侧即使桥不可见也可以显式 `setSQLAdapterType('android')`，
 * 但桌面绝不会因为误判而走到未实现的 Android 驱动。
 */
const detectAdapterType = (): SQLAdapterType => hasNativeCapacitorBridge() ? 'android' : 'desktop'

/** 当前生效的适配器类型（供日志 / 测试断言用）。 */
export const getSQLAdapterType = (): SQLAdapterType => injectedType ?? detectAdapterType()

/**
 * 创建适配器。返回值已经带好连接锁与事务语义（`SerializedSQLAdapter`），
 * 业务层只需要把它当成 `getDB()` 的返回类型使用。
 */
export const createSQLAdapter = (options: SQLAdapterOptions): SQLAdapter => {
  if (getSQLAdapterType() === 'android') return new SerializedSQLAdapter(createCapacitorSQLiteDriver(options), 'android')
  return new SerializedSQLAdapter(createBetterSqlite3Driver(options), 'desktop')
}
