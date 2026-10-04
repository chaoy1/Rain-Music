// import { toRaw } from '@common/utils/vueTools'
import { DISLIKE_EVENT_NAME } from '@common/ipcNames'
import { rendererInvoke, rendererOff, rendererOn } from '@common/rendererIpc'
import { action } from '@renderer/store/dislikeList'


export const initDislikeInfo = async() => {
  action.initDislikeInfo(await rendererInvoke<Rain.Dislike.DislikeInfo>(DISLIKE_EVENT_NAME.get_dislike_music_infos))
}

export const hasDislike = (info: Rain.Music.MusicInfo | Rain.Download.ListItem | null) => {
  if (!info) return false
  return action.hasDislike(info)
}

export const addDislikeInfo = async(infos: Rain.Dislike.DislikeMusicInfo[]) => {
  await rendererInvoke<Rain.Dislike.DislikeMusicInfo[]>(DISLIKE_EVENT_NAME.add_dislike_music_infos, infos)
}

export const overwirteDislikeInfo = async(rules: string) => {
  await rendererInvoke<string>(DISLIKE_EVENT_NAME.overwrite_dislike_music_infos, rules)
}

export const clearDislikeInfo = async() => {
  await rendererInvoke(DISLIKE_EVENT_NAME.clear_dislike_music_infos)
}


const noop = () => {}

export const registerRemoteDislikeAction = (onListChanged: (listIds: string[]) => void = noop) => {
  const add_dislike_music_infos = ({ params: datas }: Rain.IpcRendererEventParams<Rain.Dislike.DislikeMusicInfo[]>) => {
    action.addDislikeInfo(datas)
  }
  const overwrite_dislike_music_infos = ({ params: datas }: Rain.IpcRendererEventParams<Rain.Dislike.DislikeRules>) => {
    action.overwirteDislikeInfo(datas)
  }
  const clear_dislike_music_infos = () => {
    return action.clearDislikeInfo()
  }

  rendererOn(DISLIKE_EVENT_NAME.add_dislike_music_infos, add_dislike_music_infos)
  rendererOn(DISLIKE_EVENT_NAME.overwrite_dislike_music_infos, overwrite_dislike_music_infos)
  rendererOn(DISLIKE_EVENT_NAME.clear_dislike_music_infos, clear_dislike_music_infos)

  return () => {
    rendererOff(DISLIKE_EVENT_NAME.add_dislike_music_infos, add_dislike_music_infos)
    rendererOff(DISLIKE_EVENT_NAME.overwrite_dislike_music_infos, overwrite_dislike_music_infos)
    rendererOff(DISLIKE_EVENT_NAME.clear_dislike_music_infos, clear_dislike_music_infos)
  }
}
