// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/util/crypto.js
//
// Android 移植 · 阶段 3：本文件原来是 `node:crypto` 的重度用户
// （`createCipheriv` / `createDecipheriv` / `publicEncrypt(RSA_NO_PADDING)` /
// `createHash('md5')` / `randomBytes`），在 Capacitor WebView 里一个都用不了
// （WebCrypto 没有 AES-ECB、没有裸 RSA、没有 MD5）。改法按
// `docs/android/native-bridge-needs.md` §2.1 的实测方案：
//
// - **AES-128-CBC / AES-128-ECB / MD5** → 已经装了、且已是生产依赖的 `crypto-js@4.2.0`
//   （实测与 `node:crypto` 输出一致）；
// - **RSA_NO_PADDING** → `@common/utils/crypto/rsaNoPadding`（纯 JS BigInt，零新增依赖，
//   与 `lx.utils.crypto.rsaEncrypt` 共用同一实现）；
// - **randomBytes(16)** → `crypto.getRandomValues`（WebCrypto 原生）；
// - 删掉 `eapiDecrypt`（唯一用到 `createDecipheriv` 的地方）：它只在两处**注释掉的**
//   调试代码里出现（`wy/utils/index.js:17-18`、`wy/lyric.js:50-51`），实际未生效。
import CryptoJS from 'crypto-js'
import { rsaPublicEncryptNoPadding } from '@common/utils/crypto/rsaNoPadding'

const iv = CryptoJS.enc.Utf8.parse('0102030405060708')
const presetKey = CryptoJS.enc.Utf8.parse('0CoJUm6Qyw8W8jud')
const linuxapiKey = CryptoJS.enc.Utf8.parse('rFgB&h#%2?^eDg:Q')
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const eapiKey = CryptoJS.enc.Utf8.parse('e82ckenh8dichen8')

const AES_MODES = {
  'aes-128-cbc': CryptoJS.mode.CBC,
  'aes-128-ecb': CryptoJS.mode.ECB,
}

/**
 * 与原来的 `createCipheriv` 等价（默认 PKCS#7 填充，`cipher.update + final` 一起就是整段）。
 * @param {string} text 明文（按 UTF-8 编码，对应原来的 `Buffer.from(text)`）
 * @param {'aes-128-cbc'|'aes-128-ecb'} mode
 * @param {CryptoJS.lib.WordArray} key ⚠️ 必须是 WordArray（由**字节**构造，见 weapi 的注释）
 * @param {CryptoJS.lib.WordArray} [iv]
 */
const aesEncrypt = (text, mode, key, iv) => {
  const options = {
    mode: AES_MODES[mode],
    padding: CryptoJS.pad.Pkcs7,
  }
  if (iv) options.iv = iv
  return CryptoJS.AES.encrypt(text, key, options)
}

export const weapi = object => {
  const text = JSON.stringify(object)
  const secretKey = new Uint8Array(16)
  globalThis.crypto.getRandomValues(secretKey)
  for (let i = 0; i < secretKey.length; i++) secretKey[i] = base62.charCodeAt(secretKey[i] % 62)
  // ⚠️ 陷阱 2（`docs/android/native-bridge-needs.md` §2.1）：key **必须**是 typed array。
  // `WordArray.create` 会把普通数组的元素当成 32 位 word 而不是字节，普通数组算出来的
  // 密文与 node:crypto 不一致（实测 `agfiw8+y4lji60p14iDiJw==` vs `+z7w8/LPuQKtpOBUDuiPkw==`）。
  const key = CryptoJS.lib.WordArray.create(secretKey)
  return {
    params: aesEncrypt(aesEncrypt(text, 'aes-128-cbc', presetKey, iv).toString(), 'aes-128-cbc', key, iv).toString(),
    encSecKey: rsaPublicEncryptNoPadding(secretKey.reverse(), publicKey).toString('hex'),
  }
}

export const linuxapi = object => {
  const text = JSON.stringify(object)
  return {
    eparams: aesEncrypt(text, 'aes-128-ecb', linuxapiKey).ciphertext.toString(CryptoJS.enc.Hex).toUpperCase(),
  }
}


export const eapi = (url, object) => {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = CryptoJS.MD5(message).toString()
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncrypt(data, 'aes-128-ecb', eapiKey).ciphertext.toString(CryptoJS.enc.Hex).toUpperCase(),
  }
}
