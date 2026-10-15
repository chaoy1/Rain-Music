const selected = new Map()

// Handles are scoped to this WebView session; imported scripts themselves are
// persisted by the user API host after their bytes have been read.
export const rememberSelectedFile = file => {
  const url = URL.createObjectURL(file)
  selected.set(url, file)
  return url
}
export const findSelectedFile = path => selected.get(path)
export const releaseSelectedFile = path => {
  if (!selected.delete(path)) return
  URL.revokeObjectURL(path)
}
