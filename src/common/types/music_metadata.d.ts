import {
  type IAudioMetadata as iAudioMetadata,
} from 'music-metadata'

declare global {
  namespace Rain {
    namespace MusicMetadataModule {
      type IAudioMetadata = iAudioMetadata
    }
  }
}
