const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const load = require('./load-ts.cjs')
// `src/common/utils/nodejs.ts` 的 gzip/gunzip 在阶段 3 换成了 `./zlib`（pako 封装，ESM .js）。
// 它是 ESM，`load-ts.cjs` 的依赖解析走的是原生 `require`，所以这里按本仓库既有的
// "显式注入依赖" 方式把它一起加载进来。
const files = load('src/common/utils/nodejs.ts', {
  '@common/utils': { log: { error() {} } },
  './zlib': load('src/common/utils/zlib.js'),
})

test('backup write errors reject instead of reporting success', async() => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'rain-backup-'))
  try {
    await assert.rejects(files.saveRainConfigFile(path.join(folder, 'missing', 'backup'), { type: 'setting_v2' }), { code: 'ENOENT' })
  } finally { await fs.rm(folder, { recursive: true, force: true }) }
})

test('resolved backup save can be immediately read with all Unicode data intact', async() => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'rain-backup-'))
  const data = { type: 'setting_v2', setting: { name: '雨声 🎵', version: '2.12.8' } }
  try {
    const filename = path.join(folder, 'backup')
    await files.saveRainConfigFile(filename, data)
    assert.equal(JSON.stringify(await files.readRainConfigFile(`${filename}.rainmc`)), JSON.stringify(data))
  } finally { await fs.rm(folder, { recursive: true, force: true }) }
})
