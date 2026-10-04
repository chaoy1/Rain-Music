const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname,'../..')
const env = {...process.env}
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(require('electron'),[path.join(__dirname,'shell-refinement.electron.cjs'),`--user-data-dir=${path.join(root,'.design/shell-electron-data')}`],{cwd:root,env,stdio:'inherit',windowsHide:true,timeout:65000})
if(result.error)console.error(result.error)
process.exit(result.status??1)
