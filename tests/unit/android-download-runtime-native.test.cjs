const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const java = process.env.RAIN_DOWNLOAD_JAVA_SOURCE || path.join(root, 'android/app/src/main/java/com/rainmusic/mobile/ipc')

test('native HTTP/filesystem probe: exact bytes, HTTP errors, range validation, pause/resume, cancellation, traversal, atomic lyric and MP3 metadata writes', () => {
  assert.ok(fs.existsSync(path.join(java, 'RainMusicDownloadTaskChannels.java')), 'Native download executor must exist')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-download-'))
  try {
    const text = fs.readFileSync(path.join(__dirname, 'android-playback-queue-merge.test.cjs'), 'utf8')
    const ast = ts.createSourceFile('stubs.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    let source
    for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(ast) === 'STUBS') source = declaration.initializer.getText(ast)
    const json = vm.runInNewContext(`(${source})`)
    const stubs = Object.fromEntries(Object.entries(json).filter(([name]) => name.startsWith('org/json/')))
    Object.assign(stubs, {
      'android/content/Context.java': 'package android.content; public class Context { private final java.io.File root; public Context(java.io.File root){this.root=root;} public Context getApplicationContext(){return this;} public java.io.File getExternalFilesDir(String type){return root;} public java.io.File getFilesDir(){return root;} }',
      'android/system/Os.java': 'package android.system; public class Os { public static void rename(String from,String to) throws Exception { java.nio.file.Files.move(java.nio.file.Path.of(from), java.nio.file.Path.of(to), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING); } }',
      'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': 'package com.rainmusic.mobile.ipc; public class RainMusicIpcPlugin {}',
      'com/rainmusic/mobile/ipc/DownloadRuntimeProbe.java': fs.readFileSync(path.join(__dirname, 'fixtures/android-download-runtime/DownloadRuntimeProbe.java'), 'utf8'),
    })
    const stub = path.join(temp, 'stubs'); const out = path.join(temp, 'out'); fs.mkdirSync(out)
    for (const [name, contents] of Object.entries(stubs)) { const file = path.join(stub, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents) }
    const sources = ['RainMusicIpcHandlers', 'RainMusicDownloadTaskChannels'].map(name => path.join(java, `${name}.java`))
    const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-sourcepath', stub, '-d', out, path.join(stub, 'com/rainmusic/mobile/ipc/DownloadRuntimeProbe.java'), ...sources], { encoding: 'utf8', timeout: 60000 })
    assert.equal(compile.status, 0, compile.stderr)
    const result = spawnSync('java', ['-cp', out, 'com.rainmusic.mobile.ipc.DownloadRuntimeProbe', path.join(temp, 'files')], { encoding: 'utf8', timeout: 60000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /DOWNLOAD_RUNTIME_OK/)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('completion deletes the resume manifest before renaming the media file into place', () => {
  // Ordering-only invariant: a failed manifest delete must leave the task retryable, so the
  // delete has to happen *before* the rename. The JVM probe cannot force `File.delete()` to
  // fail while the earlier manifest *write* still succeeds, so this is pinned by source order
  // (same technique the repo uses for the MainActivity plugin-registration ordering).
  const source = fs.readFileSync(path.join(java, 'RainMusicDownloadTaskChannels.java'), 'utf8')
  const deleteAt = source.indexOf('Cannot remove resume manifest')
  const moveAt = source.indexOf('move(part, task.file);')
  assert.ok(deleteAt > 0, 'the completion path must delete the resume manifest')
  assert.ok(moveAt > 0, 'the completion path must rename the partial into place')
  assert.ok(deleteAt < moveAt, 'the manifest must be deleted BEFORE the rename, otherwise a failed delete reports an already-committed file as an error')
})

test('native compiler checks against real Android Context and checked AOSP JSON signatures', { skip: !fs.existsSync(path.join(os.tmpdir(), 'rain-json-probe/vendor/android-json-aosp.jar')) && 'Real Android/AOSP jars are not installed on this host' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-download-api-'))
  try {
    const stub = path.join(temp, 'stub'); const out = path.join(temp, 'out'); fs.mkdirSync(out)
    fs.cpSync(path.join(os.tmpdir(), 'rain-json-probe/module-stubs'), stub, { recursive: true })
    for (const [name, code] of Object.entries({
      'android/system/Os.java': 'package android.system; public class Os { public static void rename(String from,String to) throws Exception {} }',
    })) { const file = path.join(stub, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, code) }
    const vendor = path.join(os.tmpdir(), 'rain-json-probe/vendor')
    const classpath = [path.join(vendor, 'android-json-aosp.jar'), path.join(vendor, 'android-4.1.1.4.jar')].join(path.delimiter)
    const args = ['-encoding', 'UTF-8', '-cp', classpath, '-sourcepath', stub, '-d', out]
    const production = path.join(root, 'android/app/src/main/java')
    const sources = fs.readdirSync(production, { recursive: true }).filter(file => file.endsWith('.java')).map(file => path.join(production, file))
    const result = spawnSync('javac', [...args, ...sources], { encoding: 'utf8', timeout: 60000 })
    assert.equal(result.status, 0, result.stderr)
    const invalid = path.join(temp, 'UncheckedJson.java'); fs.writeFileSync(invalid, 'class UncheckedJson { void run() { new org.json.JSONObject().put("key", "value"); } }')
    const negative = spawnSync('javac', [...args, invalid], { encoding: 'utf8', timeout: 60000 })
    assert.notEqual(negative.status, 0); assert.match(negative.stderr, /JSONException/)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
