import fs from 'node:fs'
// `crypto-js@4.2.0` 没有随包提供类型声明（`@types/crypto-js` 也未安装）；
// 这与 `src/common/utils/zlib.js` 里对 pako 的处理同理，只是这里只有一个调用点，
// 不值得再开一层 .js 封装。装类型后这行注解会报 "unused directive"，届时删掉即可。
// @ts-expect-error crypto-js 无类型声明
import CryptoJS from 'crypto-js'
import { gzip, ungzip } from './zlib'
import path from 'node:path'
import { networkInterfaces } from 'node:os'
import { log } from '@common/utils'

export const joinPath = (...paths: string[]): string => path.join(...paths)

export const extname = (p: string): string => path.extname(p)
export const basename = (p: string, ext?: string): string => path.basename(p, ext)
export const dirname = (p: string): string => path.dirname(p)

/**
 * 检查路径是否存在
 * @param {*} path 路径
 */
export const checkPath = async(path: string): Promise<boolean> => {
  return new Promise(resolve => {
    if (!path) {
      resolve(false)
      return
    }
    fs.access(path, fs.constants.F_OK, err => {
      if (err) {
        resolve(false)
        return
      }
      resolve(true)
    })
  })
}

/**
 * 检查路径并创建目录
 * @param path
 * @returns
 */
export const checkAndCreateDir = async(path: string) => {
  return fs.promises.access(path, fs.constants.F_OK | fs.constants.W_OK)
    .catch(async(err: NodeJS.ErrnoException) => {
      if (err.code != 'ENOENT') throw err as Error
      return fs.promises.mkdir(path, { recursive: true })
    })
    .then(() => true)
    .catch((err) => {
      console.error(err)
      return false
    })
}


export const getFileStats = async(path: string): Promise<fs.Stats | null> => {
  return new Promise(resolve => {
    if (!path) {
      resolve(null)
      return
    }
    fs.stat(path, (err, stats) => {
      if (err) {
        resolve(null)
        return
      }
      resolve(stats)
    })
  })
}

/**
 * 检查路径并创建目录
 * @param path
 * @returns
 */
export const createDir = async(path: string) => new Promise<void>((resolve, reject) => {
  fs.access(path, fs.constants.F_OK | fs.constants.W_OK, err => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.mkdir(path, { recursive: true }, err => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
        return
      }
      reject(err)
      return
    }
    resolve()
  })
})

export const removeFile = async(path: string) => new Promise<void>((resolve, reject) => {
  fs.access(path, fs.constants.F_OK, err => {
    if (err) {
      err.code == 'ENOENT' ? resolve() : reject(err)
      return
    }
    fs.unlink(path, err => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
})

export const readFile = async(path: string) => fs.promises.readFile(path)


/**
 * 创建 MD5 hash
 *
 * 阶段 3：`node:crypto` → 已有的 `crypto-js@4.2.0`（实测与 `node:crypto` 一致，
 * `docs/android/native-bridge-needs.md` §2.3）。这一个 import 的更换让整个文件不再需要
 * `node:crypto`，Android 的 web bundle 也就不必再打 `crypto-browserify`。
 */
export const toMD5 = (str: string) => CryptoJS.MD5(str).toString()

export const gzipData = async(str: string): Promise<Buffer> => {
  // 阶段 3：`node:zlib` 的 `gzip` → `pako`（纯 JS，同步）。字符串按 UTF-8 编码，
  // 与 `node:zlib` 的默认行为一致；产出的 gzip 流两侧可互读（已有 .rainmc 备份不受影响）。
  return Buffer.from(gzip(str))
}

export const gunzipData = async(buf: Buffer): Promise<string> => {
  return Buffer.from(ungzip(buf)).toString()
}

/**
 * 保存rain配置文件
 * @param path 保存路径
 * @param data 数据
 */
export const saveRainConfigFile = async(path: string, data: any) => {
  if (!path.endsWith('.rainmc')) path += '.rainmc'
  await fs.promises.writeFile(path, await gzipData(JSON.stringify(data)))
}

/**
 * 读取rain配置文件
 * @param path 文件路径
 * @returns 数据
 */
export const readRainConfigFile = async(path: string): Promise<any> => {
  let isJSON = path.endsWith('.json')
  let data: string | Buffer = await fs.promises.readFile(path, isJSON ? 'utf8' : 'binary')
  if (!data) return data
  if (!isJSON) data = await gunzipData(Buffer.from(data, 'binary'))
  data = JSON.parse(data)

  // 修复v1.14.0出现的导出数据被序列化两次的问题
  if (typeof data != 'object') {
    try {
      data = JSON.parse(data)
    } catch (err) {
      return data
    }
  }

  return data
}

export const saveStrToFile = async(path: string, str: string | Buffer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    fs.writeFile(path, str, err => {
      if (err) {
        log.error(err)
        reject(err)
        return
      }
      resolve()
    })
  })
}

export const b64DecodeUnicode = (str: string): string => {
  // Going backwards: from bytestream, to percent-encoding, to original string.
  // return decodeURIComponent(window.atob(str).split('').map(function(c) {
  //   return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
  // }).join(''))

  return Buffer.from(str, 'base64').toString()
}

export const copyFile = async(sourcePath: string, distPath: string) => {
  return fs.promises.copyFile(sourcePath, distPath)
}

export const moveFile = async(sourcePath: string, distPath: string) => {
  return fs.promises.rename(sourcePath, distPath)
}

export const getAddress = (): string[] => {
  const nets = networkInterfaces()
  const results: string[] = []
  // console.log(nets)

  for (const interfaceInfos of Object.values(nets)) {
    if (!interfaceInfos) continue
    // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
    for (const interfaceInfo of interfaceInfos) {
      if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
        results.push(interfaceInfo.address)
      }
    }
  }
  return results
}
