/**
 * Rain Music Android 移植 · 阶段 2 / 线 B：**桌面（Electron / Node fs）实现**
 *
 * 这是默认实现（`src/main/platform/storage/adapter.ts` 直接导出它），
 * 行为与重构前**逐字等价**，来源逐条标注如下：
 *
 * | 本文件的成员 | 原实现 |
 * | --- | --- |
 * | `ElectronStoreAdapter.existsSync` | `src/main/utils/store.ts:35` `fs.existsSync` |
 * | `ElectronStoreAdapter.loadSync` | `src/main/utils/store.ts:38,42` `fs.readFileSync(x, 'utf8')` |
 * | `ElectronStoreAdapter.saveSync` | `src/main/utils/store.ts:17-28` 临时文件 + `renameSync` |
 * | `ElectronStoreAdapter.backupSync` | `src/main/utils/store.ts:92` `fs.renameSync(x, x + '.bak')` |
 * | `createGetStore(...)` 的注入 | `src/main/utils/store.ts:81,86,94-100` |
 * | `electronConfigFiles` | `src/main/utils/migrate.ts:11-21,78-88,112` |
 * | `electronThemeFiles` | `src/common/utils/nodejs.ts:39-50,199-205`（`createDir` / `copyFile` / `moveFile` / `removeFile`） |
 *
 * 这里**没有**任何"为了 Android 而抽象"的额外层级：所有函数体都能在原文件里逐行对上。
 */

import { dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { log } from '@common/utils'
import type { IFileAdapter, IStorePlatformAdapter, IThemeFileAdapter, StoreDescriptor } from '@common/storage/types'
import { createGetStore, type Store } from './core'

/** 与 `src/main/utils/store.ts:12-69` 的 `Store` 内部的 `writeFile()` 完全一致 */
const writeStoreFileSync = (filePath: string, dirPath: string, text: string) => {
  const tempPath = filePath + '.' + Math.random().toString().substring(2, 10) + '.temp'
  try {
    fs.writeFileSync(tempPath, text, 'utf8')
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(dirPath, { recursive: true })
      fs.writeFileSync(tempPath, text, 'utf8')
    } else throw err
  }
  fs.renameSync(tempPath, filePath)
}

class ElectronStoreAdapter implements IStorePlatformAdapter {
  readonly kind = 'electron' as const
  readonly hasSyncLoad = true

  existsSync(desc: StoreDescriptor): boolean {
    return fs.existsSync(desc.path)
  }

  loadSync(desc: StoreDescriptor): string {
    return fs.readFileSync(desc.path, 'utf8')
  }

  async load(desc: StoreDescriptor): Promise<string> {
    return fs.promises.readFile(desc.path, 'utf8')
  }

  saveSync(desc: StoreDescriptor, text: string): void {
    writeStoreFileSync(desc.path, path.dirname(desc.path), text)
  }

  async save(desc: StoreDescriptor, text: string): Promise<void> {
    writeStoreFileSync(desc.path, path.dirname(desc.path), text)
  }

  backupSync(desc: StoreDescriptor): Error | null {
    try {
      fs.renameSync(desc.path, desc.path + '.bak')
      return null
    } catch (err) {
      return err as Error
    }
  }
}

export const electronStoreAdapter = new ElectronStoreAdapter()

/**
 * 桌面「配置文件」读写：**只服务一次性数据迁移**（v2.0.0 之前的 `config.json` / `playList.json`
 * / `hotKey.json` / `userApi.json` / `data.json`）。
 *
 * Android **不做**这段迁移（新装 App 没有旧 Electron 数据目录），
 * 所以 `android.ts` 的实现可以是"永远返回 null / 空操作"。
 */
export const electronConfigFiles: IFileAdapter = {
  async exists(absPath) {
    return fs.existsSync(absPath)
  },
  async readText(absPath) {
    return (await fs.promises.readFile(absPath)).toString()
  },
  async readJsonOrNull<T>(absPath: string): Promise<T | null> {
    if (!fs.existsSync(absPath)) return null
    try {
      return JSON.parse((await fs.promises.readFile(absPath)).toString()) as T
    } catch (err) {
      log.error(err)
      return null
    }
  },
  async writeText(absPath, text) {
    // 注意：原实现（`src/main/utils/migrate.ts:112`）用 `.catch(err => log.error(err))`
    // 吞掉错误。这里保持"抛出"，由调用方决定是否吞 —— 目前唯一调用方是迁移逻辑，
    // 它会自行 catch。
    await fs.promises.writeFile(absPath, text)
  },
  async copyIfMissing(fromAbsPath, toAbsPath) {
    if (fs.existsSync(toAbsPath) || !fs.existsSync(fromAbsPath)) return
    await fs.promises.copyFile(fromAbsPath, toAbsPath).catch(err => {
      log.error(err)
    })
  },
}

/**
 * 桌面「主题文件」读写：等价于 `@common/utils/nodejs.ts` 里被渲染层 import 的那几个函数。
 *
 * ⚠️ 现状说明（很重要）：**主题图片的实际读写发生在渲染层**
 * （`src/renderer/views/Setting/components/ThemeEditModal/index.vue:126` import 了
 * `@common/utils/nodejs` 的 `copyFile/createDir/removeFile/moveFile`），
 * 因为桌面版主窗口开着 `nodeIntegration: true`（`src/main/modules/winMain/main.ts:120-130`）。
 * 主进程这边只负责**给出路径**（`src/main/utils/index.ts:219` 的 `dataPath`）。
 *
 * 把这份实现放在这里，是为了让 Android 侧有一份"同一语义、不同后端"的落点：
 * Android 上渲染层没有 Node `fs`，主题图片必须由主进程/桥接层代劳。
 * 本文件（桌面）保持 Node `fs` 语义，Android 版本见 `android.ts`。
 */
export const electronThemeFiles: IThemeFileAdapter = {
  /**
   * 桌面：**identity**。
   *
   * 渲染层拿到这个值后，因为 `isUrl()`（`src/common/utils/common.ts:75`，只认 `http(s)://`）
   * 判定它不是 URL，会**继续走改动前那一行** `encodePath(joinPath(dataPath, name))`。
   * 因此桌面端 `--background-image` 的 CSS 输出逐字不变（阶段 3 / 线 C 的硬约束）。
   */
  toUrlBase(absPath) {
    return absPath
  },
  async exists(absPath) {
    return fs.existsSync(absPath)
  },
  async readText(absPath) {
    return (await fs.promises.readFile(absPath)).toString()
  },
  async readJsonOrNull<T>(absPath: string): Promise<T | null> {
    return electronConfigFiles.readJsonOrNull<T>(absPath)
  },
  async writeText(absPath, text) {
    await fs.promises.writeFile(absPath, text)
  },
  async copyIfMissing(fromAbsPath, toAbsPath) {
    await electronConfigFiles.copyIfMissing(fromAbsPath, toAbsPath)
  },
  async mkdir(absPath) {
    // 对应 `@common/utils/nodejs.ts:39-50` 的 `checkAndCreateDir`
    await fs.promises.access(absPath, fs.constants.F_OK | fs.constants.W_OK).catch(async(err: NodeJS.ErrnoException) => {
      if (err.code != 'ENOENT') throw err as Error
      return fs.promises.mkdir(absPath, { recursive: true })
    })
  },
  async copy(fromAbsPath, toAbsPath) {
    await fs.promises.copyFile(fromAbsPath, toAbsPath)
  },
  async move(fromAbsPath, toAbsPath) {
    await fs.promises.rename(fromAbsPath, toAbsPath)
  },
  async remove(absPath) {
    // 对应 `@common/utils/nodejs.ts:94-108` 的 `removeFile`：不存在视为成功
    if (!fs.existsSync(absPath)) return
    await fs.promises.unlink(absPath)
  },
}

/**
 * 桌面版 `getStore()`：与重构前 `src/main/utils/store.ts` 的默认导出**逐字等价**。
 *
 * 只是把「路径算法」「日志」「损坏告警」显式写在这里，而不是藏在模块内部。
 */
const getStore = createGetStore(electronStoreAdapter, {
  resolvePath: name => path.join(global.rainDataPath, name + '.json'),
  logError: error => { log.error(error) },
  showErrorAlert: (name, backupPath, error) => {
    dialog.showMessageBoxSync({
      type: 'error',
      message: name + ' data load error',
      detail: `We have helped you back up the old ${name} file to: ${backupPath}\nYou can try to repair and restore it manually\n\nError detail: ${error.message}`,
    })
    shell.showItemInFolder(backupPath)
  },
})

export default getStore
export type { Store }
export { getStore }
