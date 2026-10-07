const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const evidence = path.join(root,'.design')
process.env.RAIN_DATA_DIR=path.join(evidence,'detail-test-portable')
fs.mkdirSync(path.join(process.env.RAIN_DATA_DIR,'userData/RainDatas'),{recursive:true})
fs.writeFileSync(path.join(process.env.RAIN_DATA_DIR,'userData/RainDatas/config_v2.json'),JSON.stringify({version:'2.12.6',setting:{version:'2.12.8','theme.id':'mono','common.fontSize':16,'common.windowSizeId':2,'common.langId':'zh-cn','common.isAgreePact':true,'download.enable':true}}))
// `common.isShowAnimation` 设置项已删除，应用只尊重系统的 prefers-reduced-motion。
// 这个命令行开关把系统偏好固定为「减少动态效果」：过渡瞬时完成，时序稳定，
// 相当于旧测试里默认的 isShowAnimation:false。需要观察动画中间态的段落
// 再用 CDP 的 Emulation.setEmulatedMedia 覆写成 no-preference。
app.commandLine.appendSwitch('force-prefers-reduced-motion')
const results=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const check=(test,pass,detail)=>{results.push({test,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${test} ${JSON.stringify(detail??'')}`)}
const evaluate=(win,code)=>win.webContents.executeJavaScript(code)
const finish=()=>{fs.writeFileSync(path.join(evidence,'song-detail-results.json'),JSON.stringify(results,null,2));app.exit(results.every(r=>r.pass)?0:1)}
const timeout=setTimeout(()=>app.exit(1),60000)
app.on('browser-window-created',(_,win)=>{
  win.webContents.setBackgroundThrottling(false)
  // 旧测试用 common.isShowAnimation 切换瞬时/动画两种时序，现在改为切换
  // 页面可见的 prefers-reduced-motion 媒体特性（产品里 motionEnabled() 只认它）。
  const setMotion=reduce=>win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduce?'reduce':'no-preference'}]})
  const initialized=new Promise(resolve=>global.rain.event_app.once('main_window_inited',resolve))
  win.webContents.on('did-finish-load',async()=>{
  if(!win.webContents.getURL().includes('index.html'))return
  try{
    await initialized
    // Native pointer capture and Tab navigation need a foreground test window.
    // Keep this isolated QA window above the concurrently running desktop app.
    win.setAlwaysOnTop(true)
    win.show()
    win.focus()
    await wait(200)
    await wait(300)
    win.webContents.debugger.attach('1.3')
    await setMotion(true);await wait(250)
    await evaluate(win, `window.findVue=function find(v,p){if(!v)return;if(v.component&&p(v.component))return v.component;const sub=find(v.component?.subTree,p);if(sub)return sub;for(const child of Array.isArray(v.children)?v.children:[]){const c=find(child,p);if(c)return c;}};void 0`)
    const route=await evaluate(win,`location.hash`)
    const footerVolume=await evaluate(win,`!!document.querySelector('#player [data-footer-volume] input[type=range]')`)
    check('normal bottom bar provides a directly adjustable volume slider',footerVolume)
    check('volume track is hidden while idle',await evaluate(win,`(()=>{const e=document.querySelector('[data-footer-volume] input');return !e||getComputedStyle(e).visibility==='hidden';})()`))
    const volumeTrigger=await evaluate(win,`!!document.querySelector('[data-volume-trigger]')`)
    if(volumeTrigger){await evaluate(win,`document.querySelector('[data-volume-trigger]').click();void 0`);await wait(220)}
    if(footerVolume&&volumeTrigger){
    await evaluate(win,`document.querySelector('[data-footer-volume] input').value='0.37';document.querySelector('[data-footer-volume] input').dispatchEvent(new Event('input',{bubbles:true}));void 0`);await wait(650)
    check('visible volume slider updates the real player setting',await evaluate(win,`Math.abs(window.rainData.appSetting['player.volume']-.37)<.001`))
    const sliderRect=await evaluate(win,`document.querySelector('[data-footer-volume] input').getBoundingClientRect().toJSON()`)
    const startX=Math.round(sliderRect.left+sliderRect.width*.37),endX=Math.round(sliderRect.left+sliderRect.width*.7),sliderY=Math.round(sliderRect.top+sliderRect.height/2)
    win.webContents.sendInputEvent({type:'mouseMove',x:startX,y:sliderY});win.webContents.sendInputEvent({type:'mouseDown',x:startX,y:sliderY,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:endX,y:sliderY});win.webContents.sendInputEvent({type:'mouseMove',x:endX,y:sliderY-130});await wait(600)
    check('volume remains open while dragging outside its panel',await evaluate(win,`document.querySelector('[data-volume-panel]').getAttribute('aria-hidden')==='false'`))
    win.webContents.sendInputEvent({type:'mouseUp',x:endX,y:sliderY-130,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:400,y:120});await wait(700)
    check('volume can settle closed after releasing an outside drag',await evaluate(win,`document.querySelector('[data-volume-panel]').getAttribute('aria-hidden')==='true'`))
    await evaluate(win,`document.querySelector('[data-volume-trigger]').click();void 0`);await wait(200)
    check('volume can be dragged through a generous native hit area',await evaluate(win,`window.rainData.appSetting['player.volume']>.6&&window.rainData.appSetting['player.volume']<.8&&document.querySelector('[data-footer-volume] input').getBoundingClientRect().height>=24`))
    await evaluate(win,`document.querySelector('[data-volume-mute]').click();void 0`);await wait(120)
    check('expanded volume panel provides immediate mute',await evaluate(win,`document.querySelector('[data-volume-mute]').getAttribute('aria-pressed')==='true'`))
    await evaluate(win,`document.querySelector('[data-footer-volume] input').value='0.43';document.querySelector('[data-footer-volume] input').dispatchEvent(new Event('input',{bubbles:true}));void 0`);await wait(650)
    check('adjusting the slider restores audible volume after mute',await evaluate(win,`document.querySelector('[data-volume-mute]').getAttribute('aria-pressed')==='false'&&Math.abs(window.rainData.appSetting['player.volume']-.43)<.001`))
    await evaluate(win,`document.querySelector('[data-volume-trigger]').focus();document.querySelector('[data-volume-trigger]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0`);await wait(250)
    check('Escape dismisses the volume panel',await evaluate(win,`document.querySelector('[data-volume-trigger]').getAttribute('aria-expanded')==='false'`))
    win.focus();await wait(100)
    await evaluate(win,`document.querySelector('[data-volume-trigger]').blur();document.querySelector('[data-volume-trigger]').focus();void 0`);await wait(120)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await wait(100);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await wait(80)
    check('keyboard can reach the expanded volume slider',await evaluate(win,`document.activeElement===document.querySelector('[data-footer-volume] input')`),await evaluate(win,`({windowFocused:document.hasFocus(),active:document.activeElement.outerHTML.slice(0,250),expanded:document.querySelector('[data-volume-trigger]').getAttribute('aria-expanded'),panelHidden:document.querySelector('[data-volume-panel]').getAttribute('aria-hidden')})`))
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await wait(650)
    check('keyboard volume adjustment uses fine one-percent steps',await evaluate(win,`Math.abs(window.rainData.appSetting['player.volume']-.44)<.001`))
    await evaluate(win,`document.querySelector('[data-volume-trigger]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0`);await wait(200)

    const triggerRect=await evaluate(win,`document.querySelector('[data-volume-trigger]').getBoundingClientRect().toJSON()`)
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(triggerRect.left+triggerRect.width/2),y:Math.round(triggerRect.top+triggerRect.height/2)});await wait(250)
    check('pointer hover reveals volume without a click',await evaluate(win,`document.querySelector('[data-volume-trigger]').getAttribute('aria-expanded')==='true'`))
    const panelRect=await evaluate(win,`document.querySelector('[data-volume-panel]').getBoundingClientRect().toJSON()`)
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(panelRect.left+30),y:Math.round(panelRect.top+30)});await wait(250)
    check('volume panel is reachable above the footer without clipping',await evaluate(win,`(()=>{const e=document.querySelector('[data-volume-panel]'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+30,r.top+30))&&e.getAttribute('aria-hidden')==='false';})()`))
    win.webContents.sendInputEvent({type:'mouseMove',x:400,y:120});await wait(700)
    check('volume hides after leaving its interaction area',await evaluate(win,`document.querySelector('[data-volume-panel]').getAttribute('aria-hidden')==='true'&&document.querySelector('[data-volume-panel]').inert`))


    }

    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`)
    await wait(300)
    const opened=await evaluate(win,`!!document.querySelector('[data-song-detail]')`)
    check('bottom cover restores access to song details',opened)
    check('cover is a keyboard accessible button',await evaluate(win,`document.querySelector('[data-player-cover]').tagName==='BUTTON'`))
    if(!opened){clearTimeout(timeout);finish();return}
    check('empty player has a useful detail empty state',await evaluate(win,`document.querySelector('[data-song-detail]').textContent.includes('还没有正在播放的歌曲')`))
    await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,'detail-empty.png'),img.toPNG()))
    check('details fill the window and hide normal chrome',await evaluate(win,`(()=>{const d=document.querySelector('[data-song-detail]').getBoundingClientRect();return location.hash===${JSON.stringify(route)}&&d.left<2&&d.top<2&&Math.abs(d.right-innerWidth)<2&&Math.abs(d.bottom-innerHeight)<2&&getComputedStyle(document.querySelector('#player')).visibility==='hidden';})()`))
    const fixture=await evaluate(win,`(()=>{
      const cover='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d2ddd7"/><stop offset="1" stop-color="#f2e6ce"/></linearGradient></defs><rect width="600" height="600" fill="url(#sky)"/><circle cx="420" cy="175" r="56" fill="#f6efd9"/><path d="M0 370 Q150 230 300 380 T600 350 V600 H0" fill="#798c82"/><path d="M0 440 Q180 340 350 460 T600 415 V600 H0" fill="#435e58"/><path d="M0 490 Q250 455 600 530 V600 H0" fill="#bdc9b3"/><text x="48" y="78" fill="#435e58" font-family="serif" font-size="27" letter-spacing="7">MORNING MIST</text></svg>';
      Object.assign(window.rainData.musicInfo,{id:'detail-fixture',name:'雾与晨光',singer:'界面测试',album:'慢一点的时光',pic:'data:image/svg+xml,'+encodeURIComponent(cover)});
      window.rainData.playMusicInfo.musicInfo={id:'detail-fixture',name:'雾与晨光',singer:'界面测试',source:'local'};
      const c=findVue(document.querySelector('#root')._vnode,c=>!!c.proxy?.lyric);if(!c)return false;window.detailLyric=c.proxy.lyric;
      detailLyric.lines=['微光落在窗边','风把远处的声音带来','让这一刻慢一点','沿着安静的街道','听见生活的回响'].map((text,i)=>{const dom=document.createElement('div');dom.className='line-content line-mode'+(i===2?' active':'');dom.innerHTML='<div class="line"><span class="font-lrc">'+text+'</span></div>';return{text,time:i*10000,extendedLyrics:[],dom_line:dom};});detailLyric.line=2;return true;
    })()`)
    await wait(700)
    check('detail displays current metadata and actual lyric nodes',fixture&&await evaluate(win,`document.querySelector('[data-song-detail]').textContent.includes('雾与晨光')&&document.querySelector('[data-song-detail] .lyric .line-content.active')?.textContent.includes('让这一刻慢一点')`))
    // Populate all timeline fields together, as setProgress does in playback.
    // This fixture has no audio file to supply a real duration to the screenshots.
    await evaluate(win,`window.setDetailFixtureProgress=()=>{const p=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar');Object.assign(p.proxy,{maxPlayTime:240,nowPlayTime:141,progress:141/240,nowPlayTimeStr:'02:21',maxPlayTimeStr:'04:00'});};setDetailFixtureProgress();void 0`)
    await evaluate(win,`const status=findVue(document.querySelector('#root')._vnode,c=>typeof c.proxy?.statusText==='string');if(status)status.proxy.statusText='让这一刻慢一点';void 0`);await wait(80)
    check('current lyric is shown only on the right, not repeated beneath metadata',await evaluate(win,`!document.querySelector('[data-detail-reveal]').textContent.includes('让这一刻慢一点')&&document.querySelector('[data-detail-lyrics]').textContent.includes('让这一刻慢一点')`))
    for(const theme of ['mono','mono_dark']){
      await evaluate(win,`window.rainData.updateSetting({'theme.id':'${theme}'});void 0`);await wait(350)
      check(`${theme} detail fills the whole window`,await evaluate(win,`(()=>{const d=document.querySelector('[data-song-detail]').getBoundingClientRect();return d.left<2&&d.top<2&&Math.abs(d.right-innerWidth)<2&&Math.abs(d.bottom-innerHeight)<2&&document.body.scrollWidth<=innerWidth;})()`))
      await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,`detail-${theme}.png`),img.toPNG()))
    }
    for (const [width,height] of [[1080,720],[1920,1280],[2560,1080]]) {
      win.setContentSize(width,height);await wait(400)
      const layout=await evaluate(win,`(()=>{const cover=document.querySelector('[data-detail-cover]').getBoundingClientRect(),meta=document.querySelector('[data-song-detail] h2').parentElement.getBoundingClientRect(),dock=document.querySelector('[data-detail-dock]').getBoundingClientRect(),lyrics=document.querySelector('[data-detail-lyrics]').getBoundingClientRect(),view=document.querySelector('[data-song-detail] .lyric'),ambient=document.querySelector('[data-song-detail] [aria-hidden="true"]');return {width:innerWidth,height:innerHeight,cover:cover.toJSON(),meta:meta.toJSON(),dock:dock.toJSON(),lyrics:lyrics.toJSON(),align:getComputedStyle(view).textAlign,fontSize:parseFloat(getComputedStyle(view).fontSize),ambientOpacity:ambient?Number(getComputedStyle(ambient).opacity):0};})()`)
      check(`${width}x${height} keeps the cover, metadata and dock together`,layout.dock.top-layout.meta.bottom<=40&&Math.abs(layout.cover.width-layout.dock.width)<2,layout)
      check(`${width}x${height} centers lyrics without enlarging them beyond the reading area`,layout.align==='center'&&layout.fontSize<=48&&layout.lyrics.height<=760,layout)
      check(`${width}x${height} provides a visible cover-colored ambient background`,layout.ambientOpacity>=.45,layout)
      if(width===1920)check('large screens enlarge the album cover proportionally',layout.cover.width>=440&&layout.cover.width<=580,layout)
      check(`${width}x${height} keeps the playback group inside the viewport`,layout.cover.top>=52&&layout.dock.bottom<=layout.height-16&&layout.lyrics.right<=layout.width,layout)
      await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,`detail-adaptive-${width}x${height}.png`),img.toPNG()))
    }
    win.setContentSize(1080,720);await wait(300)
    for(const theme of ['mono','mono_dark']){
      await evaluate(win,`window.rainData.updateSetting({'theme.id':'${theme}'});void 0`);await wait(250)
      const colors=await evaluate(win,`(()=>{const active=document.querySelector('[data-song-detail] .lyric .line-content.active .font-lrc'),d=document.querySelector('[data-song-detail]');return {active:getComputedStyle(active).color,ink:getComputedStyle(d).color};})()`)
      check(`${theme} uses bright readable text on the immersive background`,[colors.active,colors.ink].every(color=>Number(color.match(/[0-9.]+/g)[0])>=230),colors)
      const sample=async color=>{
        await evaluate(win,`window.rainData.musicInfo.pic='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/></svg>');void 0`);await wait(180)
        const pixel=(await win.webContents.capturePage({x:30,y:320,width:1,height:1})).toBitmap()
        return {r:pixel[2],g:pixel[1],b:pixel[0]}
      }
      const warm=await sample('#d74030'),cool=await sample('#3060d7')
      check(`${theme} ambient colors follow the actual cover`,warm.r>cool.r+10&&cool.b>warm.b+10,{warm,cool})
    }
    await evaluate(win,`window.rainData.musicInfo.pic='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#435e58"/><circle cx="420" cy="180" r="70" fill="#d8c9a2"/><path d="M0 370 Q150 230 300 380 T600 350 V600 H0" fill="#819887"/><path d="M0 490 Q250 455 600 530 V600 H0" fill="#233f38"/></svg>');void 0`);await wait(180)
    check('detail omits secondary tools and desktop lyric controls',await evaluate(win,`!document.querySelector('[data-detail-select-lyrics],[data-detail-comment],[data-detail-comments]')&&document.querySelectorAll('[data-detail-dock] button').length===5`))
    check('detail omits volume controls',await evaluate(win,`!document.querySelector('[data-detail-volume]')`))
    check('all dock controls share a baseline and generous hit targets',await evaluate(win,`(()=>{const bs=[...document.querySelectorAll('[data-detail-dock] button')].map(e=>e.getBoundingClientRect());return bs.every(r=>r.width>=40&&r.height>=40)&&Math.max(...bs.map(r=>r.top+r.height/2))-Math.min(...bs.map(r=>r.top+r.height/2))<.5;})()`))
    check('transport stays centered and its side controls are symmetric',await evaluate(win,`(()=>{const d=document.querySelector('[data-detail-dock]').getBoundingClientRect(),p=document.querySelector('[data-detail-play]').getBoundingClientRect(),a=document.querySelector('[data-detail-prev]').getBoundingClientRect(),b=document.querySelector('[data-detail-next]').getBoundingClientRect();return Math.abs(p.left+p.width/2-d.left-d.width/2)<.5&&Math.abs((p.left+p.width/2-a.left-a.width/2)-(b.left+b.width/2-p.left-p.width/2))<.5;})()`))
    check('detail seek area allows a comfortable pointer target',await evaluate(win,`document.querySelector('[data-detail-progress]').getBoundingClientRect().height>=22`))
    await setMotion(false);await wait(100)
    const pressRect=await evaluate(win,`document.querySelector('[data-detail-play]').getBoundingClientRect().toJSON()`)
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(pressRect.left+pressRect.width/2),y:Math.round(pressRect.top+pressRect.height/2)});win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(pressRect.left+pressRect.width/2),y:Math.round(pressRect.top+pressRect.height/2),button:'left',clickCount:1});await wait(120)
    check('physical press gives the playback button a restrained tactile response',await evaluate(win,`Number(getComputedStyle(document.querySelector('[data-detail-play]')).scale)<.99`))
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(pressRect.right+30),y:Math.round(pressRect.bottom+20)});win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(pressRect.right+30),y:Math.round(pressRect.bottom+20),button:'left',clickCount:1});await wait(250)
    check('releasing outside restores the playback button without activating it',await evaluate(win,`(()=>{const s=getComputedStyle(document.querySelector('[data-detail-play]')).scale;return s==='none'||Math.abs(Number(s)-1)<.001;})()`))
    await setMotion(true);await wait(80)
    check('important controls stay together beneath the song metadata',await evaluate(win,`(()=>{const d=document.querySelector('[data-detail-dock]').getBoundingClientRect(),m=document.querySelector('[data-song-detail] h2').parentElement.getBoundingClientRect();return d.left<innerWidth*.3&&d.right<innerWidth*.55&&d.top-m.bottom<=40&&!!document.querySelector('[data-detail-play]')&&!!document.querySelector('[data-detail-prev]')&&!!document.querySelector('[data-detail-next]');})()`))
    check('original sidebar and player are excluded from interaction',await evaluate(win,`document.querySelector('#app-chrome').inert&&document.querySelector('#app-chrome').getAttribute('aria-hidden')==='true'&&getComputedStyle(document.querySelector('#left')).visibility==='hidden'`))
    await evaluate(win,`const p=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar');p.proxy.maxPlayTime=120;window.seekEvents=[];window.onSeek=v=>seekEvents.push(v);window.app_event.on('setProgress',onSeek);document.querySelector('[data-detail-progress]').focus();void 0`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'END'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'END'});await wait(100)
    check('integrated progress supports keyboard seeking',await evaluate(win,`seekEvents.includes(120)`))
    await evaluate(win,`window.app_event.off('setProgress',onSeek);void 0`)
    await evaluate(win,`window.rainData.updateSetting({'player.togglePlayMethod':'list'});void 0`);await wait(180)
    const modeCycle=[]
    for(let i=0;i<4;i++){await evaluate(win,`document.querySelector('[data-detail-dock] [data-play-mode]').click();void 0`);await wait(150);modeCycle.push(await evaluate(win,`document.querySelector('[data-detail-dock] [data-play-mode]').dataset.mode`))}
    check('one mode button cycles list, loop, single and shuffle',modeCycle.join(',')==='listLoop,singleLoop,random,list',modeCycle)
    check('mode selection exposes one current option and never disables switching',await evaluate(win,`document.querySelectorAll('[data-detail-dock] [data-play-mode]').length===1&&!document.querySelector('[data-detail-dock]').textContent.includes('禁用歌曲切换')`))
    check('desktop lyric stays on the normal footer while details are open',await evaluate(win,`!document.querySelector('[data-detail-dock] use[href="#icon-desktop-lyric-off"]')&&Array.from(document.querySelectorAll('#player button')).some(e=>e.getAttribute('aria-label')?.includes('桌面歌词'))`))
    check('hidden player popups cannot receive keyboard focus',await evaluate(win,`Array.from(document.querySelectorAll('[data-player-popup][aria-hidden="true"]')).every(e=>e.inert)`))
    await evaluate(win,`(()=>{const all=[...document.querySelectorAll('[data-song-detail] button:not(:disabled), [data-song-detail] [tabindex="0"], [data-song-detail] input:not([aria-hidden="true"]), [data-song-detail] textarea')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[inert]'));all[all.length-1].focus();})();void 0`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await wait(80)
    check('Tab wraps within immersive controls',await evaluate(win,`document.activeElement===document.querySelector('[data-detail-window-controls] button')`))
    for(const selector of ['[data-detail-cover]','[data-detail-dock]']){
      const r=await evaluate(win,`document.querySelector('${selector}').getBoundingClientRect().toJSON()`)
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(r.left+20),y:Math.round(r.top+20)});await wait(100)
      check(`${selector} keeps frosted material without a mouse-following halo`,await evaluate(win,`document.querySelector('${selector}').style.getPropertyValue('--shine-opacity')!=='1'&&!getComputedStyle(document.querySelector('${selector}'),'::after').backgroundImage.includes('radial-gradient')`))
    }
    win.setContentSize(828,540);await wait(200)
    await wait(350)
    check('active lyric keeps its reading position after resizing',await evaluate(win,`(()=>{const line=document.querySelector('[data-song-detail] .lyric .line-content.active'),view=line.closest('.lyric');return Math.abs(line.getBoundingClientRect().top-view.getBoundingClientRect().top-view.clientHeight*.38)<8;})()`))
    check('small detail keeps cover, lyrics and controls in bounds',await evaluate(win,`(()=>{const v=document.querySelector('#root').getBoundingClientRect();return Array.from(document.querySelectorAll('[data-song-detail] button,[data-detail-cover],[data-detail-lyrics],[data-detail-dock]')).every(e=>{const r=e.getBoundingClientRect();return r.right<=v.right+1&&r.bottom<=v.bottom+1;});})()`))
    check('small detail keeps every playback button separate and inside its dock',await evaluate(win,`(()=>{const dock=document.querySelector('[data-detail-dock]').getBoundingClientRect(),buttons=[...document.querySelectorAll('[data-detail-dock] button')].map(e=>e.getBoundingClientRect()).sort((a,b)=>a.left-b.left);return buttons.every((r,i)=>r.left>=dock.left&&r.right<=dock.right&&(!i||buttons[i-1].right<=r.left+1));})()`))
    await evaluate(win,`setDetailFixtureProgress();document.activeElement.blur();void 0`);await wait(60)
    await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,'detail-small.png'),img.toPNG()))
    await evaluate(win,`window.rainData.musicInfo.name='雾与晨光'.repeat(30);void 0`);await wait(80)
    check('long song titles do not displace the compact dock',await evaluate(win,`(()=>{const h=document.querySelector('[data-song-detail] h2'),d=document.querySelector('[data-detail-dock]').getBoundingClientRect();return getComputedStyle(h).textOverflow==='ellipsis'&&h.clientHeight<40&&d.bottom<=innerHeight;})()`))
    await evaluate(win,`window.rainData.musicInfo.name='雾与晨光';void 0`)
    await evaluate(win,`document.querySelectorAll('[data-detail-window-controls] button')[2].click();void 0`);await wait(700)
    check('native fullscreen retains immersive details and its controls',win.isFullScreen()&&await evaluate(win,`!!document.querySelector('[data-song-detail]')&&Math.abs(document.querySelector('[data-song-detail]').getBoundingClientRect().bottom-innerHeight)<2&&getComputedStyle(document.querySelector('#player')).visibility==='hidden'`))
    check('native fullscreen shows three traffic lights with a keyboard reachable exit',await evaluate(win,`(()=>{const lights=document.querySelector('[data-detail-window-controls]'),buttons=[...lights.querySelectorAll('button')],green=buttons[2];return lights.getClientRects().length>0&&buttons.length===3&&buttons.every(b=>b.getClientRects().length>0&&b.tabIndex===0)&&green.getAttribute('aria-pressed')==='true'&&green.getAttribute('aria-label')==='退出全屏'&&!document.querySelector('[data-detail-fullscreen-exit]');})()`))
    check('native fullscreen keeps lyrics centered with a bounded font size',await evaluate(win,`(()=>{const v=document.querySelector('[data-song-detail] .lyric');return getComputedStyle(v).textAlign==='center'&&parseFloat(getComputedStyle(v).fontSize)<=48;})()`))
    win.webContents.sendInputEvent({type:'mouseMove',x:500,y:80});await wait(250)
    await evaluate(win,`setDetailFixtureProgress();document.activeElement.blur();void 0`);await wait(60)
    await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,'detail-native-fullscreen.png'),img.toPNG()))
    await evaluate(win,`document.querySelectorAll('[data-detail-window-controls] button')[2].click();void 0`);await wait(700)
    check('exiting native fullscreen retains immersive details',!win.isFullScreen()&&await evaluate(win,`!!document.querySelector('[data-song-detail]')&&Math.abs(document.querySelector('[data-song-detail]').getBoundingClientRect().bottom-innerHeight)<2`))
    for(const variant of ['full','middle','mini']){
      await evaluate(win,`window.rainData.updateSetting({'common.playBarProgressStyle':'${variant}'});void 0`);await wait(200)
      check(`${variant} uses the immersive dock and hides the original player`,await evaluate(win,`!!document.querySelector('[data-detail-dock]')&&getComputedStyle(document.querySelector('#player')).visibility==='hidden'&&document.querySelector('#app-chrome').inert`))
      await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(150)
      check(`${variant} detail button can close details`,await evaluate(win,`!document.querySelector('[data-song-detail]')`),await evaluate(win,`({reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,present:!!document.querySelector('[data-song-detail]'),inert:document.querySelector('#app-chrome').inert,active:document.activeElement.outerHTML.slice(0,160),running:document.querySelector('[data-song-detail]')?.getAnimations({subtree:true}).map(a=>({state:a.playState,time:a.currentTime}))})`))
      check(`${variant} normal footer keeps volume trigger within bounds`,await evaluate(win,`(()=>{const e=document.querySelector('#player [data-volume-trigger]'),r=e?.getBoundingClientRect();return !!r&&r.width>=28&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&getComputedStyle(e).visibility==='visible';})()`))
      await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,`minimal-footer-${variant}.png`),img.toPNG()))
      await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(150)
      check(`${variant} cover can reopen details`,await evaluate(win,`!!document.querySelector('[data-song-detail]')`))
    }
    check('repeated entry keeps a single lyric surface',await evaluate(win,`document.querySelectorAll('[data-song-detail]').length===1&&document.querySelectorAll('[data-song-detail] .lyric .line-content').length===5`))
    await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(200)
    check('back restores the underlying page and cover focus',await evaluate(win,`!document.querySelector('[data-song-detail]')&&location.hash===${JSON.stringify(route)}&&document.activeElement===document.querySelector('[data-player-cover]')`))
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(150)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(200)
    check('Escape closes the immersive detail view',await evaluate(win,`!document.querySelector('[data-song-detail]')`))
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(150)
    await evaluate(win,`location.hash+=(location.hash.includes('?')?'&':'?')+'detail_test=1';void 0`);await wait(350)
    check('background query updates do not interrupt immersive details',await evaluate(win,`document.querySelectorAll('[data-song-detail]').length===1&&document.querySelector('#app-chrome').inert`))
    const destination=route.includes('/setting')?'#/download':'#/setting'
    await evaluate(win,`location.hash=${JSON.stringify(destination)};void 0`);await wait(250)
    check('programmatic navigation closes details and restores normal content',await evaluate(win,`!document.querySelector('[data-song-detail]')&&location.hash.split('?')[0]===${JSON.stringify(destination)}`))
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(150)
    await evaluate(win,`window.rainData.musicInfo.pic='data:image/png;base64,broken';void 0`);await wait(250)
    check('unavailable cover art has a clean fallback',await evaluate(win,`!!document.querySelector('[data-detail-cover-fallback]')`))
    await setMotion(true);await wait(60)
    await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(200)
    await setMotion(false);await wait(60)
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(100)
    const midway=await evaluate(win,`(()=>{const d=document.querySelector('[data-song-detail]'),c=document.querySelector('[data-detail-cover]');return{animations:d.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,rect:c.getBoundingClientRect().toJSON()};})()`)
    check('opening uses one restrained fade and keeps the cover still',midway.animations===1&&await evaluate(win,`getComputedStyle(document.querySelector('[data-detail-cover]')).transform==='none'`),midway)
    await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(evidence,'immersive-opening.png'),img.toPNG()))
    await wait(550)
    const finalCover=await evaluate(win,`document.querySelector('[data-detail-cover]').getBoundingClientRect().toJSON()`)
    check('opening preserves cover geometry throughout the fade',Math.abs(finalCover.width-midway.rect.width)<1)
    check('opening finishes without leftover animations',await evaluate(win,`document.querySelector('[data-song-detail]').getAnimations({subtree:true}).every(a=>a.playState!=='running')&&document.querySelector('#app-chrome').inert&&getComputedStyle(document.querySelector('#app-chrome')).visibility==='hidden'&&document.activeElement===document.querySelector('[data-detail-back]')`))
    await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(60)
    const closing=await evaluate(win,`document.querySelector('[data-detail-cover]')?.getBoundingClientRect().toJSON()`)
    check('closing keeps the cover still and chrome inert until finished',Math.abs(closing?.width-finalCover.width)<1&&await evaluate(win,`document.querySelector('#app-chrome').inert`),closing)
    await wait(450)
    check('closing restores the normal page and focus after animation',await evaluate(win,`!document.querySelector('[data-song-detail]')&&!document.querySelector('#app-chrome').inert&&document.activeElement===document.querySelector('[data-player-cover]')&&getComputedStyle(document.querySelector('#player')).visibility==='visible'`))
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(90)
    await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(450)
    check('closing during entry does not leave a stuck layer or blocked controls',await evaluate(win,`!document.querySelector('[data-song-detail]')&&!document.querySelector('#app-chrome').inert`))
    await setMotion(true);await wait(50)
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(80)
    check('reduced motion opens the immersive layer immediately',await evaluate(win,`!!document.querySelector('[data-song-detail]')&&document.querySelector('[data-song-detail]').getAnimations({subtree:true}).every(a=>a.playState!=='running')&&getComputedStyle(document.querySelector('#app-chrome')).visibility==='hidden'`))
    await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(80)
    check('reduced motion closes immediately and restores focus',await evaluate(win,`!document.querySelector('[data-song-detail]')&&document.activeElement===document.querySelector('[data-player-cover]')`))
    // 同一个系统偏好经由 CDP 仿真再次显式设置，用于校验渲染进程读到的媒体特性与过渡行为一致。
    await setMotion(true);await wait(80)
    await evaluate(win,`document.querySelector('[data-player-cover]').click();void 0`);await wait(80)
    check('system reduced motion skips cover expansion',await evaluate(win,`matchMedia('(prefers-reduced-motion: reduce)').matches&&document.querySelector('[data-song-detail]').getAnimations({subtree:true}).every(a=>a.playState!=='running')&&getComputedStyle(document.querySelector('#app-chrome')).visibility==='hidden'`))
    await evaluate(win,`document.querySelector('[data-detail-back]').click();void 0`);await wait(80)
    check('system reduced motion closes without a delayed hidden layer',await evaluate(win,`!document.querySelector('[data-song-detail]')&&!document.querySelector('#app-chrome').inert`))
    win.webContents.debugger.detach()
    clearTimeout(timeout);finish()
  }catch(error){console.error(error);clearTimeout(timeout);app.exit(1)}
  })
})
require(path.join(root,'dist/main.js'))
