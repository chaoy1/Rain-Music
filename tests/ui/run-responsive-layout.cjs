const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const env = { ...process.env, RAIN_NO_PROTOCOL_REGISTRATION: '1' }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(require('electron'), [path.join(__dirname, 'responsive-layout.electron.cjs'), `--user-data-dir=${path.join(root, '.design/responsive-electron')}`], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 180000 })
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
