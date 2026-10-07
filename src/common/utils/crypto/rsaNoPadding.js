/**
 * 纯 JS 的 RSA 公钥加密（`RSA_NO_PADDING`）—— Android 移植 · 阶段 3。
 *
 * ## 为什么需要它
 *
 * `wy` 的 `weapi` 用 `node:crypto` 的 `publicEncrypt({ padding: RSA_NO_PADDING })` 加密 16 字节
 * 的 AES 密钥（`docs/android/native-bridge-needs.md` §2.1）。WebCrypto **没有**裸 RSA
 * （只有 OAEP / PKCS#1 v1.5），Android 也没有对应插件，所以这一半必须自己用 `BigInt` 算。
 * 同一份能力还要满足 `src/main/modules/userApi/renderer/preload.js` 暴露给自定义源脚本的
 * `lx.utils.crypto.rsaEncrypt`（`docs/custom-source.md` 明确的**对外契约**），
 * 因此实现放在 `@common` 下，由两处共用（Android 侧写 `lx` 宿主时也应复用本文件）。
 *
 * ## 实测结论（`docs/android/native-bridge-needs.md` §2.1 / §6.1）
 *
 * - 密钥 1024-bit、`e = 65537`；自写 BigInt 模幂与 `node:crypto` 的输出**逐字节一致**；
 * - 约 54 µs/次，比原来的 Node 路径（每次重新解析 PEM、走 OpenSSL 上下文，约 185 µs）更快；
 * - **零新增依赖**。
 *
 * ## ⚠️ 两个必须写进实现的陷阱
 *
 * 1. **输出必须左侧补零到 modulus 长度的 2 倍 hex 字符**。`node:crypto` 的 `RSA_NO_PADDING`
 *    输出是定长（1024 位 = 128 字节 = 256 个 hex 字符），而 `BigInt.toString(16)` 会丢掉前导零。
 *    实测 3000 个随机样本里有 8 个密文首字节是 `0x00`（≈1/375）——不补零就会变成
 *    "偶发的、随机的登录/请求失败"。本文件用 `padStart(keyLength * 2, '0')` 兜住。
 * 2. **`crypto-js` 的 key 必须传 typed array**（`Uint8Array`/`Buffer`），不能传普通数组：
 *    `CryptoJS.lib.WordArray` 会把普通数组的元素当成 **32 位 word**，而不是字节。
 *    这一条不在本文件里，而在 `wy/utils/crypto.js`（那里构造 AES key），
 *    单测 `tests/unit/rsa-no-padding.test.cjs` 同时覆盖这两条。
 *
 * ## 与 `node:crypto` 的行为对齐
 *
 * - 输入比模长还长 → 抛错（原来 `Buffer.alloc(128 - buffer.length)` 会抛 RangeError，
 *   OpenSSL 的 `RSA_NO_PADDING` 也会拒绝）；
 * - 输入作为大端整数 `m`，`m >= n` → 抛错（OpenSSL: "data too large for modulus"）；
 *   1024 位密钥 + 16 字节输入在实际使用中不可能触发。
 */

/** 解析结果缓存：preload 的 `rsaEncrypt(buffer, key)` 允许传任意 PEM，按 key 文本缓存。 */
const keyCache = new Map()

const readLength = (bytes, offset) => {
  let length = bytes[offset++]
  if (length === 0x80) throw new Error('rsa: unsupported indefinite DER length')
  if (length > 0x80) {
    let value = 0
    for (let i = 0; i < (length & 0x7f); i++) value = value * 256 + bytes[offset++]
    length = value
  }
  return [length, offset]
}

/** 读一个 DER TLV。返回 { tag, contentStart, contentEnd, next }。 */
const readElement = (bytes, offset) => {
  const tag = bytes[offset++]
  const [length, contentStart] = readLength(bytes, offset)
  const contentEnd = contentStart + length
  if (contentEnd > bytes.length) throw new Error('rsa: truncated DER element')
  return { tag, contentStart, contentEnd, next: contentEnd }
}

/** 只解析**直接子元素**（不递归展开），用于在 SEQUENCE 里层找两个 INTEGER。 */
const readChildren = (bytes, start, end) => {
  const children = []
  let offset = start
  while (offset < end) {
    const element = readElement(bytes, offset)
    children.push(element)
    offset = element.next
  }
  return children
}

const findIntegers = (bytes, sequence) =>
  readChildren(bytes, sequence.contentStart, sequence.contentEnd).filter(child => child.tag === INTEGER_TAG)

const INTEGER_TAG = 0x02
const SEQUENCE_TAG = 0x30
const BIT_STRING_TAG = 0x03
/**
 * 从 PEM 里取出 (n, e)。支持两种常见公钥格式：
 * - SPKI：`-----BEGIN PUBLIC KEY-----`，`SEQUENCE { AlgorithmIdentifier, BIT STRING { SEQUENCE { INTEGER n, INTEGER e } } }`
 * - PKCS#1：`-----BEGIN RSA PUBLIC KEY-----`，`SEQUENCE { INTEGER n, INTEGER e }`
 */
const parsePublicKey = (pem) => {
  if (typeof pem !== 'string') throw new Error('rsa: public key must be a PEM string')
  const match = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/.exec(pem)
  if (!match) throw new Error('rsa: not a PEM public key')
  const der = Buffer.from(match[1].replace(/\s+/g, ''), 'base64')
  if (der.length === 0) throw new Error('rsa: empty public key')

  const top = readElement(der, 0)
  if (top.tag !== SEQUENCE_TAG) throw new Error('rsa: public key is not a DER SEQUENCE')

  // PKCS#1：顶层 SEQUENCE 直接就是 { n, e }
  let integers = findIntegers(der, top)
  if (integers.length !== 2) {
    // SPKI：算法标识 + BIT STRING，里面才是 RSAPublicKey
    const bitString = readChildren(der, top.contentStart, top.contentEnd)
      .find(child => child.tag === BIT_STRING_TAG)
    if (!bitString) throw new Error('rsa: unsupported public key format')
    // BIT STRING 的第一个字节是"未使用位数"，正常为 0
    const inner = readElement(der, bitString.contentStart + 1)
    if (inner.tag !== SEQUENCE_TAG) throw new Error('rsa: unsupported public key format')
    integers = findIntegers(der, inner)
  }
  if (integers.length !== 2) throw new Error('rsa: unsupported public key format')

  const [nElement, eElement] = integers
  const modulus = BigInt('0x' + Buffer.from(der.subarray(nElement.contentStart, nElement.contentEnd)).toString('hex'))
  const exponent = BigInt('0x' + Buffer.from(der.subarray(eElement.contentStart, eElement.contentEnd)).toString('hex'))
  if (modulus <= 0n || exponent <= 0n) throw new Error('rsa: invalid public key')

  // 模长（字节），= ceil(bits(n) / 8)，1024 位密钥即 128
  const keyLength = Math.ceil(modulus.toString(2).length / 8)
  return { modulus, exponent, keyLength }
}

const getKey = (pem) => {
  let key = keyCache.get(pem)
  if (key == null) {
    key = parsePublicKey(pem)
    keyCache.set(pem, key)
  }
  return key
}

/** 二进制模幂 `base ** exponent mod modulus`（`e = 65537` 时 16 次平方 + 1 次乘法）。 */
const modPow = (base, exponent, modulus) => {
  let result = 1n
  let factor = base % modulus
  let power = exponent
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus
    factor = (factor * factor) % modulus
    power >>= 1n
  }
  return result
}

/**
 * `RSA_NO_PADDING` 公钥加密：左侧补零到模长后，直接当作大端整数做模幂。
 *
 * @param {Uint8Array|Buffer} data 明文字节（`wy` 的 `weapi` 传 16 字节 AES 密钥）
 * @param {string} publicKey PEM 公钥
 * @returns {Buffer} 定长密文（1024 位密钥 → 128 字节），与 `node:crypto` 逐字节一致
 */
export const rsaPublicEncryptNoPadding = (data, publicKey) => {
  const { modulus, exponent, keyLength } = getKey(publicKey)
  const bytes = Buffer.from(data)
  if (bytes.length > keyLength) throw new Error('rsa: data too long for modulus')

  const padded = Buffer.alloc(keyLength)
  bytes.copy(padded, keyLength - bytes.length)

  const message = BigInt('0x' + padded.toString('hex'))
  if (message >= modulus) throw new Error('rsa: data too large for modulus')

  const cipher = modPow(message, exponent, modulus)
  // 陷阱 1：hex 必须补零到定长，否则首字节 0x00 的密文会变成 254 个字符（≈1/375 概率）
  return Buffer.from(cipher.toString(16).padStart(keyLength * 2, '0'), 'hex')
}
