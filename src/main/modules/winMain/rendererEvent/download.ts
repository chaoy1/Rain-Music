import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'


export default () => {
  mainHandle<Rain.Download.ListItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_get, async() => {
    return global.rain.worker.dbService.getDownloadList()
  })
  mainHandle<Rain.Download.saveDownloadMusicInfo>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_add, async({ params: { list, addMusicLocationType } }) => {
    await global.rain.worker.dbService.downloadInfoSave(list, addMusicLocationType)
  })
  mainHandle<Rain.Download.ListItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_update, async({ params: list }) => {
    await global.rain.worker.dbService.downloadInfoUpdate(list)
  })
  mainHandle<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_remove, async({ params: ids }) => {
    await global.rain.worker.dbService.downloadInfoRemove(ids)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.download_list_clear, async() => {
    await global.rain.worker.dbService.downloadInfoClear()
  })
}
