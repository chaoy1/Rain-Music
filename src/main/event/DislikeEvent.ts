import { EventEmitter } from 'events'


export class Event extends EventEmitter {
  dislike_changed() {
    this.emit('dislike_changed')
  }

  /**
   * 覆盖整个列表数据
   * @param dislikeData 列表数据
   */
  async dislike_data_overwrite(dislikeData: Rain.Dislike.DislikeRules) {
    await global.rain.worker.dbService.dislikeInfoOverwrite(dislikeData)
    this.emit('dislike_data_overwrite', dislikeData)
    this.dislike_changed()
  }

  /**
   * 批量添加歌曲到列表
   * @param dislikeId 列表id
   * @param musicInfos 添加的歌曲信息
   * @param addMusicLocationType 添加在到列表的位置
   */
  async dislike_music_add(musicInfo: Rain.Dislike.DislikeMusicInfo[]) {
    // const changedIds =
    await global.rain.worker.dbService.dislikeInfoAdd(musicInfo)
    // await checkUpdateDislike(changedIds)
    this.emit('dislike_music_add', musicInfo)
    this.dislike_changed()
  }

  /**
   * 清空列表内的歌曲
   * @param ids 列表Id
   */
  async dislike_music_clear() {
    // const changedIds =
    await global.rain.worker.dbService.dislikeInfoOverwrite('')
    // await checkUpdateDislike(changedIds)
    this.emit('dislike_music_clear')
    this.dislike_changed()
  }
}


type EventMethods = Omit<EventType, keyof EventEmitter>
declare class EventType extends Event {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): this
  once<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): this
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): this
}
export type Type = Omit<EventType, keyof Omit<EventEmitter, 'on' | 'off' | 'once'>>
