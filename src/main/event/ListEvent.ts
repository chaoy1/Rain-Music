import { EventEmitter } from 'events'
// import {
//   // getAllUserList as getAllUserListByDB,
//   createUserLists,
//   removeUserLists,
//   updateUserLists,
//   updateUserListsPosition,
//   musicsAdd,
//   musicsMove,
//   musicsRemove,
//   musicsUpdate,
//   musicsClear,
//   musicsPositionUpdate,
//   musicOverwrite,
// } from '@main/workers/dbService/modules/list'

// 兼容v2.3.0之前版本插入数字类型的ID导致其意外在末尾追加 .0 的问题，确保所有ID都是字符串类型
const fixListIdType = (lists: Rain.List.UserListInfo[] | Rain.List.UserListInfoFull[]) => {
  for (const list of lists) {
    if (typeof list.sourceListId == 'number') {
      list.sourceListId = String(list.sourceListId)
      if (typeof list.id == 'number') {
        list.id = String(list.id)
      }
    }
  }
}

export class Event extends EventEmitter {
  list_changed() {
    this.emit('list_changed')
  }

  /**
   * 覆盖整个列表数据
   * @param listData 列表数据
   */
  async list_data_overwrite(listData: MakeOptional<Rain.List.ListDataFull, 'tempList'>) {
    fixListIdType(listData.userList)
    await global.rain.worker.dbService.listDataOverwrite(listData)
    this.emit('list_data_overwrite', listData)
    this.list_changed()
  }

  /**
   * 批量创建列表
   * @param position 列表位置
   * @param lists 列表信息
   */
  async list_create(position: number, lists: Rain.List.UserListInfo[]) {
    fixListIdType(lists)
    await global.rain.worker.dbService.createUserLists(position, lists)
    this.emit('list_create', position, lists)
    this.list_changed()
  }

  /**
   * 批量删除列表及列表内歌曲
   * @param ids 列表ids
   */
  async list_remove(ids: string[]) {
    await global.rain.worker.dbService.removeUserLists(ids)
    this.emit('list_remove', ids)
    this.list_changed()
  }

  /**
   * 批量更新列表信息
   * @param lists 列表信息
   */
  async list_update(lists: Rain.List.UserListInfo[]) {
    await global.rain.worker.dbService.updateUserLists(lists)
    this.emit('list_update', lists)
    this.list_changed()
  }

  /**
   * 批量更新列表位置
   * @param position 列表位置
   * @param ids 列表ids
   */
  async list_update_position(position: number, ids: string[]) {
    await global.rain.worker.dbService.updateUserListsPosition(position, ids)
    this.emit('list_update_position', position, ids)
    this.list_changed()
  }

  /**
   * 覆盖列表内歌曲
   * @param listId 列表id
   * @param musicInfos 音乐信息
   */
  async list_music_overwrite(listId: string, musicInfos: Rain.Music.MusicInfo[]) {
    await global.rain.worker.dbService.musicOverwrite(listId, musicInfos)
    this.emit('list_music_overwrite', listId, musicInfos)
    this.list_changed()
  }

  /**
   * 批量添加歌曲到列表
   * @param listId 列表id
   * @param musicInfos 添加的歌曲信息
   * @param addMusicLocationType 添加在到列表的位置
   */
  async list_music_add(listId: string, musicInfos: Rain.Music.MusicInfo[], addMusicLocationType: Rain.AddMusicLocationType) {
    await global.rain.worker.dbService.musicsAdd(listId, musicInfos, addMusicLocationType)
    this.emit('list_music_add', listId, musicInfos, addMusicLocationType)
    this.list_changed()
  }

  /**
   * 批量移动歌曲
   * @param fromId 源列表id
   * @param toId 目标列表id
   * @param musicInfos 移动的歌曲信息
   * @param addMusicLocationType 添加在到列表的位置
   */
  async list_music_move(fromId: string, toId: string, musicInfos: Rain.Music.MusicInfo[], addMusicLocationType: Rain.AddMusicLocationType) {
    await global.rain.worker.dbService.musicsMove(fromId, toId, musicInfos, addMusicLocationType)
    this.emit('list_music_move', fromId, toId, musicInfos, addMusicLocationType)
    this.list_changed()
  }

  /**
   * 批量移除歌曲
   * @param listId
   * @param listId 列表Id
   * @param ids 要删除歌曲的id
   */
  async list_music_remove(listId: string, ids: string[]) {
    await global.rain.worker.dbService.musicsRemove(listId, ids)
    this.emit('list_music_remove', listId, ids)
    this.list_changed()
  }

  /**
   * 批量更新歌曲信息
   * @param musicInfos 歌曲&列表信息
   */
  async list_music_update(musicInfos: Rain.List.ListActionMusicUpdate) {
    await global.rain.worker.dbService.musicsUpdate(musicInfos)
    this.emit('list_music_update', musicInfos)
    this.list_changed()
  }

  /**
   * 清空列表内的歌曲
   * @param ids 列表Id
   */
  async list_music_clear(ids: string[]) {
    await global.rain.worker.dbService.musicsClear(ids)
    this.emit('list_music_clear', ids)
    this.list_changed()
  }

  /**
   * 批量更新歌曲位置
   * @param listId 列表ID
   * @param position 新位置
   * @param ids 歌曲id
   */
  async list_music_update_position(listId: string, position: number, ids: string[]) {
    await global.rain.worker.dbService.musicsPositionUpdate(listId, position, ids)
    this.emit('list_music_update_position', listId, position, ids)
    this.list_changed()
  }
}


type EventMethods = Omit<EventType, keyof EventEmitter>
declare class EventType extends Event {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): this
  once<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): this
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): this
}
export type Type = Omit<EventType, keyof Omit<EventEmitter, 'on' | 'off' | 'once'>>
