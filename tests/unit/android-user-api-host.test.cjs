const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { Worker, MessageChannel } = require('node:worker_threads')
const load = require('./fixtures/android-user-api/load.cjs')
const root = process.env.RAIN_USER_API_TEST_ROOT || path.resolve(__dirname, '../..')
const hostPath = path.join(root, 'src/renderer/platform/userApi/host.js')
const script = body => `/**\n * @name Test source\n * @version 1.0\n */\n${body}`
const normal = script(`
if (lx !== rain || typeof Capacitor !== 'undefined' || typeof require !== 'undefined') throw Error('isolation');
lx.on(lx.EVENT_NAMES.request, async ({ action, info }) => {
  if (info?.slow) return new Promise(resolve => setTimeout(() => resolve('https://late.test/music'), 120));
  if (action === 'lyric') return {lyric:'[00:00]hello',tlyric:7,rainlyric:'rain'};
  return action === 'pic' ? 'https://media.test/pic' : 'https://media.test/music';
});
lx.send(lx.EVENT_NAMES.inited, {sources:{tx:{type:'music',actions:['musicUrl','pic'],qualitys:['128k','flac','bad']},local:{type:'music',actions:['musicUrl','lyric','pic'],qualitys:['flac']},mg:{type:'music',actions:['musicUrl'],qualitys:['flac']}}});
`)
function setup(t, options = {}) {
  const { createUserApiHost } = load(hostPath)
  let saved = options.saved ?? null
  const events = []
  const storage = { read: async () => saved, write: async value => { if (options.writeError) throw Error('storage failed'); saved = structuredClone(value) } }
  const sessions = []
  const createSession = (onMessage, onError) => {
    const worker = new Worker(path.join(__dirname, 'fixtures/android-user-api/node-worker.cjs'))
    const { port1, port2 } = new MessageChannel()
    port1.on('message', onMessage)
    worker.on('error', onError)
    worker.postMessage({ kind: 'connect', port: port2 }, [port2])
    const session = { post: message => port1.postMessage(message), terminate() { port1.close(); void worker.terminate() } }
    sessions.push(session)
    return session
  }
  const host = createUserApiHost({ storage, createSession, emit: (channel, data) => events.push({ channel, data }), initTimeoutMs: options.initTimeoutMs ?? 15000, requestTimeoutMs: options.requestTimeoutMs ?? 5000, httpRequest: options.httpRequest ?? (() => { throw Error('unexpected HTTP') }) })
  t.after(() => host.dispose())
  return { host, events, storage, get saved() { return saved } }
}
const req = (requestKey, action = 'musicUrl', source = 'tx', info = { type: 'flac' }) => ({ requestKey, data: { source, action, info } })

test('imports persist raw scripts and metadata atomically; duplicate and failed writes reject', async t => {
  const a = setup(t)
  const imported = await a.host.importApi(normal)
  assert.equal(imported.apiInfo.name, 'Test source')
  assert.equal('script' in imported.apiInfo, false)
  assert.equal(a.saved.apis[0].script, normal)
  await assert.rejects(a.host.importApi(normal), /相同|duplicate/)
  const restored = setup(t, { saved: a.saved })
  assert.deepEqual(await restored.host.getApiList(), imported.apiList)
  const failed = setup(t, { writeError: true })
  await assert.rejects(failed.host.importApi(normal), /storage failed/)
  assert.deepEqual(await failed.host.getApiList(), [])
})

test('real worker initializes lx/rain, filters platforms/quality and returns desktop envelopes', async t => {
  const a = setup(t)
  const { apiInfo } = await a.host.importApi(normal)
  await a.host.setApi(apiInfo.id)
  const status = await a.host.getStatus()
  assert.equal(status.status, true)
  assert.deepEqual(Object.keys(status.apiInfo.sources), ['tx', 'local'])
  assert.deepEqual(status.apiInfo.sources.tx, { type: 'music', actions: ['musicUrl'], qualitys: ['128k', 'flac'] })
  assert.deepEqual(status.apiInfo.sources.local.qualitys, [])
  assert.deepEqual(await a.host.request(req('m')), {source:'tx',action:'musicUrl',data:{type:'flac',url:'https://media.test/music'}})
  assert.deepEqual(await a.host.request(req('l','lyric','local')), {source:'local',action:'lyric',data:{lyric:'[00:00]hello',tlyric:null,rlyric:null,rainlyric:'rain'}})
  assert.equal((await a.host.request(req('p','pic','local'))).data, 'https://media.test/pic')
  await assert.rejects(a.host.request(req('bad','musicUrl','mg')), /support/)
  await assert.rejects(a.host.request(req('bad','pic','tx')), /support/)
  assert.equal(a.saved.selectedId, apiInfo.id)
})

test('cancel, timeout and switching source reject pending requests and ignore stale replies', async t => {
  const a = setup(t, { requestTimeoutMs: 55 })
  const {apiInfo} = await a.host.importApi(normal)
  await a.host.setApi(apiInfo.id)
  const cancelled = a.host.request(req('cancel', 'musicUrl', 'tx', { slow: true, type: 'flac' }))
  const cancelledCheck = assert.rejects(cancelled, /Cancel/)
  a.host.cancelRequest('cancel')
  await cancelledCheck
  await assert.rejects(a.host.request(req('timeout', 'musicUrl', 'tx', { slow: true, type: 'flac' })), /timeout/i)
  const switched = a.host.request(req('switch', 'musicUrl', 'tx', { slow: true, type: 'flac' }))
  const switchedCheck = assert.rejects(switched, /source changed/)
  await a.host.setApi('default')
  await switchedCheck
  await assert.rejects(a.host.request(req('late')), /not load|not ready/)
})

test('script errors, malformed responses, init hangs and unsupported crypto modes are visible', async t => {
  const a = setup(t)
  const broken = await a.host.importApi(script(`throw Error('broken source')`))
  await assert.rejects(a.host.setApi(broken.apiInfo.id), /broken source/)
  assert.match((await a.host.getStatus()).message, /broken source/)
  assert.equal(a.events.at(-1).data.status, false)
  const invalid = await a.host.importApi(script(`lx.on('request',async()=> 'file:///secret');lx.send('inited',{sources:{local:{type:'music',actions:['pic'],qualitys:[]}}});`))
  await a.host.setApi(invalid.apiInfo.id)
  await assert.rejects(a.host.request(req('invalid','pic','local')), /failed|URL/)
  const unsupported = await a.host.importApi(script(`lx.utils.crypto.aesEncrypt(lx.utils.buffer.from('x'),'bad',lx.utils.buffer.from('1234567890123456'));`))
  await assert.rejects(a.host.setApi(unsupported.apiInfo.id), /Unsupported AES/)
  const devtools = await a.host.importApi(script(`lx.send('inited',{openDevTools:true,sources:{}});`))
  await assert.rejects(a.host.setApi(devtools.apiInfo.id), /Unsupported capability: openDevTools/)
})

test('HTTP runs in parent, callbacks parse JSON, abort and once-only update permissions work', async t => {
  let aborted = false
  const a = setup(t, { httpRequest: (url, options, callback) => {
    assert.equal(url, 'https://api.test/data')
    assert.equal(options.headers.Cookie, 'session=test')
    const timer = setTimeout(() => callback(null, {statusCode:200,headers:{},raw:new Uint8Array()}, {ok:true}), 10)
    return () => { aborted = true; clearTimeout(timer) }
  } })
  const imported = await a.host.importApi(script(`
  lx.on('request', () => new Promise((resolve,reject)=> {
    lx.request('https://api.test/data',{headers:{Cookie:'session=test'}},(error,response,body)=> error ? reject(error) : resolve(body.ok ? 'https://ok.test/music' : 'bad'));
  }));
  lx.send('inited',{sources:{tx:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});
  lx.send('updateAlert',{log:'new version', updateUrl:'javascript:bad'});
  `))
  await a.host.setAllowShowUpdateAlert(imported.apiInfo.id, false)
  await a.host.setApi(imported.apiInfo.id)
  assert.equal((await a.host.request(req('http','musicUrl','tx',{type:'128k'}))).data.url, 'https://ok.test/music')
  assert.equal(a.events.some(e => /update_alert$/.test(e.channel)), false)
  await a.host.setAllowShowUpdateAlert(imported.apiInfo.id, true)
  await a.host.setApi(imported.apiInfo.id)
  await a.host.request(req('sync','musicUrl','tx',{type:'128k'}))
  const update = a.events.find(e => /update_alert$/.test(e.channel))
  assert.equal(update.data.log, 'new version')
  assert.equal(update.data.updateUrl, undefined)
  assert.equal(aborted, false)
})


test('unknown/prototype sources and unadvertised quality reject without executing the script', async t => {
  const a = setup(t)
  const {apiInfo} = await a.host.importApi(normal)
  await a.host.setApi(apiInfo.id)
  for (const source of ['__proto__', 'constructor', 'kw', 'mg']) await assert.rejects(a.host.request(req('bad', 'musicUrl', source)), /support/)
  await assert.rejects(a.host.request(req('quality', 'musicUrl', 'tx', {type:'flac24bit'})), /quality/)
})

test('hanging init is terminated, persisted corruption is reported and active removal stops requests', async t => {
  const broken = setup(t, { saved: {version:1,apis:[{id:'bad'}],selectedId:''} })
  await assert.rejects(broken.host.getApiList(), /persisted/)
  const timed = setup(t, { initTimeoutMs: 2500 })
  const hanging = await timed.host.importApi(script('while (true) {}'))
  await assert.rejects(timed.host.setApi(hanging.apiInfo.id), /init timeout/)
  assert.equal((await timed.host.getStatus()).status, false)
  const a = setup(t)
  const {apiInfo} = await a.host.importApi(normal)
  await a.host.setApi(apiInfo.id)
  const request = a.host.request(req('removed', 'musicUrl', 'tx', {type:'flac',slow:true}))
  const rejected = assert.rejects(request, /source changed/)
  await a.host.removeApi([apiInfo.id])
  await rejected
  assert.equal(a.saved.selectedId, '')
  assert.equal((await a.host.getStatus()).status, false)
  // A queued removal must win over a simultaneous selection using an old snapshot.
  const raced = await a.host.importApi(normal)
  const removing = a.host.removeApi([raced.apiInfo.id])
  const selecting = a.host.setApi(raced.apiInfo.id)
  const selectingCheck = assert.rejects(selecting, /api not found/)
  await removing
  await selectingCheck
  assert.equal(a.saved.selectedId, '')
})

test('lx.request abort reaches parent and invalid/multipart HTTP errors reach callback explicitly', async t => {
  let aborts = 0
  const a = setup(t, { httpRequest: () => () => { aborts++ } })
  const { apiInfo } = await a.host.importApi(script(`
  const abort = lx.request('https://abort.test/data', {}, () => {throw Error('callback after abort')});
  abort(); abort();
  lx.on('request', () => new Promise((resolve,reject) => {
    lx.request('file:///private', {}, error => {
      if (!error) return reject(Error('expected URL failure'));
      lx.request('https://multipart.test', {formData:{a:'b'}}, error => error && /multipart/.test(error.message) ? resolve('https://ok.test/music') : reject(Error('expected multipart failure')));
    });
  }));
  lx.send('inited',{sources:{tx:{type:'music',actions:['musicUrl'],qualitys:['flac']}}});
  `))
  await a.host.setApi(apiInfo.id)
  assert.equal((await a.host.request(req('http-errors'))).data.url, 'https://ok.test/music')
  assert.equal(aborts, 1)
})

test('the private worker protocol cannot be spoofed through global postMessage and direct networking rejects', async t => {
  const a = setup(t)
  const {apiInfo} = await a.host.importApi(script(`
    postMessage({kind:'init',info:{sources:{mg:{type:'music',actions:['musicUrl'],qualitys:['flac']}}}});
    let blocked = false;
    try { fetch('https://bypass.test') } catch(error) { blocked = /Unsupported capability/.test(error.message) }
    if (!blocked || typeof indexedDB !== 'undefined') throw Error('network/storage isolation missing');
    lx.on('request', async () => 'https://safe.test/music');
    lx.send('inited',{sources:{tx:{type:'music',actions:['musicUrl'],qualitys:['flac']}}});
  `))
  await a.host.setApi(apiInfo.id)
  assert.deepEqual(Object.keys((await a.host.getStatus()).apiInfo.sources), ['tx'])
  assert.equal((await a.host.request(req('safe'))).data.url, 'https://safe.test/music')
})
