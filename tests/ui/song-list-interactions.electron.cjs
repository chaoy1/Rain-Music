const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(root, '.design/song-list-interactions')
process.env.RAIN_DATA_DIR = path.join(evidence, 'portable')
const config = path.join(process.env.RAIN_DATA_DIR, 'userData/RainDatas')
fs.mkdirSync(config, { recursive: true })
fs.writeFileSync(path.join(config, 'config_v2.json'), JSON.stringify({ version: '2.12.6', setting: { version: '2.12.8', 'common.langId': 'zh-cn', 'common.windowSizeId': 2, 'common.fontSize': 16, 'theme.id': 'mono', 'desktopLyric.enable': false } }))
const results = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`) }
const timeout = setTimeout(() => app.exit(1), 65000)
app.on('browser-window-created', (_, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }))
  const initialized = new Promise(resolve => global.rain.event_app.once('main_window_inited', resolve))
  win.webContents.once('did-finish-load', async() => {
    if (!win.webContents.getURL().includes('index.html')) return
    const evaluate = code => win.webContents.executeJavaScript(code)
    const rows = Array.from({ length: 90 }, (_, i) => ({ id: 'song-' + i, name: '歌曲 ' + i, singer: '界面验证', source: 'tx', interval: '03:20', meta: { songId: 'song-' + i, albumName: '排序验证', qualitys: [], _qualitys: {} } }))
    const point = rect => ({ x: Math.round(rect.left + Math.min(35, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) })
    const mouse = (type, p, button = 'left') => win.webContents.sendInputEvent({ type, ...p, button, clickCount: 1 })
    const dismiss = async() => { await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList'||c.type.name==='MaterialOnlineList');c?.proxy.handleMenuClick();})()`); await wait(100) }
    try {
      await initialized
      await require('./dismiss-audio-notice.cjs')(evaluate)
      await global.rain.event_list.list_data_overwrite({ defaultList: rows, userList: [{ id: 'drag-custom', name: '自定义测试', list: rows }] })
      await evaluate(`window.findVue=function find(v,p){if(!v)return;if(v.component&&p(v.component))return v.component;const sub=find(v.component?.subTree,p);if(sub)return sub;for(const child of Array.isArray(v.children)?v.children:[]){const c=find(child,p);if(c)return c;}};void 0`)
      if (process.env.RAIN_LIST_INTERACTIONS_ONLY_ONLINE === '1') {
        win.setContentSize(1440, 900); win.setAlwaysOnTop(true); win.show(); win.focus(); await wait(200)
      }
      const sizes = process.env.RAIN_LIST_INTERACTIONS_ONLY_ONLINE === '1' ? [] : [[828, 540], [1440, 900]]
      for (const [width, height] of sizes) {
        win.setContentSize(width, height); win.setAlwaysOnTop(true); win.show(); win.focus()
        for (const listId of ['default', 'drag-custom']) {
          await global.rain.event_list.list_music_overwrite(listId, rows)
          await evaluate(`location.hash=${JSON.stringify('#/list?id=' + listId)};void 0`); await wait(350)
          await evaluate(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList').proxy.listRef.$el.scrollTop=0;void 0`); await wait(100)
          const text = await evaluate(`document.querySelector('#my-list .list-item .name.select').getBoundingClientRect().toJSON()`)
          const p = point(text); mouse('mouseMove', p); await wait(650); mouse('mouseDown', p, 'right'); mouse('mouseUp', p, 'right'); await wait(160)
          check(`${width} ${listId}: native right-click on song text opens row menu`, await evaluate(`!!document.querySelector('[role=toolbar][aria-hidden=false]')`))
          check(`${width} ${listId}: only essential song actions remain`, await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');return c.proxy.menus.every(m=>!['toggleSource','copyName','sourceDetail','search','sort','moveTo'].includes(m.action))&&c.proxy.menus.some(m=>m.action==='addTo')&&c.proxy.menus.some(m=>m.action==='remove');})()`))
          await dismiss()
          await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');c.proxy.listRef.$el.scrollTop=0;window.rainData.playMusicInfo.listId=${JSON.stringify(listId)};window.rainData.playMusicInfo.musicInfo=c.proxy.list[0];window.rainData.playMusicInfo.isTempPlay=false;Object.assign(window.rainData.playInfo,{playerListId:${JSON.stringify(listId)},playIndex:0,playerPlayIndex:0});})()`); await wait(100)
          const from = point(await evaluate(`document.querySelector('#my-list .list-item .name.select').getBoundingClientRect().toJSON()`))
          const to = point(await evaluate(`document.querySelectorAll('#my-list .list-item .name.select')[4].getBoundingClientRect().toJSON()`))
          mouse('mouseMove', from); mouse('mouseDown', from); await wait(580)
          check(`${width} ${listId}: long hold exposes drag feedback`, await evaluate(`!!document.querySelector('[data-song-drag-preview]')`))
          mouse('mouseMove', to); await wait(80); mouse('mouseUp', to); await wait(600)
          const persisted = await global.rain.worker.dbService.getListMusics(listId)
          check(`${width} ${listId}: drag changes persisted order`, persisted[4].id === 'song-0', persisted.slice(0, 6).map(s => s.id))
          check(`${width} ${listId}: playing song and progress survive reorder`, await evaluate(`window.rainData.playMusicInfo.musicInfo.id==='song-0'&&window.rainData.playInfo.playIndex===4`))
          // Move a visible row beyond the virtual viewport; auto-scroll must address absolute indices.
          const beforeEdge = await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList');return{id:c.proxy.list[0].id,visibleCount:document.querySelectorAll('#my-list .list-item').length};})()`)
          const source = point(await evaluate(`document.querySelector('#my-list .list-item .name.select').getBoundingClientRect().toJSON()`))
          const bottom = await evaluate(`(()=>{const r=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList').proxy.listRef.$el.getBoundingClientRect();return{x:Math.round(r.left+70),y:Math.round(r.bottom-8)};})()`)
          mouse('mouseMove', source); mouse('mouseDown', source); await wait(580); mouse('mouseMove', bottom); await wait(850)
          check(`${width} ${listId}: edge drag scrolls virtual list`, await evaluate(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList').proxy.listRef.$el.scrollTop>100`))
          mouse('mouseUp', bottom); await wait(400)
          const edgeResult = await global.rain.worker.dbService.getListMusics(listId)
          check(`${width} ${listId}: edge drop remains valid and preserves records`, edgeResult.length === rows.length)
          check(`${width} ${listId}: edge drop reaches a row outside the original virtual slice`, edgeResult.findIndex(s => s.id === beforeEdge.id) >= beforeEdge.visibleCount, { target: edgeResult.findIndex(s => s.id === beforeEdge.id), originalVisible: beforeEdge.visibleCount })
          // Escape cancels an armed drag without writing a new order.
          const beforeCancel = edgeResult.map(s => s.id)
          let cancelTarget = null
          for (let attempt = 0; attempt < 40; attempt++) {
            cancelTarget = await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList'),container=c.proxy.listRef.$el,r=container.getBoundingClientRect();if(JSON.stringify(c.proxy.list.map(s=>s.id))!==${JSON.stringify(JSON.stringify(beforeCancel))})return null;for(const span of document.querySelectorAll('#my-list .list-item .name.select')){const s=span.getBoundingClientRect(),row=span.closest('.list-item').getBoundingClientRect(),p={x:Math.round(s.left+Math.min(35,s.width/2)),y:Math.round(s.top+s.height/2)},hit=document.elementFromPoint(p.x,p.y);if(s.width>0&&row.top>=r.top+2&&row.bottom<=r.bottom-2&&span.contains(hit))return{point:p,songId:span.closest('.list-item').getAttribute('data-song-id'),span:s.toJSON(),row:row.toJSON(),container:r.toJSON(),scrollTop:container.scrollTop,target:hit.outerHTML.slice(0,160)};}return null;})()`)
            if (cancelTarget) break
            await wait(50)
          }
          check(`${width} ${listId}: cancellation targets a fully visible song after persisted order settles`, !!cancelTarget, cancelTarget)
          if (!cancelTarget) throw new Error('No fully visible native song target for Escape cancellation')
          const cancelPoint = cancelTarget.point
          fs.writeFileSync(path.join(evidence, `${width}-${listId}-cancel-target.json`), JSON.stringify(cancelTarget, null, 2))
          mouse('mouseMove', cancelPoint); mouse('mouseDown', cancelPoint)
          let cancelDragStarted = false
          for (let attempt = 0; attempt < 60; attempt++) {
            cancelDragStarted = await evaluate(`!!document.querySelector('[data-song-drag-preview]')`)
            if (cancelDragStarted) break
            await wait(25)
          }
          check(`${width} ${listId}: cancellation starts with an active drag`, cancelDragStarted, { targetSong: cancelTarget.songId, point: cancelPoint })
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); mouse('mouseUp', cancelPoint); await wait(100)
          check(`${width} ${listId}: Escape removes feedback and preserves order`, JSON.stringify((await global.rain.worker.dbService.getListMusics(listId)).map(s => s.id)) === JSON.stringify(beforeCancel) && await evaluate(`!document.querySelector('[data-song-drag-preview]')`))
          fs.writeFileSync(path.join(evidence, `${width}-${listId}.png`), (await win.webContents.capturePage()).toPNG())
        }
      }
      // Search hides its list without text. Let the real provider settle before
      // installing local fixtures, so a late success/failure cannot replace them.
      await evaluate(`location.hash='#/search?source=tx&type=music&text=测试';void 0`); await wait(350)
      let searchSettled = false
      for (let attempt = 0; attempt < 200; attempt++) {
        searchSettled = await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList');return !!c&&c.props.noItem!==window.i18n.t('list__loading');})()`)
        if (searchSettled) break
        await wait(50)
      }
      check('real provider request completes before online fixtures are installed', searchSettled)
      if (!searchSettled) throw new Error('Search request did not reach a terminal state within 10 seconds')
      await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList');Object.assign(c.props,{list:${JSON.stringify(rows)},noItem:'',total:90,page:1,limit:90});})()`); await wait(150)
      let onlineReady = false
      for (let attempt = 0; attempt < 40; attempt++) {
        onlineReady = await evaluate(`(()=>{const span=document.querySelector('#view .list-item .name.select');if(!span)return false;const r=span.getBoundingClientRect();return r.width>0&&r.height>0&&span.contains(document.elementFromPoint(Math.round(r.left+Math.min(35,r.width/2)),Math.round(r.top+r.height/2)));})()`)
        if (onlineReady) break
        await wait(50)
      }
      check('online fixture is rendered above the completed loading transition', onlineReady)
      const online = point(await evaluate(`document.querySelector('#view .list-item .name.select').getBoundingClientRect().toJSON()`))
      const diagnoseOnline = async stage => {
        const detail = await evaluate(`(()=>{const c=findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList'),span=document.querySelector('#view .list-item .name.select'),hit=document.elementFromPoint(${online.x},${online.y});const chain=[];for(let e=hit;e&&chain.length<7;e=e.parentElement)chain.push({tag:e.tagName,class:e.className,text:e.textContent.slice(0,90)});return {stage:${JSON.stringify(stage)},point:${JSON.stringify(online)},route:location.hash,focused:document.hasFocus(),rect:span?.getBoundingClientRect().toJSON(),hitChain:chain,spanText:span?.textContent,visibleRows:document.querySelectorAll('#view .list-item').length,propRows:c?.props.list.length,noItem:c?.props.noItem,menuOpen:c?.proxy.isShowItemMenu,rightClickIndex:c?.proxy.rightClickSelectedIndex,containerRect:c?.proxy.listRef?.$el.getBoundingClientRect().toJSON(),scrollTop:c?.proxy.listRef?.$el.scrollTop,captured:document.querySelector('[data-song-drag-preview]')?.outerHTML.slice(0,200),menus:[...document.querySelectorAll('[role=toolbar]')].map(e=>({hidden:e.getAttribute('aria-hidden'),display:getComputedStyle(e).display,rect:e.getBoundingClientRect().toJSON(),text:e.textContent.slice(0,160)}))};})()`)
        detail.windowFocused = win.isFocused()
        detail.windowBounds = win.getBounds()
        fs.writeFileSync(path.join(evidence, `online-${stage}.json`), JSON.stringify(detail, null, 2))
        fs.writeFileSync(path.join(evidence, `online-${stage}.png`), (await win.webContents.capturePage()).toPNG())
        return detail
      }
      await diagnoseOnline('before-hover')
      await evaluate(`window.qaOnlinePointerEvents=[];for(const type of ['pointerdown','pointerup','contextmenu'])document.addEventListener(type,e=>qaOnlinePointerEvents.push({type,button:e.button,x:e.clientX,y:e.clientY,target:e.target.outerHTML.slice(0,200)}),true);void 0`)
      mouse('mouseMove', online); await wait(650)
      const beforeOnline = await diagnoseOnline('before-click')
      check('online native pointer targets the populated song text', beforeOnline.propRows === rows.length && beforeOnline.spanText === '歌曲 0' && typeof beforeOnline.hitChain[0]?.class === 'string' && beforeOnline.hitChain[0].class.split(' ').includes('name'), { point: online, target: beforeOnline.hitChain[0]?.tag, text: beforeOnline.hitChain[0]?.text })
      mouse('mouseDown', online, 'right'); mouse('mouseUp', online, 'right'); await wait(150)
      const afterOnline = await diagnoseOnline('after-click')
      const events = await evaluate('qaOnlinePointerEvents')
      fs.writeFileSync(path.join(evidence, 'online-pointer-events.json'), JSON.stringify(events, null, 2))
      check('online song text responds to native right-click', await evaluate(`!!document.querySelector('[role=toolbar][aria-hidden=false]')`), { focused: afterOnline.focused, menuOpen: afterOnline.menuOpen, rightClickIndex: afterOnline.rightClickIndex, eventCount: events.length })
      check('online menu omits search and source detail', await evaluate(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MaterialOnlineList').proxy.menus.every(m=>!['search','sourceDetail'].includes(m.action))`))
      clearTimeout(timeout); fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2)); app.exit(results.every(r => r.pass) ? 0 : 1)
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1) }
  })
})
require(path.join(root, 'dist/main.js'))
