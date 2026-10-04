/**
 * 读取桌面壁纸路径。
 *
 * 用于 macOS 风格的磨砂玻璃：把壁纸重度模糊后作为应用底层背景，
 * 各面板再对其做 backdrop-filter —— 玻璃观感因此不依赖 Windows 的
 * DWM Acrylic（该系统材质偏弱、且受「透明效果」系统设置影响，
 * 实测在部分机器上几乎看不出效果）。
 *
 * 只做读取，不修改任何系统设置。
 */

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const REG_KEY = 'HKCU\\Control Panel\\Desktop'
const REG_VALUE = 'WallPaper'

const readRegistryWallpaper = (): string | null => {
  try {
    const out = execFileSync('reg', ['query', REG_KEY, '/v', REG_VALUE], {
      encoding: 'utf8',
      windowsHide: true,
    })
    // 输出形如：    WallPaper    REG_SZ    C:\Windows\web\wallpaper\Windows\img19.jpg
    const m = /REG_SZ\s+(.+?)\s*$/m.exec(out)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

export const getWallpaperPath = (): string | null => {
  if (process.platform !== 'win32') return null

  const p = readRegistryWallpaper()
  if (!p) return null
  // 壁纸可能被删除，落盘校验一次，避免渲染端拿到无效路径
  return existsSync(p) ? p : null
}
