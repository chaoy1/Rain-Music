type QueueMusic = Pick<Rain.Music.MusicInfo, 'id' | 'name' | 'singer'>

// Keep versions (e.g. Live/remix) distinct; only normalize typography and surrounding spaces.
export const getPlaybackQueueMusicKey = (music: QueueMusic): string => {
  const name = music.name?.normalize('NFKC').trim().toLowerCase() ?? ''
  const singer = music.singer?.normalize('NFKC').trim().toLowerCase() ?? ''
  return name && singer ? JSON.stringify(['song', name, singer]) : JSON.stringify(['id', music.id])
}

export const dedupePlaybackQueue = <T extends QueueMusic>(musics: T[]): T[] => {
  const ids = new Set<string>()
  const keys = new Set<string>()
  return musics.filter(music => {
    const key = getPlaybackQueueMusicKey(music)
    if (ids.has(music.id) || keys.has(key)) return false
    ids.add(music.id)
    keys.add(key)
    // Retain the first complete source record. Mixing another source's quality/hash
    // into its metadata would make an otherwise playable song invalid.
    return true
  })
}

export const filterPlaybackQueueAdditions = <T extends QueueMusic>(existing: T[], incoming: T[]): T[] => {
  const ids = new Set(existing.map(music => music.id))
  const keys = new Set(existing.map(getPlaybackQueueMusicKey))
  return incoming.filter(music => {
    const key = getPlaybackQueueMusicKey(music)
    if (ids.has(music.id) || keys.has(key)) return false
    ids.add(music.id)
    keys.add(key)
    return true
  })
}

export const findPlaybackQueueMusicIndex = <T extends QueueMusic>(list: T[], music: QueueMusic): number => {
  const exactIndex = list.findIndex(item => item.id === music.id)
  if (exactIndex >= 0) return exactIndex
  const key = getPlaybackQueueMusicKey(music)
  return list.findIndex(item => getPlaybackQueueMusicKey(item) === key)
}
