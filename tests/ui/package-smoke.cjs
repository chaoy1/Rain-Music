const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const asar = createRequire(require.resolve('app-builder-lib/package.json'))('@electron/asar')
const WebSocket = require('ws')
const root = path.resolve(__dirname, '../..')
const packageDir = path.resolve(root, process.argv[2] || 'build/win-unpacked')
const evidence = path.join(root, '.design/package-smoke')
const results = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = data => createHash('sha256').update(data).digest('hex')
const check = (test, pass, detail) => {
  results.push({ test, pass: !!pass, detail })
  if (!pass) throw new Error(test)
}

async function run() {
  fs.mkdirSync(evidence, { recursive: true })
  let child, socket
  try {
    const archive = path.join(packageDir, 'resources/app.asar')
    const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString())
    check('package version matches the source', metadata.version === require('../../package.json').version, metadata.version)
    for (const file of ['main.js', 'renderer.js', 'renderer-lyric.js', 'preload-lyric.js']) {
      check(`${file} matches the verified build`, hash(asar.extractFile(archive, `dist/${file}`)) === hash(fs.readFileSync(path.join(root, 'dist', file))))
    }
    const sqlite = asar.statFile(archive, path.join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))
    check('package includes SQLite and third-party licenses', sqlite.size > 0 && fs.existsSync(path.join(packageDir, 'resources/licenses/license_zh.txt')))
    const server = net.createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    const data = path.join(evidence, 'portable')
    const config = path.join(data, 'userData/RainDatas')
    fs.mkdirSync(config, { recursive: true })
    fs.writeFileSync(path.join(config, 'config_v2.json'), JSON.stringify({ version: '2.12.10', setting: { version: '2.12.10', 'common.langId': 'zh-cn', 'theme.id': 'mono', 'desktopLyric.enable': false } }))
    const env = { ...process.env, RAIN_DATA_DIR: data, RAIN_NO_PROTOCOL_REGISTRATION: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(path.join(packageDir, 'rain-music-desktop.exe'), [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
    let spawnError
    child.once('error', error => { spawnError = error })
    let tab
    for (let i = 0; i < 150; i++) {
      if (spawnError) throw spawnError
      try {
        tab = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page' && t.url.includes('index.html'))
        if (tab) break
      } catch {}
      await wait(100)
    }
    if (!tab) throw new Error('Packaged application did not open its main page')
    socket = new WebSocket(tab.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    let id = 0
    const pending = new Map()
    socket.on('message', data => {
      const reply = JSON.parse(data)
      const request = pending.get(reply.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(reply.id)
      if (reply.error) request.reject(new Error(reply.error.message))
      else request.resolve(reply.result)
    })
    const command = (method, params) => new Promise((resolve, reject) => {
      const current = ++id
      const timer = setTimeout(() => { pending.delete(current); reject(new Error(`Timed out: ${method}`)) }, 5000)
      pending.set(current, { resolve, reject, timer })
      socket.send(JSON.stringify({ id: current, method, params }))
    })
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
      return result.result?.value
    }
    const until = async expression => {
      for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return true; await wait(100) }
      return false
    }
    check('packaged renderer initializes', await until(`!!window.rainData?.updateSetting && !!document.querySelector('[data-favorite-btn]')`))
    await evaluate(`location.hash='#/setting';true`)
    check('packaged settings contain all seven continuous sections', await until(`document.querySelectorAll('[data-settings-section]').length === 7`))
    check('empty packaged player hides the timeline', await evaluate(`!document.querySelector('[data-footer-progress],[data-footer-time]')`))
    check('packaged theme picker expands and collapses', await evaluate(`(async()=>{const button=document.querySelector('[data-theme-toggle]');button.click();await new Promise(r=>setTimeout(r,100));const open=button.getAttribute('aria-expanded')==='true';button.click();await new Promise(r=>setTimeout(r,100));return open&&button.getAttribute('aria-expanded')==='false'})()`))
    const capture = await command('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidence, 'settings.png'), Buffer.from(capture.data, 'base64'))
    socket.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: `require('electron').ipcRenderer.send('winMain_quit');true` } }))
    await wait(500)
  } catch (error) {
    results.push({ test: 'packaged runtime smoke test', pass: false, detail: error.message })
  } finally {
    socket?.close()
    if (child && child.exitCode === null) child.kill()
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.test} ${JSON.stringify(result.detail ?? '')}`)
  process.exitCode = results.every(result => result.pass) ? 0 : 1
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
