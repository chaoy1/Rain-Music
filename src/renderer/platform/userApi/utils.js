import { Buffer } from 'buffer'
import CryptoJS from 'crypto-js'
import { rsaPublicEncryptNoPadding } from '../../../common/utils/crypto/rsaNoPadding'
import { inflate, deflate } from '../../../common/utils/zlib'

const wordArray = value => CryptoJS.lib.WordArray.create(new Uint8Array(Buffer.from(value)))
const bytes = value => Buffer.from(value.toString(CryptoJS.enc.Hex), 'hex')

/** Browser-only equivalents of the public preload helpers; no native bridge is passed here. */
export const createUserApiUtils = crypto => Object.freeze({
  crypto: Object.freeze({
    aesEncrypt(buffer, mode, key, iv) {
      const match = /^aes-(128|192|256)-(cbc|ecb)$/i.exec(mode)
      if (!match) throw new Error(`Unsupported AES mode: ${mode}`)
      if (Buffer.from(key).length !== Number(match[1]) / 8) throw new Error('Invalid AES key length')
      if (match[2].toLowerCase() === 'cbc' && Buffer.from(iv ?? []).length !== 16) throw new Error('Invalid AES IV length')
      const encrypted = CryptoJS.AES.encrypt(wordArray(buffer), wordArray(key), {
        mode: match[2].toLowerCase() === 'cbc' ? CryptoJS.mode.CBC : CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
        iv: iv == null ? undefined : wordArray(iv),
      })
      return bytes(encrypted.ciphertext)
    },
    rsaEncrypt: rsaPublicEncryptNoPadding,
    randomBytes(size) {
      if (!Number.isSafeInteger(size) || size < 0 || size > 1048576) throw new Error('Invalid randomBytes size (maximum 1 MiB)')
      const result = Buffer.alloc(size)
      for (let offset = 0; offset < size; offset += 65536) crypto.getRandomValues(result.subarray(offset, Math.min(offset + 65536, size)))
      return result
    },
    md5: value => CryptoJS.MD5(wordArray(value)).toString(CryptoJS.enc.Hex),
  }),
  buffer: Object.freeze({ from: (...args) => Buffer.from(...args), bufToString: (buf, format) => Buffer.from(buf, 'binary').toString(format) }),
  zlib: Object.freeze({
    inflate: async buffer => Buffer.from(inflate(buffer)),
    deflate: async data => Buffer.from(deflate(data)),
  }),
})
