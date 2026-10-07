import { addToPlaybackQueue } from '@renderer/core/player/playbackQueue'
import { playList } from '@renderer/core/player'

export default ({ props, selectedList, list, removeAllSelect }) => {
  let clickTime = 0
  let clickIndex = -1

  const handlePlayMusic = (index) => {
    playList(props.listId, index)
  }

  const handlePlayMusicLater = async(index, single) => {
    if (selectedList.value.length && !single) {
      await addToPlaybackQueue([...selectedList.value])
      removeAllSelect()
    } else {
      await addToPlaybackQueue([list.value[index]])
    }
  }

  const doubleClickPlay = index => {
    if (
      window.performance.now() - clickTime > 400 ||
      clickIndex !== index
    ) {
      clickTime = window.performance.now()
      clickIndex = index
      return
    }
    handlePlayMusic(index, true)
    clickTime = 0
    clickIndex = -1
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
    doubleClickPlay,
  }
}
