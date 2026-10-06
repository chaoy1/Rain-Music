import { dislikeMusic, pause, play, playNext, playPrev, togglePlay } from '@renderer/core/player'

type Action = 'play' | 'pause' | 'skipNext' | 'skipPrev' | 'togglePlay' | 'dislike'

export default () => {
  return async(action: Action) => {
    switch (action) {
      case 'play':
        play()
        break
      case 'pause':
        pause()
        break
      case 'skipNext':
        playNext()
        break
      case 'skipPrev':
        playPrev()
        break
      case 'togglePlay':
        togglePlay()
        break
      case 'dislike':
        dislikeMusic()
        break
      default: throw new Error('Unknown action: ' + (action as any ?? ''))
    }
  }
}
