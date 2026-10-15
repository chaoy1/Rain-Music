const assert = require('node:assert/strict')
const {test} = require('node:test')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const path = require('node:path')
const load = require('./fixtures/android-user-api/load.cjs')
const {createUserApiUtils} = load(path.join(process.env.RAIN_USER_API_TEST_ROOT || path.resolve(__dirname,'../..'),'src/renderer/platform/userApi/utils.js'))
const utils = createUserApiUtils(crypto.webcrypto)

test('public AES CBC/ECB helpers match Node output for every supported key size', () => {
  const input = Buffer.from('Rain Music 中文 helper')
  for (const size of [128,192,256]) for (const mode of ['cbc','ecb']) {
    const algorithm = `aes-${size}-${mode}`
    const key = crypto.randomBytes(size/8)
    const iv = mode === 'cbc' ? crypto.randomBytes(16) : null
    const cipher = crypto.createCipheriv(algorithm, key, iv)
    assert.equal(utils.crypto.aesEncrypt(input, algorithm, key, iv).toString('hex'), Buffer.concat([cipher.update(input),cipher.final()]).toString('hex'))
  }
  assert.throws(() => utils.crypto.aesEncrypt(input,'aes-256-gcm',Buffer.alloc(32),Buffer.alloc(16)), /Unsupported AES/)
  assert.throws(() => utils.crypto.aesEncrypt(input,'aes-256-cbc',Buffer.alloc(16),Buffer.alloc(16)), /key length/)
})

test('buffer/md5/randomBytes and zlib preserve public return types and reject malformed data', async() => {
  const input = Buffer.from('中文 Rain Music')
  assert.equal(utils.crypto.md5(input), crypto.createHash('md5').update(input).digest('hex'))
  assert.equal(utils.crypto.md5('hello'), crypto.createHash('md5').update('hello').digest('hex'))
  assert.equal(utils.buffer.bufToString(utils.buffer.from('hello'),'base64'), 'aGVsbG8=')
  const random = utils.crypto.randomBytes(70000)
  assert.equal(Buffer.isBuffer(random), true)
  assert.equal(random.length, 70000)
  assert.throws(() => utils.crypto.randomBytes(-1), /Invalid/)
  assert.equal((await utils.zlib.inflate(zlib.deflateSync(input))).toString(), input.toString())
  assert.equal(zlib.inflateSync(await utils.zlib.deflate(input)).toString(), input.toString())
  await assert.rejects(utils.zlib.inflate(Buffer.from('broken')))
})

test('public RSA encryption matches Node RSA_NO_PADDING and retains the modulus width', () => {
  const {publicKey} = crypto.generateKeyPairSync('rsa',{modulusLength:1024,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const input = Buffer.from('rain music')
  const padded = Buffer.alloc(128)
  input.copy(padded,128-input.length)
  const output = utils.crypto.rsaEncrypt(input,publicKey)
  assert.equal(output.length,128)
  assert.equal(output.toString('hex'),crypto.publicEncrypt({key:publicKey,padding:crypto.constants.RSA_NO_PADDING},padded).toString('hex'))
})
