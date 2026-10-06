// Render the actual dock component; substitute audio and shared widget boundaries.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '../..')
app.whenReady().then(async() => {
  const compile = file => {
    const { descriptor } = parse(fs.readFileSync(path.join(root,file),'utf8'))
    return compileScript(descriptor,{id:'dock-test',inlineTemplate:true}).content
      .replace(/import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g,(_,names,source)=>`const {${names.replace(/\bas\b/g, ':')}} = ${source === 'vue' || source.includes('vueTools') ? 'Vue' : source.includes('/core/player') ? 'audio' : 'store'}`)
      .replace(/import\s+(\w+)\s+from\s+['"][^'"]+['"]/g,(_,name)=>`const ${name} = boundaries.${name}`).replace('export default','const component =')
  }
  const code = compile('src/renderer/components/layout/PlayDetail/PlayBar.vue')
  const transportCode = compile('src/renderer/components/common/PlaybackControls.vue')
  const progressCode = compile('src/renderer/components/common/ProgressBar.vue')
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  await win.loadURL('data:text/html,<div id="app"></div>')
  const result = await win.webContents.executeJavaScript(`(async() => {
    const Vue = require(${JSON.stringify(path.join(root, 'node_modules/vue/dist/vue.cjs.js'))});
    const calls = [], seeks = [], volumes = [];
    const store = { isPlay: Vue.ref(false), musicInfo: Vue.reactive({id:null}), playMusicInfo: {musicInfo:null}, volume:Vue.ref(.5), isMute:Vue.ref(false), playProgress: Vue.reactive({nowPlayTime:30,maxPlayTime:120}) };
    const audio = { playPrev: () => calls.push('prev'), playNext: () => calls.push('next'), togglePlay: () => {calls.push('toggle');store.isPlay.value=!store.isPlay.value;} };
    const boundaries = {
      DetailTools: {template:'<span />'},
      usePlayProgress: () => ({nowPlayTimeStr:'00:30',maxPlayTimeStr:'02:00',progress:.25,isActiveTransition:false,handleTransitionEnd:()=>{},hasTimeline:Vue.computed(()=>!!store.musicInfo.id),canSeek:Vue.computed(()=>!!store.musicInfo.id&&store.playProgress.maxPlayTime>0)}),
      useToggleDesktopLyric: () => ({toggleDesktopLyricBtnTitle:'desktop-lyric',toggleDesktopLyric:()=>calls.push('desktop'),toggleLockDesktopLyric:()=>calls.push('lock')})
    };
    window.app_event = {setProgress: value => seeks.push(value),setVolume:value=>{volumes.push(value);store.volume.value=value;},setVolumeIsMute:value=>{store.isMute.value=value;}};
    ${code}
    component.__cssModules = {$style:{}};
    const instance=Vue.createApp(component);instance.config.globalProperties.$t=key=>key;
    for(const name of ['common-progress-bar','common-volume-btn','common-toggle-play-mode-btn','common-list-add-modal'])instance.component(name,{template:'<span />'});
    instance.component('common-playback-controls',(()=>{${transportCode};component.__cssModules={$style:{}};return component;})());
    instance.mount('#app');await Vue.nextTick();
    const results=[],check=(test,pass)=>results.push({test,pass});
    document.querySelector('[data-detail-prev]').click();document.querySelector('[data-detail-next]').click();
    check('immersive previous and next dispatch to the audio controller',calls.join(',')==='prev,next');
    document.querySelector('[data-detail-play]').click();await Vue.nextTick();
    check('immersive play updates to a pause control',calls.at(-1)==='toggle'&&document.querySelector('[data-detail-play]').getAttribute('aria-label')==='player__pause');
    document.querySelector('[data-detail-play]').click();await Vue.nextTick();
    check('immersive pause returns to a play control',document.querySelector('[data-detail-play]').getAttribute('aria-label')==='player__play');
    check('empty dock omits its timeline and time labels',!document.querySelector('[data-detail-progress],[data-detail-time]'));
    store.musicInfo.id='fixture';await Vue.nextTick();check('a current song restores the dock timeline',!!document.querySelector('[data-detail-progress]'));
    const slider=document.querySelector('[data-detail-progress]');
    const key=k=>slider.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
    key('ArrowRight');key('ArrowLeft');check('keyboard seeks by five seconds in either direction',seeks.slice(-2).join(',')==='35,25');
    key('Home');key('End');check('Home and End seek to track boundaries',seeks.slice(-2).join(',')==='0,120');
    store.playProgress.nowPlayTime=119;key('ArrowUp');store.playProgress.nowPlayTime=1;key('ArrowDown');
    check('keyboard seek clamps to the actual track duration',seeks.slice(-2).join(',')==='120,0');
    check('immersive dock keeps volume outside details',!document.querySelector('[data-detail-volume]'));
    const progressComponent=(()=>{${progressCode};component.__cssModules={$style:{}};return component;})();
    const progressHost=document.createElement('div');document.body.append(progressHost);
    const progressApp=Vue.createApp(progressComponent,{progress:.25,isActiveTransition:false,handleTransitionEnd:()=>{}});progressApp.mount(progressHost);await Vue.nextTick();
    const hit=progressHost.querySelector('[data-seek-hit]'),captures=[];hit.getBoundingClientRect=()=>({left:100,width:200});hit.setPointerCapture=id=>captures.push(id);
    const pointer=(type,x,id=1)=>hit.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,button:0,bubbles:true,cancelable:true}));
    const beforeSeek=seeks.length;pointer('pointerdown',150);await Vue.nextTick();
    check('progress responds immediately on pointer down before release',progressHost.querySelector('[data-seeking]').getAttribute('data-seeking')==='true'&&progressHost.querySelector('[data-seeking] div').style.transform==='scaleX(0.25)'&&seeks.length===beforeSeek);
    pointer('pointermove',250);await Vue.nextTick();check('drag preview follows the pointer without animation lag',progressHost.querySelector('[data-seeking] div').style.transform==='scaleX(0.75)');
    pointer('pointermove',300,2);pointer('pointerup',250);await Vue.nextTick();check('captured pointer commits one seek and ignores other pointers',captures[0]===1&&seeks.length===beforeSeek+1&&seeks.at(-1)===90);
    pointer('pointerdown',150);pointer('pointermove',400);pointer('pointerup',400);check('drag beyond the progress bar clamps to duration',seeks.at(-1)===120);
    const beforeCancel=seeks.length;pointer('pointerdown',160);pointer('pointercancel',160);pointer('pointerup',180);await Vue.nextTick();check('cancelled gestures never seek or leave a stuck drag',seeks.length===beforeCancel&&progressHost.querySelector('[data-seeking]').getAttribute('data-seeking')==='false');
    store.playProgress.maxPlayTime=0;pointer('pointerdown',180);pointer('pointerup',180);check('empty playback does not start a seek gesture',seeks.length===beforeCancel);
    progressApp.unmount();instance.unmount();
    return results;
  })()`)
  for (const item of result) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.test}`)
  fs.writeFileSync(path.join(root, '.design/detail-dock-results.json'), JSON.stringify(result, null, 2))
  app.exit(result.every(item => item.pass) ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
