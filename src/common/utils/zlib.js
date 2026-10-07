/**
 * 纯 JS 的 zlib 封装 —— Android 移植 · 阶段 3（`pako` 显式化）。
 *
 * ## 为什么要有这一层
 *
 * 1. **Android 没有 zlib 桥**。四处**活**的 zlib 用途必须换纯 JS 实现
 *    （`docs/android/native-bridge-needs.md` §2.2）：kg 歌词 `inflate`、
 *    tx QRC 歌词 `inflate`、配置备份 `gzip`/`gunzip`、以及自定义源对外契约里的
 *    `lx.utils.zlib`。`pako` 已经是 `package.json` 的显式依赖（锁 `^1`：只有 1.x 的
 *    顶层才有 `deflateRaw` / `inflateRaw`，2.x 的导出面未核实）。
 * 2. **`pako` 没有随包提供 TypeScript 类型声明**，而 `src/common/**`、`src/renderer/**`
 *    都在 tsc 的 strict 模式下编译：任何 `.ts` 文件直接 `import ... from 'pako'` 都会报
 *    TS7016。放在 `.js` 里（项目关闭了 `checkJs`）既避开类型问题，又把全部 pako 调用
 *    收敛到一个文件 —— 将来升级 pako 2.x 只需要改这里。
 *
 * 所以：**其它地方一律从这里 import，不要直接 import 'pako'。**
 *
 * ## 与 `node:zlib` 的对应关系
 *
 * | 原来（node:zlib） | 现在 | 说明 |
 * | --- | --- | --- |
 * | `inflate(buf, cb)` | `inflate(buf)` | 同步返回 `Uint8Array`；调用方自己 `Buffer.from()` |
 * | `inflate(buf, { finishFlush: Z_SYNC_FLUSH }, cb)` | `new Inflate()` + `push(buf, Z_SYNC_FLUSH)` | 见 `tx/qrcDecode.js`：要容忍尾部不完整的 zlib 流 |
 * | `gzip/gunzip(str, cb)` | `gzip/ungzip(data)` | 字符串按 UTF-8 编码（与 `node:zlib` 默认一致） |
 */
import pako from 'pako'

export const inflate = pako.inflate
export const inflateRaw = pako.inflateRaw
export const deflate = pako.deflate
export const deflateRaw = pako.deflateRaw
export const gzip = pako.gzip
export const ungzip = pako.ungzip
export const Inflate = pako.Inflate
export const Deflate = pako.Deflate
/** `Z_SYNC_FLUSH`：pako 的顶层常量（`pako/lib/zlib/constants.js` 被 mixin 进顶层导出）。 */
export const Z_SYNC_FLUSH = pako.Z_SYNC_FLUSH
