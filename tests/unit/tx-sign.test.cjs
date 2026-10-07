/**
 * Android 移植 · 阶段 3 / 线 B 的单测：**摘掉 `tx` 签名里的 `node:crypto`**。
 *
 * ## 为什么有这个测试
 *
 * `src/renderer/utils/musicSdk/tx/utils/crypto.js` 原本是渲染层里**唯一**还
 * `import crypto from 'node:crypto'` 的文件。web 目标下这个名字被
 * `build-config/renderer/webpack.config.web.js` 的 `resolve.fallback.crypto`
 * 解析成 `crypto-browserify`，于是整个依赖闭包（实测 66 个包 / 302 条源码）被拖进
 * Android 产物，只为了算**一次 SHA-1**。
 *
 * 替换后必须证明"桌面行为逐字等价"，所以这里的做法是：
 *   1. 把**改动前那一版**（`node:crypto` + `Buffer.from(...).toString('base64')`）
 *      逐行抄成本文件的"参考实现"；
 *   2. 用**真实 tx 签名输入**（从 `tx/musicSearch.js`、`tx/songList.js`、`tx/hotSearch.js`
 *      逐字抄下来的请求体）以及 500 个确定性随机载荷，逐字符比对；
 *   3. 钉 3 个**回归锚点**常量（SHA-1 与最终签名），防止未来"顺手重构"造成静默漂移；
 *   4. 静态断言源文件已经不再引用 `node:crypto` / `crypto`（这才是本线的交付物）。
 *
 * ⚠️ 唯一的调用点 `tx/utils/index.js:7` 是 `await zzcSign(JSON.stringify(data))`，
 * 所以这里也断言 `zzcSign` **仍然返回 Promise**（不能改成同步）。
 */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const load = require('./load-ts.cjs')

const CRYPTO_FILE = 'src/renderer/utils/musicSdk/tx/utils/crypto.js'
const { zzcSign } = load(CRYPTO_FILE)

// ---------------------------------------------------------------------------
// 参考实现：`src/renderer/utils/musicSdk/tx/utils/crypto.js` 改动前的那一版，
// 逐行照抄（`crypto.createHash('sha1')` + `Buffer.from(array).toString('base64')`）。
// ---------------------------------------------------------------------------
const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

const nodeSHA1 = data => crypto.createHash('sha1').update(data).digest('hex')

function referenceZzcSign(text) {
  const hash = nodeSHA1(text)
  const part1 = PART_1_INDEXES.map(idx => hash[idx]).join('')
  const part2 = PART_2_INDEXES.map(idx => hash[idx]).join('')
  const part3 = SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16))
  const b64Part = Buffer.from(part3).toString('base64').replace(/[\\/+=]/g, '')
  return `zzc${part1}${b64Part}${part2}`.toLowerCase()
}

// ---------------------------------------------------------------------------
// 真实 tx 签名输入：请求体逐字抄自生产代码，`searchid` 换成固定值以确定性。
// ---------------------------------------------------------------------------
const REAL_INPUTS = [
  {
    label: 'musicSearch（tx/musicSearch.js:13-43）',
    data: {
      comm: {
        _channelid: '0',
        _os_version: '6.2.9200-2',
        ct: '19',
        cv: '2151',
        guid: '1F70E520B2EAA7D25E11760783C53CA9',
        patch: '118',
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeAppID: 'qqmusic',
        tmeLoginType: 0,
        uin: '0',
        wid: '7223299733393904640',
      },
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: 50,
          page_num: 1,
          query: '周杰伦',
          remoteplace: 'txt.newclient.top',
          search_type: 0,
          searchid: '1F70E520B2EAA7D25E11760783C53CA900123',
        },
      },
    },
    sha1: '4d9200eb51300d4a869e3387b9ee8ee405cef0dd',
    sign: 'zzc74ef8beflwzfytin7y3qon8wa58yypviw48d00ee50',
  },
  {
    label: 'songList 歌单详情（tx/songList.js:251-276）',
    data: {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        platform: 'yqq.json',
        needNewCode: 1,
        uin: 0,
      },
      req_1: {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: {
          disstid: 7011264340,
          userinfo: 1,
          tag: 1,
          orderlist: 1,
          song_begin: 0,
          song_num: 1000,
          onlysonglist: 0,
          enc_host_uin: '',
        },
      },
    },
    sha1: '2c1bbc9d7c76eeced35f7167e8bf1c117d3f05b9',
    sign: 'zzc7c90ddfdtwpc6yk1djia8sckpulpkefaodc7eff7c',
  },
  {
    label: 'hotSearch（tx/hotSearch.js:17-40）',
    data: {
      comm: {
        ct: '19',
        cv: '1803',
        guid: '0',
        patch: '118',
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeAppID: 'qqmusic',
        tmeLoginType: 0,
        uin: '0',
        wid: '0',
      },
      hotkey: {
        method: 'GetHotkeyForQQMusicPC',
        module: 'tencent_musicsoso_hotkey.HotkeyService',
        param: { search_id: '', uin: 0 },
      },
    },
    sha1: '5f2b3d7313a1a232fa0056bf3ca3b16c13b6f0c7',
    sign: 'zzcf37ff30bgyo5cnzmm5lnozerond6zwxixqff1a031d',
  },
]

test('真实 tx 签名输入 × 3：SHA-1 与最终签名与 node:crypto 参考实现逐字符一致（含钉死的回归锚点）', async() => {
  for (const { label, data, sha1, sign } of REAL_INPUTS) {
    const text = JSON.stringify(data)
    // 锚点 1：SHA-1 本身（这样即使签名逻辑被改坏，也能立刻区分是哈希坏还是拼接坏）
    assert.equal(nodeSHA1(text), sha1, `${label}：node:crypto 的 SHA-1 与锚点不符（说明抄下来的输入变了）`)
    // 锚点 2：最终签名（改动前那一版算出来的值）
    assert.equal(referenceZzcSign(text), sign, `${label}：参考实现与锚点不符`)
    // 被测实现（crypto-js SHA-1）
    assert.equal(await zzcSign(text), sign, `${label}：新实现与 node:crypto 参考实现不一致`)
  }
})

test('500 个确定性随机载荷：新实现与参考实现逐字符一致（含中文 / emoji / 长串 / 数字 / null）', async() => {
  // mulberry32：确定性 PRNG，避免测试 flaky（不需要真随机）
  const mulberry32 = seed => () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rand = mulberry32(20261007)
  const WORDS = ['周杰伦', '晴天', '🎵', 'QQ音乐', 'a', '', 'txt.newclient.top', '𝄞', '龍', 'Ａ', '\n\t"\\']
  const pick = arr => arr[Math.floor(rand() * arr.length)]

  const makeValue = (depth) => {
    const kind = rand()
    if (depth > 2 || kind < 0.25) return pick(WORDS)
    if (kind < 0.4) return Math.floor(rand() * 1e9)
    if (kind < 0.5) return rand() < 0.5
    if (kind < 0.55) return null
    if (kind < 0.7) return Array.from({ length: Math.floor(rand() * 4) + 1 }, () => makeValue(depth + 1))
    const obj = {}
    for (let i = 0; i < Math.floor(rand() * 4) + 1; i++) obj[pick(WORDS) || `k${i}`] = makeValue(depth + 1)
    return obj
  }

  for (let i = 0; i < 500; i++) {
    const payload = i % 3 === 0 ? { ...REAL_INPUTS[i % REAL_INPUTS.length].data } : { comm: { cv: i, patch: '118' }, req: makeValue(0) }
    const text = JSON.stringify(payload)
    assert.equal(await zzcSign(text), referenceZzcSign(text), `第 ${i} 个载荷不一致：${text.slice(0, 120)}`)
  }
})

test('UTF-8 边界：多字节、代理对（emoji）、超长串', async() => {
  const cases = [
    '周杰伦',
    '🎵🎶𝄞',
    'ÄÖÜß 한국어 日本語 ไทย',
    'a'.repeat(10000),
    '中'.repeat(5000) + '🎵',
    JSON.stringify({ query: '周杰伦 🎵', empty: '', zero: 0, no: null }),
  ]
  for (const text of cases) {
    assert.equal(await zzcSign(text), referenceZzcSign(text), `不一致：${text.slice(0, 60)}`)
  }
})

test('签名形状：`zzc` 前缀 + 全小写 [0-9a-z]，长度 44–46（8 + base64(20B) + 8）', async() => {
  for (const { data } of REAL_INPUTS) {
    const sign = await zzcSign(JSON.stringify(data))
    assert.match(sign, /^zzc[0-9a-z]+$/, sign)
    // part1(8) + part2(8) + base64(20 字节)=28 去掉 `=` 与可能的 `/` `+` → 25–27
    assert.ok(sign.length >= 44 && sign.length <= 46, `长度异常 ${sign.length}：${sign}`)
  }
})

test('对外契约：zzcSign 仍然是 async（tx/utils/index.js:7 是 `await zzcSign(...)`）', () => {
  const result = zzcSign('{}')
  assert.equal(typeof result.then, 'function', 'zzcSign 必须返回 Promise')
  return result
})

/**
 * 去掉 `//` 行注释与 `/* … *​/` 块注释。
 * 必须去注释后再断言：文件头**故意**写了 "原来是 `import crypto from 'node:crypto'`"
 * 来说明改动原因，直接在原文上匹配会把这个说明本身当成违规。
 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .map(line => line.replace(/^\s*\/\/.*/, ''))
  .join('\n')

test('交付物断言：tx/utils/crypto.js 已不再引用 node:crypto / crypto（web 产物不再需要 crypto-browserify）', () => {
  const source = stripComments(fs.readFileSync(path.resolve(__dirname, '../..', CRYPTO_FILE), 'utf8'))
  assert.doesNotMatch(source, /from\s+['"](?:node:)?crypto['"]/, '仍在使用 node:crypto')
  assert.doesNotMatch(source, /require\(\s*['"](?:node:)?crypto['"]\s*\)/, '仍在 require crypto')
  assert.doesNotMatch(source, /\bcrypto\.createHash\b/, '仍在使用 crypto.createHash')
  assert.doesNotMatch(source, /\bcrypto\.subtle\b/, '不要改用异步的 crypto.subtle（zzcSign 的调用方期望确定性同步路径）')
  assert.match(source, /from\s+['"]crypto-js['"]/, '应当使用 crypto-js 的 SHA-1')
  assert.match(source, /CryptoJS\.SHA1\(/, '应当使用 CryptoJS.SHA1')
})

test('桌面侧回归：整个渲染层除了本文件外没有第二个 node:crypto 引用点（bundle 结论的前提）', () => {
  // 只在 renderer 的 musicSdk 里找（`src/main/**` 是主进程，走 Electron 的 Node 内置 crypto，
  // 与 web 目标无关 —— 见 docs/android/cleartext-verification.md 附录）。
  const root = path.resolve(__dirname, '../../src/renderer')
  const hits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(js|ts|vue)$/.test(entry.name)) continue
      const text = fs.readFileSync(full, 'utf8')
      if (/^\s*import\s[^\n]*from\s+['"](?:node:)?crypto['"]/m.test(text) || /require\(\s*['"](?:node:)?crypto['"]\s*\)/.test(text)) {
        hits.push(path.relative(root, full).replace(/\\/g, '/'))
      }
    }
  }
  walk(root)
  assert.deepEqual(hits, [], `渲染层仍有 crypto 引用：${hits.join(', ')}`)
})
