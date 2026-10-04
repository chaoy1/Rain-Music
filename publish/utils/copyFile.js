const fs = require('fs')
const chalk = require('chalk')
const { jp, copyFile } = require('./index')

const buildDir = '../../build'


const getBuildFileName = () => {
  const names = []
  const pathRegExp = [
    /latest\.yml$/,
    /\.exe$/,
    /\.blockmap$/,
  ]
  const files = fs.readdirSync(jp(buildDir), 'utf8')
  files.forEach(name => {
    pathRegExp.forEach(regexp => {
      if (regexp.test(name)) names.push(name)
    })
  })
  return names
}

const copy = names => {
  const tasks = names.map(name => copyFile(jp(buildDir, name), jp('../assets', name)))
  return Promise.all(tasks)
}


module.exports = () => {
  copy(getBuildFileName()).catch(err => {
    console.log(err)
    console.log(chalk.red('File copy failed.'))
    return Promise.reject(err)
  })
}
