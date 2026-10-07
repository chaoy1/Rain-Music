import CryptoJS from 'crypto-js'
import { decodeName } from '@renderer/utils'

export const toMD5 = str => CryptoJS.MD5(str).toString()

// 阶段 3 删除：`ipMap` / `getHostIp` / `dnsLookup`（DNS pinning）。
// 它只被 3 个零引用的 `api-test.js` 使用，生产路径调用次数为 0
// （`docs/android/native-bridge-needs.md` §2.4）；Android 侧没有 JS 的 DNS API，
// 而 `import dns from 'dns'` 是**顶层静态 import** —— 不删掉它，web 目标打包会因
// `dns` 无法解析而失败（即使函数没人调用）。同时删掉的还有顶层 `import crypto`：
// MD5 走已经装了、且已是生产依赖的 `crypto-js@4.2.0`（实测与 `node:crypto` 一致，
// 见 `docs/android/native-bridge-needs.md` §2.3），web bundle 里不再需要 crypto polyfill。


/**
 * 格式化歌手
 * @param singers 歌手数组
 * @param nameKey 歌手名键值
 * @param join 歌手分割字符
 */
export const formatSingerName = (singers, nameKey = 'name', join = '、') => {
  if (Array.isArray(singers)) {
    const singer = []
    singers.forEach(item => {
      let name = item[nameKey]
      if (!name) return
      singer.push(name)
    })
    return decodeName(singer.join(join))
  }
  return decodeName(String(singers ?? ''))
}
