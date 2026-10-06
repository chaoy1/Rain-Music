/**
 * 数据目录重定向（必须在任何其它 import 之前执行）
 *
 * 背景：`app.setPath('userData', ...)` 只有在主进程脚本「已加载」之后才生效。
 * Electron 启动阶段会先按默认 userData 路径准备 Chromium 的缓存/分区目录，
 * 因此仅重定向 userData 时，`%APPDATA%\rain-music-preview` 一类的默认目录
 * 仍会被创建，达不到「不在工作目录外留痕」的要求。
 *
 * 因此这里把 `appData` 与 `userData` 一并指向便携目录：
 * 之后 Electron 派生的所有路径（userData / cache / logs / crashDumps）
 * 都会落在 exe 同级的 `portable` 文件夹内。
 *
 * 触发条件（任一）：
 *  - exe 同级存在 `portable` 文件夹（便携模式约定）
 *  - 设置了 `RAIN_DATA_DIR`，便于调试时指定任意数据目录
 */

import path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { app } from 'electron'

export const resolvePortableBase = (): string | null => {
  if (process.env.RAIN_DATA_DIR) return process.env.RAIN_DATA_DIR
  if (process.platform !== 'win32') return null

  const portablePath = path.join(path.dirname(app.getPath('exe')), 'portable')
  if (!existsSync(portablePath)) return null
  return portablePath
}

/**
 * 把 appData / userData 重定向到便携目录。
 * 必须在模块加载最早期调用。
 *
 * 同时记录重定向「之前」的原始路径到 global.rainOldDataPath，
 * 该字段被 utils/migrate.ts 用于从旧数据目录导入历史数据，
 * 因此语义必须保持为「原始数据目录」。
 */
export const applyPortableDataPath = (): void => {
  // 先记录原始路径，供 migrate 使用（无论是否启用便携模式都要设置）
  global.rainOldDataPath = app.getPath('userData')

  const base = resolvePortableBase()
  if (!base) {
    // 非便携模式：保持默认数据目录行为
    global.rainDataPath = path.join(global.rainOldDataPath, 'RainDatas')
    if (!existsSync(global.rainDataPath)) mkdirSync(global.rainDataPath, { recursive: true })
    return
  }

  try {
    app.setPath('appData', base)

    const userDataPath = path.join(base, 'userData')
    if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
    app.setPath('userData', userDataPath)

    global.rainDataPath = path.join(userDataPath, 'RainDatas')
    if (!existsSync(global.rainDataPath)) mkdirSync(global.rainDataPath, { recursive: true })
  } catch (err) {
    console.error('applyPortableDataPath failed', err)
  }
}
