
export const getLocalDislikeData = async(): Promise<Rain.Dislike.DislikeRules> => {
  return (await global.rain.worker.dbService.getDislikeListInfo()).rules
}

export const setLocalDislikeData = async(listData: Rain.Dislike.DislikeRules) => {
  await global.rain.event_dislike.dislike_data_overwrite(listData, true)
}

export const registerDislikeActionEvent = (sendDislikeAction: (action: Rain.Sync.Dislike.ActionList) => (void | Promise<void>)) => {
  const dislike_music_add = async(listData: Rain.Dislike.DislikeMusicInfo[], isRemote: boolean = false) => {
    if (isRemote) return
    await sendDislikeAction({ action: 'dislike_music_add', data: listData })
  }
  const dislike_data_overwrite = async(listInfos: Rain.Dislike.DislikeRules, isRemote: boolean = false) => {
    if (isRemote) return
    await sendDislikeAction({ action: 'dislike_data_overwrite', data: listInfos })
  }
  const dislike_music_clear = async(isRemote: boolean = false) => {
    if (isRemote) return
    await sendDislikeAction({ action: 'dislike_music_clear' })
  }

  global.rain.event_dislike.on('dislike_music_add', dislike_music_add)
  global.rain.event_dislike.on('dislike_data_overwrite', dislike_data_overwrite)
  global.rain.event_dislike.on('dislike_music_clear', dislike_music_clear)
  return () => {
    global.rain.event_dislike.off('dislike_music_add', dislike_music_add)
    global.rain.event_dislike.off('dislike_data_overwrite', dislike_data_overwrite)
    global.rain.event_dislike.off('dislike_music_clear', dislike_music_clear)
  }
}

export const handleRemoteDislikeAction = async(event: Rain.Sync.Dislike.ActionList) => {
  // console.log('handleRemoteDislikeAction', event)

  switch (event.action) {
    case 'dislike_music_add':
      await global.rain.event_dislike.dislike_music_add(event.data, true)
      break
    case 'dislike_data_overwrite':
      await global.rain.event_dislike.dislike_data_overwrite(event.data, true)
      break
    case 'dislike_music_clear':
      await global.rain.event_dislike.dislike_music_clear(true)
      break
    default:
      throw new Error('unknown list sync action')
  }
}
