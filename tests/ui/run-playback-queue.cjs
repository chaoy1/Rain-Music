const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const env = { ...process.env, RAIN_NO_PROTOCOL_REGISTRATION: '1' }
delete env.ELECTRON_RUN_AS_NODE
for (const phase of ['interactions', 'restart']) {
  const result = spawnSync(require('electron'), [path.join(__dirname, 'playback-queue.electron.cjs'), `--user-data-dir=${path.join(root, '.design/playback-queue-electron')}`], { cwd: root, env: { ...env, RAIN_QUEUE_TEST_PHASE: phase }, stdio: 'inherit', windowsHide: true, timeout: 60000 })
  if (result.error) console.error(result.error)
  if (result.status !== 0) process.exit(result.status ?? 1)
}
