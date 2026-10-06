const path = require('node:path')
const { spawnSync } = require('node:child_process')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.RAIN_NO_PROTOCOL_REGISTRATION = '1'
const root = path.resolve(__dirname, '../..')
const result = spawnSync(require('electron'), [path.join(__dirname, 'settings-layout.electron.cjs'), `--user-data-dir=${path.join(root, '.design/settings-layout-electron')}`], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 45000 })
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
