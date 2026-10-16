const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const data = path.join(root, '.design/setting-download-shell-data')
fs.mkdirSync(data, { recursive: true })
const env = { ...process.env }
// 本机环境里 ELECTRON_RUN_AS_NODE=1 会让 electron 退化成纯 Node，必须显式清掉。
delete env.ELECTRON_RUN_AS_NODE
env.RAIN_NO_PROTOCOL_REGISTRATION = '1'
const result = spawnSync(require('electron'), [path.join(__dirname, 'setting-download-shell.electron.cjs'), `--user-data-dir=${data}`], {
  cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 60000,
})
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
