import { init } from './db'
import { exposeWorker } from '../utils/worker'
import { list, lyric, music_url, music_other_source, download, dislike_list } from './modules/index'


const common = {
  init,
}

/**
 * 对外契约不变（`global.rain.worker.dbService` 上暴露的函数名 / 参数 / 返回类型保持原样），
 * 这里只保证**执行顺序**：worker 里同一时刻只跑一个业务调用。
 *
 * 为什么需要它：SQL 适配器把同步调用改成异步之后，每个 `await` 都是让出点。改造前
 * `dbService` 的调用是同步跑完的（一次调用内不可能被别的调用插进来），异步化之后，
 * 如果渲染层同时发来两个请求，两个业务流就会交错 —— 而它们各自都在做
 * "读内存缓存 → 写 SQLite → 改内存缓存"这类**非事务**的复合操作（各模块的 `index.ts`）。
 * 把入口排成一条队列，等于把旧的"同步独占"语义原样找回：事务里的原子性由适配器的
 * 连接锁保证，事务外的复合操作由这里的队列保证。
 *
 * 注意：模块之间互相调用走的是本地函数（不是这个包装对象），所以不会自我排队 / 死锁。
 */
type SerializedService<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => Promise<infer Result> ? (...args: Args) => Promise<Result> : T[K]
}

const ignore = () => {}

const serializeCalls = <T extends Record<string, any>>(service: T): SerializedService<T> => {
  let queue: Promise<unknown> = Promise.resolve()
  const serialized: Record<string, any> = {}
  for (const [name, value] of Object.entries(service)) {
    if (typeof value !== 'function') {
      serialized[name] = value
      continue
    }
    const call = value as (...args: any[]) => Promise<unknown>
    serialized[name] = async(...args: any[]) => {
      const result = queue.then(async() => await call(...args))
      queue = result.then(ignore, ignore)
      return await result
    }
  }
  return serialized as SerializedService<T>
}

exposeWorker(serializeCalls(Object.assign(common, list, lyric, music_url, music_other_source, download, dislike_list)))

export type workerDBSeriveTypes = typeof common
  & typeof list
  & typeof lyric
  & typeof music_url
  & typeof music_other_source
  & typeof download
  & typeof dislike_list
