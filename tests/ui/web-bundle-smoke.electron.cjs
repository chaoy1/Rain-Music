// 在真实 Chromium 里**直接运行构建出来的 web 产物**（`dist-web/index.html`）。
//
// 这是本机最接近真机的一条证据：这个页面里既没有 Electron 的 `process.versions.electron`、
// 也没有原生桥，于是 `renderer/platform/index.ts` 判定 `shell='unknown'` ⇒ 走的正是 Android
// WebView 那条**移动分支**。所以它验证的是**真产物**（不是组件替身）里的两件事：
//   1) 移动端界面**不出现** macOS 交通灯，且那个零尺寸占位元素在（Aside / PlayDetail 的布局靠它）；
//   2) 连不上原生桥时应用**照常启动并渲染**，不会白屏、也不会抛 JS 崩溃。
//
// 需要 `dist-web` 已构建（CI 里由 Android workflow 的 `build:web` 产出）。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, '.design/web-bundle-smoke')
const indexPath = path.join(root, 'dist-web/index.html')

// 只找"JS 崩了"这类信号。
const CRASH_PATTERNS = [/Uncaught/, /is not a function/, /TypeError/, /ReferenceError/, /is not defined/, /Cannot read propert/]
// 这个页面**故意**没有任何原生桥（正是为了走移动分支），所以"每个写都很可能 reject"是本环境固有的：
// `src/renderer/main.ts` 里那两次 `updateSetting(...)`（写回语言/窗口尺寸）**有意不降级**
// ——"写不进去就应该看得见"。过滤必须**同时**满足"像崩了"和"桥没实现"两个条件，
// 否则一个真的 TypeError 会被顺带放过。
const BRIDGE_MISSING = /plugin is not implemented on web|没有送达原生侧/

app.whenReady().then(async() => {
  const results = []
  const push = (test, pass, detail) => results.push(detail === undefined ? { test, pass } : { test, pass, detail })
  const finish = () => {
    console.log(JSON.stringify(results, null, 2))
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
    app.exit(results.every(item => item.pass) ? 0 : 1)
  }

  if (!fs.existsSync(indexPath)) {
    push('dist-web/index.html exists (run build:web first)', false, indexPath)
    finish()
    return
  }

  const win = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  const messages = []
  // Electron 42 起推荐事件对象形式，但旧签名仍会传 (event, level, message)：两种都接住。
  win.webContents.on('console-message', (event, level, message) => {
    const text = event && typeof event === 'object' && typeof event.message === 'string' ? event.message : message
    messages.push(String(text ?? ''))
  })

  let loadError = null
  try {
    await win.loadFile(indexPath)
  } catch (error) { loadError = error.message }
  // 不做任何交互，只等应用自己启动完成。CI runner 可能比本机慢，所以**轮询**而不是固定等 6 秒；
  // 轮询结束后再留 1 秒收尾，让启动阶段的 console 消息都到齐。
  for (let attempt = 0; attempt < 40; attempt++) {
    const rendered = await win.webContents.executeJavaScript(`document.querySelector('#root') ? document.querySelector('#root').children.length : 0`).catch(() => 0)
    if (rendered > 0) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  await new Promise(resolve => setTimeout(resolve, 1000))

  const state = await win.webContents.executeJavaScript(`(() => ({
    rootChildren: document.querySelector('#root') ? document.querySelector('#root').children.length : -1,
    elementCount: document.querySelectorAll('*').length,
    mobileTitleBar: document.querySelectorAll('[data-mobile-title-bar]').length,
    nativeWindowControls: document.querySelectorAll('[data-native-window-control]').length,
    isDesktopShellSignal: !!(window.process && window.process.versions && window.process.versions.electron),
    nativeBridgeActive: typeof window.Capacitor === 'object' && window.Capacitor !== null && typeof window.Capacitor.isNativePlatform === 'function' ? window.Capacitor.isNativePlatform() : false
  }))()`).catch(error => ({ evaluateError: error.message }))

  push('the built web bundle loads without a load error', loadError === null, String(loadError))
  push('the app actually boots and renders into #root', typeof state.rootChildren === 'number' && state.rootChildren > 0 && state.elementCount > 100, JSON.stringify({ rootChildren: state.rootChildren, elementCount: state.elementCount }))
  // 这条是验收项本身：真产物里**没有** macOS 交通灯，而且移动分支的占位元素在。
  push('no macOS traffic lights in the mobile artifact', state.nativeWindowControls === 0, `nativeWindowControls=${state.nativeWindowControls}`)
  push('the mobile shell branch is the one that rendered', state.mobileTitleBar >= 1, `mobileTitleBar=${state.mobileTitleBar}`)
  // 证明这一轮确实是在"没有桌面壳、也没有原生桥"的条件下跑的（否则上面两条可能只是碰巧）。
  push('the page really has no desktop shell and no native bridge', state.isDesktopShellSignal === false && state.nativeBridgeActive === false, JSON.stringify({ isDesktopShellSignal: state.isDesktopShellSignal, nativeBridgeActive: state.nativeBridgeActive }))
  const bridgeMissing = messages.filter(text => BRIDGE_MISSING.test(text)).length
  const crashes = [...new Set(messages.filter(text => CRASH_PATTERNS.some(pattern => pattern.test(text)) && !BRIDGE_MISSING.test(text)))].slice(0, 5)
  push('booting the mobile artifact raises no JS crash beyond the unavoidable missing-bridge rejections', crashes.length === 0, `${crashes.join(' | ')} (missing-bridge messages seen: ${bridgeMissing})`)

  win.destroy()
  finish()
}).catch(error => { console.error(error); app.exit(1) })
