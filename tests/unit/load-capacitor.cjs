const load = require('./load-ts.cjs')
module.exports = (file, dependencies = {}, globals = {}) => load(file, {
  '../filePicker/web': load('src/common/platform/filePicker/web.js', {
    '../selectedFiles.js': load('src/common/platform/selectedFiles.js', {}, globals),
  }, globals),
  ...dependencies,
}, globals)
