const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const ts = require('typescript')

module.exports = (relativePath, dependencies = {}, globals = {}) => {
  const filename = path.resolve(__dirname, '../..', relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const exports = {}
  const nativeRequire = createRequire(filename)
  const context = {
    exports,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name),
    console, process, Buffer, URL, setInterval, clearInterval, setTimeout, clearTimeout,
    ...globals,
  }
  context.global = context
  vm.runInNewContext(source, context, { filename })
  return exports
}
