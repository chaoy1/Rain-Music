import { parseBuffer } from 'music-metadata'
import fs from '@common/platform/fs/web'

export const parseFile = async path => {
  const bytes = await fs.promises.readFile(path)
  return parseBuffer(bytes, { path, size: bytes.byteLength })
}
