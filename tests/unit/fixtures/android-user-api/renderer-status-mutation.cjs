// Reinstate the premature terminal status only in a TEMP copy; never mutate checkout files.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const relative = 'src/renderer/platform/userApi'
const source = path.join(root, relative, 'host.js')
const original = fs.readFileSync(source)
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-user-api-renderer-mutation-'))
fs.cpSync(path.join(root, relative), path.join(directory, relative), { recursive: true })
const file = path.join(directory, relative, 'host.js')
const before = "status = { status: false, apiInfo: publicApi(selected), message: 'initing' }"
assert.ok(original.toString().includes(before), 'Mutation anchor absent')
fs.writeFileSync(file, original.toString().replace(before, "publish({ status: false, apiInfo: publicApi(selected), message: 'initing' })"))
const result = spawnSync(process.execPath, ['--test', path.join(root, 'tests/unit/android-user-api-renderer.test.cjs')], {
  cwd: root, env: { ...process.env, RAIN_USER_API_TEST_ROOT: directory }, encoding: 'utf8', timeout: 30000,
})
const output = result.stdout + result.stderr
fs.writeFileSync(path.join(directory, 'result.log'), output)
assert.ifError(result.error)
assert.notEqual(result.status, 0, 'Premature failure status mutant survived')
assert.match(output, /initializing must not settle the playback gate as failure/)
assert.deepEqual(fs.readFileSync(source), original, 'Original host was modified')
fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ name: 'premature-terminal-init-status', caught: true, originalSha256: crypto.createHash('sha256').update(original).digest('hex') }, null, 2))
console.log(`MUTATION 1/1 caught; original unchanged; evidence ${directory}`)
