import { STORE_NAMES, DATA_KEYS, LIST_IDS } from '@common/constants'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainOn, mainHandle } from '@common/mainIpc'
import getStore from '@main/platform/storage/adapter'

export default () => {
  mainHandle<string, any>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, async({ params: path }) => {
    const store = getStore(STORE_NAMES.DATA)
    const value = store.get(path) as any
    if (path != DATA_KEYS.playInfo) return value
    if (value?.listId != LIST_IDS.DEFAULT || value.index < 0) {
      await global.rain.worker.dbService.completePlaybackQueueRestore()
      return value
    }
    const index = await global.rain.worker.dbService.resolvePlaybackQueueRestoreIndex(value.index, value.musicId, value.musicName, value.musicSinger)
    if (index < 0) return null
    const music = (await global.rain.worker.dbService.getListMusics(LIST_IDS.DEFAULT))[index]
    const restored = { ...value, index, musicId: music.id, musicName: music.name, musicSinger: music.singer }
    // Store.set writes a temporary JSON file and renames it synchronously. Keep
    // the SQLite mapping until that succeeds; the saved ID also protects a crash
    // between this write and the acknowledgment below.
    store.set(path, restored)
    await global.rain.worker.dbService.completePlaybackQueueRestore()
    return restored
  })

  mainOn<{
    path: string
    data: any
  }>(WIN_MAIN_RENDERER_EVENT_NAME.save_data, async({ params: { path, data } }) => {
    getStore(STORE_NAMES.DATA).set(path, data)
    if (path == DATA_KEYS.playInfo && (data?.listId != LIST_IDS.DEFAULT || data?.musicId)) await global.rain.worker.dbService.completePlaybackQueueRestore()
  })
}
