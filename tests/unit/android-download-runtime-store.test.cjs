const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./load-ts.cjs')
const constants = load('src/common/constants.ts')
const setup = ({ rejectStart = false, rejectUpdate = false } = {}) => {
  const calls = []; let listener
  const bridge = { on: (_channel, callback) => { listener = callback }, invoke: async(channel, payload) => {
    calls.push({ channel, payload })
    if (channel.endsWith('_start') && rejectStart) throw new Error('native start failed')
    if (channel.endsWith('_update_url') && rejectUpdate) throw new Error('native refresh failed')
    return { filePath: '/private/downloads/a.mp3' }
  } }
  const facade = load('src/renderer/platform/download/android.ts', { '@common/platform/ipcBridge': { bridge }, './pure': {}, '../../worker/download/lrcTool': { buildLyrics: () => '' } }).createAndroidDownloadFacade(bridge)
  const tasks = ['a', 'b', 'c', 'd'].map(id => ({ id, status: 'pause', statusText: '', metadata: { url: `http://host/${id}`, fileName: `${id}.mp3`, filePath: '', musicInfo: { meta: {} } } }))
  const action = load(process.env.RAIN_DOWNLOAD_ACTION_SOURCE || 'src/renderer/store/download/action.ts', {
    '@renderer/utils/ipc': { downloadTasksUpdate: async() => {}, downloadTasksRemove: async() => {} },
    './state': { downloadList: tasks }, '@common/utils/vueTools': { markRaw: x => x, toRaw: x => x },
    '@renderer/core/music/online': { getMusicUrl: async() => 'http://host/refreshed' },
    '..': { qualityList: { value: {} } }, '@renderer/worker/utils': { proxyCallback: x => x },
    '@renderer/utils': { arrPush: (a, b) => a.push(...b), arrUnshift: (a, b) => a.unshift(...b), joinPath: (a, b) => `${a}/${b}` },
    '@common/constants': constants, './utils': { buildSavePath: () => '/preference' },
  }, { window: { rain: { worker: { download: facade } }, i18n: { t: key => key }, app_event: { downloadListUpdate() {} } } })
  return { action, tasks, calls, emit: (id, action) => {
    const start = calls.find(call => call.channel.endsWith('_start') && call.payload.downloadInfo.id === id)
    listener({ params: { id, token: start.payload.token, action: { action } } })
  } }
}
const settle = async(predicate) => {
  const end = Date.now() + 2000
  while (!predicate() && Date.now() < end) await new Promise(resolve => setImmediate(resolve))
  assert.ok(predicate(), 'Expected store state did not settle')
}
test('real store + facade start rejection marks failures and releases all three download slots', async() => {
  const { action, tasks, calls } = setup({ rejectStart: true })
  await action.startDownloadTasks(tasks)
  await settle(() => tasks.every(task => task.status === 'error'))
  assert.equal(calls.filter(call => call.channel.endsWith('_start')).length, 4)
  assert.deepEqual(tasks.map(task => task.statusText), ['native start failed', 'native start failed', 'native start failed', 'native start failed'])
})
test('real store + facade refresh rejection marks only that task failed and starts waiting work', async() => {
  const { action, tasks, calls, emit } = setup({ rejectUpdate: true })
  await action.startDownloadTasks(tasks)
  await settle(() => calls.filter(call => call.channel.endsWith('_start')).length === 3)
  emit('a', 'refreshUrl')
  await settle(() => tasks[0].status === 'error' && tasks[3].status === 'run')
  assert.equal(tasks[0].statusText, 'native refresh failed')
  assert.deepEqual(tasks.slice(1).map(task => task.status), ['run', 'run', 'run'])
})
test('real store deletion of a waiting task preserves every unrelated running native task', async() => {
  const { action, tasks, calls } = setup()
  await action.startDownloadTasks(tasks)
  await settle(() => calls.filter(call => call.channel.endsWith('_start')).length === 3)
  await action.removeDownloadTasks(['d'])
  assert.deepEqual(tasks.map(task => task.id), ['a', 'b', 'c'])
  assert.deepEqual(calls.filter(call => call.channel.endsWith('_remove')).map(call => call.payload.id), [])
  await action.removeDownloadTasks(['a'])
  await settle(() => calls.some(call => call.channel.endsWith('_remove')))
  assert.deepEqual(calls.filter(call => call.channel.endsWith('_remove')).map(call => call.payload.id), ['a'])
  assert.deepEqual(tasks.map(task => task.status), ['run', 'run'])
})
