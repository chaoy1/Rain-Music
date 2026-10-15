const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-capacitor.cjs')
const MODULE = process.env.RAIN_USER_API_TEST_ROOT ? require('node:path').join(process.env.RAIN_USER_API_TEST_ROOT, 'src/common/platform/ipcBridge/capacitor.js') : 'src/common/platform/ipcBridge/capacitor.js'

test('user API invokes and send cancellation stay in WebView with no native plugin', async() => {
  const calls = []
  const module = load(MODULE, {}, { __RAIN_CAPACITOR_IPC__: { userApiFactory: () => ({ invoke: async (channel, params) => { calls.push([channel, params]); return 'local-result' } }) } })
  const channels = ['import_user_api','get_user_api_list','remove_user_api','set_user_api','get_user_api_status','request_user_api','user_api_set_allow_update_alert']
  for (const suffix of channels) assert.equal(await module.bridge.invoke(`winMain_${suffix}`, {value:1}), 'local-result')
  module.bridge.send('winMain_request_user_api_cancel', 'cancel-me')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 8)
  assert.equal(calls.at(-1)[1], 'cancel-me')
})

test('user API event subscriptions are local and preserve once/off without native attach', async() => {
  let emit
  const module = load(MODULE, {}, { __RAIN_CAPACITOR_IPC__: { userApiFactory: callback => { emit = callback; return {invoke:async()=> []} } } })
  const channel = 'winMain_user_api_status'
  const seen = []
  const listener = event => seen.push(event.params.status)
  module.bridge.on(channel, listener)
  module.bridge.once(channel, event => seen.push(event.params.status ? 'once' : 'bad'))
  await module.bridge.invoke('winMain_get_user_api_list')
  emit(channel, {status:true})
  emit(channel, {status:false})
  module.bridge.off(channel, listener)
  assert.equal(JSON.stringify(seen), JSON.stringify([true,'once',false]))
  module.bridge.on('winMain_user_api_show_update_alert', listener)
  module.bridge.offAll('winMain_user_api_show_update_alert')
})
