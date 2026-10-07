const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(root, '.design/playback-queue')
const phase = process.env.RAIN_QUEUE_TEST_PHASE
process.env.RAIN_DATA_DIR = path.join(evidence, 'portable')
const config = path.join(process.env.RAIN_DATA_DIR, 'userData/RainDatas')
fs.mkdirSync(config, { recursive: true })
if (phase !== 'restart') fs.writeFileSync(path.join(config, 'config_v2.json'), JSON.stringify({ version: '2.12.10', setting: { version: '2.12.10', 'common.langId': 'zh-cn', 'common.windowSizeId': 2, 'theme.id': 'mono', 'desktopLyric.enable': false, 'player.volume': 0, 'player.togglePlayMethod': 'listLoop' } }))
const audioFile = path.join(evidence, 'silent.wav')
if (!fs.existsSync(audioFile)) {
  const dataSize = 8000 * 200, wav = Buffer.alloc(dataSize + 44, 128)
  wav.write('RIFF', 0); wav.writeUInt32LE(dataSize + 36, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40)
  fs.writeFileSync(audioFile, wav)
}
const results = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (test, pass, detail) => { results.push({ test, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${test} ${JSON.stringify(detail ?? '')}`); if (!pass) throw new Error(test) }
const timeout = setTimeout(() => app.exit(1), 50000)
app.on('browser-window-created', (_, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
  const initialized = new Promise(resolve => global.rain.event_app.once('main_window_inited', resolve))
  win.webContents.once('did-finish-load', async() => {
    if (!win.webContents.getURL().includes('index.html')) return
    const evaluate = code => win.webContents.executeJavaScript(code)
    const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return true; await wait(40) } return false }
    const state = () => evaluate(`({id:rainData.playMusicInfo.musicInfo?.id,listId:rainData.playMusicInfo.listId,playerListId:rainData.playInfo.playerListId,index:rainData.playInfo.playerPlayIndex,time:findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar').proxy.nowPlayTime})`)
    const mouse = (type, point, button = 'left') => win.webContents.sendInputEvent({ type, ...point, button, clickCount: 1 })
    const center = rect => ({ x: Math.round(rect.left + Math.min(35, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) })
    const nativeClick = async selector => { const point = center(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)); mouse('mouseDown', point); mouse('mouseUp', point); await wait(150) }
    const route = async listId => { await evaluate(`location.hash=${JSON.stringify('#/list?id=' + listId)};void 0`); check(`opens ${listId} list`, await until(`!!findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList'&&c.props.listId===${JSON.stringify(listId)})`)); await wait(150) }
    const later = async index => {
      const point = center(await evaluate(`document.querySelectorAll('#my-list .list-item .name.select')[${index}].getBoundingClientRect().toJSON()`))
      mouse('mouseMove', point); mouse('mouseDown', point, 'right'); mouse('mouseUp', point, 'right')
      check('native song-name context menu opens', await until(`!!document.querySelector('[role=toolbar][aria-hidden=false]')`))
      await nativeClick('[role=toolbar][aria-hidden=false] [aria-label="稍后播放"]')
    }
    try {
      await initialized; await require('./dismiss-audio-notice.cjs')(evaluate)
      win.setAlwaysOnTop(true); win.show(); win.focus(); await wait(150)
      await evaluate(`window.findVue=function find(v,p){if(!v)return;if(v.component&&p(v.component))return v.component;const s=find(v.component?.subTree,p);if(s)return s;for(const child of Array.isArray(v.children)?v.children:[]){const c=find(child,p);if(c)return c;}};void 0`)
      if (phase === 'restart') {
        const expected = JSON.parse(fs.readFileSync(path.join(evidence, 'restart-expected.json')))
        const rows = await global.rain.worker.dbService.getListMusics('default')
        check('queue order and deduplication survive a new application process', JSON.stringify(rows.map(s => s.id)) === JSON.stringify(expected.order), rows.map(s => s.id))
        check('new application process restores the queue cursor and elapsed progress', await until(`rainData.playMusicInfo.listId==='default'&&rainData.playMusicInfo.musicInfo?.id===${JSON.stringify(expected.id)}&&Math.abs(findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar').proxy.nowPlayTime-42)<.5`), await state())
        await nativeClick('#player [data-playback-controls] button:nth-child(3)')
        check('next after restart follows the saved queue order', await until(`rainData.playMusicInfo.musicInfo?.id===${JSON.stringify(expected.nextId)}`), await state())
      } else {
        const song = (id, name, singer = '播放列表验证') => ({ id, name, singer, source: 'local', interval: '03:20', meta: { songId: audioFile, filePath: audioFile, ext: 'wav', albumName: '播放列表验证' } })
        const rows = [song('current', '正在播放'), song('later-a', '稍后播放 A'), song('later-b', '稍后播放 B'), song('duplicate-a', '稍后播放 A'), song('other-artist', '稍后播放 A', '另一位歌手')]
        await global.rain.event_list.list_data_overwrite({ defaultList: [], userList: [{ id: 'queue-custom', name: '原始歌单', list: rows }] })
        await route('queue-custom')
        await nativeClick('#my-list .list-item .name.select')
        await nativeClick('#my-list .list-item .name.select')
        check('real local audio starts from the custom playlist', await until(`document.querySelector('#player [data-playback-controls] button:nth-child(2)').getAttribute('aria-label')===window.i18n.t('player__pause')&&findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar').proxy.maxPlayTime>190`))
        await nativeClick('#player [data-playback-controls] button:nth-child(2)')
        await evaluate(`window.app_event.setProgress(42);void 0`); await wait(100)
        await later(1)
        check('play later writes the visible SQLite queue without interrupting the paused song', JSON.stringify((await global.rain.worker.dbService.getListMusics('default')).map(s=>s.id)) === JSON.stringify(['current', 'later-a']), await state())
        check('current audio cursor moves to the queue with its 42-second progress intact', await evaluate(`rainData.playMusicInfo.listId==='default'&&rainData.playInfo.playerListId==='default'&&rainData.playInfo.playerPlayIndex===0&&!rainData.playMusicInfo.isTempPlay&&Math.abs(findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar').proxy.nowPlayTime-42)<.5`))
        await later(2); await later(3); await later(4)
        const queued = await global.rain.worker.dbService.getListMusics('default')
        check('successive native clicks append in order and merge only same title and artist', queued.map(s=>s.id).join(',') === 'current,later-a,later-b,other-artist', queued.map(s=>s.id))
        check('the original custom playlist retains all songs including source versions', (await global.rain.worker.dbService.getListMusics('queue-custom')).length === 5)
        await route('default')
        check('the persisted songs appear in the visible playback list', await evaluate(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='MusicList').proxy.list.map(s=>s.id).join(',')==='current,later-a,later-b,other-artist'`))
        fs.writeFileSync(path.join(evidence, 'visible-playback-queue.png'), (await win.webContents.capturePage()).toPNG())
        await global.rain.event_list.list_music_remove('default', ['later-a']); await wait(150)
        await global.rain.event_list.list_music_update_position('default', 1, ['other-artist']); await wait(150)
        check('removal and sorting update the persisted playback order', (await global.rain.worker.dbService.getListMusics('default')).map(s=>s.id).join(',') === 'current,other-artist,later-b')
        await nativeClick('#player [data-playback-controls] button:nth-child(3)')
        check('next skips the removed item and follows the displayed sort order', await until(`rainData.playMusicInfo.musicInfo?.id==='other-artist'`), await state())
        await nativeClick('#player [data-playback-controls] button:nth-child(1)')
        check('previous follows the same visible playback queue', await until(`rainData.playMusicInfo.musicInfo?.id==='current'`), await state())
        check('audio finishes loading before the restart fixture is saved', await until(`findVue(document.querySelector('#root')._vnode,c=>c.type.name==='CorePlayBar').proxy.maxPlayTime>190&&document.querySelector('#player [data-playback-controls] button:nth-child(2)').getAttribute('aria-label')===window.i18n.t('player__pause')`))
        await nativeClick('#player [data-playback-controls] button:nth-child(2)')
        await evaluate(`window.app_event.setProgress(42);void 0`); await wait(2300)
        fs.writeFileSync(path.join(evidence, 'restart-expected.json'), JSON.stringify({ id: 'current', nextId: 'other-artist', order: ['current', 'other-artist', 'later-b'] }))
      }
    } catch (error) { console.error(error); results.push({ test: 'runtime finishes without errors', pass: false, detail: error.message }) }
    clearTimeout(timeout); fs.writeFileSync(path.join(evidence, `${phase}-results.json`), JSON.stringify(results, null, 2)); app.exit(results.every(result => result.pass) ? 0 : 1)
  })
})
require(path.join(root, 'dist/main.js'))
