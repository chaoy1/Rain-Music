import defaultSetting from '@common/defaultSetting'

// Restore neutral playback before creating the audio graph. Preserve volume,
// output device, music lists, appearance and all unrelated preferences.
export const getStandardPlaybackPatch = (setting: Rain.AppSetting): Partial<Rain.AppSetting> => {
  const keys = (Object.keys(defaultSetting) as Array<keyof Rain.AppSetting>).filter(key =>
    key.startsWith('player.soundEffect.') || key === 'player.playbackRate' || key === 'player.audioVisualization')
  const patch = Object.fromEntries(keys
    .filter(key => setting[key] !== defaultSetting[key])
    .map(key => [key, defaultSetting[key]])) as Partial<Rain.AppSetting>
  if (setting['player.togglePlayMethod'] === 'none') patch['player.togglePlayMethod'] = 'listLoop'
  return patch
}
