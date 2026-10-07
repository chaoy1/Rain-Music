import { addToPlaybackQueue } from '@renderer/core/player/playbackQueue'
import { playList } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'

export default ({ selectedList, list, listAll, removeAllSelect }) => {
  const handlePlayMusic = (index) => {
    playList(LIST_IDS.DOWNLOAD, listAll.value.indexOf(list.value[index]))
  }

  const handlePlayMusicLater = async(index, single) => {
    if (selectedList.value.length && !single) {
      await addToPlaybackQueue([...selectedList.value])
      removeAllSelect()
    } else {
      await addToPlaybackQueue([list.value[index]])
    }
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
  }
}
