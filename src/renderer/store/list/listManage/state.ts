import { LIST_IDS } from '@common/constants'
import { markRaw, reactive } from '@common/utils/vueTools'

export const allMusicList: Map<string, Rain.Music.MusicInfo[]> = markRaw(new Map())

export const defaultList = markRaw<Rain.List.MyDefaultListInfo>({
  id: LIST_IDS.DEFAULT,
  name: 'list__name_default',
  // name: '试听列表',
})

export const loveList = markRaw<Rain.List.MyLoveListInfo>({
  id: LIST_IDS.LOVE,
  name: 'list__name_love',
  // name: '我的收藏',
})
export const tempList = markRaw<Rain.List.MyTempListInfo>({
  id: LIST_IDS.TEMP,
  name: '临时列表',
  meta: {},
})

export const userLists: Rain.List.UserListInfo[] = reactive([])
