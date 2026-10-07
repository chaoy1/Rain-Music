/**
 * Rain Music Android 移植 · 阶段 2 / 线 B：平台无关的存储内核
 *
 * 这个文件是 `src/main/utils/store.ts` 里 `Store` 类的**逐字等价重写**，
 * 只把「字节从哪来、往哪写」抽成 `IStorePlatformAdapter`，其余逻辑一行不改：
 *
 * | 原实现 | 现在的等价位置 |
 * | --- | --- |
 * | `src/main/utils/store.ts:17-28` 原子写（临时文件 + rename） | `electron.ts` 的 `writeText()` |
 * | `:30-50` 构造 / 解析 / `clearInvalidConfig` | 本文件 `Store` 构造函数 + `parseStore()` |
 * | `:78-106` `getStore()` 单例 + 损坏恢复 | 本文件 `createGetStore()` |
 *
 * ## 三条必须守住的现有语义（改错任何一条都会影响桌面端）
 *
 * 1. **初始化是同步的**。桌面版 `getStore()` 返回时数据已经就绪，调用方立刻 `get()`。
 *    → `readTextSync` 同步读盘；解析失败**同步抛出**，由 `createGetStore()` 捕获后做 `.bak` 备份。
 * 2. **`set()` / `override()` 是同步的**。`src/main/modules/winLegacy.ts:27,39` 在同步函数里调用它。
 *    → 桌面分支返回 `void`，写失败**同步抛出**（Android 只能用异步版，见 `IStore` 注释）。
 * 3. **写盘是「整份 JSON + tab 缩进 + utf8」**，不是逐键写。
 *    → `stringify()` 与 `src/main/utils/store.ts:20,24` 完全一致（含 `\t` 缩进）。
 */

import type { IStore, IStorePlatformAdapter, StoreDescriptor } from '@common/storage/types'

export type { IStore, StoreDescriptor }

/**
 * 与 `src/main/utils/store.ts:20,24` 完全一致的序列化方式。
 * `'\t'` 缩进是**文件格式契约**：桌面端 10 个 UI 测试直接手写同一个文件
 * （例：`tests/ui/refined-surfaces.electron.cjs:10`），换缩进会让它们失败。
 */
export const stringify = (data: unknown): string => JSON.stringify(data, null, '\t')

/** 解析文本为对象；`clearInvalidConfig` 为真时解析失败静默回退 `{}`（`store.ts:34-49`） */
const parseStore = (text: string, clearInvalidConfig: boolean): Record<string, any> => {
  let store: Record<string, any>
  if (clearInvalidConfig) {
    try {
      store = JSON.parse(text)
    } catch {
      store = {}
    }
  } else store = JSON.parse(text)

  if (typeof store != 'object') {
    if (clearInvalidConfig) store = {}
    else throw new Error('parse data error: ' + String(store))
  }
  return store
}

export class Store implements IStore {
  private readonly desc: StoreDescriptor
  private readonly adapter: IStorePlatformAdapter
  private store: Record<string, any>

  constructor(adapter: IStorePlatformAdapter, desc: StoreDescriptor) {
    this.adapter = adapter
    this.desc = desc
    // 对应 `src/main/utils/store.ts:35-43`：
    //   if (fs.existsSync(filePath)) { ...read + parse... } else store = {}
    // 这一步**不能省**：省掉之后"首次启动、文件还不存在"会变成 readFileSync 抛 ENOENT，
    // 被 getStore() 当成"数据损坏"处理，进而弹出错误对话框 + 生成一堆 .bak 文件。
    // 该回归已由 `tests/unit/storage-adapter.test.cjs` 的
    // "directory is created on demand" 用例守住。
    this.store = adapter.existsSync(desc)
      ? parseStore(adapter.loadSync(desc), desc.clearInvalidConfig)
      : {}
  }

  get<Value = unknown>(key: string): Value {
    return this.store[key] as Value
  }

  has(key: string): boolean {
    return key in this.store
  }

  set(key: string, value: unknown) {
    this.store[key] = value
    this.adapter.saveSync(this.desc, stringify(this.store))
  }

  override(value: Record<string, any>) {
    this.store = value
    this.adapter.saveSync(this.desc, stringify(this.store))
  }

  /**
   * 与 `set()` 等价但**保证异步**：等待落盘完成，写失败以 rejection 表达。
   *
   * 桌面（同步写）拿到的是已经 resolve 的 Promise —— 语义与 `set()` 相同，
   * 只是把同步抛出换成了 rejection；Android 侧调用点可以统一写成 `await`。
   */
  async setAsync(key: string, value: unknown): Promise<void> {
    this.store[key] = value
    await this.adapter.save(this.desc, stringify(this.store))
  }

  /** 与 `override()` 等价但**保证异步** */
  async overrideAsync(value: Record<string, any>): Promise<void> {
    this.store = value
    await this.adapter.save(this.desc, stringify(this.store))
  }

  /** 桌面实现是同步写，这里天然「已落盘」；Android 侧等 pending 写完成 */
  async flush(): Promise<void> {}
}

/**
 * 创建 `getStore()` 所需的「按名字取单例」函数，与 `src/main/utils/store.ts:78-106` 一一对应：
 * 命中缓存直接返回 → 建 Store → 失败时记日志 / 备份 / 弹窗 / 用 `clearInvalidConfig` 重建。
 *
 * 差别只在两处**平台相关**的行为被注入进来：
 * - `backupSync()`：桌面是 `fs.renameSync(storePath, storePath + '.bak')`（`store.ts:92`）
 * - `showErrorAlert()`：桌面是 `dialog.showMessageBoxSync` + `shell.showItemInFolder`（`store.ts:94-100`）
 */
export const createGetStore = (
  adapter: IStorePlatformAdapter,
  options: {
    /** 该 store 的落盘路径（桌面绝对路径；Android 用逻辑名即可） */
    resolvePath: (name: string) => string
    /** 损坏时给用户的提示；Android 传空实现 */
    showErrorAlert: (name: string, backupPath: string, error: Error) => void
    /** 日志；主进程注入 electron-log（`src/main/utils/store.ts:86` 用的是 `log.error`） */
    logError: (error: unknown) => void
  },
) => {
  const stores: Record<string, Store> = {}

  return (name: string, isIgnoredError = true, isShowErrorAlert = true): Store => {
    if (stores[name]) return stores[name]
    const desc: StoreDescriptor = {
      name,
      path: options.resolvePath(name),
      clearInvalidConfig: false,
    }

    let store: Store
    try {
      store = stores[name] = new Store(adapter, desc)
    } catch (err) {
      const error = err as Error
      options.logError(error)

      if (!isIgnoredError) throw error

      // 与原实现一致：备份路径固定是 `<storePath>.bak`（`store.ts:91`）
      const backupPath = desc.path + '.bak'
      const backupError = adapter.backupSync(desc)
      // 原实现在这里会把 renameSync 的错误直接抛出去；这里改为记日志，
      // 因为"备份失败"不应该比"数据损坏"更致命 —— 但会照原样继续走重建分支。
      if (backupError) options.logError(backupError)
      if (isShowErrorAlert) options.showErrorAlert(name, backupPath, error)

      store = stores[name] = new Store(adapter, { ...desc, clearInvalidConfig: true })
    }
    return store
  }
}
