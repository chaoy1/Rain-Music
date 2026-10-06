const fs = require('node:fs')
const path = require('node:path')

module.exports = root => {
  const workspace = path.resolve(root)
  // Packaged applications may contain portable user data; preserve build/.
  for (const name of ['dist']) {
    const target = path.resolve(workspace, name)
    if (path.dirname(target) !== workspace) throw new Error('Output cleanup escaped the workspace')
    fs.rmSync(target, { recursive: true, force: true })
  }
}
