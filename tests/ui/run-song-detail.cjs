const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const playback = spawnSync(process.execPath, [path.join(__dirname,'minimal-playback.cjs')], {cwd:root,env,stdio:'inherit',windowsHide:true})
if(playback.status!==0)process.exit(playback.status??1)
for (const harness of ['song-detail', 'detail-dock']) {
  const result = spawnSync(require('electron'), [path.join(__dirname,`${harness}.electron.cjs`), `--user-data-dir=${path.join(root,`.design/${harness}-electron-data`)}`], {cwd:root,env,stdio:'inherit',windowsHide:true,timeout:65000})
  if(result.error)console.error(result.error)
  if(result.status!==0)process.exit(result.status??1)
}
