// import { useCommit } from '@common/utils/vueTools'
import { defaultList } from '@renderer/store/list/state'
import { getListMusics, addListMusics } from '@renderer/store/list/action'
import { addTempPlayList } from '@renderer/store/player/action'
import { type Ref } from '@common/utils/vueTools'
import { playList } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'

export default ({ selectedList, props, removeAllSelect, emit }: {
  selectedList: Ref<Rain.Music.MusicInfoOnline[]>
  props: {
    list: Rain.Music.MusicInfoOnline[]
  }
  removeAllSelect: () => void
  emit: (event: 'show-menu' | 'play-list' | 'togglePage', ...args: any[]) => void
}) => {
  let clickTime = 0
  let clickIndex = -1

  const handlePlayMusic = async(index: number, single: boolean) => {
    let targetSong = props.list[index]
    const defaultListMusics = await getListMusics(defaultList.id)
    if (selectedList.value.length && !single) {
      await addListMusics(defaultList.id, [...selectedList.value])
      removeAllSelect()
    } else {
      await addListMusics(defaultList.id, [targetSong])
    }
    let targetIndex = defaultListMusics.findIndex(s => s.id === targetSong.id)
    if (targetIndex > -1) {
      playList(defaultList.id, targetIndex)
    }
  }

  const handlePlayMusicLater = (index: number, single: boolean) => {
    if (selectedList.value.length && !single) {
      addTempPlayList(selectedList.value.map(s => ({ listId: LIST_IDS.PLAY_LATER, musicInfo: s })))
      removeAllSelect()
    } else {
      addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo: props.list[index] }])
    }
  }

  const doubleClickPlay = (index: number) => {
    if (
      window.performance.now() - clickTime > 400 ||
      clickIndex !== index
    ) {
      clickTime = window.performance.now()
      clickIndex = index
      return
    }
    // 双击歌曲时自动切换到当前列表播放已固定为「启用」
    // （原 list.isClickPlayList 设置项已移除 -> true）
    emit('play-list', index)
    clickTime = 0
    clickIndex = -1
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
    doubleClickPlay,
  }
}
