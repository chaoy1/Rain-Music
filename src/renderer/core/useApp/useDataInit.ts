import { getPlayInfo } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import { log } from '@common/utils'
import { getListMusics, getUserLists, registerAction } from '@renderer/store/list/action'


import useInitUserApi from './useInitUserApi'
import { playList } from '@renderer/core/player'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { initDislikeInfo, registerRemoteDislikeAction } from '@renderer/core/dislikeList'

const initPrevPlayInfo = async() => {
  const info = await getPlayInfo()
  window.rain.restorePlayInfo = null
  if (!info?.listId || info.index < 0) return
  const list = await getListMusics(info.listId)
  if (!list[info.index]) return
  window.rain.restorePlayInfo = info
  playList(info.listId, info.index)
  // player.startupAutoPlay 设置项已移除，行为固定为「启动后不自动播放」，
  // 因此这里恢复播放列表后不再自动 play()。
}

export default () => {
  const initUserApi = useInitUserApi()

  let unregister: null | (() => void) = null
  let unregisterDislikeEvent: null | (() => void) = null

  onBeforeUnmount(() => {
    if (unregister) unregister()
    if (unregisterDislikeEvent) unregisterDislikeEvent()
  })

  return async() => {
    await Promise.all([
      initUserApi(), // 自定义API
    ]).catch(err => {
      log.error(err)
    })
    void music.init() // 初始化音乐sdk
    unregister = registerAction((ids) => {
      window.app_event.myListUpdate(ids)
    })
    window.rainData.userLists = await getUserLists() // 获取用户列表
    unregisterDislikeEvent = registerRemoteDislikeAction()
    await initDislikeInfo() // 获取不喜欢列表
    await initPrevPlayInfo().catch(err => {
      log.error(err)
    }) // 初始化上次的歌曲播放信息
  }
}
