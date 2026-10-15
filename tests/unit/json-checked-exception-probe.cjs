const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Compile against the suite's own JSON stubs. A valid caller must compile first;
// each unchecked caller must then fail at its own call, specifically for JSONException.
module.exports = (stubs, calls) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-json-signatures-'))
  try {
    const stubRoot = path.join(dir, 'stub')
    const outDir = path.join(dir, 'out')
    fs.mkdirSync(outDir, { recursive: true })
    for (const [relative, source] of Object.entries(stubs)) {
      if (!relative.startsWith('org/json/')) continue
      const file = path.join(stubRoot, ...relative.split('/'))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, source, 'utf8')
    }
    const compile = (name, source) => {
      const file = path.join(dir, `${name}.java`)
      fs.writeFileSync(file, source, 'utf8')
      const logFile = path.join(dir, `${name}.log`)
      const fd = fs.openSync(logFile, 'w')
      let result
      try {
        result = spawnSync('javac', [
          '-encoding', 'UTF-8', '-sourcepath', stubRoot, '-d', outDir, file,
        ], { cwd: dir, stdio: ['ignore', fd, fd] })
      } finally {
        fs.closeSync(fd)
      }
      assert.ifError(result.error)
      return { status: result.status, log: fs.readFileSync(logFile, 'utf8') }
    }
    const imports = 'import org.json.JSONObject;\nimport org.json.JSONArray;\n'
    const valid = compile('CheckedCaller', `${imports}public class CheckedCaller {
      static void call() throws org.json.JSONException {
        ${calls.map(([, expression]) => `${expression};`).join('\n')}
      }
    }`)
    assert.equal(valid.status, 0, `JSON 替身或调用方本身编不过，不能把环境故障当成负向验证：\n${valid.log}`)
    for (const [name, expression] of calls) {
      const invalid = compile(name, `${imports}public class ${name} {
        static void call() { ${expression}; }
      }`)
      assert.notEqual(invalid.status, 0, `${name}: 不处理 JSONException 的调用方居然编过了，替身比 Android API 宽松`)
      const diagnostic = invalid.log.split(/\r?\n/).find(line => line.includes(`${name}.java:`))
      assert.ok(diagnostic, `${name}: 失败必须定位到调用方，不能是替身自身坏了：\n${invalid.log}`)
      assert.match(diagnostic, /JSONException/, `${name}: 必须因未处理受检 JSONException 而失败：\n${invalid.log}`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
