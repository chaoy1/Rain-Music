import { rememberSelectedFile, releaseSelectedFile } from '../selectedFiles.js'

/**
 * `focus` 回退路径的轮询窗口：8 × 150 ms ≈ 1.2 s。
 *
 * 为什么是轮询而不是"一个固定延时后检查一次"：真机上 `focus` 可能**早于** WebView 把用户选的文件
 * 填进 `input.files`，而结算只看那一刻的 `files` —— 于是**真选择会被判成取消、文件被静默丢掉**
 * （用户看到的现象是"选完了没反应"）。轮询让"文件到了就立刻算成功"，只有整段窗口内都没文件才判取消。
 */
const RETURNED_INTERVAL_MS = 150
const RETURNED_ATTEMPTS = 8

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
    let polling = false
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
    // the picker closes; poll for the files instead of trusting one fixed delay.
    const returned = () => {
      if (polling || settled) return
      polling = true
      let attempts = 0
      const poll = () => {
        if (settled) return
        if (input.files?.length) { finish(); return }
        if (++attempts >= RETURNED_ATTEMPTS) { finish(); return }
        timer = setTimeout(poll, RETURNED_INTERVAL_MS)
      }
      poll()
    }
    input.addEventListener('change', finish, { once: true })
    input.addEventListener('cancel', finish, { once: true })
    globalThis.window?.addEventListener('focus', returned)
    document.body.append(input)
    try { input.click() } catch (error) { settled = true; cleanup(); reject(error) }
  })
}
