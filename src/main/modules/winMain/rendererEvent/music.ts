import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'


export default () => {
  // =========================歌词=========================
  mainHandle<string, Rain.Player.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, async({ params: id }) => {
    // return (getStore(LRC_EDITED, true, false).get(id) as Rain.Music.LyricInfo | undefined) ??
    // getStore(LRC_RAW, true, false).get(id, {}) as Rain.Music.LyricInfo
    return global.rain.worker.dbService.getPlayerLyric(id)
  })

  // 原始歌词
  mainHandle<string, Rain.Music.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw, async({ params: id }) => {
    return global.rain.worker.dbService.getRawLyric(id)
  })
  mainHandle<Rain.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, async({ params: { id, lyrics } }) => {
    await global.rain.worker.dbService.rawLyricAdd(id, lyrics)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.clear_lyric_raw, async() => {
    await global.rain.worker.dbService.rawLyricClear()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw_count, async() => {
    return global.rain.worker.dbService.rawLyricCount()
  })

  // 已编辑的歌词
  mainHandle<string, Rain.Music.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited, async({ params: id }) => {
    return global.rain.worker.dbService.getEditedLyric(id)
  })
  mainHandle<Rain.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited, async({ params: { id, lyrics } }) => {
    await global.rain.worker.dbService.editedLyricUpdateAddAndUpdate(id, lyrics)
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.remove_lyric_edited, async({ params: id }) => {
    await global.rain.worker.dbService.editedLyricRemove([id])
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.clear_lyric_edited, async() => {
    await global.rain.worker.dbService.editedLyricClear()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited_count, async() => {
    return global.rain.worker.dbService.editedLyricCount()
  })


  // =========================歌曲URL=========================
  mainHandle<string, string>(WIN_MAIN_RENDERER_EVENT_NAME.get_music_url, async({ params: id }) => {
    return (await global.rain.worker.dbService.getMusicUrl(id)) ?? ''
  })
  mainHandle<Rain.Music.MusicUrlInfo>(WIN_MAIN_RENDERER_EVENT_NAME.save_music_url, async({ params: { id, url } }) => {
    await global.rain.worker.dbService.musicUrlSave([{ id, url }])
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.clear_music_url, async() => {
    await global.rain.worker.dbService.musicUrlClear()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.get_music_url_count, async() => {
    return global.rain.worker.dbService.musicUrlCount()
  })

  // =========================换源歌曲=========================
  mainHandle<string, Rain.Music.MusicInfoOnline[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_other_source, async({ params: id }) => {
    return global.rain.worker.dbService.getMusicInfoOtherSource(id)
  })
  mainHandle<Rain.Music.MusicInfoOtherSourceSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_other_source, async({ params: { id, list } }) => {
    await global.rain.worker.dbService.musicInfoOtherSourceAdd(id, list)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.clear_other_source, async() => {
    await global.rain.worker.dbService.musicInfoOtherSourceClear()
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.get_other_source_count, async() => {
    return global.rain.worker.dbService.musicInfoOtherSourceCount()
  })

  // mainHandle<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.remove_dislike_music_infos, async({ params: ids }) => {
  //   await global.rain.worker.dbService.dislikeInfoRemove(ids)
  // })
  // mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.clear_dislike_music_infos, async() => {
  //   await global.rain.worker.dbService.dislikeInfoClear()
  // })


  // =========================我的列表=========================
  // mainHandle<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.get_playlist, async({ params: isIgnoredError = false }) => {
  //   const electronStore_list = getStore('playList', isIgnoredError, false)

  //   return {
  //     defaultList: electronStore_list.get('defaultList'),
  //     loveList: electronStore_list.get('loveList'),
  //     tempList: electronStore_list.get('tempList'),
  //     userList: electronStore_list.get('userList'),
  //     downloadList: getStore('downloadList').get('list'),
  //   }
  // })

  // const handleSaveList = ({ defaultList, loveList, userList, tempList }: Partial<Rain.List.MyAllList>) => {
  //   let data: Partial<Rain.List.MyAllList> = {}
  //   if (defaultList != null) data.defaultList = defaultList
  //   if (loveList != null) data.loveList = loveList
  //   if (userList != null) data.userList = userList
  //   if (tempList != null) data.tempList = tempList
  //   getStore('playList').set(data)
  // }
  // mainOn<Rain.List.ListSaveInfo>(WIN_MAIN_RENDERER_EVENT_NAME.save_playlist, ({ params }) => {
  //   switch (params.type) {
  //     case 'myList':
  //       handleSaveList(params.data)
  //       global.rain.event_app.save_my_list(params.data)
  //       break
  //     case 'downloadList':
  //       getStore('downloadList').set('list', params.data)
  //       break
  //   }
  // })
}
