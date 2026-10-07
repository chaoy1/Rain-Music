const path = require('node:path')
const { spawnSync } = require('node:child_process')
const env = { ...process.env, RAIN_NO_PROTOCOL_REGISTRATION: '1' }
delete env.ELECTRON_RUN_AS_NODE
const root = path.resolve(__dirname, '../..')
const result = spawnSync(require('electron'), [path.join(__dirname, 'play-controls-refresh.electron.cjs'), `--user-data-dir=${path.join(root, '.design/play-controls-refresh-electron')}`], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 50000 })
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
