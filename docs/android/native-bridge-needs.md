# 原生桥需求核查（阶段 0 补充验证）

> 目标：把 `docs/android/ipc-contract.md` §6.3 末段（L731-745）里"没有现成 Capacitor 插件、可能需要自己写原生桥"的 7 项能力**逐项验证清楚**，判断哪些能用纯 JS / Web 平台能力替代，避免阶段 1 做到一半才发现方案要改。
>
> 本文是**只读核查**的产物：没有修改任何产品代码（`src/**` 只读）、没有改 `package.json`、没有安装依赖、没有跑 `npm` / `build-config/pack.js` / dev server、没有 git 写操作。

## 0. 核查方法与证据等级

| 等级 | 含义 | 本文中的用法 |
| --- | --- | --- |
| **A · 实测** | 在本机 Node v24.18.0 里跑**纯内存**脚本，与 `node:crypto` 的输出逐字节比对；不写任何文件、不装任何包、不联网 | 第 1、3、5 项的核心结论 |
| **B · 静态证据** | 读源码 / `node_modules` 里的包，给出 `文件:行` | 全部 7 项 |
| **C · 官方文档** | Capacitor / Android 官方文档，附链接 | 第 6 项 CORS、明文流量 |
| **D · 未确认** | 本次无法验证，正文明确标注，见 §5 | 真机行为、插件能力 |

实测脚本见 §6 附录，可以原样重跑复现。

---

## 1. 总结表

| # | 能力 | 结论 | 推荐方案 | 需要新增依赖 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | `wy` 的 `RSA_NO_PADDING` 公钥加密 | ✅ **纯 JS 可替代** | 内联 **BigInt** 模幂（约 15 行）；AES-ECB/CBC 与 MD5 用**已有** `crypto-js@4.2.0` | **不需要** | 低 |
| 2 | `tx` 签名需要的 `zlib.deflateRaw` | 🗑️ **可直接删除**（该分支是死代码） | 删掉 `bHtml` 头分支；另外 3 处**仍然活着**的 zlib 用途改用 `pako` | ✅ 需要 `pako`（当前只是 dev 链的传递依赖） | 低 |
| 3 | `node:crypto` 的 MD5 | ✅ **纯 JS 可替代** | `crypto-js@4.2.0`（已装、且是生产依赖），实测与 `node:crypto` 一致 | **不需要**（也**不需要**阶段 0 说的 `js-md5`） | 低 |
| 4 | `dns.lookup` | 🗑️ **可直接删除** | 删函数 + **必须同时删 `utils.js:2` 的顶层 `import dns`** | 不需要 | 无 |
| 5 | `iconv-lite` 的 GBK | ✅ **纯 JS 可替代，不必原生桥** | 解码 → 内建 `TextDecoder`；编码 → 保留 `iconv-lite`（纯 JS、已装） | 需要 `buffer` polyfill（与第 6 项共用） | 中 |
| 6 | `request.js` 的四重 Node 依赖 | ✅ **Capacitor 能力可替代，不必原生桥** | `fetch` / `CapacitorHttp` + `AbortController`；`process.versions.app` 换构建期常量 | ✅ `buffer`（Buffer polyfill）；可选 `pako` | **高** |
| 7 | `better-sqlite3` 同步 API → 异步 | ✅ **用插件 + 内部异步化，不是自写原生桥** | `@capacitor-community/sqlite` + 保持同形 façade（外部契约**本来就是 Promise**） | ✅ 插件 | **高** |

**一句话结论：本次核查的 7 项里，没有一项需要自写原生桥。** 阶段 0 最担心的第 1 项（`RSA_NO_PADDING`）经实测确认可以纯 JS 解决，而且比现在的 Node 实现更快。

---

## 2. 逐项详述

### 2.1 `wy` 的 `RSA_NO_PADDING` 公钥加密 → ✅ 纯 JS 可替代，**零新增依赖**

**用在哪里**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/utils/musicSdk/wy/utils/crypto.js:2` | `import { createCipheriv, createDecipheriv, publicEncrypt, randomBytes, createHash, constants } from 'crypto'` |
| `src/renderer/utils/musicSdk/wy/utils/crypto.js:20-23` | `rsaEncrypt`：`Buffer.alloc(128 - buffer.length)` 左补零 → `publicEncrypt({ padding: constants.RSA_NO_PADDING })` |
| `src/renderer/utils/musicSdk/wy/utils/crypto.js:25-32` | `weapi`：`secretKey = randomBytes(16).map(...)`，`:30` `encSecKey: rsaEncrypt(secretKey.reverse(), publicKey).toString('hex')` |
| `src/renderer/utils/musicSdk/wy/utils/crypto.js:42-50` | `eapi`：**不使用 RSA**，只有 AES-128-ECB + MD5 |
| `src/renderer/utils/musicSdk/wy/utils/crypto.js:34-39` | `linuxapi`：只有 AES-128-ECB（`songList.js:80` 在用） |

`weapi(...)` 的调用点共 **10 处**：`comment.js:134,163`、`leaderboard.js:114,121`、`musicDetail.js:102`、`musicInfo.js:13`、`songList.js:211,253,291`、`tipSearch.js:18`。
`eapi(...)` 的调用点共 **12 处**，集中在 `wy/utils/index.js:12`（`eapiRequest`）与 `wy/lyric.js:45`。

**当前实现依赖什么**

`node:crypto`。其中：
- `createCipheriv('aes-128-cbc' / 'aes-128-ecb')`、`createDecipheriv` —— WebCrypto **有** AES-CBC，但**没有 AES-ECB**（WebCrypto 规范未定义 ECB 模式），所以 AES 这一半也必须换库。
- `publicEncrypt({ padding: RSA_NO_PADDING })` —— WebCrypto 完全没有裸 RSA，只有 RSA-OAEP / RSASSA-PKCS1-v1_5。
- `createHash('md5')` —— WebCrypto 没有 MD5。
- `Buffer` / `randomBytes`。

**关键判断：密钥长度、频率、数据量**

用本机 Node 从 `crypto.js:7` 的 PEM 导出 JWK 实测：

```
kty= RSA | modulus bytes= 128 | bits= 1024 | e(hex)= 010001 | e(dec)= 65537
```

- **密钥长度 1024 位**（模长 128 字节），公开指数 `e = 65537`。代码里 `Buffer.alloc(128 - buffer.length)`（`crypto.js:21`）与"`RSA_NO_PADDING` 要求输入长度等于模长"互相印证。
- **数据量：每次只加密 16 字节**（`weapi` 的 `randomBytes(16)` 生成的 AES 密钥）。不存在"大数据量"问题。
- **频率：每次 `weapi` 调用 1 次 RSA**，即每个涉及 wy 的 `weapi` 接口请求 1 次（歌单、评论、歌曲详情、搜索建议等，共 10 个调用点）。一个用户操作至多几次。**不是热路径。**

**纯 JS 大数运算是否可行 + 性能**

实测（§6 附录脚本）：把 128 字节大端整数转 `BigInt`，做 `c = m^e mod n` 的二进制模幂（`e = 65537` → 16 次平方 + 1 次乘法），再转回 128 字节十六进制：

```
node native : 6424370b84242eed...bf1dc5c445
pure BigInt : 6424370b84242eed...bf1dc5c445
byte-identical: true
200 pure-JS modpow ms: 10.9  => per-call us: 54.4
200 node-native RSA_NO_PADDING ms: 37.0
```

- **逐字节一致**（同一输入，`node:crypto` 的 `RSA_NO_PADDING` 与自写 BigInt 模幂输出完全相同）。
- **性能：约 54 µs/次**（纯 JS），而现在的 Node 路径约 **185 µs/次**（因为 `publicEncrypt` 每次都要重新解析 PEM、走 OpenSSL 上下文）。**纯 JS 反而更快。**
- 结论：纯 JS 大数运算**完全可行，性能绰绰有余**（每次请求 0.05 ms，相对网络往返可以忽略）。

**⚠️ 移植陷阱（必须写进实现）**

1. **输出必须左侧补零到 256 个 hex 字符**。`node:crypto` 的 `RSA_NO_PADDING` 输出是**定长 128 字节**，因此 `toString('hex')` 恒为 256 字符（可能以 `00` 开头）；而 `BigInt.toString(16)` 会丢掉前导零。实测 3000 个随机样本里有 **8 个密文首字节为 `0x00`**（≈1/375）—— 不补零就会出现"偶发的、随机的登录/请求失败"，是最难排查的一类 bug。实现里必须 `r.toString(16).padStart(256, '0')`。
2. **`crypto-js` 的 key 传参陷阱**。`secretKey` 现在是 **16 个字节值组成的数组**（`crypto.js:27` 的 `randomBytes(16).map(...)`，`Buffer.prototype.map` 返回 Buffer）。实测：把普通数组直接当 key 传给 `CryptoJS.AES`，结果与 `node:crypto` **不一致**；必须包装成 typed array：

   ```
   node ref            : +z7w8/LPuQKtpOBUDuiPkw==
   crypto-js plain Arr : agfiw8+y4lji60p14iDiJw==  -> matches node? false
   crypto-js typedArr  : +z7w8/LPuQKtpOBUDuiPkw==  -> matches node? true
   ```
   原因：`CryptoJS.lib.WordArray` 把数组元素当 **32 位 word**，不当时字节（实测 `WordArray.create([1,2,3,4]).words === [1,2,3,4]`）。正确写法是 `CryptoJS.lib.WordArray.create(new Uint8Array(bytes))`（Buffer 也是 Uint8Array，可直接传）。

**重点核查：`node_modules` 里是否已有可用的纯 JS 实现**

| 包 | 是否已装 | 能否解决本项 | 说明 |
| --- | --- | --- | --- |
| `crypto-js` | ✅ **4.2.0，且在 `package.json:164` 的 `dependencies`** | **部分**（AES-ECB / AES-CBC / MD5 / SHA1 实测与 node 完全一致） | **没有 RSA，也没有 `BigInteger`**（对 `crypto-js/**/*.js` 搜 `BigInteger` 零命中）→ RSA 部分必须自己用 `BigInt` |
| `pako` | ✅ 1.0.11（传递依赖） | 与本项无关 | 见 §2.2 |
| `jsencrypt` / `node-rsa` / `node-forge` / `forge` / `bn.js` / `elliptic` / `asn1.js` / `browserify-sign` / `jsrsasign` / `big-integer` / `decimal.js` / `@noble/*` | ❌ **全部 MISSING** | — | 项目里**没有任何现成的纯 JS RSA 实现** |
| `elliptic` / `tweetnacl` | ❌ MISSING | 无关 | 且它们只做 ECC，不做 RSA |
| WebCrypto (`crypto.subtle`) | ✅ 原生 | 否 | 无裸 RSA、无 ECB、无 MD5；但**有 SHA-1**（见下） |

顺带核实：`jsencrypt` / `node-rsa` / `node-forge` 这类库**普遍只支持 PKCS#1 v1.5 与 OAEP**，`RSA_NO_PADDING` 需要自己用大数拼 —— 即使装了也解决不了本项的核心需求，**所以引入它们是纯亏**。

**推荐方案**

1. **RSA**：在 `wy/utils/crypto.js` 内联一个约 15 行的 `BigInt` 模幂（或抽到 `src/common/utils/`）。**不需要新增任何依赖。**
2. **AES-128-CBC / AES-128-ECB / MD5**：用**已经装了、已经是生产依赖**的 `crypto-js@4.2.0`，写法按上面的陷阱 2。
3. **`randomBytes(16)`**：`crypto.getRandomValues(new Uint8Array(16))`（WebCrypto 提供，无需库）。
4. **`wy/utils/crypto.js` 的 `eapiDecrypt`（`:52-54`）**：`createDecipheriv('aes-128-ecb')` 目前只在注释掉的调试代码里用到（`wy/utils/index.js:18`、`wy/lyric.js:51` 都是注释），实际未生效，可一并删除。

**结论：纯 JS 可替代（BigInt 内联 + crypto-js），不必写原生桥，也不需要引入大数库。阶段 0「必须写原生桥 或 引入纯 JS 大数库」的后半句是对的，但比预期简单得多。**

> **横向影响**：`src/main/modules/userApi/renderer/preload.js:249-292` 把**同一套**能力暴露给自定义源脚本（`lx.utils.crypto.rsaEncrypt` → `:255-257` 的 `RSA_NO_PADDING`；`lx.utils.zlib` → `:274-291` 的 `inflate/deflate`；`lx.utils.buffer` → `:266-273`）。这是 `docs/custom-source.md:18` 明确的**对外契约**。本项（BigInt）与 §2.2（pako）的结论**同样适用于它**，实现时应共用同一份纯 JS 代码。

---

### 2.2 `tx` 签名需要的 `zlib.deflateRaw` → 🗑️ **可直接删除**（真凶是另外 3 处 zlib）

**实现位置与调用点**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/utils/request.js:6` | `import { deflateRaw } from 'zlib'` |
| `src/renderer/utils/request.js:247-252` | `handleDeflateRaw(data) => new Promise(...)` |
| `src/renderer/utils/request.js:265-274` | `if (headers[bHh]) { ... }` —— 唯一使用 `handleDeflateRaw` 的地方（`:272`） |
| `src/renderer/utils/musicSdk/options.js:1` | `export const bHh = '624868746c'`（`bHh` 是 **hex**，`Buffer.from(bHh,'hex').toString() === 'bHtml'`） |
| `src/renderer/utils/musicSdk/options.js:3-6` | 唯一构造那个特殊 key 的 `headers` 对象：`{ 'User-Agent': ..., [bHh]: [bHh] }` |

**它到底是不是 `tx` 的签名头？—— 不是，而且它是死代码**

`request.js` 只在 `headers` 里**存在那个特殊 key** 时才走 deflate 分支。设置这个 key 的唯一来源是 `options.js:3-6` 导出的 `headers`，而 `headers` 只被 **3 个文件** import，且这 3 个文件**没有任何地方 import**：

```
src\renderer\utils\musicSdk\kg\api-test.js:3: import { headers, timeout } from '../options'
src\renderer\utils\musicSdk\tx\api-test.js:3: import { headers, timeout } from '../options'
src\renderer\utils\musicSdk\wy\api-test.js:3: import { headers, timeout } from '../options'
```

交叉验证：
- 对 `src/`、`tests/`、`build-config/` 全量搜字符串 `api-test` → **0 命中**（文件名本身除外）。
- 音源注册是**显式列举**，不是目录扫描：`src/renderer/utils/musicSdk/index.js:1-3` 只 import `tx/index`、`kg/index`、`wy/index`；`tx/index.js`、`kg/index.js`、`wy/index.js` 都不 import `api-test`。
- 这 3 个文件指向的 `http://ts.tempmusics.tk/...`（`kg/api-test.js:8`）是已废弃的第三方加速服务，也说明它们是开发期抓包脚本。

→ **`deflateRaw` 分支在当前代码路径里一次都不会执行。** 它不是 `tx` 的签名头；`tx` 的签名在 `src/renderer/utils/musicSdk/tx/utils/crypto.js:21-28` 的 `zzcSign`，只用到 **SHA-1 + base64**，与 zlib 无关。

**结论：可以直接删除** —— 连同 `request.js:6` 的 import、`:247-252` 的 `handleDeflateRaw`、`:265-274` 的整个 `if (headers[bHh])` 分支，以及 `options.js` 的 `headers`/`bHh` 导出和三个 `api-test.js` 死文件。这样 `request.js` 的 zlib 依赖归零。

**但另有 3 处 zlib 是活的，这才是真正要换 pako 的地方**

| 位置 | 用途 | 需要的 API |
| --- | --- | --- |
| `src/common/utils/lyricUtils/kg.js:1,13` | kg 歌词解密：base64 → XOR → `inflate`（**zlib 格式**，不是 raw） | `inflate` |
| `src/renderer/utils/musicSdk/tx/qrcDecode.js:1` | QRC 歌词解密：3DES → `inflate`（**zlib 格式**） | `inflate` |
| `src/common/utils/nodejs.ts:3,119-140` | 配置备份的 `gzip` / `gunzip`（实际读写在 `:150`、`:162`） | `gzip` / `gunzip` |
| （自定义源契约）`src/main/modules/userApi/renderer/preload.js:274-291` | `lx.utils.zlib.inflate/deflate` —— **对外契约** | `inflate` / `deflate` |

**`node_modules` 里是否已有 pako**

- ✅ **`pako@1.0.11` 已存在**，且顶层导出确认包含 `deflateRaw`：`node_modules/pako/lib/deflate.js:397-400` 导出 `Deflate / deflate / deflateRaw / gzip`；`inflate.js` 同理有 `inflateRaw / inflate / ungzip`。
- ⚠️ **但 `pako` 不在 `package.json` 里**。它是 `jszip` 的依赖，而 `jszip` 来自 `unzip-crx-3`（`electron-devtools-installer` 的 dev 链）→ **属于 dev 树的传递依赖**。依赖 hoisting 一旦变化就会断，**必须显式写进 `dependencies`**。
- ⚠️ 版本注意：本机是 `pako@1.0.11`，1.x 才有顶层 `deflateRaw` / `inflateRaw`。**升级到 2.x 时顶层导出会变化**（需要 `{ raw: true }` 走 `deflate` / `inflate`）—— 我**没有**逐字核实 2.x 的导出差异，见 §5。

**推荐方案**：删除死分支；对上面 3+1 处活用途**显式新增 `pako` 依赖**（锁 `^1`，或按 2.x API 适配）。**不必写原生桥**（这些数据量都很小：一条歌词 / 一份配置）。

---

### 2.3 `node:crypto` 的 MD5 → ✅ 纯 JS 可替代，**零新增依赖**

**使用点**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/utils/musicSdk/utils.js:1,5` | `crypto.createHash('md5')` → `toMD5` |
| `src/renderer/utils/musicSdk/kg/util.js:1,19` | kg 接口签名 `signatureParams()` 用 `toMD5` —— **这是最关键的一处**，签名错则 kg 全部接口失败 |
| `src/renderer/utils/index.ts:4` | re-export `@common/utils/nodejs` |
| `src/renderer/views/Leaderboard/action.ts:8,31`、`src/renderer/views/songList/Detail/action.ts:6,13,19` | 用 `toMD5` 生成本地 id |
| `src/common/utils/nodejs.ts:2,117` | 另一份 `toMD5`（该文件整体是要拆的 Node 工具文件，见 §2.6） |

**`node_modules` 里已有什么**

| 包 | 状态 |
| --- | --- |
| `js-md5` / `spark-md5` / `blueimp-md5` | ❌ 全部 MISSING（阶段 0 建议的 `js-md5` **没有装**，也不需要装） |
| `crypto-js` | ✅ **4.2.0，`package.json:164` 生产依赖** |
| WebCrypto | 有 SHA-1 / SHA-256，**没有 MD5** |

实测 `CryptoJS.MD5(msg).toString()` 与 `crypto.createHash('md5')...digest('hex')` **完全一致**（`===` 为 `true`）。

**顺带核实**：`tx` 的签名 `src/renderer/utils/musicSdk/tx/utils/crypto.js:1,8` 用的是 **SHA-1**，这一处**连库都不用**——实测 `crypto.subtle.digest` 可用（`typeof crypto.webcrypto.subtle.digest === "function"`），WebCrypto 原生提供；`crypto-js` 的 SHA-1 也实测与 node 一致，两条路都行。

**推荐方案**：统一用**已有的** `crypto-js@4.2.0`（同时解决 MD5 与 AES-ECB）。**不需要新增 `js-md5`。不必写原生桥。**

> 注意：`src/common/utils/nodejs.ts` 里同时有 `fs`(`:1`)、`crypto`(`:2`)、`zlib`(`:3`)、`path`(`:4`)、`os`(`:5`)。它被渲染层 6 处 import（`store/utils.ts:9`、`store/download/utils.ts:5`、`utils/music.ts:1`、`views/Download/useTaskActions.js:4`、`views/Setting/components/UserApiModal.vue:34`、`views/Setting/components/ThemeEditModal/index.vue:126`）—— **它整体是要按 ipc-contract §6.2 拆分的文件**，替换 `toMD5` 只是其中一行。

---

### 2.4 `dns.lookup` → 🗑️ **可直接删除**（连带必须删掉顶层 import）

**位置与用途**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/utils/musicSdk/utils.js:2` | `import dns from 'dns'`（**顶层静态 import**） |
| `src/renderer/utils/musicSdk/utils.js:8-23` | `getHostIp`：`ipMap` 缓存 + `dns.lookup(hostname, { all: false }, cb)` |
| `src/renderer/utils/musicSdk/utils.js:25-30` | `dnsLookup`：命中缓存直接回调，否则回落 `dns.lookup` |

**用途确认**：它就是**"预先做 DNS 解析、把域名钉成一个具体 IP，再把这次连接固定到该 IP"**（DNS pinning / 抗 DNS 污染），缓存在 `ipMap` 里，通过 needle 的 `lookup` 选项注入 HTTP 层 —— `vendor/needle/lib/needle.js:192` 确认 needle 支持 `lookup`，调用方还会额外传 `family: 4`（IPv4）。**没有第二种用途。**

**删掉会不会导致接口失败？——不会，因为它在生产路径里从未生效**

唯一传入 `lookup: dnsLookup` 的地方：
```
src\renderer\utils\musicSdk\kg\api-test.js:4,12: import { dnsLookup } from '../utils' / lookup: dnsLookup
src\renderer\utils\musicSdk\tx\api-test.js:4,12: 同上
src\renderer\utils\musicSdk\wy\api-test.js:4,12: 同上
```
这 3 个文件**没有任何 import 点**（理由与 §2.2 完全相同）。`musicSdk/utils.js` 被 **11 个活模块** import，但都只为 `formatSingerName` / `toMD5`，**没有一个为 `dnsLookup`**。

→ 所以在当前版本里，`dns.lookup` 的调用次数是 **0**。删除它**不会**改变任何接口的成功率（如果它历史上曾经生效过，那也只是回到了"没有这个优化"的状态，而不是引入新失败）。

**⚠️ 但只删函数是不够的**：`utils.js:2` 是**顶层静态 import**。换 `web` 目标打包时，webpack 会因为 `dns` 无法解析而**直接失败**（即使那个函数没人调用）。必须**同时删除 `utils.js:2` 的 `import dns`**，以及 `:8-30` 的 `ipMap` / `getHostIp` / `dnsLookup` 和三个 `api-test.js` 死文件。

**结论：可直接删除。不需要原生桥（`InetAddress` 也不用写）。**

---

### 2.5 `iconv-lite` 的 GBK → ✅ 纯 JS 可替代，**不必原生桥**（但解码/编码要分开处理）

**用法确认：一处解码、一处编码**

| 位置 | 类型 | 内容 |
| --- | --- | --- |
| `src/renderer/utils/music.ts:180-187` | **解码** | `readFile(lrcPath)` → `jschardet.detect(lrcBuf)`（`:181-182`）→ `iconv.encodingExists(encoding)`（`:186`）→ **`iconv.decode(lrcBuf, encoding)`**（`:187`）。读本地 `.lrc` 时按探测到的编码解码 |
| `src/renderer/worker/download/utils.ts:17-31` | **编码** | `iconv.encode(lrc, 'gbk', { addBOM: true })`（`:21`）/ `iconv.encode(lrc, 'utf8', { addBOM: true })`（`:27`）→ `fs.writeFile` 写出下载的歌词文件 |

**实测能力边界**

```
TextDecoder gbk     : 中文            <- 可用
TextDecoder gb18030 : 中文            <- 可用
TextDecoder big5    : 中文            <- 可用
TextDecoder shift_jis ok: true        <- 可用
TextEncoder().encoding: utf-8
TextEncoder('gbk') accepted           <- 不抛错！
TextEncoder('gbk') bytes : e4b8ade69687e6ad8ce8af8d   (UTF-8!)
iconv-lite  gbk  bytes   : d6d0cec4b8e8b4ca           (GBK)
```

- **解码侧**：`TextDecoder` 支持整个 WHATWG Encoding Standard 标签集（`gbk` / `gb18030` / `big5` / `shift_jis` / `euc-kr` / `windows-1252` …）。Android WebView 是 Chromium，实现同一套解码器 → **`iconv.decode` 可以直接换成 `new TextDecoder(enc).decode(u8)`**，输入本来就该是 `Uint8Array`（现在的 `lrcBuf` 是 Buffer，即 Uint8Array 子类，直接传即可）。顺带把 `jschardet`（`:181`）也一起评估——它是纯 JS（3.1.4，生产依赖），可以留。
- **编码侧**：**`TextEncoder` 在规范上只支持 UTF-8**。实测最危险的一点是 **`new TextEncoder('gbk')` 不抛错，`encoding` 仍是 `utf-8`，输出的是 UTF-8 字节** —— 如果照着"把 iconv 换成 TextEncoder"去改，会**静默产出错误的歌词文件**（文件名/编码声明是 GBK，内容是 UTF-8），且不会有任何报错。**这一点必须在实现时显式防住。**

**编码侧的 4 条路（按推荐度）**

1. **保留 `iconv-lite`（推荐）**。理由：它已经是 `package.json:167` 的**生产依赖**，而且是**纯 JS**：唯一运行时依赖是 `safer-buffer`（`iconv-lite@0.7.3` 的 `dependencies`），自己的 `package.json` 里带 `"browser": { "stream": false }`，说明它本来就被设计成可以打包进浏览器。体积实测：**全部文件 336 KB，其中 JSON 编码表 211 KB**（`cp936.json` 单独 47 KB）。现有代码本来就是 **`await import('iconv-lite')`**（`worker/download/utils.ts:17`、`music.ts:185`）→ webpack 会天然把它切成**懒加载 chunk**，只有真的下载 GBK 歌词时才加载。
2. **自己生成 GBK 编码表**：只需要 cp936 的**反查表**（Unicode → GBK），约 47 KB 数据。零依赖，但要自己维护一张表。
3. **降级为只输出 UTF-8**：现有 `format: 'utf8'` 分支（`:27`）已经存在，删掉 `'gbk'` 分支即可。**这是功能倒退**（车机/老播放器需要 GBK 歌词），且 ipc-contract §6.3 也只是把它当降级备选。
4. **写原生桥 `Charset.forName("GBK")`**：❌ **不推荐**。为了 47 KB 的表去写一个 Android 插件（还要跨桥传字符串/字节、处理 BOM），收益比极差。

**结论：解码 = 纯 Web 可替代（应删除 iconv-lite 的解码路径）；编码 = 纯 JS 可保留 `iconv-lite`，不必写原生桥。** 唯一前提是 `Buffer` polyfill（`safer-buffer` 需要 Buffer）—— 与第 6 项共用同一个依赖。

---

### 2.6 `src/renderer/utils/request.js` 的四重 Node 依赖 → ✅ 替代方案成立，改动面可控（但最大）

#### 2.6.1 四重依赖逐项

| 依赖 | 位置 | 替代方案 | 风险 |
| --- | --- | --- | --- |
| `needle` | `request.js:1`，唯一 HTTP 引擎；`request()` 在 `:25-34` | `fetch`（WebView 原生）或 `CapacitorHttp` | **中高**：见下"改动面" |
| `zlib.deflateRaw` | `:6`、`:247-252`、`:272` | **直接删除**（死代码，见 §2.2） | **低** |
| `Buffer` | `:267`（`Buffer.from(bHh,'hex')`）、`:269`（`Buffer.from(s,'base64')`）、`:272`（`Buffer.from(JSON)`）—— **全在死分支里**；另外 `:27` `resp.raw.toString()` 是 needle 给的 Buffer | 死分支随分支一起删；`:27` 换成 `await res.text()`。**但整个渲染层的 `Buffer` 需要 polyfill**（见 2.6.3） | **中** |
| `process.versions.app` | `:270-271`，赋值点在 `src/renderer/store/index.ts:4,6`（`process.versions.app = pkg.version`） | 换成**构建期常量**（`webpack.DefinePlugin` 已经在这里用了，`build-config/renderer/webpack.config.prod.js` 注入了 `process.env`/`COMMIT_ID`） | **低**，但 `store/index.ts:6` 在 Web 里会**直接抛 TypeError**（`process` 未定义），必须一起改 |

`needle` 是**本地 vendored 包**（`package.json:174` `"needle": "file:vendor/needle"`，版本 3.2.0），不是上游版本，所以不能用"上游行为"当契约，必须按实际用到的选项来重写。

#### 2.6.2 改动面（实测统计）

**核心文件 `request.js` 共 298 行**，真正要重写的：

| 位置 | 函数 | 处理 |
| --- | --- | --- |
| `:10-35` | `request()`（needle 调用、`json` 解析、`:23` `response_timeout`） | **重写** |
| `:49-78` | `buildHttpPromose()`（`.promise` + `.cancelHttp()` 契约） | 改 `AbortController` |
| `:110-116` | `cancelHttp()`（`requestObj.abort()`） | 改 `AbortController.abort()` |
| `:247-252`、`:265-274` | `handleDeflateRaw` + `bHtml` 分支 | **删除** |
| `:256-285` | `fetchData()` | **重写** |
| `:85-104` | `httpFetch()` + 错误码映射（`ETIMEDOUT`/`ESOCKETTIMEDOUT`/`ENOTFOUND`/`socket hang up`） | **需要重映射**：fetch 没有这些 Node `err.code`，要用 `AbortError`/`TypeError` 判定 |
| `:126-205` | `http` / `httpGet` / `httpPost` | **调用点为 0**（全库仅各自 1 处命中 = 定义本身）→ **可删** |
| `:215-245` | `http_jsonp` | 调用点 0 → **可删** |
| `:287-298` | `checkUrl`（`method: 'head'`） | 调用点 0 → **可删** |

估计 **80–120 行**核心改动。

**调用方（实测）**

- `httpFetch` 出现在 **39 个文件**；剔除死文件（3 个 `api-test.js`、2 个 `kg/temp/*`）后，**真实 importer 27 个**：
  - `kg/` 8 个：`comment.js`、`hotSearch.js`、`leaderboard.js`、`lyric.js`、`musicSearch.js`、`pic.js`、`songList.js`、`util.js`（另 `musicInfo.js`/`singer.js`/`album.js` 间接用）
  - `tx/` 8 个：`comment.js`、`hotSearch.js`、`leaderboard.js`、`lyric.js`、`musicInfo.js`、`singer.js`、`songList.js`、`utils/index.js`
  - `wy/` 9 个：`comment.js`、`leaderboard.js`、`lyric.js`、`musicDetail.js`、`musicInfo.js`、`songList.js`、`tipSearch.js`、`utils/index.js`（`musicSearch.js:1` 的 import 是注释）
  - 再加 `src/renderer/views/Setting/components/UserApiOnlineImportModal.vue:23`
- **返回值契约**：SDK 里 `statusCode` 被引用 **62 处**（最大的机械改动：`statusCode` → fetch 的 `status`）；`.raw` / `resp.headers` / `set-cookie` / `.cookies` 引用数均为 **0** → 不用实现。
- **选项语义需要映射**（实测各选项在 SDK 里的出现次数）：`form` **20 处**（→ `URLSearchParams` + `application/x-www-form-urlencoded`，注意 `request.js:16` 现在会顺带把 `json` 置 false）、`data` **12 处**（POST body）、`headers`、`timeout`（`request.js:23` → needle 的 `response_timeout`）、`json`（`request.js:16,21,280` 的自动解析，handmade 需要自己 `JSON.parse`）、`format:'json'`（7 处，**是默认值**，无实际作用）、`lookup`/`family`（只在死文件里）、`follow_max`（只在 `kg/temp/songList-new.js:667`）。
- `cancelHttp` **40 处**（含定义）→ 取消语义必须保留（`AbortController`）。

**结论：改动面是"1 个核心文件（约 100 行）+ 27 个 importer 的 `statusCode`→`status` 机械替换"，不是"重写 27 个文件"。** 但 `form`/`data`/`json` 的语义对齐必须逐接口验证（尤其 `wy` 的 `form: weapi(...)` 与 `kg` 的 `form` POST）。

#### 2.6.3 `Buffer` 在 WebView 里怎么替代

**现状：项目里没有任何 polyfill。**

| 包 | 状态 |
| --- | --- |
| `buffer` | ❌ **MISSING** |
| `node-polyfill-webpack-plugin` / `path-browserify` / `os-browserify` / `stream-browserify` / `process` / `util` | ❌ 全 MISSING |
| `events` | ✅ 3.3.0（无关） |
| webpack 配置 | `build-config/renderer/webpack.config.base.js:12` 是 **`target: 'electron-renderer'`**；全 `build-config` 搜 `resolve.fallback` / `ProvidePlugin` / `polyfill` **零命中** |

也就是说：现在 `Buffer` / `process` / `zlib` / `crypto` / `dns` 之所以能用，**完全是靠 Electron 渲染进程的 Node 集成**，一行 polyfill 都没有。换成 `web` 目标后它们会全部消失。

**两条路**

- **(a) 加 `buffer` 依赖 + webpack `resolve.fallback` / `ProvidePlugin`（推荐）**
  - 代码里 `Buffer.` 的真实用量（用词边界统计，已排除 `mediaBuffer.` 这类误命中）：**全库 100 处**。渲染层活代码集中在：`wy/utils/crypto.js`(9)、`worker/download/lrcTool.ts`(4)、`request.js`(3)、`common/utils/lyricUtils/kg.js`(3)、`worker/main/common.ts`(2)、`worker/main/music.ts`(2)、`tx/qrcDecode.js`(2)、`kg/lyric.js`(1)、`tx/utils/crypto.js`(1)、`utils/index.ts`(1)、`worker/download/...`。
  - **决定性理由**：`lx.utils.buffer` 是**对外契约**（`src/main/modules/userApi/renderer/preload.js:266-273`）：
    ```js
    buffer: {
      from(...args) { return Buffer.from(...args) },
      bufToString(buf, format) { return Buffer.from(buf, 'binary').toString(format) },
    }
    ```
    `from(...args)` 要接受 Node 的全部重载（`from(str,'base64')`、`from(str,'hex')`、`from(str,'binary')`…），`'binary'` / `'latin1'` 这些编码语义**只有真正的 `buffer` polyfill 才等价**。自定义源脚本（`docs/custom-source.md:18` 明确说是对外契约）会依赖它。
  - **(a) 是唯一能"行为等价"的方案**，改动量也最小（只加依赖 + 配置）。
- **(b) 手写 `Uint8Array` + `TextEncoder` + `atob`/`btoa` 帮助函数（不推荐）**
  - 需要改 100 处；且现有代码大量做**二进制 → 字符串 → base64** 的往返（`worker/main/music.ts:29` `Buffer.from(picture.data).toString('base64')`、`kg/lyric.js:82` `Buffer.from(body.content,'base64').toString('utf-8')`、`lrcTool.ts:67-76`、`utils/index.ts:56`），`atob` + `TextDecoder` 的写法在非 ASCII / 非 UTF-8 数据上**极易静默出错**。
  - 只有在"绝对不想加任何依赖"时才考虑，并且必须为上面每个调用点写单测。

**推荐：加 `buffer`（`buffer@^6` 或 5.x）+ `ProvidePlugin({ Buffer: ['buffer','Buffer'] })` + `resolve.fallback`。** 这一个依赖同时解决 §2.5 的 GBK 编码、§2.6 的 request.js、以及 `lx.utils.buffer` 的对外契约。

#### 2.6.4 核实：`CapacitorHttp` 到底能不能绕开 CORS

**先说结论：ipc-contract `docs/android/ipc-contract.md:716` 写的是"能绕开 WebView 的 CORS/混合内容限制" —— 这个方向是【正确的】。**（任务描述里说"ipc-contract 提到不能绕开"，与文件实际文字不符；我按文件原文和官方文档核实。）

依据：
- 官方文档原文："The Capacitor Http API provides native http support via **patching `fetch` and `XMLHttpRequest` to use native libraries**." —— [Http Capacitor Plugin API](https://capacitorjs.com/docs/apis/http)
- Ionic 官方论坛（Capacitor 维护者 twestrick 的回答）："CORS is a browser specific security feature. Any HTTP requests **outside a browser** like from a backend server is not held to comply. With that, the Capacitor HTTP plugin **uses native calls vs. through the embedded browser so it is not held to comply as well**." —— [Ionic Forum #230474](https://forum.ionicframework.com/t/how-works-cors-in-capasitor-on-real-devices/230474)
- Ionic 的 CORS 排障文档也把"用原生 HTTP 插件"列为绕开 CORS 的正式手段。

**但必须纠正/补充 3 点**（这些是本次核查新增的风险）：

1. **包名要改**。该能力在 v5+ **内置于 `@capacitor/core`**（导出 `CapacitorHttp`），**不需要单独安装 `@capacitor/http`**。`@capacitor/http` 这个名字在 npm 上不是官方包；社区版是 [`@capacitor-community/http`](https://www.npmjs.com/package/@capacitor-community/http)（v1.4.1，已 4 年未更新，提供下载/上传/cookie 等额外能力）。
2. **"绕开 CORS" ≠ "绕开 Android 明文流量策略"（最重要的新增风险）**。CapacitorHttp 走的是**应用进程的原生网络栈**，因此**同样受 Android Network Security Config / `android:usesCleartextTraffic` 约束**（Android 9 / API 28 起默认禁止明文 HTTP —— [Android 官方文档](https://developer.android.com/privacy-and-security/risks/cleartext-communications)）。
   实测本项目里 `http://`（**明文**）请求 URL 的规模：在**活模块**里有 **31 处非注释命中**，其中 **3 处是 `Referer`/`Refere` 头里的字符串**，即约 **28 处真实明文请求 URL**：
   | 文件 | 处数 | 例 |
   | --- | --- | --- |
   | `wy/utils/index.js:5` | 1 | **`http://interface.music.163.com/eapi/batch`** ← wy 的**核心数据路径**（搜索/热搜/歌手/歌单/歌词全走它） |
   | `kg/songList.js` | 13 | `http://gateway.kugou.com/v2/album_audio/audio`(:304)、`http://msearchretry.kugou.com/...`(:1001) |
   | `kg/comment.js` | 6 | `http://comment.service.kugou.com/...`(:53) |
   | `kg/singer.js` | 3 | `http://mobiles.kugou.com/api/v5/singer/...`(:11,38,59) |
   | `kg/leaderboard.js` | 2 | `http://mobilecdnbj.kugou.com/api/v5/rank/list`(:78) |
   | `kg/lyric.js` | 2 | `http://lyrics.kugou.com/search`(:39)、`/download`(:62) |
   | `kg/hotSearch.js` / `pic.js` / `musicInfo.js` / `musicSearch.js` | 各 1 | `http://songsearch.kugou.com/song_search_v2`(:12) |
   | `tx/comment.js:95`、`tx/songList.js:401` | 各 1 | `http://c.y.qq.com/...` |

   → **如果 Capacitor 生成的 manifest 不允许明文，kg / wy / tx 会整体不可用。** 社区证据显示 Capacitor 生成的 `AndroidManifest.xml` **默认确实带 `android:usesCleartextTraffic="true"`**（[quasar#17219](https://github.com/quasarframework/quasar/issues/17219)、[capacitor#2118](https://github.com/ionic-team/capacitor/issues/2118)），但这是**版本相关、且常被视为安全问题而被收紧**的实现细节 —— **必须真机实测确认**，不能假定。
3. **`CapacitorHttp` 的 `data` 在原生侧只支持 string / JSON**（官方文档：FormData / Blob / ArrayBuffer 只在 web 或开启 patch 后的 fetch/XHR 里直接支持）。这与 `request.js` 的 `form`（20 处）/ `data`（12 处）语义需要对齐；另外全局 patch `fetch` 会影响本地 `file://`/`capacitor://` URL（社区反馈过的坑）。

**混合内容（mixed content）**：Android 端 Capacitor 默认以 `http://localhost` 提供页面（[Ionic Forum](https://forum.ionicframework.com/t/how-works-cors-in-capasitor-on-real-devices/230474)），源不是 HTTPS，所以 `http://` 子请求**不构成混合内容拦截**；真正的门槛是上面的**明文流量策略**。

> ⚠️ **阶段 3 / 线 B 的纠正（已在真机验证前登记）**：上面这一段的前提**对本仓库的 Capacitor 8.5.2 不成立**。
> `@capacitor/cli` 的 `declarations.ts` 里 `server.androidScheme` 的默认值是 **`https`**（不是 `http`），
> 也就是说页面 origin 是 `https://localhost`；此时 `http://` 子请求会**同时**撞上
> **混合内容**（`android.allowMixedContent` 默认 `false`）与**明文流量策略**两堵墙，两者的报错不同。
> 这条纠正的证据、以及"怎么把两堵墙分开"的完整真机步骤，见
> **`docs/android/cleartext-verification.md`**（§1.3 结论纠正 1、§4.4 错误指纹表）。

---

### 2.7 `better-sqlite3` 同步 API → Capacitor SQLite 异步 API → ✅ 用插件 + 内部异步化，**不必自写原生桥**

#### 2.7.1 `dbService` 被怎么调用（关键结论：**外部契约本来就是异步的**）

- 实现在 **`src/main/worker/dbService/**`，23 个文件、2633 行**（`tables.ts` 217、`list/index.ts` 405、`list/dbHelper.ts` 376、`list/statements.ts` 181、`lyric/*` 451、`download/*` 234、`migrate.ts` 103 …）。
- 它在**独立 worker_thread 里**运行，并通过 **Comlink** 暴露：`src/main/worker/index.ts:1-6`（`createDBServiceWorker()` → `dbService`）、`src/main/worker/utils/index.ts:7-14`（`new Worker(new URL('../dbService', import.meta.url))` + `Comlink.wrap(nodeEndpoint(worker))`）、`src/main/worker/utils/worker.ts:1-9`（`Comlink.expose`）。
- **调用点分布在 31 个文件**（`src/main/app.ts:276,285`、`src/main/event/ListEvent.ts:40,52,62,72,83,94,106,119,131,141,151,163`、`src/main/event/DislikeEvent.ts:14,27,39`、`src/main/modules/winMain/rendererEvent/{data,download,music}.ts`、`src/main/modules/commonRenderers/{list,dislike}/rendererEvent.ts`、`src/main/utils/migrate.ts:67,72` …）。
- **因为 Comlink 的远程调用返回值本来就是 `Promise`（`src/main/types/app.d.ts:27` 的 `DBSeriveTypes = Comlink.Remote<...>`），所有调用点已经是 `await` 或直接 `return` 一个 Promise。** 抽样确认：
  - `src/main/event/ListEvent.ts:40` `await global.rain.worker.dbService.listDataOverwrite(listData)`（全部同形）
  - `src/main/modules/winMain/rendererEvent/data.ts:17` `const music = (await global.rain.worker.dbService.getListMusics(LIST_IDS.DEFAULT))[index]`
  - `src/main/modules/commonRenderers/list/rendererEvent.ts:7` `return global.rain.worker.dbService.getAllUserList()`

→ **结论：把内部实现改成 async，对外部 31 个调用文件是 0 改动。** 比阶段 0 估计的"业务层要改成 async"要轻。

#### 2.7.2 真正要改的是**内部**，逐文件清单

| 文件 | 行数 | 需要做什么 |
| --- | --- | --- |
| `db.ts` | 63 | **重写**：`:1` `import Database from 'better-sqlite3'`；`:22` `nativeBinding`（无对应）；`:32,43` `new Database(path, { fileMustExist })`（无对应）；`:49` `db.pragma('journal_mode = WAL')`；`:53` `if (!verifyDB(db))`（要 await）；`:12-15` `db.exec`；`:67` `process.on('exit', ...)`（Android 无对应） |
| `statements.ts` × 6 | 567 | `db.prepare(sql)` 返回的 statement 对象（`.get/.all/.run`）在 `@capacitor-community/sqlite` 里**没有对应**。**推荐**：写一个 async 但**外形兼容**的 statement 适配器（`{ get, all, run }` 都是 Promise），这样 `dbHelper` 的调用点几乎只需加 `await` |
| `dbHelper.ts` × 6 | 763 | 同步 DB 调用点密集。**实测**：`.run()` **77**、`.get()` **20**、`.all()` **11**、`.exec()` **5**、`.pragma()` **1** = **114 处**同步调用；另有 **`db.transaction()` 31 处** |
| `modules/*/index.ts` × 6 | 879 | 目前是**同步**函数（抽样：`music_url/index.ts:15,24,32,39,46` 全无 `async`；`getMusicUrl` 声明 `: string \| null`）→ 全部改 `async`。因为在 Comlink 边界之后，**不改变对外契约** |
| `migrate.ts` | 103（110 行） | 要 async：`:34-41` `migrateV1`（`db.prepare(...).get()`）、`:51-55` `migrateV2`（3 个 `.run()`）、`:68-80` `migrateV3`（`.all()` + 循环 `.run()`，**且依赖循环内的即时可见性**）、`:82-110` 的 switch 里 4 处 `.run()` |
| `verifyDB.ts` | 28 | 要 async（`db.ts:53` 同步调用它） |
| `tables.ts` | 217 | **纯 SQL 字符串，不用改**（这是 ipc-contract §6.3 说"SQL 原样复用"的部分，确认成立） |
| `modules/index.ts` | 6 | 纯聚合，不用改 |

**`db.transaction(cb)` 是最需要设计的地方**（31 处）。`better-sqlite3` 的 `transaction()` 不只是 `BEGIN/COMMIT`，还有：
- 同步回调（内部可自由读写，事务边界确定）；
- busy 时的**自动重试**语义（`db.transaction(fn)` 包了 `IMMEDIATE` + 重试）；
- 嵌套时用 SAVEPOINT。
在 `@capacitor-community/sqlite` 里需要手写 `execute('BEGIN') / COMMIT / ROLLBACK`，并把循环体改成 `await`。这是**行为最容易漂移**的部分（尤其 `list/dbHelper.ts:328-395` 的 `overwriteMusicInfo` / `overwriteListData`、`:222-257` 的 `moveMusicInfoAndRefreshOrder`）。

#### 2.7.3 "包一层 façade 保持同形"是否现实 → **现实，而且成本比阶段 0 估计的更低**

- **现实**：`dbService` 的对外名字/形状（`global.rain.worker.dbService.<method>`）可以完全保留 —— 因为 Comlink 已经把每个方法包成 Promise。只要 `modules/*/index.ts` 的导出改成 `async`，**31 个调用文件一行都不用改**，`src/main/types/worker.d.ts` / `app.d.ts` 的类型也不用改（`Comlink.Remote` 已把返回值包成 Promise）。
- **改动被完全封闭在**：`dbService/**` 内部（约 2633 行中的 ~2400 行）+ 下面的测试夹具。
- **⚠️ 阶段 0 没提到的隐藏成本：现有单测依赖同步语义。**
  - `tests/unit/database.test.cjs:12-30` 定义了一个**同步** `Adapter` 类（`exec` / `pragma` / `prepare → { get, all, run }` / `close`）来 mock `better-sqlite3`，用 `tests/unit/load-ts.cjs:7-24` 注入依赖；`:47`、`:71-76`、`:93` 直接**同步**调用 `db.prepare(...).get(...)` 和 `statement.createListQueryStatement().all()`。
  - 同样模式的还有：`tests/unit/playback-queue.test.cjs:3,10-15`、`tests/unit/playlist-collection.test.cjs:4,10-12`、`tests/unit/downloads.test.cjs:9`。
  - 而 `tests/ui/playback-queue.electron.cjs:45,61,64,72`、`tests/ui/song-list-interactions.electron.cjs:51,61,85` 是**通过 Electron 的 `global.rain.worker.dbService` 异步调用**的 → 这些**不受影响**。
  - → 改异步会**打破 4 个单测夹具**，需要把它们也改成 async。这既是成本，**也是现成的验收网**（见 §3 第 3 件事）。
- **顺带的好消息**：`comlink@4.3.1` 已经是生产依赖（`package.json:163`）且浏览器可用，所以 worker 边界本身可以保留为 **Web Worker + Comlink**；`node:worker_threads` / `comlink/dist/esm/node-adapter` 换成浏览器侧的 `Comlink.wrap(worker)` 即可（改动集中在 `src/main/worker/utils/{index,worker}.ts` 两个共 24 行的小文件）。

**结论：不是"缺插件"，也不是"自写原生桥" —— 用 `@capacitor-community/sqlite`（及其 web 回退）+ 内部异步化。风险等级：高（工作量最大、且直接影响歌单/下载/歌词数据的正确性）。**

**⚠️ 未确认**：`@capacitor-community/sqlite` 的 `journal_mode=WAL` 支持、嵌套事务/SAVEPOINT 行为、并发 busy 重试语义 —— 插件未安装，本次只读核查**无法验证**（见 §5）。

---

## 3. 必须在阶段 1 就验证的 3 件事（按风险排序）

### 第 1 件：音源网络层端到端 —— `request.js` → `fetch`/`CapacitorHttp`，叠加 `wy` 全套加密

**为什么排第一**：它是"能不能搜到歌"的硬门槛，同时一次覆盖第 1、2、3、6 项；而且只有真发请求才能暴露"算法对但接口不通"（风控/签名/明文策略）的问题。

**具体验证方法**

1. **先在桌面 Node 里做（不碰产品代码、不需要 Android）**
   - 新建一个临时脚本（放 `tests/` 之外或临时目录，标注为 spike，不入库），**复制** `wy/utils/crypto.js` 的逻辑，把 `node:crypto` 全换成：BigInt 模幂（RSA）+ `crypto-js`（AES-ECB/CBC/MD5）+ `crypto.getRandomValues`。
   - 用**原生 `fetch`** 真调这三个端点，把返回 `body` 与当前 needle 版本逐字段对比：
     - `http://interface.music.163.com/eapi/batch`（`wy/utils/index.js:5`，eapi，AES-ECB + MD5）
     - `https://interface3.music.163.com/eapi/song/lyric/v1`（`wy/lyric.js:38`，eapi）
     - `https://music.163.com/weapi/v3/song/detail`（`wy/musicInfo.js:6`，**weapi，会走 RSA**）
   - 再跑一遍 kg（`form` + MD5 签名，`kg/util.js:13-20`）和 tx（SHA-1 + `zzcSign`）。
   - **验收**：搜索结果 / 歌单 / 歌词与桌面版完全一致；`weapi` 的 `encSecKey` 长度恒为 256 hex 字符（含前导零补齐）。
2. **在 Android 真机上重跑同一段**
   - 显式开启 `CapacitorHttp`（`capacitor.config` 的 `plugins.CapacitorHttp.enabled = true`），确认：(a) 从 `http://localhost` 页面直接 `fetch` 跨域失败（预期），(b) 走 `CapacitorHttp` 成功。
   - 记录每次请求的实际 URL 协议，为第 2 件事做交叉验证。
3. **记录**：每个端点"桌面 fetch / 真机 fetch / 真机 CapacitorHttp"三列的成功率与错误码。

### 第 2 件：Android 网络策略 —— 明文流量 + CORS（约 28 处 `http://` 端点能不能通）

**为什么排第二**：它是"会不会所有音源一起死"的分水岭，且与第 1 件耦合；隐藏度最高（代码里看不出问题，只有真机才报错）。

**具体验证方法**

1. 建一个**最小 Capacitor 工程**（不接本项目代码），一个页面里用三种方式请求，做成功/失败矩阵：
   - `fetch` → `http://interface.music.163.com/eapi/batch`（预期：**CORS 失败**）
   - `fetch`（`CapacitorHttp` patch 后）→ 同上
   - `CapacitorHttp.request(...)` → 同上
   - 同样三组换成 `http://songsearch.kugou.com/song_search_v2?...`（kg 的 `http://`）与一个纯 `https://` 对照
2. 打开 `android/app/src/main/AndroidManifest.xml`，**记录 Capacitor 生成的实际值**（`android:usesCleartextTraffic`），以及 `res/xml/network_security_config.xml` 是否存在、内容如何。
3. 如果明文被拦：验证 **`network_security_config` 白名单方案**（只对 `interface.music.163.com`、`*.kugou.com`、`c.y.qq.com` 等开明文，而不是全局 `usesCleartextTraffic=true`）—— 这比全局开关更安全，且能同时覆盖 WebView 与 CapacitorHttp（Network Security Config 是应用级的）。
4. **验收**：得到一张"端点 × 请求方式 × 成败 × 错误码"的表，并据此定下 manifest / network security config 的最终配置。

### 第 3 件：SQLite 异步化 spike + 事务等价性

**为什么排第三**：风险最高但**不确定性最低**（方案已确定，是纯工程量问题），而且可以晚一点动；但它决定了阶段 2 的工期。

**具体验证方法**

1. **挑最小 + 最大两个模块做 spike**：`music_url`（`index.ts` 49 + `dbHelper.ts` 75 + `statements.ts` 69 = 193 行）先跑通，再上 `list`（405 + 376 + 181 = 962 行，含 8 处 `db.transaction`）。
2. 在 WebView 里用 `@capacitor-community/sqlite` 实现：
   - 一个 **async 但外形兼容的 statement 适配器**（`{ get, all, run }` → Promise），把 `statements.ts` × 6 的改动压到最小；
   - `db.transaction(cb)` 的等价实现（`BEGIN` / `COMMIT` / `ROLLBACK`，并确认 31 处调用点的循环体改 `await` 后**原子性不变**）；
   - `journal_mode=WAL`、`verifyDB`（`verifyDB.ts:28`）、`migrate` 三段（`migrate.ts:34-80`）的 async 化。
3. **把现有单测当验收网**：把 `tests/unit/database.test.cjs:12-30`、`playback-queue.test.cjs:10-15`、`playlist-collection.test.cjs:10-12`、`downloads.test.cjs:9` 的同步 `Adapter` 改成 async（`prepare()` 返回 `{ get: async, all: async, run: async }`，`transaction(cb)` 改成 `async`），其余断言**原样不改**。
4. **验收**：这 4 个单测在 async 适配器下**全绿**；`migrate` 的 v1→v2→v3→v4 路径与 `verifyDB` 的失败分支行为与桌面版一致。
5. **顺带验证**：Web Worker + `Comlink.wrap(worker)`（去掉 `comlink/dist/esm/node-adapter`）在 Android WebView 里能否跑通。

---

## 4. 必须写原生桥的最终清单

### 4.1 本次核查的 7 项：**没有一项需要自写原生桥**

| # | 阶段 0 初判（`ipc-contract.md`） | 本次核查的纠正 |
| --- | --- | --- |
| 1 | `:737` ——「Android `Cipher` 有 `RSA/ECB/NoPadding`，但 WebCrypto 没有；Capacitor 无插件。**必须**写原生桥（`@PluginMethod` 里做 `Cipher`）或引入纯 JS 大数库」 | ❌ **不必写原生桥。** 纯 JS `BigInt` 内联实现即可：实测与 `node:crypto` 的 `RSA_NO_PADDING` **逐字节一致**，约 **54 µs/次**（比现在的 Node 路径 185 µs 更快）。**也不需要引入大数库**（`node_modules` 里本来就没有 RSA 库）。唯一必须注意的是输出要 `padStart(256,'0')`、`crypto-js` 的 key 要传 typed array |
| 2 | `:736` ——「Capacitor 无 zlib 桥。首选 `pako`（纯 JS）；若性能不满意再写原生桥」 | 🗑️ **该分支是死代码，可直接删除**，不需要桥也不需要 pako。**但另外 4 处 zlib 用途（kg 歌词 `inflate`、tx QRC `inflate`、配置 `gzip/gunzip`、`lx.utils.zlib`）确实需要 pako**，且 `pako` 当前只是 dev 树的传递依赖，**必须显式加进 `dependencies`** |
| 3 | `:739` ——「WebCrypto 不提供 MD5。用 JS 实现（`js-md5`），无需原生桥」 | ✅ 方向正确，**但不需要新增 `js-md5`**：用**已经装了的生产依赖** `crypto-js@4.2.0`（实测 MD5 与 node 一致，同时解决 AES-ECB）。**无需原生桥** |
| 4 | `:738` ——「Android 无 JS 侧 DNS API。直接删除该优化；若接口必须指定 IP，写原生桥走 `InetAddress`」 | ✅ 同意删除，并补强：它**只被 3 个无任何引用的 `api-test.js` 使用，在生产路径里调用次数为 0**，所以删掉不可能导致接口失败。**不需要 `InetAddress` 桥。但必须连 `musicSdk/utils.js:2` 的顶层 `import dns` 一起删**，否则 web 打包直接失败 |
| 5 | `:741` ——「`TextDecoder` 支持 `gbk` 解码，但 `TextEncoder` **不支持** GBK 编码。要么写原生桥（`Charset.forName("GBK")`），要么降级为只输出 UTF-8 BOM 的 `.lrc`」 | ❌ **两个选项都不必选。** 解码：`TextDecoder` 可直接替换（实测 `gbk`/`gb18030`/`big5`/`shift_jis` 全可用）。编码：保留 **`iconv-lite`（纯 JS、已是生产依赖、自带 `browser` 字段、336 KB、`await import` 天然分包）** 即可。**不必写原生桥，也不必降级。** ⚠️ 必须防住 `new TextEncoder('gbk')` **不报错但输出 UTF-8** 的静默坑 |
| 6 | `:716` ——「`@capacitor/http`（`CapacitorHttp`）：能绕开 WebView 的 CORS/混合内容限制。但它不提供 `deflateRaw`」 | ✅ **CORS 方向正确**（官方文档：patch fetch/XHR 走**原生库**；论坛：原生调用不受浏览器 CORS 约束）。**3 点纠正**：(1) 该能力**内置于 `@capacitor/core`**，不用装 `@capacitor/http`；(2) **它不绕开 Android 明文流量策略** —— 项目里有约 **28 处真实 `http://` 明文请求 URL**（含 wy 的核心路径 `http://interface.music.163.com/eapi/batch`），必须配置 Network Security Config + 真机验证；(3) 原生侧 `data` 只支持 string/JSON。**不必写原生桥** |
| 7 | `:735` ——「不是缺插件，而是同步 API → 异步 API 的语义转换；在 JS 侧包一层 `dbService` façade（同名同形），SQL 原样复用」 | ✅ 同意，并补强两点：(1) **外部契约本来就是异步的**（Comlink `Remote`）→ 31 个调用文件 **0 改动**，改动封闭在 `dbService/**` 内部 + 4 个单测夹具；(2) `db.transaction()` **31 处**是最难等价的部分（busy 重试 / SAVEPOINT）。**这是插件能覆盖的（`@capacitor-community/sqlite`），不是自写原生桥** |

### 4.2 需要新增的依赖（把"原生桥"换算成"依赖"）

| 依赖 | 必要性 | 用在 |
| --- | --- | --- |
| **`buffer`** | **必要**（当前 MISSING，且项目零 polyfill） | `Buffer` 全局 polyfill：`request.js`、`wy/utils/crypto.js`、`lx.utils.buffer` 对外契约、`iconv-lite` 的 `safer-buffer` |
| **`pako`** | **必要**（当前只是 `jszip`→`unzip-crx-3` 的 dev 传递依赖，必须显式提升） | `common/utils/lyricUtils/kg.js`、`tx/qrcDecode.js`、`common/utils/nodejs.ts`、`lx.utils.zlib`；（若保留 `bHtml` 头还需要 `deflateRaw`） |
| `@capacitor-community/sqlite` | 必要（阶段 2） | 替代 `better-sqlite3` |
| `crypto-js` | **不需要新增**（`package.json:164` 已有） | AES-128-ECB/CBC、MD5、SHA-1 |
| RSA 大数库（`jsencrypt`/`node-rsa`/`node-forge`…） | **不要引入** | 它们只支持 PKCS#1 v1.5 / OAEP，`RSA_NO_PADDING` 仍需自己拼大数 → 纯亏 |
| `js-md5` | **不要引入** | `crypto-js` 已覆盖 |

### 4.3 明确不在本次核查范围、仍可能需要自写原生桥的部分

`docs/android/ipc-contract.md:742-744` 里的另外几项**本次没有核查**，不要被本文的"零原生桥"结论误导：
- **自定义源宿主（`lx`/`rain`）** —— 需要"执行第三方脚本 + 提供 `lx` API + 网络代理 + 取消请求"的组合。**从代码形态看确实需要自写宿主**（`src/main/modules/userApi/renderer/preload.js:1-5` 依赖 `electron` / `needle` / `zlib` / `crypto`）。但注意：**`preload.js:255-257` 里也有一份 `RSA_NO_PADDING`**，第 1 项的 BigInt 结论**同样适用于它**；`:274-291` 的 `lx.utils.zlib` 由 pako 覆盖；`:249-264` 的 `lx.utils.crypto.{aesEncrypt,md5,randomBytes}` 由 `crypto-js` + `crypto.getRandomValues` 覆盖。**即"宿主需要重写"成立，但宿主里的密码学算法不需要原生桥。**
- **通知栏歌词 / 悬浮窗歌词**、**托盘替代（`MediaSessionCompat`）** —— 仍需自写原生桥，但首版不做。

---

## 5. 我没能确认的点（明确标注，未做推测）

1. **`weapi` 在真实服务端的兼容性 / 定长 hex 要求**：我实测确认的是"3 个固定样本下，自写 BigInt 模幂与 `node:crypto` 的 `RSA_NO_PADDING` 输出**逐字节一致**"，以及"密文有约 1/375 概率以 `0x00` 开头"。**服务端是否严格按 128 字节解析 `encSecKey`、以及 `weapi` 接口当前是否仍可用（可能已被风控），本次【没有联网验证】**。我是故意不联网调第三方接口的 —— 这属于阶段 1 第 1 件事的验证内容。
2. **`@capacitor-community/sqlite` 的具体能力**：`journal_mode=WAL` 支持、嵌套事务 / SAVEPOINT、并发 busy 重试语义、web 回退（`jeep-sqlite`/`sql.js`）的可用性 —— **插件未安装，只读核查无法验证**。
3. **Android 真机行为（全部）**：Capacitor 生成的 `AndroidManifest.xml` 里 `android:usesCleartextTraffic` 的**实际值**、约 28 处明文端点在真机上的连通性、`CapacitorHttp` 在真机上的表现 —— **本机没有 Android SDK / 设备**（`docs/android-port-plan.md:7-15`），**全部未验证**。这是阶段 1 第 2 件事。
4. **`pako` 2.x 的 API 差异**：我确认了本机 `pako@1.0.11` 顶层导出 `deflateRaw`/`inflateRaw`（`node_modules/pako/lib/deflate.js:399`）。**若要用 2.x，"顶层 `deflateRaw` 是否仍存在"我没有逐字核实官方迁移说明**，请以实际安装版本为准（或直接锁 `^1`）。
5. **打包体积**：我实测 `iconv-lite` 全部文件 336 KB（JSON 表 211 KB，`cp936.json` 47 KB），且现有代码是 `await import('iconv-lite')` 动态导入。但 **"webpack 实际只会把 cp936 打进懒加载 chunk、还是会把所有编码表都打进去"我没有跑构建验证**（遵守"不要跑 pack.js / build"的约束）。如果体积超标，退路是自己生成 cp936 反查表（见 §2.5 方案 2）。
6. **"死代码"的判定依据**：第 2、4 项以及 `kg/album.js`、`kg/temp/*` 的"死代码"结论，依据是**全量静态 import 图搜索**（对 `src/`、`tests/`、`build-config/` 搜 `api-test` / `dnsLookup` / `kg/temp` 等，0 命中，且音源注册是显式列举见 `musicSdk/index.js:1-3`）。**我没有跑 webpack 打包来确认它们真的不进产物**。如果存在我没搜到的动态拼路径加载方式，结论需要修正 —— 但即便如此，"删除后请求**不会**失败"这一点仍然成立（因为它们当前就没有被调用）。
7. **`http://` 端点数量的口径**：我用的是"活模块里含 `http://` 的非注释行数 = 31，其中 3 行是 `Referer`/`Refere` 头"→ 约 28 处真实请求 URL。这个口径**包含三元表达式分支和模板字符串里的多个 URL**，是"代码行数"而非"唯一端点去重数"。**端点去重计数我没有做。**
8. **`@capacitor/http` 这个包名是否在 npm 上存在**：官方文档只说"bundled with `@capacitor/core`"，我**没有直接查 `@capacitor/http` 的 npm 注册表条目**。可以确定的是：官方路径是 `@capacitor/core` 的 `CapacitorHttp`，社区包是 `@capacitor-community/http`。

---

## 6. 附录：实测脚本与原始输出

### 6.1 RSA_NO_PADDING 等价性与性能（实测 A）

```js
const crypto = require("crypto");
const pub = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----";
const jwk = crypto.createPublicKey(pub).export({ format: "jwk" });
const nHex = Buffer.from(jwk.n, "base64url").toString("hex");
const eHex = Buffer.from(jwk.e, "base64url").toString("hex");
const n = BigInt("0x" + nHex), e = BigInt("0x" + eHex);
function nodeRsa(buf) { return crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_NO_PADDING }, Buffer.concat([Buffer.alloc(128 - buf.length), buf])).toString("hex"); }
function jsRsa(buf) {
  let r = 1n, b = BigInt("0x" + (buf.toString("hex") || "0")) % n, x = e;
  while (x > 0n) { if (x & 1n) r = (r * b) % n; b = (b * b) % n; x >>= 1n; }
  return r.toString(16).padStart(256, "0");
}
```

```
kty= RSA | modulus bytes= 128 | bits= 1024 | e(hex)= 010001 | e(dec)= 65537
node native : 6424370b84242eedd6de9f79cf43afa9d98f184d26d9bf965bc335836471e775a33fd2d6d6ac92fadd47a65b1dcd6f91bd08245da4b4207049498eb31023448ebddc6160affb783c6a83501f6332bfd9e31c6bfcd1c1e239a60e3ab30fff573600a94c02de35fa34b4d996835005a46b2ccfb6bab968c91e3b4085bf1dc5c445
pure BigInt : 6424370b84242eedd6de9f79cf43afa9d98f184d26d9bf965bc335836471e775a33fd2d6d6ac92fadd47a65b1dcd6f91bd08245da4b4207049498eb31023448ebddc6160affb783c6a83501f6332bfd9e31c6bfcd1c1e239a60e3ab30fff573600a94c02de35fa34b4d996835005a46b2ccfb6bab968c91e3b4085bf1dc5c445
byte-identical: true
ciphertexts with leading 0x00 byte in 3000 samples: 8
200 pure-JS modpow ms: 10.9 => per-call us: 54.4
200 node-native RSA_NO_PADDING ms: 37.0
```

### 6.2 crypto-js 等价性与陷阱（实测 A）

```
crypto-js version: 4.2.0
has AES: true | has MD5: true | has SHA1: true | mode.ECB: true | mode.CBC: true
AES-128-ECB hex match: true
AES-128-CBC(base64 str) match: true
MD5 match: true
SHA1 match: true
WebCrypto subtle.digest SHA-1 available: true

node ref            : +z7w8/LPuQKtpOBUDuiPkw==
crypto-js plain Arr : agfiw8+y4lji60p14iDiJw==  -> matches node? false
crypto-js typedArr  : +z7w8/LPuQKtpOBUDuiPkw==  -> matches node? true
WordArray.create on a byte array treats entries as 32-bit WORDS -> words: [1,2,3,4]
```

### 6.3 编码能力边界（实测 A）

```
TextDecoder gbk     : 中文
TextDecoder gb18030 : 中文
TextDecoder big5    : 中文
TextDecoder shift_jis ok: true
iconv-lite gbk bytes     : d6d0cec4b8e8b4ca
TextEncoder('gbk') bytes : e4b8ade69687e6ad8ce8af8d   （UTF-8！标签被静默忽略）
TextEncoder('gbk') 的 .encoding 仍是 utf-8
iconv-lite version: 0.7.3 | deps: {"safer-buffer":">= 2.1.2 < 3.0.0"} | browser field: {"stream":false}
iconv-lite 全部文件 344185 字节（336 KB），其中 JSON 表 216084 字节（211 KB）
```

### 6.4 依赖可用性扫描（实测 B）

```
pako = 1.0.11          （传递依赖：jszip → unzip-crx-3；不在 package.json）
crypto-js = 4.2.0      （dependencies ✅）
js-md5 = MISSING       spark-md5 = MISSING    blueimp-md5 = MISSING
jsencrypt = MISSING    node-rsa = MISSING     node-forge = MISSING   forge = MISSING
bn.js = MISSING        elliptic = MISSING     asn1.js = MISSING      jsrsasign = MISSING
big-integer = MISSING  decimal.js = MISSING   @noble = MISSING
buffer = MISSING       node-polyfill-webpack-plugin = MISSING
path-browserify = MISSING  os-browserify = MISSING  stream-browserify = MISSING
process = MISSING      util = MISSING         events = 3.3.0
iconv-lite = 0.7.3（dependencies ✅）  needle = 3.2.0（file:vendor/needle）  comlink = 4.3.1（dependencies ✅）
```

---

## 7. 参考来源

- [Http Capacitor Plugin API — Capacitor Documentation](https://capacitorjs.com/docs/apis/http)
- [How works cors in capasitor on real devices — Ionic Forum](https://forum.ionicframework.com/t/how-works-cors-in-capasitor-on-real-devices/230474)
- [Cleartext communications — Android Developers](https://developer.android.com/privacy-and-security/risks/cleartext-communications)
- [Capacitor/Android - usesCleartextTraffic attribute is always true — quasar#17219](https://github.com/quasarframework/quasar/issues/17219)
- [bug: ERR_CLEARTEXT_NOT_PERMITTED — ionic-team/capacitor#2118](https://github.com/ionic-team/capacitor/issues/2118)
- [@capacitor-community/http — npm](https://www.npmjs.com/package/@capacitor-community/http)
- 项目内：`docs/android-port-plan.md`、`docs/android/ipc-contract.md`（§2.3、§3.1、§6.2、§6.3）、`docs/custom-source.md`
