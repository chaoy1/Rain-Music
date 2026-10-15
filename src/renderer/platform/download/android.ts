import { bridge } from '@common/platform/ipcBridge'
import { checkList, createDownloadTasks } from './pure'
import { buildLyrics } from '../../worker/download/lrcTool'

interface DownloadBridge {
  invoke: (channel: string, params: unknown) => Promise<any>
  on: (channel: string, callback: (event: any) => void) => void
}
let nextToken = 0
const session = Math.random().toString(36).slice(2)

/** Runs in the main WebView. Never expose this object through Comlink. */
export const createAndroidDownloadFacade = (ipc: DownloadBridge = bridge) => {
  const callbacks = new Map<string, { token: string, ready: boolean, queue: Rain.Download.DownloadTaskActions[], callback: (action: Rain.Download.DownloadTaskActions) => void }>()
  const commands = new Map<string, Promise<unknown>>()
  const ordered = async<T>(id: string, operation: () => Promise<T>): Promise<T> => {
    const pending = (commands.get(id) ?? Promise.resolve()).catch(() => {}).then(operation)
    commands.set(id, pending)
    try { return await pending } finally { if (commands.get(id) === pending) commands.delete(id) }
  }
  let listening = false
  const listen = () => {
    if (listening) return
    ipc.on('winMain_download_task_event', ({ params }) => {
      if (!params || typeof params.id !== 'string') return
      const current = callbacks.get(params.id)
      if (!current || (params.token && current.token !== params.token)) return
      if (!current.ready) current.queue.push(params.action)
      else current.callback(params.action)
    })
    listening = true
  }
  return {
    checkList,
    createDownloadTasks,
    async startTask(downloadInfo: Rain.Download.ListItem, savePath: string, skipExistFile: boolean, callback: (action: Rain.Download.DownloadTaskActions) => void, proxy?: { host: string, port: number }) {
      listen()
      const token = `${session}-${++nextToken}`
      const current = { token, ready: false, queue: [] as Rain.Download.DownloadTaskActions[], callback }
      callbacks.set(downloadInfo.id, current)
      try {
        // Android owns a fixed private root. Desktop directory preferences may
        // contain Windows paths and must never cross into the Android executor.
        const result = await ordered(downloadInfo.id, async() => await ipc.invoke('winMain_download_task_start', { downloadInfo, savePath: '', skipExistFile, token, proxy }))
        if (callbacks.get(downloadInfo.id) !== current) return
        downloadInfo.metadata.filePath = result.filePath
        current.ready = true
        for (const action of current.queue.splice(0)) {
          if (callbacks.get(downloadInfo.id) !== current) break
          callback(action)
        }
      } catch (error) {
        if (callbacks.get(downloadInfo.id) !== current) return
        callbacks.delete(downloadInfo.id)
        throw error
      }
    },
    async pauseTask(id: string) {
      const token = callbacks.get(id)?.token
      callbacks.delete(id)
      await ordered(id, async() => await ipc.invoke('winMain_download_task_pause', { id, token }))
    },
    async removeTask(id: string) {
      const token = callbacks.get(id)?.token
      callbacks.delete(id)
      await ordered(id, async() => await ipc.invoke('winMain_download_task_remove', { id, token }))
    },
    async updateUrl(id: string, url: string) {
      const token = callbacks.get(id)?.token
      try {
        await ordered(id, async() => await ipc.invoke('winMain_download_task_update_url', { id, url, token }))
      } catch (error) {
        if (callbacks.get(id)?.token !== token) return
        throw error
      }
    },
    async saveLrc(lyric: Rain.Music.LyricInfo, info: { filePath: string, format: Rain.LyricFormat, downloadRainlrc: boolean, downloadTlrc: boolean, downloadRlrc: boolean }) {
      await ipc.invoke('winMain_download_task_save_lyric', { filePath: info.filePath, format: info.format, text: buildLyrics(lyric, info.downloadRainlrc, info.downloadTlrc, info.downloadRlrc) })
    },
    async writeMeta({ isEmbedLyricRain, isEmbedLyricT, isEmbedLyricR, ...meta }: { filePath: string, isEmbedLyricRain: boolean, isEmbedLyricT: boolean, isEmbedLyricR: boolean, title: string, artist: string, album: string, APIC: string | null }, lyric: Rain.Music.LyricInfo, proxy?: { host: string, port: number }) {
      await ipc.invoke('winMain_download_task_write_meta', { ...meta, lyrics: buildLyrics(lyric, isEmbedLyricRain, isEmbedLyricT, isEmbedLyricR), proxy })
    },
  }
}
