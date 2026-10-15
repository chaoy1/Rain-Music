const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
module.exports = function load(filename, globals = {}) {
  filename = path.resolve(filename)
  const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(require('node:url').pathToFileURL(filename).href))
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText
  const module = { exports: {} }
  const nativeRequire = require('node:module').createRequire(filename)
  const localRequire = name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name.endsWith('.js') ? name : `${name}.js`), globals) : nativeRequire(name)
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled)(localRequire, module, module.exports, ...Object.values(globals))
  return module.exports
}
