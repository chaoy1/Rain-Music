const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.RAIN_NO_PROTOCOL_REGISTRATION = '1'
const result = spawnSync(require('electron'), [path.join(__dirname, 'pagination.electron.cjs'), `--user-data-dir=${path.join(root, '.design/pagination-electron-data')}`], {
  cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 30000,
})
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
