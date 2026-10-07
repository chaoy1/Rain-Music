/**
 * Android 移植 · 阶段 3 / 线 A 的单测：
 *
 * 1. `wy` 的 `RSA_NO_PADDING` 纯 JS 实现与 `node:crypto` **逐字节一致**（陷阱 1 的载体）；
 * 2. 密文首字节为 `0x00` 的样本仍然输出 256 个 hex 字符（`padStart` 陷阱，实测 ≈1/375）；
 * 3. `crypto-js` 的 key 必须传 typed array（普通数组结果不同 —— 陷阱 2）；
 * 4. 真实产品代码 `src/renderer/utils/musicSdk/wy/utils/crypto.js` 的 weapi / eapi / linuxapi
 *    输出与 `node:crypto` 参考实现逐字节一致（用确定性的 `getRandomValues` 钉住随机源）；
 * 5. `pako` 替换后的三条 zlib 语义与 `node:zlib` 等价（含 qrcDecode 依赖的 Z_SYNC_FLUSH 截断流）。
 */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const CryptoJS = require('crypto-js')
const load = require('./load-ts.cjs')

const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const rsa = load('src/common/utils/crypto/rsaNoPadding.js')

/** `node:crypto` 的参考实现：与 `wy/utils/crypto.js:20-23` 原来的写法完全一致。 */
const nodeRsaEncrypt = (buffer, key = PUBLIC_KEY) => crypto.publicEncrypt(
  { key, padding: crypto.constants.RSA_NO_PADDING },
  Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]),
)

test('纯 JS RSA_NO_PADDING 与 node:crypto 逐字节一致（200 个随机 16 字节样本）', () => {
  for (let i = 0; i < 200; i++) {
    const input = crypto.randomBytes(16)
    const expected = nodeRsaEncrypt(input).toString('hex')
    const actual = rsa.rsaPublicEncryptNoPadding(input, PUBLIC_KEY).toString('hex')
    assert.equal(actual, expected)
    // 定长：128 字节密文恒等于 256 个 hex 字符
    assert.equal(actual.length, 256)
  }
})

test('固定向量（回归锚点）', () => {
  const input = Buffer.from('0123456789abcdef', 'utf8')
  const expected = nodeRsaEncrypt(input).toString('hex')
  assert.equal(rsa.rsaPublicEncryptNoPadding(input, PUBLIC_KEY).toString('hex'), expected)
  // 反过来的顺序也不能撞上（确保不是"恒等映射"那种假通过）
  assert.notEqual(rsa.rsaPublicEncryptNoPadding(Buffer.from('fedcba9876543210', 'utf8'), PUBLIC_KEY).toString('hex'), expected)
})

test('陷阱 1：密文首字节为 0x00 的样本仍然补零到 256 个 hex 字符', () => {
  let sample = null
  for (let i = 0; i < 40000 && sample == null; i++) {
    const input = crypto.randomBytes(16)
    const hex = rsa.rsaPublicEncryptNoPadding(input, PUBLIC_KEY).toString('hex')
    if (hex.startsWith('00')) sample = { input, hex }
  }
  assert.ok(sample != null, '40000 个样本里没有出现首字节 0x00 的密文（期望 ≈1/375，说明统计口径不对）')
  // 不补零的话 `BigInt.toString(16)` 会给出 254 个字符，服务端按 128 字节解析就会失败
  assert.equal(sample.hex.length, 256)
  assert.equal(Buffer.from(sample.hex, 'hex').length, 128)
  assert.equal(sample.hex, nodeRsaEncrypt(sample.input).toString('hex'))
})

test('陷阱 2：crypto-js 的 key 必须是 typed array', () => {
  const keyBytes = crypto.randomBytes(16)
  const iv = CryptoJS.enc.Utf8.parse('0102030405060708')
  const text = 'rain-music'
  const cipher = crypto.createCipheriv('aes-128-cbc', keyBytes, Buffer.from('0102030405060708'))
  const expected = Buffer.concat([cipher.update(Buffer.from(text)), cipher.final()]).toString('base64')

  const typed = CryptoJS.AES.encrypt(text, CryptoJS.lib.WordArray.create(new Uint8Array(keyBytes)), { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString()
  const plain = CryptoJS.AES.encrypt(text, CryptoJS.lib.WordArray.create(Array.from(keyBytes)), { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString()

  assert.equal(typed, expected)
  // 普通数组会被当成 32 位 word，结果必然不同 —— 这条断言就是陷阱本身存在的证据
  assert.notEqual(plain, expected)
  // Buffer 是 Uint8Array 的子类，同样安全
  assert.equal(CryptoJS.AES.encrypt(text, CryptoJS.lib.WordArray.create(keyBytes), { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(), expected)
})

// ---------------------------------------------------------------------------
// 真实产品代码：wy 的 weapi / eapi / linuxapi
// ---------------------------------------------------------------------------

/** 确定性的"随机"源，用来钉住 weapi 里的 `getRandomValues`。 */
const fixedRandom = {
  getRandomValues(array) {
    for (let i = 0; i < array.length; i++) array[i] = (i * 5 + 1) & 0xff
    return array
  },
}

const wyCrypto = load('src/renderer/utils/musicSdk/wy/utils/crypto.js', {
  '@common/utils/crypto/rsaNoPadding': rsa,
  // ⚠️ 必须把外层的 `Uint8Array` 注入 vm：`crypto-js/lib-typedarrays.js:33-52` 用的是
  // `instanceof Uint8Array` 判定 typed array，跨 realm 时 `instanceof` 为 false，
  // 会被当成普通数组（正好是陷阱 2），测试就会假失败。生产运行没有跨 realm 问题。
}, { crypto: fixedRandom, Uint8Array })

const secretKeyBytes = (() => {
  const raw = fixedRandom.getRandomValues(new Uint8Array(16))
  const out = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) out[i] = BASE62.charCodeAt(raw[i] % 62)
  return out
})()

test('weapi：params 与 encSecKey 都与 node:crypto 参考实现一致，encSecKey 恒为 256 hex', () => {
  const object = { c: '[{"id":123456}]', ids: '[123456]' }
  const actual = wyCrypto.weapi(object)

  const aesEnc = (buffer, key) => {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.from('0102030405060708'))
    return Buffer.concat([cipher.update(buffer), cipher.final()])
  }
  const text = JSON.stringify(object)
  const inner = aesEnc(Buffer.from(text), Buffer.from('0CoJUm6Qyw8W8jud')).toString('base64')
  const params = aesEnc(Buffer.from(inner), secretKeyBytes).toString('base64')
  const encSecKey = rsa.rsaPublicEncryptNoPadding(Buffer.from(secretKeyBytes).reverse(), PUBLIC_KEY).toString('hex')

  assert.equal(actual.params, params)
  assert.equal(actual.encSecKey, encSecKey)
  assert.equal(actual.encSecKey.length, 256)
  assert.match(actual.encSecKey, /^[0-9a-f]{256}$/)
  // 与 node:crypto 的 RSA_NO_PADDING 也逐字节一致
  assert.equal(actual.encSecKey, nodeRsaEncrypt(Buffer.from(secretKeyBytes).reverse()).toString('hex'))
})

test('eapi：AES-128-ECB + MD5 与 node:crypto 参考实现一致', () => {
  const url = '/api/song/enhance/player/url/v1'
  const object = { ids: '[1]', level: 'standard' }
  const text = JSON.stringify(object)
  const digest = crypto.createHash('md5').update(`nobody${url}use${text}md5forencrypt`).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), '')
  const expected = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]).toString('hex').toUpperCase()

  assert.equal(wyCrypto.eapi(url, object).params, expected)
})

test('linuxapi：AES-128-ECB 与 node:crypto 参考实现一致', () => {
  const object = { method: 'POST', url: 'https://music.163.com/api/v3/playlist/detail', params: { id: 1, n: 1000, s: 8 } }
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('rFgB&h#%2?^eDg:Q'), '')
  const expected = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(object))), cipher.final()]).toString('hex').toUpperCase()

  assert.equal(wyCrypto.linuxapi(object).eparams, expected)
})

// ---------------------------------------------------------------------------
// pako：替换 node:zlib 后的等价性
// ---------------------------------------------------------------------------

const pakoZlib = load('src/common/utils/zlib.js')

test('pako.inflate 与 node:zlib 一致（含 qrcDecode 依赖的 Z_SYNC_FLUSH 截断流）', () => {
  const source = Buffer.from('雨声 Rain Music · QRC lyric payload '.repeat(20))
  const compressed = zlib.deflateSync(source)

  assert.deepEqual(Buffer.from(pakoZlib.inflate(compressed)), zlib.inflateSync(compressed))

  // 尾部截断：node 侧只有配 finishFlush: Z_SYNC_FLUSH 才不报错，pako 侧对应 push(data, Z_SYNC_FLUSH)
  const truncated = compressed.subarray(0, compressed.length - 6)
  assert.throws(() => zlib.inflateSync(truncated))
  const nodeResult = zlib.inflateSync(truncated, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
  const inflator = new pakoZlib.Inflate()
  inflator.push(truncated, pakoZlib.Z_SYNC_FLUSH)
  assert.equal(inflator.err, 0)
  assert.deepEqual(Buffer.from(inflator.result), nodeResult)
  // 顺带记录实测事实：本机 pako 1.0.11 的 `inflate()` 快捷函数（内部 Z_FINISH）对这个截断流
  // 也是容忍的，结果与 Z_SYNC_FLUSH 相同。qrcDecode 仍然显式用 Z_SYNC_FLUSH，是为了**保留**
  // 原来 `finishFlush` 选项的语义，而不是把结论押在 pako 某个版本的宽容度上。
  assert.deepEqual(Buffer.from(pakoZlib.inflate(truncated)), nodeResult)
})

test('pako.gzip/ungzip 与 node:zlib 双向可读（配置备份 .rainmc 不受影响）', () => {
  const text = JSON.stringify({ type: 'setting_v2', setting: { name: '雨声 🎵', version: '2.12.8' } })

  // 新写的（pako）能被 node 读，旧文件（node gzip）能被 pako 读
  assert.equal(zlib.gunzipSync(Buffer.from(pakoZlib.gzip(text))).toString(), text)
  assert.equal(Buffer.from(pakoZlib.ungzip(zlib.gzipSync(text))).toString(), text)
})

test('kg 歌词解密（base64 → XOR → inflate）走 pako 后结果不变', async() => {
  const kg = load('src/common/utils/lyricUtils/kg.js', {
    '../zlib': pakoZlib,
    './util': { decodeName: str => str },
  })
  const encKey = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69], 'binary')
  const plain = '[0,1000]hello rain music'
  const compressed = zlib.deflateSync(Buffer.from(plain))
  const xored = Buffer.from(compressed)
  for (let i = 0; i < xored.length; i++) xored[i] ^= encKey[i % 16]
  // KRC 载荷 = 4 字节头 + XOR 后的 zlib 流
  const payload = Buffer.concat([Buffer.alloc(4), xored]).toString('base64')

  const result = await kg.decodeKrc(payload)
  assert.match(result.lyric, /hello rain music/)
})
