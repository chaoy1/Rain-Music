// Android 移植 · 阶段 3 / 线 B：本文件原来是渲染层里**唯一**还 import `node:crypto` 的地方
// （`import crypto from 'node:crypto'`），而 web 目标下 `crypto` 会解析到
// `resolve.fallback.crypto = crypto-browserify` —— 于是整个 `crypto-browserify` 依赖闭包
// （66 个包、302 条源码）被拖进 Android 产物，只为了一次 SHA-1。
//
// 本文件对 `crypto` 的**全部**用法只有两处：
//   1. `crypto.createHash('sha1').update(data).digest('hex')` —— SHA-1（hex，小写）；
//   2. `Buffer.from(data).toString('base64')` —— 标准 base64（`Buffer` 是另一套 polyfill，
//      不是 `crypto`，渲染层有 100 处在用，见 `docs/android/native-bridge-needs.md` §2.6.3）。
// 所以只替换第 1 处：SHA-1 换成**已经装了、且已是生产依赖**的 `crypto-js@4.2.0`。
// `docs/android/native-bridge-needs.md` §2.3 已实测 `CryptoJS.SHA1(msg).toString()` 与
// `node:crypto` 的 `createHash('sha1').digest('hex')` 完全一致；
// 单测 `tests/unit/tx-sign.test.cjs` 再用**真实 tx 签名输入**逐字符回归一次。
//
// 为什么不用 `globalThis.crypto.subtle.digest`：它是**异步**的（返回 Promise），而
// `crypto.subtle` 只在安全上下文可用（Android 侧默认 `server.androidScheme = 'https'` →
// `https://localhost` 是安全上下文，但 web 调试/文件预览不是）。`crypto-js` 同步、
// 无上下文要求、零新增依赖，是这里更稳的那条。
//
// ⚠️ `zzcSign` 本身保持 `async`（返回 Promise）：`tx/utils/index.js:7` 是 `await zzcSign(...)`，
// 改成同步会改变对外契约。
import CryptoJS from 'crypto-js'

const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

/**
 * SHA-1（hex，小写）。等价于原来的 `crypto.createHash('sha1').update(data).digest('hex')`。
 * @param {string} data 调用点恒为 `JSON.stringify(data)` 的结果（见 `zzcSign`）
 */
function hashSHA1(data) {
  return CryptoJS.SHA1(data).toString(CryptoJS.enc.Hex)
}

function pickHashByIdx(hash, indexes) {
  return indexes.map((idx) => hash[idx]).join('')
}

function base64Encode(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/[\\/+=]/g, '')
}

export async function zzcSign(text) {
  const hash = await hashSHA1(text)
  const part1 = pickHashByIdx(hash, PART_1_INDEXES)
  const part2 = pickHashByIdx(hash, PART_2_INDEXES)
  const part3 = SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16))
  const b64Part = base64Encode(part3).replace(/[\\/+=]/g, '')
  return `zzc${part1}${b64Part}${part2}`.toLowerCase()
}
