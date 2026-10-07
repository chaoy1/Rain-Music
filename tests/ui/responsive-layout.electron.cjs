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
const results = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (test, pass, detail) => { results.push({ test, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${test} ${JSON.stringify(detail ?? '')}`) }
const timeout = setTimeout(() => app.exit(1), 85000)
app.on('browser-window-created', (_, win) => {
  win.webContents.setBackgroundThrottling(false)
  // Test layout with deterministic local records; remote service availability is unrelated.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
  const initialized = new Promise(resolve => global.rain.event_app.once('main_window_inited', resolve))
  win.webContents.once('did-finish-load', async() => {
    if (!win.webContents.getURL().includes('index.html')) return
    const evaluate = code => win.webContents.executeJavaScript(code)
    const screenshot = async name => {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(win.getContentSize()[0]/2), y: 50 })
      await wait(160)
      fs.writeFileSync(path.join(evidence, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    }
    try {
      await initialized
      await require('./dismiss-audio-notice.cjs')(evaluate)
      await evaluate(`window.findVue=function find(v,p){if(!v)return;if(v.component&&p(v.component))return v.component;const sub=find(v.component?.subTree,p);if(sub)return sub;for(const child of Array.isArray(v.children)?v.children:[]){const c=find(child,p);if(c)return c;}};void 0`)
      await evaluate(`window.qaRows=Array.from({length:60},(_,i)=>({id:'online-row-'+i,source:'tx',name:'雾与晨光 · 轻音乐精选 '+(i+1),singer:'Rain Music',interval:'03:20',meta:{albumName:'日常聆听 · 适配验证',songId:'online-row-'+i,picUrl:'',qualitys:[],_qualitys:{}}}));window.installOnlineRows=()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList');if(!c)return false;Object.assign(c.props,{list:qaRows,noItem:'',total:60,page:1,limit:60});return true;};void 0`)
      await evaluate(`Object.assign(window.rainData.musicInfo,{id:'responsive-fixture',name:'雾与晨光',singer:'Rain Music',album:'日常聆听'});const bar=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar');bar.proxy.maxPlayTime=240;bar.proxy.nowPlayTime=69;bar.proxy.progress=69/240;bar.proxy.nowPlayTimeStr='01:09';bar.proxy.maxPlayTimeStr='04:00';void 0`)
      await evaluate(`(()=>{const ipc=require('electron').ipcRenderer,invoke=ipc.invoke.bind(ipc);ipc.invoke=(channel,...args)=>channel==='winMain_download_list_get'?Promise.resolve(qaRows.map((musicInfo,i)=>({id:'download-'+i,status:'pause',statusText:'已暂停',progress:46,isComplate:false,speed:'',metadata:{musicInfo,quality:'320k',fileName:'qa-'+i}}))):invoke(channel,...args);})()`)
      const routes = [['playlists', '/songList/list?source=tx'], ['search', '/search?source=tx&type=music&text=雾'], ['leaderboard', '/leaderboard?source=tx'], ['library', '/list'], ['settings', '/setting'], ['downloads', '/download'], ['playlist-detail', '/songList/detail?source=tx&id=qa-list']]
      for (const [width, height] of [[828,540], [1080,720], [1440,900], [1920,1080], [1920,1280], [2560,1080]]) {
        win.setContentSize(width, height)
        await wait(180)
        for (const [name, route] of routes) {
          await evaluate(`location.hash=${JSON.stringify('#'+route)};void 0`)
          await wait(300)
          if (name === 'playlists') {
            check(`${width} playlist fixture loaded`, await evaluate(`(window.setPlaylistFixture=()=>{const c=findVue(document.querySelector('#root')._vnode,c=>!!c.props.listInfo);if(!c)return false;const info=c.props.listInfo;Object.assign(info,{noItemLabel:'',total:24,page:1,limit:24});info.list=Array.from({length:24},(_,i)=>({id:'fixture-'+i,source:'tx',name:['雨天的安静时光','落日与晚风','沿途的风景','专注工作 · 轻音乐'][i%4],author:'Rain Music',time:'2026-10-07',total:'36',play_count:'12.6万',img:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="'+['#778d82','#b3957e','#6e8596','#8b8193'][i%4]+'"/><circle cx="300" cy="110" r="60" fill="#efe7d4"/><path d="M0 330L140 160L280 340L400 220V400H0Z" fill="#354b49"/><path d="M0 370L170 270L350 400H0Z" fill="#283b3c"/></svg>')}));return true;})()`))
            await wait(100)
          }
          if (['search', 'leaderboard', 'playlist-detail'].includes(name)) {
            // Do not replace pending provider results: a later completion would
            // erase the local records and turn this layout check into network QA.
            let settled = false
            for (let attempt = 0; attempt < 100; attempt++) {
              settled = await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList');return !!c&&c.props.noItem!==window.i18n.t('list__loading');})()`)
              if (settled) break
              await wait(50)
            }
            if (!settled) throw new Error(`${name} did not finish its initial provider request`)
            check(`${width} ${name} populated fixture loaded`, await evaluate('installOnlineRows()'))
            await wait(100)
            check(`${width} ${name} song rows fit and stay evenly spaced`, await evaluate(`(()=>{const view=document.querySelector('#view').getBoundingClientRect(),a=[...document.querySelectorAll('#view .list-item')].map(e=>e.getBoundingClientRect());return a.length>3&&a.every(r=>r.left>=view.left&&r.right<=view.right+1)&&a.slice(0,-1).every((r,i)=>Math.abs(a[i+1].top-r.bottom)<1);})()`))
          }
          if (name === 'library') {
            await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');if(c)c.proxy.list=Array.from({length:60},(_,i)=>({id:'row-'+i,source:'local',name:'雾与晨光 · '+(i+1),singer:'Rain Music',interval:'03:20',meta:{albumName:'日常聆听',songId:'row-'+i,filePath:''}}));})()`)
            await wait(100)
          }
          if (name === 'downloads') {
            check(`${width} downloads populated fixture loaded`,await evaluate(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='Download')?.proxy.list.length===60`))
          }
          const geometry = await evaluate(`(()=>{const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON(), view=document.querySelector('#view'),controls=[...document.querySelectorAll('#player button')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);return {width:innerWidth,height:innerHeight,font:parseFloat(getComputedStyle(document.documentElement).fontSize),view:rect('#view'),player:rect('#player'),rootOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,contentOverflow:view.scrollWidth>view.clientWidth+1,controlsFit:controls.every(r=>r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1),overlap:controls.some((r,i)=>controls.slice(i+1).some(s=>Math.min(r.right,s.right)-Math.max(r.left,s.left)>1&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>1))};})()`)
          check(`${width}x${height} ${name} shell and controls fit`, !geometry.rootOverflow && !geometry.contentOverflow && geometry.controlsFit && !geometry.overlap && geometry.view.bottom <= geometry.player.top+1, geometry)
          if (name === 'playlists') {
            const cards = await evaluate(`(()=>{const a=[...document.querySelectorAll('#view li[data-glass]')].map(e=>e.getBoundingClientRect());return {count:a.length,width:a[0]?.width,columns:a.filter(r=>Math.abs(r.top-a[0].top)<2).length,square:[...document.querySelectorAll('#view li[data-glass] img')].slice(0,6).every(e=>Math.abs(e.clientWidth-e.clientHeight)<2)};})()`)
            check(`${width} playlists use bounded covers and adaptive columns`, cards.count===24 && cards.width<=310 && cards.width>=150 && cards.square && cards.columns >= (width>=1440 ? 4 : 2), cards)
          }
          if (name === 'settings') {
            const themes = await evaluate(`(()=>{const a=[...document.querySelectorAll('#settings-themes button')].map(e=>e.getBoundingClientRect());const section=document.querySelector('[data-settings-scroll]');return {count:a.length,oneRow:a.length===5&&a.every(r=>Math.abs(r.top-a[0].top)<1),fit:a.every(r=>r.left>=section.getBoundingClientRect().left&&r.right<=section.getBoundingClientRect().right),horizontalScroll:section.scrollWidth>section.clientWidth};})()`)
            check(`${width} all five theme presets are visible on one row`, themes.oneRow&&themes.fit&&!themes.horizontalScroll, themes)
          }
          const scrollFit = await evaluate(`(()=>{const a=[...document.querySelectorAll('#view .scroll')].filter(e=>e.clientWidth&&e.clientHeight);return a.every(e=>e.scrollWidth<=e.clientWidth+1);})()`)
          check(`${width} ${name} scroll areas have no horizontal overflow`, scrollFit)
          if (['library','leaderboard'].includes(name)&&width>=1440) check(`${width} ${name} secondary sidebar has a bounded width`,await evaluate(`(()=>{const e=document.querySelector('#view>.view-container')||document.querySelector('#view>div');const sidebar=e?.firstElementChild;return sidebar&&sidebar.getBoundingClientRect().width<=225.1;})()`))
          if ([828,1440,1920].includes(width)&&height!==1280) await screenshot(`${name}-${width}x${height}`)
        }
      }
      await evaluate(`location.hash='#/songList/list?source=tx';void 0`); await wait(300)
      await evaluate('setPlaylistFixture()'); await wait(100)
      win.setContentSize(1080,720); await wait(200)
      await evaluate(`document.querySelectorAll('[data-native-window-control]')[2].click();void 0`); await wait(550)
      const fullscreenBounds = win.getBounds(), displayBounds = screen.getDisplayMatching(fullscreenBounds).bounds
      check('green traffic light fills the native display',win.isFullScreen()&&Math.abs(fullscreenBounds.width-displayBounds.width)<=2&&Math.abs(fullscreenBounds.height-displayBounds.height)<=2,{fullscreenBounds,displayBounds})
      check('native fullscreen preserves user font and traffic lights', await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)===16&&document.querySelectorAll('[data-native-window-control]').length===3`), await evaluate(`({width:innerWidth,height:innerHeight,font:getComputedStyle(document.documentElement).fontSize,buttons:[...document.querySelectorAll('[data-native-window-control]')].map(e=>e.getAttribute('aria-label'))})`))
      await screenshot('playlists-native-fullscreen')
      await evaluate(`window.rainData.updateSetting({'common.fontSize':17});void 0`); await wait(200)
      check('font preference applies in native fullscreen', await evaluate(`getComputedStyle(document.documentElement).fontSize==='17px'`))
      await evaluate(`document.querySelectorAll('[data-native-window-control]')[2].click();void 0`); await wait(400)
      check('green traffic light restores windowed mode',!win.isFullScreen())
      await evaluate(`location.hash='#/list';void 0`); await wait(300)
      check('virtual song rows match the selected root font', await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');if(!c)return false;c.proxy.list=Array.from({length:60},(_,i)=>({id:'final-'+i,source:'local',name:'检查行高',singer:'Rain Music',interval:'03:20',meta:{albumName:'适配检查',songId:'final-'+i,filePath:''}}));return true;})()`))
      await wait(100)
      check('virtual rows remain evenly spaced', await evaluate(`(()=>{const a=[...document.querySelectorAll('#view .list-item')].map(e=>e.getBoundingClientRect());return a.length>3&&a.slice(0,-1).every((r,i)=>Math.abs(a[i+1].top-r.bottom)<1)&&Math.abs(a[0].height-Math.ceil(17*2.3))<1;})()`))
      clearTimeout(timeout)
      fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
      app.exit(results.every(r=>r.pass)?0:1)
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1) }
  })
})
require(path.join(root, 'dist/main.js'))
