import { nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/** Exact raster representations are rendered from the vector, including 300/400% DPI. */
export const buildTrayImage = (directory: string, darkTaskbar: boolean, windows: boolean): Electron.NativeImage => {
  const name = darkTaskbar ? 'tray_white' : 'tray_black'
  // Windows ICO decoding can synthesize a 256px bitmap even for a 16px entry.
  // Start with the exact PNG so scale 1 is not silently replaced by that bitmap.
  const png = path.join(directory, name + '.png')
  const base = fs.existsSync(png) ? png : path.join(directory, name + (windows ? '.ico' : '.png'))
  if (!fs.existsSync(base)) return nativeImage.createEmpty()
  const image = nativeImage.createFromPath(base)
  for (const scaleFactor of [1, 1.25, 1.5, 2, 3, 4]) {
    const variant = path.join(directory, name + (scaleFactor === 1 ? '' : `@${scaleFactor}x`) + '.png')
    try {
      const buffer = fs.readFileSync(variant)
      if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) image.addRepresentation({ scaleFactor, buffer })
    } catch { /* A missing optional representation must not prevent startup. */ }
  }
  if (!windows) image.setTemplateImage(true)
  return image
}
