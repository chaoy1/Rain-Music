import { mainHandle } from '@common/mainIpc'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'

// 列表操作事件（公共，只注册一次）
export default () => {
  mainHandle<Rain.List.UserListInfo[]>(PLAYER_EVENT_NAME.list_get, async() => {
    return global.rain.worker.dbService.getAllUserList()
  })
  mainHandle<Rain.List.ListActionDataOverwrite>(PLAYER_EVENT_NAME.list_data_overwire, async({ params: listData }) => {
    await global.rain.event_list.list_data_overwrite(listData, false)
  })
  mainHandle<Rain.List.ListActionAdd>(PLAYER_EVENT_NAME.list_add, async({ params: { position, listInfos } }) => {
    await global.rain.event_list.list_create(position, listInfos, false)
  })
  mainHandle<Rain.List.ListActionRemove>(PLAYER_EVENT_NAME.list_remove, async({ params: ids }) => {
    await global.rain.event_list.list_remove(ids, false)
  })
  mainHandle<Rain.List.ListActionUpdate>(PLAYER_EVENT_NAME.list_update, async({ params: listInfos }) => {
    await global.rain.event_list.list_update(listInfos, false)
  })
  mainHandle<Rain.List.ListActionUpdatePosition>(PLAYER_EVENT_NAME.list_update_position, async({ params: { position, ids } }) => {
    await global.rain.event_list.list_update_position(position, ids, false)
  })
  mainHandle<string, Rain.Music.MusicInfo[]>(PLAYER_EVENT_NAME.list_music_get, async({ params: listId }) => {
    return global.rain.worker.dbService.getListMusics(listId)
  })
  mainHandle<Rain.List.ListActionMusicAdd>(PLAYER_EVENT_NAME.list_music_add, async({ params: { id, musicInfos, addMusicLocationType } }) => {
    await global.rain.event_list.list_music_add(id, musicInfos, addMusicLocationType, false)
  })
  mainHandle<Rain.List.ListActionMusicMove>(PLAYER_EVENT_NAME.list_music_move, async({ params: { fromId, toId, musicInfos, addMusicLocationType } }) => {
    await global.rain.event_list.list_music_move(fromId, toId, musicInfos, addMusicLocationType, false)
  })
  mainHandle<Rain.List.ListActionMusicRemove>(PLAYER_EVENT_NAME.list_music_remove, async({ params: { listId, ids } }) => {
    await global.rain.event_list.list_music_remove(listId, ids, false)
  })
  mainHandle<Rain.List.ListActionMusicUpdate>(PLAYER_EVENT_NAME.list_music_update, async({ params: musicInfos }) => {
    await global.rain.event_list.list_music_update(musicInfos, false)
  })
  mainHandle<Rain.List.ListActionMusicUpdatePosition>(PLAYER_EVENT_NAME.list_music_update_position, async({ params: { listId, position, ids } }) => {
    await global.rain.event_list.list_music_update_position(listId, position, ids, false)
  })
  mainHandle<Rain.List.ListActionMusicOverwrite>(PLAYER_EVENT_NAME.list_music_overwrite, async({ params: { listId, musicInfos } }) => {
    await global.rain.event_list.list_music_overwrite(listId, musicInfos, false)
  })
  mainHandle<Rain.List.ListActionMusicClear>(PLAYER_EVENT_NAME.list_music_clear, async({ params: listId }) => {
    await global.rain.event_list.list_music_clear(listId, false)
  })
  mainHandle<Rain.List.ListActionCheckMusicExistList, boolean>(PLAYER_EVENT_NAME.list_music_check_exist, async({ params: { listId, musicInfoId } }) => {
    return global.rain.worker.dbService.checkListExistMusic(listId, musicInfoId)
  })
  mainHandle<string, string[]>(PLAYER_EVENT_NAME.list_music_get_list_ids, async({ params: musicInfoId }) => {
    return global.rain.worker.dbService.getMusicExistListIds(musicInfoId)
  })
}
