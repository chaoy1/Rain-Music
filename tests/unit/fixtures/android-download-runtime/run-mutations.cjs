// Optional destructive-behavior probes run exclusively against temp copies.
// Usage: node tests/unit/fixtures/android-download-runtime/run-mutations.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-download-mutations-'))
const jsFile = path.join(root, 'src/renderer/platform/download/android.ts')
const pureFile = path.join(root, 'src/renderer/platform/download/pure.ts')
const actionFile = path.join(root, 'src/renderer/store/download/action.ts')
const javaDir = path.join(root, 'android/app/src/main/java/com/rainmusic/mobile/ipc')
const original = Object.fromEntries([jsFile, pureFile, actionFile, path.join(javaDir, 'RainMusicDownloadTaskChannels.java'), path.join(javaDir, 'RainMusicIpcHandlers.java')].map(file => [file, fs.readFileSync(file, 'utf8')]))
const replace = (source, before, after) => { assert.ok(source.includes(before), `Mutation anchor absent: ${before}`); return source.replace(before, after) }
const report = []
function probe(name, sourceFile, mutate, pattern, expected, native = false, store = false) {
  const directory = path.join(output, name); fs.mkdirSync(directory)
  const target = path.join(directory, path.basename(sourceFile)); fs.writeFileSync(target, mutate(original[sourceFile]))
  const env = { ...process.env }
  if (native) {
    fs.writeFileSync(path.join(directory, 'RainMusicIpcHandlers.java'), original[path.join(javaDir, 'RainMusicIpcHandlers.java')])
    env.RAIN_DOWNLOAD_JAVA_SOURCE = directory
    env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ''} -Drain.probe.timeoutMs=2500`
  } else env[sourceFile === jsFile ? 'RAIN_DOWNLOAD_JS_SOURCE' : sourceFile === pureFile ? 'RAIN_DOWNLOAD_PURE_SOURCE' : 'RAIN_DOWNLOAD_ACTION_SOURCE'] = target
  const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${pattern}`, path.join(root, `tests/unit/android-download-runtime${native ? '-native' : store ? '-store' : ''}.test.cjs`)], { cwd: root, env, encoding: 'utf8', timeout: 60000 })
  const log = result.stdout + result.stderr; fs.writeFileSync(path.join(directory, 'result.log'), log)
  assert.ifError(result.error); assert.notEqual(result.status, 0, `${name}: mutant survived`); assert.match(log, expected, `${name}: failed for an unrelated reason`)
  report.push({ name, caught: true, log: path.join(directory, 'result.log') })
  console.log(`${name}: caught`)
}
probe('browser-node-import', jsFile, s => `import fs from 'fs'\n${s}`, 'independently of Node', /does not match|must not match|input was expected to not match/)
probe('quality-selection', pureFile, s => replace(s, "let selected: Rain.Quality = '128k'", "let selected: Rain.Quality = '128k'").replace("selected = QUALITYS.slice", "selected = false ? QUALITYS.slice").replace("?? '128k'", "?? '128k' : '128k'"), 'quality fallback', /wy_1_128k_mp3/)
probe('route-task-id', jsFile, s => replace(s, 'callbacks.get(params.id)', "callbacks.get('a')"), 'routes native action', /other|complete|deep-equal/)
probe('native-path-update', jsFile, s => replace(s, 'downloadInfo.metadata.filePath = result.filePath', 'downloadInfo.metadata.filePath = ""'), 'original signature', /private\/downloads\/a.mp3/)
probe('lyric-payload', jsFile, s => replace(s, 'text: buildLyrics(lyric, info.downloadRainlrc, info.downloadTlrc, info.downloadRlrc)', 'text: ""'), 'lyric and metadata writes', /hello/)
probe('premature-completion', jsFile, s => replace(s, 'if (!current.ready) current.queue.push(params.action)', 'if (!current.ready) current.callback(params.action)'), 'queued native complete', /1 !== 0/)
probe('windows-preference', jsFile, s => replace(s, "savePath: '', skipExistFile", 'savePath, skipExistFile'), 'imported Windows', /Users/)
probe('generation-command', jsFile, s => replace(s, "{ id, url, token }", '{ id, url }'), 'current generation token', /undefined/)
probe('late-start-rejection', jsFile, s => replace(s, 'if (callbacks.get(downloadInfo.id) !== current) return\n        callbacks.delete', 'if (false) return\n        callbacks.delete'), 'rejected stale start', /late old failure/)
probe('metadata-rejection', actionFile, s => replace(s, 'return window.rain.worker.download.writeMeta', 'void window.rain.worker.download.writeMeta'), 'store observes metadata', /tag failed/)
probe('store-start-slots', actionFile, s => replace(s, 'void handleStartTask(downloadInfo).catch', 'void handleStartTask(downloadInfo).then'), 'start rejection', /native start failed/, false, true)
probe('store-refresh-slots', actionFile, s => replace(s, 'return window.rain.worker.download.updateUrl', 'void window.rain.worker.download.updateUrl'), 'refresh rejection', /native refresh failed/, false, true)
probe('store-remove-scope', actionFile, s => replace(s, 'idsSet.has(task.id) && runingTask.has(task.id)', 'runingTask.has(task.id)'), 'deletion of a waiting', /a|deep-equal/, false, true)
const nativeFile = path.join(javaDir, 'RainMusicDownloadTaskChannels.java')
const nativeProbe = (name, mutate, expected) => probe(name, nativeFile, mutate, '^native HTTP', expected, true)
nativeProbe('truncated-body', s => replace(s, 'if (downloaded != total) throw', 'if (false) throw'), /short missing error/)
nativeProbe('async-acknowledgement', s => replace(s, 'executor.execute(() -> transfer(task));', 'transfer(task);'), /start must not wait for slow HTTP/)
nativeProbe('resume-range', s => replace(s, 'if (begin != offset ||', 'if (false && (begin != offset ||').replace('throw new IOException("Resume validation failed");', 'throw new IOException("Resume validation failed");').replace('!validator.equals(currentValidator)))) throw', '!validator.equals(currentValidator))))) throw'), /bad missing error/)
nativeProbe('range-ignored', s => replace(s, '} else offset = 0;', '} else offset = offset;'), /ignored missing complete/)
nativeProbe('old-token-cancel', s => replace(s, 'task.token.equals(params.opt("token"))', 'true'), /No live download task for generation|generation missing complete/)
nativeProbe('resource-url-binding', s => replace(s, ' || !task.url.toExternalForm().equals(saved.getProperty("url"))', ''), /cross missing complete|cross-resource ETag must not mix bytes/)
nativeProbe('redirect-target-binding', s => replace(s, 'if (offset > 0 && !responseUrl.equals(saved.getProperty("responseUrl"))) throw', 'if (false) throw'), /redirect missing error/)
nativeProbe('keep-completed-media', s => replace(s, 'tasks.remove(id); task.stop();', 'tasks.remove(id); task.stop(); task.file.delete();'), /remove must preserve completed file/)
nativeProbe('lyric-io', s => replace(s, 'move(temp,file);\n        }\n    }\n    private void writeMeta', '// skipped write\n        }\n    }\n    private void writeMeta'), /good.lrc|NoSuchFileException/)
nativeProbe('metadata-io', s => replace(s, 'move(temp,file);\n        }\n    }\n    private static byte[] textFrame', '// skipped write\n        }\n    }\n    private static byte[] textFrame'), /real ID3 header/)
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
for (const [file, source] of Object.entries(original)) assert.equal(fs.readFileSync(file, 'utf8'), source, `Original source changed: ${file}`)
console.log(`MUTATIONS ${report.length}/${report.length} caught; originals unchanged; evidence ${output}`)
