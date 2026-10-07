// 阶段 3 删除：`bHh` 与 `headers` 两个导出。
// `headers`（`{ 'User-Agent': ..., [bHh]: [bHh] }`）是 `request.js` 里 `bHtml` deflate 分支的
// **唯一**触发源，而那个分支只被 3 个零引用的 `api-test.js` 使用，**不是 tx 的签名头**
// （tx 签名在 `musicSdk/tx/utils/crypto.js`，只用 SHA-1 + base64）——
// 见 `docs/android/native-bridge-needs.md` §2.2。三个 `api-test.js` 已同时删除。

export const timeout = 15000
