const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { imageSize } = require('image-size')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(root, '.design/tray-and-tips')
process.env.RAIN_DATA_DIR = path.join(evidence, 'portable')
const config = path.join(process.env.RAIN_DATA_DIR, 'userData/RainDatas')
fs.mkdirSync(config, { recursive: true })
fs.writeFileSync(path.join(config, 'config_v2.json'), JSON.stringify({ version: '2.12.6', setting: { version: '2.12.10', 'common.langId': 'zh-cn', 'common.windowSizeId': 2, 'theme.id': 'mono', 'desktopLyric.enable': false } }))
const results = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`) }
const timeout = setTimeout(() => app.exit(1), 30000)
app.on('browser-window-created', (_, win) => {
  win.webContents.setBackgroundThrottling(false)
  const initialized = new Promise(resolve => global.rain.event_app.once('main_window_inited', resolve))
  win.webContents.once('did-finish-load', async () => {
    if (!win.webContents.getURL().includes('index.html')) return
    try {
      await initialized
      win.setAlwaysOnTop(true); win.show(); win.focus()
      const evaluate = code => win.webContents.executeJavaScript(code)
      await require('./dismiss-audio-notice.cjs')(evaluate)
      const { buildTrayImage } = require('../unit/load-ts.cjs')('src/main/modules/trayImage.ts')
      const dir = path.join(root, 'src/static/images/tray')
      for (const dark of [false, true]) {
        const image = buildTrayImage(dir, dark, true)
        check(`native tray ${dark ? 'white' : 'black'} is usable`, !image.isEmpty())
        for (const scaleFactor of [1, 1.25, 1.5, 2, 3, 4]) {
          const png = image.toPNG({ scaleFactor })
          const dimensions = imageSize(png)
          check(`native tray ${dark ? 'white' : 'black'} ${scaleFactor * 100}% uses exact pixels`, dimensions.width === 16 * scaleFactor && dimensions.height === 16 * scaleFactor, dimensions)
        }
      }
      check('missing optional tray resources do not throw', buildTrayImage(path.join(evidence, 'missing'), false, true).isEmpty())
      await evaluate(`(()=>{const f=document.createElement('div');f.id='qa-hover';f.style='position:fixed;left:400px;top:240px;z-index:9999;display:flex;gap:30px;background:var(--color-content-background);padding:16px';f.innerHTML='<button id="qa-text" aria-label="月白">月白</button><button id="qa-icon" aria-label="播放"><svg width="20" height="20"><path d="M4 2L17 10 4 18Z" fill="currentColor"/></svg></button><span id="qa-short" aria-label="短歌名">短歌名</span><span id="qa-long" aria-label="这是一个超长的完整歌曲名称" style="display:inline-block;width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">这是一个超长的完整歌曲名称</span>';document.querySelector('#root').append(f)})()`)
      const hover = async id => {
        const p = await evaluate(`(()=>{const r=document.querySelector('#${id}').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
        win.webContents.sendInputEvent({ type: 'mouseMove', ...p }); await wait(550)
      }
      const hasTip = label => evaluate(`[...document.querySelectorAll('[role=presentation]')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&e.getClientRects().length)`)
      await hover('qa-text'); check('visible button label has no redundant hover tip', !(await hasTip('月白')))
      await hover('qa-icon'); check('icon-only action keeps its hover label', await hasTip('播放'))
      await hover('qa-short'); check('short song name has no redundant hover tip', !(await hasTip('短歌名')))
      await hover('qa-long'); check('truncated song name keeps its full hover label', await hasTip('这是一个超长的完整歌曲名称'))
      await evaluate(`document.querySelector('#qa-hover').remove();location.hash='#/settings';void 0`); await wait(200)
    } catch (error) { console.error(error); check('runtime completes without errors', false, error.message) }
    clearTimeout(timeout)
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
    app.exit(results.every(result => result.pass) ? 0 : 1)
  })
})
require(path.join(root, 'dist/main.js'))
