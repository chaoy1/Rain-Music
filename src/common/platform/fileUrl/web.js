import { Capacitor } from '@capacitor/core'

export const localFileUrl = path => {
  if (typeof path !== 'string' || !path) throw new Error('Local file path is required')
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path
  const raw = path.startsWith('file://') || path.startsWith('content://') ? path : `file://${path.split('/').map(encodeURIComponent).join('/')}`
  const mapped = Capacitor.convertFileSrc(raw)
  // Browser Workers have no injected Capacitor object; the local file server is
  // available on the same origin as their entry script.
  if (mapped === raw && globalThis.location?.origin && /^file:\/\//.test(raw)) return `${globalThis.location.origin}/_capacitor_file_${raw.slice(7)}`
  if (mapped === raw && globalThis.location?.origin && /^content:\/\//.test(raw)) return `${globalThis.location.origin}${raw.replace('content:/', '/_capacitor_content_')}`
  return mapped
}
