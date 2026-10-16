// 在真实 Chromium 里**直接运行构建出来的 web 产物**（`dist-web/index.html`）。
//
// 这是本机最接近真机的一条证据：这个页面里既没有 Electron 的 `process.versions.electron`、
// 也没有原生桥，于是 `renderer/platform/index.ts` 判定 `shell='unknown'` ⇒ 走的正是 Android
// WebView 那条**移动分支**。所以它验证的是**真产物**（不是组件替身）里的三件事：
//   1) 移动端界面**不出现** macOS 交通灯，且那个零尺寸占位元素在（Aside / PlayDetail 的布局靠它）；
//   2) 连不上原生桥时应用**照常启动并渲染**，不会白屏、也不会抛 JS 崩溃；
//   3) 三条**不依赖原生桥**的视图（歌单 / 下载 / 设置）各自都能渲染出来，且一直不带交通灯
//      —— 其中"设置"页里那条桌面专用的"保存路径"必须**不存在**（W6 的真产物级证据）。
//
// 每条路由都用**独立的一次加载**（`loadFile(index, {hash})`）而不是应用内点来点去：
// 那条路要穿过 `<transition>` 的 leave（旧容器会留在 DOM 里）和各个视图的 `beforeRouteEnter`
// 守卫，本机实测会得到"hash 变了、视图没换"这种难以解释的中间态。
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

// 结构性签名，**只看最后一个** `.view-container`：一次加载里 router-view 会留下不只一个容器，
// 取最后一个才稳定。刻意不用文案 —— 文案随语言变。
const SIGNATURE = `(() => {
  const containers = [...document.querySelectorAll('.view-container')]
  const scope = containers[containers.length - 1] || document
  return {
    hash: location.hash,
    containers: containers.length,
    tables: scope.querySelectorAll('table').length,
    dts: scope.querySelectorAll('dt').length,
    dds: scope.querySelectorAll('dd').length,
    inputs: scope.querySelectorAll('input').length,
    downloadPathRow: document.querySelectorAll('#download_path').length,
    downloadPathAria: document.querySelectorAll('[aria-label="setting__download_path_title"]').length,
    trafficLights: document.querySelectorAll('[data-native-window-control]').length,
    mobileTitleBar: document.querySelectorAll('[data-mobile-title-bar]').length,
    elementCount: document.querySelectorAll('*').length,
    isDesktopShellSignal: !!(window.process && window.process.versions && window.process.versions.electron),
    nativeBridgeActive: typeof window.Capacitor === 'object' && window.Capacitor !== null && typeof window.Capacitor.isNativePlatform === 'function' ? window.Capacitor.isNativePlatform() : false
  }
})()`

app.on('window-all-closed', () => {})

app.whenReady().then(async() => {
  const results = []
  const allMessages = []
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

  // 独立加载一条路由：等应用渲染出来（轮询，CI runner 更慢），再读签名。
  const loadRoute = async(hash) => {
    const win = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } })
    const messages = []
    // Electron 42 起推荐事件对象形式，但旧签名仍会传 (event, level, message)：两种都接住。
    win.webContents.on('console-message', (event, level, message) => {
      const text = event && typeof event === 'object' && typeof event.message === 'string' ? event.message : message
      messages.push(String(text ?? ''))
    })
    let loadError = null
    try {
      await win.loadFile(indexPath, hash ? { hash } : undefined)
    } catch (error) { loadError = error.message }
    for (let attempt = 0; attempt < 40; attempt++) {
      const rendered = await win.webContents.executeJavaScript(`document.querySelector('#root') ? document.querySelector('#root').children.length : 0`).catch(() => 0)
      if (rendered > 0) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    const signature = await win.webContents.executeJavaScript(SIGNATURE).catch(error => ({ evaluateError: error.message }))
    win.destroy()
    allMessages.push(...messages)
    return { loadError, signature, messages }
  }

  const crashLines = () => [...new Set(allMessages.filter(text => CRASH_PATTERNS.some(pattern => pattern.test(text)) && !BRIDGE_MISSING.test(text)))].slice(0, 5)

  // ---- 第 1 段：启动（不带路由）----
  const boot = await loadRoute('')
  const state = boot.signature
  push('the built web bundle loads without a load error', boot.loadError === null, String(boot.loadError))
  push('the app actually boots and renders into #root', typeof state.elementCount === 'number' && state.elementCount > 100, JSON.stringify({ elementCount: state.elementCount }))
  // 这条是验收项本身：真产物里**没有** macOS 交通灯，而且移动分支的占位元素在。
  push('no macOS traffic lights in the mobile artifact', state.trafficLights === 0, `trafficLights=${state.trafficLights}`)
  push('the mobile shell branch is the one that rendered', state.mobileTitleBar >= 1, `mobileTitleBar=${state.mobileTitleBar}`)
  // 证明这一轮确实是在"没有桌面壳、也没有原生桥"的条件下跑的（否则上面两条可能只是碰巧）。
  push('the page really has no desktop shell and no native bridge', state.isDesktopShellSignal === false && state.nativeBridgeActive === false, JSON.stringify({ isDesktopShellSignal: state.isDesktopShellSignal, nativeBridgeActive: state.nativeBridgeActive }))

  // ---- 第 2 段：逐条路由 ----
  // ⚠️ 为什么**不**走 `#/search` 与 `#/leaderboard`：它们的 `beforeRouteEnter` 守卫会 `await`
  // `getSearchSetting()` / `getLeaderboardSetting()`（→ `winMain_get_data` 的 invoke，
  // `views/Search/index.vue:35-62`）。这个页面里没有任何桥 ⇒ 那个 Promise 必然 reject ⇒
  // 导航被中止、视图不换（本机实测：hash 是 `#/search`，DOM 停在上一页）。
  // 这是**环境固有**的，不是产物缺陷：`winMain_get_data` 在原生侧**已注册**
  // （`RainMusicDataChannels.java:22` 的 `CHANNEL_GET_DATA`，注册在 `:84`，落点 `rain:store:data`），
  // 真机上这两页正常打开。
  const list = await loadRoute('list')
  push('the playlist view renders in the mobile artifact', list.signature.hash === '#/list' && list.signature.tables === 0 && list.signature.dts === 0 && list.signature.elementCount > 100, JSON.stringify(list.signature))

  const download = await loadRoute('download')
  push('the download view renders in the mobile artifact', download.signature.hash === '#/download' && download.signature.tables >= 1 && download.signature.dts === 0, JSON.stringify(download.signature))

  const setting = await loadRoute('setting')
  push('the settings view renders in the mobile artifact', setting.signature.hash === '#/setting' && setting.signature.dts >= 5 && setting.signature.dds >= 5, JSON.stringify(setting.signature))
  // W6 的真产物级证据：桌面专用的"保存路径"行在移动端**不渲染**（连 aria 标记都不在）。
  push('the settings view has no desktop-only download save-path row', setting.signature.downloadPathRow === 0 && setting.signature.downloadPathAria === 0, JSON.stringify({ downloadPathRow: setting.signature.downloadPathRow, downloadPathAria: setting.signature.downloadPathAria }))

  // 每一条路由都不该冒出交通灯，且都还在移动分支上。
  const routes = [boot, list, download, setting]
  push('no route renders traffic lights and every route stays on the mobile branch', routes.every(item => item.signature.trafficLights === 0) && routes.every(item => item.signature.mobileTitleBar >= 1), JSON.stringify(routes.map(item => ({ hash: item.signature.hash, lights: item.signature.trafficLights, titleBar: item.signature.mobileTitleBar }))))

  const crashes = crashLines()
  const bridgeMissing = allMessages.filter(text => BRIDGE_MISSING.test(text)).length
  push('no JS crash beyond the unavoidable missing-bridge rejections', crashes.length === 0, `${crashes.join(' | ')} (missing-bridge messages seen: ${bridgeMissing})`)

  finish()
}).catch(error => { console.error(error); app.exit(1) })
