const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.RAIN_NO_PROTOCOL_REGISTRATION = '1'
const result = spawnSync(require('electron'), [path.join(__dirname, 'refined-surfaces.electron.cjs'), `--user-data-dir=${path.join(root, '.design/refined-electron-data')}`], {
  cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 95000,
})
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
