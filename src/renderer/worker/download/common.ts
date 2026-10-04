import { setMeta } from '@common/utils/musicMeta'
import { buildLyrics } from './lrcTool'

export const writeMeta = ({ filePath, isEmbedLyricRain, isEmbedLyricT, isEmbedLyricR, ...meta }: {
  filePath: string
  isEmbedLyricRain: boolean
  isEmbedLyricT: boolean
  isEmbedLyricR: boolean
  title: string
  artist: string
  album: string
  APIC: string | null
}, lyric: Rain.Music.LyricInfo, proxy?: { host: string, port: number }) => {
  setMeta(filePath, { ...meta, lyrics: buildLyrics(lyric, isEmbedLyricRain, isEmbedLyricT, isEmbedLyricR) }, proxy)
}

export { saveLrc } from './utils'
