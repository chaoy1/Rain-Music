const { app, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(root, '.design/responsive-layout')
process.env.RAIN_DATA_DIR = path.join(evidence, 'portable')
const config = path.join(process.env.RAIN_DATA_DIR, 'userData/RainDatas')
fs.mkdirSync(config, { recursive: true })
fs.writeFileSync(path.join(config, 'config_v2.json'), JSON.stringify({ version: '2.12.6', setting: { version: '2.12.8', 'common.langId': 'zh-cn', 'common.windowSizeId': 2, 'common.fontSize': 16, 'theme.id': 'mono_dark', 'desktopLyric.enable': false, 'download.enable': true } }))
app.commandLine.appendSwitch('force-prefers-reduced-motion')
// Hosted runners and desktops differ in DPI and display zoom. CSS px are DPI
// independent, but fractional host scaling snaps edges to device pixels, which
// can move a measured rect by 1px and break the 1px tolerances below. Pin the
// scale factor so both hosts lay out and measure the same thing (same place and
// same reason as the reduced-motion switch above).
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const results = []
const runLog = []
let phase = 'startup'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = message => { runLog.push(`${new Date().toISOString()} ${message}`); console.log(message) }
const check = (test, pass, detail) => { results.push({ test, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${test} ${JSON.stringify(detail ?? '')}`) }

// Bounded readiness waits instead of fixed sleeps. A hosted runner renders and
// schedules slower than a desktop, so "sleep 100ms then measure" observed
// half-laid-out DOM there. Every wait below has a deadline and is only used for
// readiness (route mounted, transition finished, rects stable) — never for the
// condition a check asserts, so no check is made vacuous.
const waitFor = async (label, probe, { timeout = 5000, interval = 50 } = {}) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() >= deadline) {
      log(`waitFor '${label}' timed out after ${timeout}ms`)
      return false
    }
    await wait(interval)
  }
}
const waitStable = async (probe, { samples = 2, interval = 60, timeout = 5000 } = {}) => {
  const deadline = Date.now() + timeout
  let previous = null
  let streak = 0
  for (;;) {
    const value = await probe()
    const text = JSON.stringify(value)
    streak = text === previous ? streak + 1 : 1
    previous = text
    if (streak >= samples || Date.now() >= deadline) return value
    await wait(interval)
  }
}

// Workflow commands become check annotations on the run, which the public API
// serves without a token — the same trick the CI aggregation step uses
// (.github/workflows/build-test.yml). Artifacts need a token, annotations do
// not, so a CI failure names its own assertion here.
const inline = detail => {
  const text = detail === undefined ? '' : JSON.stringify(detail)
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}
const annotate = (level, message) => console.log(`::${level} title=responsive-layout::${message}`)

// Persist results on every exit path (assertion failure, thrown error, watchdog
// abort). Previously a timeout or an exception exited without writing
// results.json, which is exactly when the artifact was needed most.
const finish = (reason, error) => {
  clearTimeout(timeout)
  if (reason && reason !== 'completed') results.push({ test: `suite ${reason}`, pass: false, detail: error ? String((error && error.stack) || error) : undefined })
  const failed = results.filter(result => !result.pass)
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
  fs.writeFileSync(path.join(evidence, 'run.log'), [
    ...runLog,
    ...results.map(result => `${result.pass ? 'PASS' : 'FAIL'} ${result.test} ${JSON.stringify(result.detail ?? '')}`),
    `checks=${results.length} failures=${failed.length}`,
  ].join('\n') + '\n')
  for (const item of failed.slice(0, 10)) annotate('error', `FAIL ${item.test} ${inline(item.detail)}`)
  if (failed.length > 10) annotate('error', `${failed.length} checks failed, the first ten are annotated above`)
  if (!failed.length) annotate('notice', `${results.length} responsive layout checks passed`)
  return failed.length === 0
}

const timeout = setTimeout(() => {
  log(`watchdog fired during phase '${phase}'`)
  finish(`aborted after 170s (watchdog) during '${phase}'`)
  app.exit(1)
}, 170000)
app.on('browser-window-created', (_, win) => {
  win.webContents.setBackgroundThrottling(false)
  // Test layout with deterministic local records; remote service availability is unrelated.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
  const initialized = new Promise(resolve => global.rain.event_app.once('main_window_inited', resolve))
  win.webContents.once('did-finish-load', async() => {
    if (!win.webContents.getURL().includes('index.html')) return
    const evaluate = code => win.webContents.executeJavaScript(code)
    const measure = () => evaluate('({width:innerWidth,height:innerHeight})')
    const nextFrames = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const screenshot = async name => {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(win.getContentSize()[0]/2), y: 50 })
      await wait(160)
      fs.writeFileSync(path.join(evidence, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    }
    // The renderer re-applies its own window-size preference at startup
    // (src/renderer/main.ts) and a hosted runner settles slower, so wait for the
    // viewport that will actually be measured. If the request is not honoured,
    // measure what is there instead of silently asserting against the request.
    const setViewport = async (width, height) => {
      win.setContentSize(width, height)
      const honored = await waitFor(`viewport ${width}x${height}`, async() => {
        const size = await measure()
        return size.width === width && size.height === height ? size : false
      }, { timeout: 2500 })
      const actual = honored || await measure()
      if (!honored) log(`viewport request ${width}x${height} not honoured, measuring ${actual.width}x${actual.height} instead`)
      return actual
    }
    try {
      await initialized
      await require('./dismiss-audio-notice.cjs')(evaluate)
      // Environment snapshot: the first thing to read when a check fails only on
      // CI. Kept as an always-passing entry so results.json carries it too, and
      // wrapped so a probe failure can never take the suite down.
      const displays = screen.getAllDisplays().map(display => ({ bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor }))
      let environment
      try {
        environment = await evaluate(`(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='16px sans-serif';const probe=ctx.measureText('雾与晨光 · 轻音乐精选').width;let fonts=[];try{fonts=[...new Set([...document.fonts].map(f=>f.family))].slice(0,20)}catch(e){}return {dpr:devicePixelRatio,ua:navigator.userAgent,view:innerWidth+'x'+innerHeight,rootFont:getComputedStyle(document.documentElement).fontSize,cjkProbeWidth:Math.round(probe*100)/100,fonts}})()`)
      } catch (error) {
        environment = { error: String((error && error.message) || error) }
      }
      const snapshot = { ...environment, display: screen.getPrimaryDisplay().bounds, workArea: screen.getPrimaryDisplay().workAreaSize, displays, platform: process.platform, versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node } }
      log(`environment ${JSON.stringify(snapshot)}`)
      annotate('notice', `env ${inline(snapshot)}`)
      check('environment (informational)', true, snapshot)
      await evaluate(`window.findVue=function find(v,p){if(!v)return;if(v.component&&p(v.component))return v.component;const sub=find(v.component?.subTree,p);if(sub)return sub;for(const child of Array.isArray(v.children)?v.children:[]){const c=find(child,p);if(c)return c;}};void 0`)
      await evaluate(`window.qaRows=Array.from({length:60},(_,i)=>({id:'online-row-'+i,source:'tx',name:'雾与晨光 · 轻音乐精选 '+(i+1),singer:'Rain Music',interval:'03:20',meta:{albumName:'日常聆听 · 适配验证',songId:'online-row-'+i,picUrl:'',qualitys:[],_qualitys:{}}}));window.installOnlineRows=()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList');if(!c)return false;Object.assign(c.props,{list:qaRows,noItem:'',total:60,page:1,limit:60});return true;};void 0`)
      await evaluate(`Object.assign(window.rainData.musicInfo,{id:'responsive-fixture',name:'雾与晨光',singer:'Rain Music',album:'日常聆听'});const bar=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar');bar.proxy.maxPlayTime=240;bar.proxy.nowPlayTime=69;bar.proxy.progress=69/240;bar.proxy.nowPlayTimeStr='01:09';bar.proxy.maxPlayTimeStr='04:00';void 0`)
      await evaluate(`(()=>{const ipc=require('electron').ipcRenderer,invoke=ipc.invoke.bind(ipc);ipc.invoke=(channel,...args)=>channel==='winMain_download_list_get'?Promise.resolve(qaRows.map((musicInfo,i)=>({id:'download-'+i,status:'pause',statusText:'已暂停',progress:46,isComplote:false,speed:'',metadata:{musicInfo,quality:'320k',fileName:'qa-'+i}}))):invoke(channel,...args);})()`)
      await evaluate(`window.setPlaylistFixture=()=>{const c=findVue(document.querySelector('#root')._vnode,c=>!!c.props.listInfo);if(!c)return false;const info=c.props.listInfo;Object.assign(info,{noItemLabel:'',total:24,page:1,limit:24});info.list=Array.from({length:24},(_,i)=>({id:'fixture-'+i,source:'tx',name:['雨天的安静时光','落日与晚风','沿途的风景','专注工作 · 轻音乐'][i%4],author:'Rain Music',time:'2026-10-07',total:'36',play_count:'12.6万',img:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="'+['#778d82','#b3957e','#6e8596','#8b8193'][i%4]+'"/><circle cx="300" cy="110" r="60" fill="#efe7d4"/><path d="M0 330L140 160L280 340L400 220V400H0Z" fill="#354b49"/><path d="M0 370L170 270L350 400H0Z" fill="#283b3c"/></svg>')}));return true};void 0`)
      const routes = [['playlists', '/songList/list?source=tx'], ['search', '/search?source=tx&type=music&text=雾'], ['leaderboard', '/leaderboard?source=tx'], ['library', '/list'], ['settings', '/setting'], ['downloads', '/download'], ['playlist-detail', '/songList/detail?source=tx&id=qa-list']]
      for (const [width, height] of [[828,540], [1080,720], [1440,900], [1920,1080], [1920,1280], [2560,1080]]) {
        phase = `viewport ${width}x${height}`
        const actual = await setViewport(width, height)
        for (const [name, route] of routes) {
          phase = `${width}x${height} ${name}`
          await evaluate(`location.hash=${JSON.stringify('#'+route)};void 0`)
          await wait(300)
          if (name === 'playlists') {
            // The route chunk is loaded lazily, so give the view time to mount
            // before asking it for its records.
            const installed = await waitFor(`${name} fixture`, () => evaluate('setPlaylistFixture()'), { timeout: 5000 })
            check(`${width} playlist fixture loaded`, installed, { viewport: `${actual.width}x${actual.height}` })
            await waitFor(`${name} cards`, async() => (await evaluate(`document.querySelectorAll('#view li[data-glass]').length`)) >= 24, { timeout: 3000 })
          }
          if (['search', 'leaderboard', 'playlist-detail'].includes(name)) {
            // Do not replace pending provider results: a later completion would
            // erase the local records and turn this layout check into network QA.
            const settled = await waitFor(`${name} provider settled`, () => evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList');return !!c&&c.props.noItem!==window.i18n.t('list__loading');})()`), { timeout: 5000 })
            if (!settled) throw new Error(`${name} did not finish its initial provider request`)
            check(`${width} ${name} populated fixture loaded`, await evaluate('installOnlineRows()'))
            await waitFor(`${name} rows`, async() => (await evaluate(`document.querySelectorAll('#view .list-item').length`)) > 0, { timeout: 3000 })
            const rowFit = await waitStable(() => evaluate(`(()=>{const view=document.querySelector('#view').getBoundingClientRect(),a=[...document.querySelectorAll('#view .list-item')].map(e=>e.getBoundingClientRect());return {count:a.length,outside:Math.max(a.length?view.left-Math.min(...a.map(r=>r.left)):Infinity,a.length?Math.max(...a.map(r=>r.right))-(view.right+1):Infinity),gapMax:a.slice(0,-1).reduce((m,r,i)=>Math.max(m,Math.abs(a[i+1].top-r.bottom)),0)};})()`))
            check(`${width} ${name} song rows fit and stay evenly spaced`, rowFit.count>3 && rowFit.outside<=0 && rowFit.gapMax<1, { ...rowFit, outside: Number.isFinite(rowFit.outside) ? Math.round(rowFit.outside*100)/100 : null })
          }
          if (name === 'library') {
            // Readiness only: the local list is installed below and its geometry
            // is asserted by the shell checks, so this just waits for the view
            // container to have rendered something.
            await waitFor(`${name} view`, async() => (await evaluate(`document.querySelector('#view')?.childElementCount`)) > 0, { timeout: 5000 })
            await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');if(c)c.proxy.list=Array.from({length:60},(_,i)=>({id:'row-'+i,source:'local',name:'雾与晨光 · '+(i+1),singer:'Rain Music',interval:'03:20',meta:{albumName:'日常聆听',songId:'row-'+i,filePath:''}}));})()`)
            await waitFor(`${name} rows`, async() => (await evaluate(`document.querySelectorAll('#view .list-item').length`)) > 0, { timeout: 3000 })
          }
          if (name === 'downloads') {
            const downloaded = await waitFor(`${name} list`, () => evaluate(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='Download')?.proxy.list.length===60`), { timeout: 5000 })
            check(`${width} downloads populated fixture loaded`, downloaded)
          }
          const geometry = await waitStable(() => evaluate(`(()=>{const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON(), view=document.querySelector('#view');if(!view)return null;const controls=[...document.querySelectorAll('#player button')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);return {width:innerWidth,height:innerHeight,font:parseFloat(getComputedStyle(document.documentElement).fontSize),view:rect('#view'),player:rect('#player'),rootOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,contentOverflow:view.scrollWidth>view.clientWidth+1,controlsFit:controls.every(r=>r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1),overlap:controls.some((r,i)=>controls.slice(i+1).some(s=>Math.min(r.right,s.right)-Math.max(r.left,s.left)>1&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>1))};})()`))
          check(`${width}x${height} ${name} shell and controls fit`, !!geometry && !geometry.rootOverflow && !geometry.contentOverflow && geometry.controlsFit && !geometry.overlap && geometry.view.bottom <= geometry.player.top+1, { ...geometry, requested: `${width}x${height}`, viewport: `${actual.width}x${actual.height}` })
          if (name === 'playlists') {
            // Scope to the playlist grid itself. `#view li[data-glass]` is not a
            // unique selector — the search view mounts the same SongList
            // component (src/renderer/views/Search/SongListList), and a route
            // transition can briefly leave a second list in #view. Counting the
            // largest group keeps the assertion about the fixture's grid (24
            // records, bounded square covers, adaptive columns) instead of about
            // whatever else happens to be in the DOM; `groups` records the rest
            // so a genuine regression is still visible in the failure detail.
            const cards = await waitStable(() => evaluate(`(()=>{const groups=[...document.querySelectorAll('#view ul')].map(u=>({u,items:[...u.querySelectorAll(':scope > li[data-glass]')]}));const grid=groups.reduce((best,g)=>g.items.length>(best?best.items.length:0)?g:best,null);const a=(grid?grid.items:[]).map(e=>e.getBoundingClientRect());const info=findVue(document.querySelector('#root')._vnode,c=>!!c.props.listInfo);return {count:a.length,width:a[0]?.width,columns:a.length?a.filter(r=>Math.abs(r.top-a[0].top)<2).length:0,square:a.length>0&&[...(grid?grid.u:document).querySelectorAll('img')].slice(0,6).every(e=>Math.abs(e.clientWidth-e.clientHeight)<2),groups:groups.map(g=>g.items.length),fixtureItems:info?.props.listInfo.list.length};})()`))
            // The column floor is a property of the width actually measured, not
            // of the request: CSS px are what the grid sees.
            const expectedColumns = actual.width >= 1440 ? 4 : 2
            check(`${width} playlists use bounded covers and adaptive columns`, cards.count===24 && cards.width<=310 && cards.width>=150 && cards.square && cards.columns >= expectedColumns, { ...cards, expectedColumns, viewport: actual.width })
          }
          if (name === 'settings') {
            const themes = await waitStable(() => evaluate(`(()=>{const a=[...document.querySelectorAll('#settings-themes button')].map(e=>e.getBoundingClientRect());const section=document.querySelector('[data-settings-scroll]');if(!section)return null;return {count:a.length,oneRow:a.length===5&&a.every(r=>Math.abs(r.top-a[0].top)<1),fit:a.every(r=>r.left>=section.getBoundingClientRect().left&&r.right<=section.getBoundingClientRect().right),horizontalScroll:section.scrollWidth>section.clientWidth};})()`))
            check(`${width} all five theme presets are visible on one row`, !!themes&&themes.oneRow&&themes.fit&&!themes.horizontalScroll, themes)
          }
          const scrollFit = await evaluate(`(()=>{const a=[...document.querySelectorAll('#view .scroll')].filter(e=>e.clientWidth&&e.clientHeight);return a.every(e=>e.scrollWidth<=e.clientWidth+1);})()`)
          check(`${width} ${name} scroll areas have no horizontal overflow`, scrollFit)
          if (['library','leaderboard'].includes(name)&&actual.width>=1440) check(`${width} ${name} secondary sidebar has a bounded width`,await evaluate(`(()=>{const e=document.querySelector('#view>.view-container')||document.querySelector('#view>div');const sidebar=e?.firstElementChild;return sidebar&&sidebar.getBoundingClientRect().width<=225.1;})()`))
          if ([828,1440,1920].includes(width)&&height!==1280) await screenshot(`${name}-${width}x${height}`)
        }
      }
      phase = 'native fullscreen'
      await evaluate(`location.hash='#/songList/list?source=tx';void 0`); await wait(300)
      // Install once (never poll a mutating fixture); readiness is only that the
      // route rendered something.
      await waitFor('final playlist view', async() => (await evaluate(`document.querySelector('#view')?.childElementCount`)) > 0, { timeout: 5000 })
      await evaluate('setPlaylistFixture()')
      await setViewport(1080, 720)
      await evaluate(`document.querySelectorAll('[data-native-window-control]')[2].click();void 0`)
      // The app resolves the native transition through its own deadline
      // (src/main/modules/winMain/main.ts), so a fixed 550ms wait could measure
      // the window mid-transition on a slow runner.
      await waitFor('entered fullscreen', () => win.isFullScreen(), { timeout: 8000 })
      const fullscreenBounds = win.getBounds(), displayBounds = screen.getDisplayMatching(fullscreenBounds).bounds
      check('green traffic light fills the native display',win.isFullScreen()&&Math.abs(fullscreenBounds.width-displayBounds.width)<=2&&Math.abs(fullscreenBounds.height-displayBounds.height)<=2,{fullscreenBounds,displayBounds,displays})
      // Readiness for the next check is that the renderer processed the
      // fullscreen resize — not the font or control state it asserts.
      await waitFor('fullscreen viewport', async() => Math.abs((await measure()).width - displayBounds.width) <= 2, { timeout: 5000 })
      const fullscreenState = await evaluate(`(()=>{const s=getComputedStyle(document.documentElement).fontSize;return {width:innerWidth,height:innerHeight,font:s,fontOk:parseFloat(s)===16,buttons:[...document.querySelectorAll('[data-native-window-control]')].map(e=>e.getAttribute('aria-label'))}})()`)
      check('native fullscreen preserves user font and traffic lights', fullscreenState.fontOk&&fullscreenState.buttons.length===3, fullscreenState)
      await screenshot('playlists-native-fullscreen')
      await evaluate(`window.rainData.updateSetting({'common.fontSize':17});void 0`)
      // The setting round-trips through IPC. Wait for the stored value (the real
      // source of uncertainty), then assert the applied CSS separately.
      const stored = await waitFor('font preference stored', () => evaluate(`window.rainData.appSetting['common.fontSize']===17`), { timeout: 5000 })
      await nextFrames()
      const appliedFont = await evaluate(`getComputedStyle(document.documentElement).fontSize`)
      check('font preference applies in native fullscreen', stored && appliedFont==='17px', { stored, appliedFont, rootFontSetting: await evaluate(`window.rainData.appSetting['common.fontSize']`) })
      await evaluate(`document.querySelectorAll('[data-native-window-control]')[2].click();void 0`)
      await waitFor('left fullscreen', () => !win.isFullScreen(), { timeout: 8000 })
      check('green traffic light restores windowed mode',!win.isFullScreen())
      phase = 'virtual rows'
      await evaluate(`location.hash='#/list';void 0`); await wait(300)
      // Readiness is only "the /list view rendered something", so the MusicList
      // lookup below still has to succeed on its own.
      await waitFor('list view mounted', async() => (await evaluate(`document.querySelector('#view')?.childElementCount`)) > 0, { timeout: 5000 })
      check('virtual song rows match the selected root font', await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');if(!c)return false;c.proxy.list=Array.from({length:60},(_,i)=>({id:'final-'+i,source:'local',name:'检查行高',singer:'Rain Music',interval:'03:20',meta:{albumName:'适配检查',songId:'final-'+i,filePath:''}}));return true;})()`))
      await waitFor('virtual rows rendered', async() => (await evaluate(`document.querySelectorAll('#view .list-item').length`)) > 0, { timeout: 4000 })
      const rows = await waitStable(() => evaluate(`(()=>{const a=[...document.querySelectorAll('#view .list-item')].map(e=>e.getBoundingClientRect());return {count:a.length,height:a[0]?.height,gapMax:a.slice(0,-1).reduce((m,r,i)=>Math.max(m,Math.abs(a[i+1].top-r.bottom)),0)}})()`))
      // Row height follows the selected root font. Derive the expectation from
      // the font actually in effect instead of a hardcoded 17px, so the check
      // still proves "rows track the user's font" — the formula is the app's own
      // (src/renderer/views/List/MusicList/useList.js).
      const rootFont = parseFloat(await evaluate(`getComputedStyle(document.documentElement).fontSize`))
      const expectedRowHeight = Math.ceil(rootFont * 2.3)
      check('virtual rows remain evenly spaced', rows.count>3 && rows.gapMax<1 && Math.abs(rows.height-expectedRowHeight)<1, { ...rows, rootFont, expectedRowHeight })
      phase = 'done'
      app.exit(finish('completed') ? 0 : 1)
    } catch (error) {
      console.error(error)
      finish(`aborted during '${phase}'`, error)
      app.exit(1)
    }
  })
})
require(path.join(root, 'dist/main.js'))
