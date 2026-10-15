const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const {spawnSync} = require('node:child_process')
const repository = path.resolve(__dirname,'../../../..')
const location = fs.mkdtempSync(path.join(os.tmpdir(),'rain-user-api-mutations-'))
const base = 'src/renderer/platform/userApi/'
const cases = [
  {name:'failed-persistence-rollback',file:base+'host.js',from:'await storage.write(next)',to:'snapshot = next; await storage.write(next)',suite:'host',pattern:'imports persist raw scripts'},
  {name:'platform-whitelist',file:base+'contract.js',from:"local: { actions: ['musicUrl', 'lyric', 'pic'], qualitys: [] },",to:"local: { actions: ['musicUrl', 'lyric', 'pic'], qualitys: [] }, mg: {actions:['musicUrl'],qualitys:['flac']},",suite:'host',pattern:'real worker initializes'},
  {name:'switch-pending-rejection',file:base+'host.js',from:'for (const key of pending.keys()) settle(key, new Error(reason))',to:'// mutation: retain stale pending requests',suite:'host',pattern:'cancel, timeout and switching'},
  {name:'result-url-validation',file:base+'contract.js',from:"case 'pic': result = httpUrl(response); break",to:"case 'pic': result = response; break",suite:'host',pattern:'script errors, malformed responses'},
  {name:'update-permission',file:base+'host.js',from:'if (!selected.allowShowUpdateAlert) return',to:'// mutation: ignore update permission',suite:'host',pattern:'HTTP runs in parent'},
  {name:'prototype-source',file:base+'host.js',from:'Object.hasOwn(status.apiInfo.sources, data.source) ? status.apiInfo.sources[data.source] : null',to:'status.apiInfo.sources[data.source]',suite:'host',pattern:'unknown/prototype sources'},
  {name:'init-timeout-fails-open',file:base+'host.js',from:"fail(new Error('User API init timeout'))",to:'initPending.resolve()',suite:'host',pattern:'hanging init is terminated'},
  {name:'http-abort-not-forwarded',file:base+'worker-runtime.js',from:"post({ kind: 'httpCancel', id })",to:'// mutation: abort dropped',suite:'host',pattern:'lx.request abort reaches parent'},
  {name:'direct-network-not-disabled',file:base+'worker-runtime.js',from:"['fetch', 'XMLHttpRequest'",to:"['XMLHttpRequest'",suite:'host',pattern:'the private worker protocol'},
  {name:'bridge-local-invoke',file:'src/common/platform/ipcBridge/capacitor.js',from:'if (USER_API_LOCAL_CHANNELS.has(channel)) return invokeLocalUserApi(channel, args)',to:'// mutation: route all invokes to native',suite:'bridge',pattern:'user API invokes and send'},
  {name:'bridge-local-events',file:'src/common/platform/ipcBridge/capacitor.js',from:'if (!USER_API_LOCAL_EVENTS.has(channel)) attachTransport()',to:'attachTransport()',suite:'bridge',pattern:'user API event subscriptions'},
  {name:'aes-result',file:base+'utils.js',from:'return bytes(encrypted.ciphertext)',to:'return Buffer.alloc(16)',suite:'utils',pattern:'public AES CBC/ECB'},
  {name:'md5-result',file:base+'utils.js',from:"CryptoJS.MD5(wordArray(value)).toString(CryptoJS.enc.Hex)",to:"'broken-md5'",suite:'utils',pattern:'buffer/md5/randomBytes'},
  {name:'rsa-result',file:base+'utils.js',from:'rsaEncrypt: rsaPublicEncryptNoPadding,',to:'rsaEncrypt: () => Buffer.alloc(128),',suite:'utils',pattern:'public RSA encryption'},
  {name:'storage-corruption-hidden',file:base+'web.js',from:'return value == null ? null : JSON.parse(value)',to:'try { return value == null ? null : JSON.parse(value) } catch (_) { return null }',suite:'web',pattern:'real localStorage adapter'},
  {name:'http-status-lost',file:base+'web.js',from:'statusCode: response.status,',to:'statusCode: 200,',suite:'web',pattern:'WebView HTTP adapter'},
]
const outcomes = []
for (const mutant of cases) {
  const target = path.join(location,mutant.name)
  fs.cpSync(path.join(repository,'src/renderer/platform/userApi'),path.join(target,base),{recursive:true})
  fs.cpSync(path.join(repository,'src/renderer/platform/http'),path.join(target,'src/renderer/platform/http'),{recursive:true})
  fs.cpSync(path.join(repository,'src/common/utils/crypto'),path.join(target,'src/common/utils/crypto'),{recursive:true})
  fs.cpSync(path.join(repository,'src/common/platform/ipcBridge/capacitor.js'),path.join(target,'src/common/platform/ipcBridge/capacitor.js'))
  fs.copyFileSync(path.join(repository,'src/common/utils/zlib.js'),path.join(target,'src/common/utils/zlib.js'))
  const file = path.join(target,mutant.file)
  const original = fs.readFileSync(file,'utf8')
  if (!original.includes(mutant.from)) throw Error(`Mutation anchor absent: ${mutant.name}`)
  fs.writeFileSync(file, original.replace(mutant.from,mutant.to))
  const result = spawnSync(process.execPath,['--test',`--test-name-pattern=${mutant.pattern}`,path.join(repository,`tests/unit/android-user-api-${mutant.suite}.test.cjs`)],{cwd:repository,env:{...process.env,RAIN_USER_API_TEST_ROOT:target,NODE_PATH:path.join(repository,'node_modules')},encoding:'utf8',timeout:40000})
  const output = result.stdout+result.stderr
  const killed = result.status !== 0 && /(?:fail 1|not ok|✖)/.test(output) && !/ERR_MODULE_NOT_FOUND|ENOENT|MODULE_NOT_FOUND/.test(output)
  fs.writeFileSync(path.join(target,'result.txt'),output)
  const outcome = {name:mutant.name,test:mutant.pattern,suite:mutant.suite,killed,exitCode:result.status}
  outcomes.push(outcome)
  console.log(`${mutant.name}: ${killed ? 'killed' : 'SURVIVED/ERROR'}`)
}
fs.writeFileSync(path.join(location,'summary.json'),JSON.stringify(outcomes,null,2))
console.log(JSON.stringify({location,total:outcomes.length,killed:outcomes.filter(outcome=>outcome.killed).length},null,2))
if (outcomes.some(outcome => !outcome.killed)) process.exitCode = 1
