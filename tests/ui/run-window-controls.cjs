const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const data = path.join(root, '.design/traffic-test-data')
fs.mkdirSync(data, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(require('electron'), [path.join(__dirname, 'traffic-lights.electron.cjs'), `--user-data-dir=${data}`], {
  cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 30000,
})
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
