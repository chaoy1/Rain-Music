import { rememberSelectedFile, releaseSelectedFile } from '../selectedFiles.js'

export const releaseSelectedFiles = paths => { for (const path of paths) releaseSelectedFile(path) }

/** Capacitor's WebChromeClient opens Android's system chooser for file inputs. */
export const showSelectDialog = async(options = {}) => {
  if (options.properties?.includes('openDirectory')) throw new Error('Directory selection requires Android document-tree support')
  if (!globalThis.document?.body) throw new Error('File selection requires the main WebView')
  if (globalThis.navigator?.userActivation && !navigator.userActivation.isActive) throw new Error('File selection requires a user tap; tap import again')
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = !!options.properties?.includes('multiSelections')
    input.accept = [...new Set((options.filters ?? []).flatMap(filter => filter.extensions ?? []).filter(ext => ext !== '*' && /^[a-z\d]+$/i.test(ext)).map(ext => `.${ext}`))].join(',')
    input.style.display = 'none'
    let settled = false
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      globalThis.window?.removeEventListener('focus', returned)
      input.remove()
    }
    const finish = () => {
      if (settled) return
      settled = true
      try {
        const filePaths = Array.from(input.files ?? [], rememberSelectedFile)
        cleanup()
        resolve({ canceled: filePaths.length === 0, filePaths })
      } catch (error) { cleanup(); reject(error) }
    }
    // Older WebViews do not dispatch the input cancel event. Focus returns after
    // the picker closes; allow change to be dispatched before checking the files.
    const returned = () => { timer = setTimeout(finish, 300) }
    input.addEventListener('change', finish, { once: true })
    input.addEventListener('cancel', finish, { once: true })
    globalThis.window?.addEventListener('focus', returned)
    document.body.append(input)
    try { input.click() } catch (error) { settled = true; cleanup(); reject(error) }
  })
}
