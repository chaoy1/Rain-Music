const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const load = require('./load-ts.cjs')
const files = load('src/common/utils/nodejs.ts', { '@common/utils': { log: { error() {} } } })

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
