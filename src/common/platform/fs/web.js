import { localFileUrl } from '../fileUrl/web'
import { findSelectedFile } from '../selectedFiles'

const missing = path => Object.assign(new Error(`File not found: ${path}`), { code: 'ENOENT' })
const response = async(path, method) => {
  const result = await fetch(localFileUrl(path), { method })
  if (result.status === 404) throw missing(path)
  if (!result.ok) throw new Error(`File ${method} failed (${result.status}): ${path}`)
  return result
}
const access = async path => { if (!findSelectedFile(path)) await response(path, 'HEAD') }
const stat = async path => {
  const selected = findSelectedFile(path)
  if (selected) return { size: selected.size, isFile: () => true, isDirectory: () => false }
  const result = await response(path, 'HEAD')
  const length = result.headers.get('content-length')
  // Capacitor's local file server omits Content-Length. Read the bytes when it
  // is absent rather than reporting a fake zero and bypassing lyric size limits.
  const size = length != null ? Number(length) : (await (await response(path, 'GET')).arrayBuffer()).byteLength
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid file length: ${path}`)
  return { size, isFile: () => true, isDirectory: () => false }
}
const readFile = async(path, encoding) => {
  const selected = findSelectedFile(path)
  const result = selected ?? await response(path, 'GET')
  const bytes = Buffer.from(await result.arrayBuffer())
  return encoding ? bytes.toString(encoding) : bytes
}
const unsupported = async() => { throw new Error('This file operation requires an Android document picker; use app download storage') }
const callback = (operation, args, cb) => operation(...args).then(value => cb(null, value), cb)
export default {
  constants: { F_OK: 0, W_OK: 2 },
  access: (path, mode, cb) => callback(access, [path], cb),
  stat: (path, cb) => callback(stat, [path], cb),
  writeFile: (path, data, cb) => callback(unsupported, [], cb),
  mkdir: (path, options, cb) => callback(unsupported, [], cb),
  unlink: (path, cb) => callback(unsupported, [], cb),
  promises: { access, stat, readFile, writeFile: unsupported, mkdir: unsupported, unlink: unsupported, copyFile: unsupported, rename: unsupported },
}
