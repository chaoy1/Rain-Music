// Run with Electron: node_modules/.bin/electron build-config/generate-tray-icons.cjs
// Render the vector at native pixel sizes; never upscale the 16px raster.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const dir = path.resolve(__dirname, '../src/static/images/tray')
const sizes = [16, 20, 24, 32, 48, 64]
const suffixes = ['', '@1.25x', '@1.5x', '@2x', '@3x', '@4x']
const symbol = '<path d="M6 3.5v8.1a2.25 1.7 0 1 1-1.5-1.61V3.65c0-.62.4-1.12 1-1.28l6-1.55c.78-.2 1.5.38 1.5 1.17v8.25a2.25 1.7 0 1 1-1.5-1.61V4L6 5.45Z"/>'
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="${color}">${symbol}</svg>`
const ico = buffers => {
  const header = Buffer.alloc(6 + 16 * buffers.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(buffers.length, 4)
  let offset = header.length
  buffers.forEach((buffer, i) => {
    const start = 6 + i * 16
    header[start] = sizes[i]; header[start + 1] = sizes[i]
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6)
    header.writeUInt32LE(buffer.length, start + 8); header.writeUInt32LE(offset, start + 12)
    offset += buffer.length
  })
  return Buffer.concat([header, ...buffers])
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<meta charset="utf-8">')
  fs.writeFileSync(path.join(dir, 'tray-symbol.svg'), svg('currentColor'))
  for (const [name, color] of [['tray_black', '#16181c'], ['tray_white', '#ffffff']]) {
    const buffers = []
    for (const [i, size] of sizes.entries()) {
      const data = await win.webContents.executeJavaScript(`(async()=>{const image=new Image(); image.src=${JSON.stringify('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(color)))};await image.decode(); const c=document.createElement('canvas');c.width=c.height=${size};c.getContext('2d').drawImage(image,0,0,${size},${size});return c.toDataURL('image/png').split(',')[1]})()`)
      const buffer = Buffer.from(data, 'base64')
      buffers.push(buffer)
      fs.writeFileSync(path.join(dir, name + suffixes[i] + '.png'), buffer)
    }
    fs.writeFileSync(path.join(dir, name + '.ico'), ico(buffers))
  }
  win.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
