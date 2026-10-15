const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const load = require('./load-ts.cjs')
const loadHost = require('./fixtures/android-user-api/load.cjs')
const root = process.env.RAIN_USER_API_TEST_ROOT || path.resolve(__dirname, '../..')

test('real renderer status handler waits for final initialization and leaves successful source playback gate true', async t => {
  const { createUserApiHost } = loadHost(path.join(root, 'src/renderer/platform/userApi/host.js'))
  let statusHandler
  let onWorkerMessage
  let finishInit
  const alerts = []
  const statuses = []
  const userApi = { status: false }
  const qualityList = { value: {} }
  const appSetting = { 'common.apiSource': 'user_api_good' }
  const apiSource = { value: '' }
  const window = { rain: { apiInitPromise: [Promise.resolve(false), true, () => {}] } }
  const host = createUserApiHost({
    storage: {
      read: () => ({ version: 1, selectedId: '', apis: ['good', 'bad'].map(name => ({ id: `user_api_${name}`, name, allowShowUpdateAlert: true, script: `/*\n * @name ${name}\n */` })) }),
      write() {},
    },
    // Worker execution has separate real-worker tests. Here the controlled port
    // holds initialization open to exercise the production renderer readiness gate.
    createSession: onMessage => {
      onWorkerMessage = onMessage
      return {
        post(message) {
          if (message.kind === 'load') finishInit = () => onMessage(message.api.id.endsWith('_bad')
            ? { kind: 'fatal', message: 'broken source' }
            : { kind: 'init', info: { sources: { tx: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } } })
          if (message.kind === 'request') queueMicrotask(() => onMessage({ kind: 'response', requestKey: message.requestKey, status: true, response: 'https://media.test/song.mp3' }))
        },
        terminate() {},
      }
    },
    httpRequest() { throw Error('unexpected HTTP') },
    emit: (_channel, params) => { statuses.push(params); statusHandler({ params }) },
  })
  t.after(() => host.dispose())
  const core = load('src/renderer/core/apiSource.ts', {
    '@renderer/store': { userApi, qualityList, apiSource },
    '@renderer/store/setting': { appSetting, setApiSource: id => { appSetting['common.apiSource'] = id } },
    '@renderer/utils/ipc': { setUserApi: id => host.setApi(id) },
    '@renderer/utils/musicSdk': {}, '@renderer/utils/musicSdk/api-source-info': [],
  }, { window })
  load('src/renderer/core/useApp/useInitUserApi.ts', {
    '@common/utils/vueTools': { onBeforeUnmount() {}, watch: () => () => {} },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/utils/ipc': {
      onUserApiStatus: callback => { statusHandler = callback; return () => {} },
      onShowUserApiUpdateAlert: () => () => {},
      sendUserApiRequest: params => host.request(params), userApiRequestCancel: key => host.cancelRequest(key),
    },
    '@renderer/platform/ipcFallback/subscribe': { subscribeSkippable: (_name, _category, install) => install() },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: {} }, '@common/utils/electron': {},
    '@renderer/store': { userApi, qualityList }, '@renderer/store/setting': { appSetting },
    '@renderer/plugins/Dialog': { dialog: message => { alerts.push(message); return Promise.resolve() } },
    '@renderer/core/apiSource': core,
  }, { window }).default()

  const selecting = core.setUserApi('user_api_good')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof onWorkerMessage, 'function')
  assert.equal(window.rain.apiInitPromise[1], false, 'initializing must not settle the playback gate as failure')
  assert.equal(alerts.length, 0)
  finishInit()
  await selecting
  assert.equal(await window.rain.apiInitPromise[0], true)
  assert.equal(userApi.status, true)
  assert.deepEqual(Object.keys(userApi.apis), ['tx'])
  assert.equal((await userApi.apis.tx.getMusicUrl({ id: 'tx_1' }, '128k').promise).url, 'https://media.test/song.mp3')
  assert.equal(alerts.length, 0)
  assert.equal(statuses.length, 1)

  appSetting['common.apiSource'] = 'user_api_bad'
  const failing = core.setUserApi('user_api_bad')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(window.rain.apiInitPromise[1], false)
  finishInit()
  await failing
  assert.equal(await window.rain.apiInitPromise[0], false)
  assert.equal(userApi.status, false)
  assert.equal(alerts.length, 1)
  assert.match(statuses.at(-1).message, /broken source/)
})
