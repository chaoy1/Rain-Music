/**
 * 渲染层「主题图片」适配层（Android 移植 · 阶段 3 / 线 C）。
 *
 * ## 这个文件解决什么
 *
 * 改动前，`ThemeEditModal/index.vue` 直接
 * `import { joinPath, extname, copyFile, checkPath, createDir, removeFile, moveFile, basename } from '@common/utils/nodejs'`
 * —— 那是 `node:fs`（`src/common/utils/nodejs.ts:1`）。桌面能这么写只是因为主窗口开着
 * `nodeIntegration: true`（`src/main/modules/winMain/main.ts:120-130`）；Android WebView 没有 `fs`。
 *
 * 于是把所有**文件操作**从这里转发给主进程（IPC），并顺手把"相对名 / 外部路径"的语义固定下来：
 *
 * ```
 * 本文件（渲染层）
 *   ├─ extname / basename           纯字符串，无 IO（实现与原 node:path 的用法逐字对齐，见下）
 *   ├─ imageUrl / imageSrc          ← @common/utils/themeImageUrl（与主进程共用同一份公式）
 *   └─ importImage / copyImage / moveImage / removeImage
 *        → @renderer/utils/ipc 的 winMain_theme_file_* 通道
 *        → 主进程 src/main/utils/themeImages.ts（相对名 → <RainDatas>/theme_images/<相对名>）
 *        → @main/platform/storage/adapter 的 themeFiles（桌面 = electronThemeFiles，Node fs）
 * ```
 *
 * ## 为什么没有 `desktop.js` / `web.js` 的分裂（和 `platform/http/` 不同）
 *
 * HTTP 那一层必须构建期分裂，是因为桌面实现（vendored needle）**不能**进 Android bundle。
 * 这里两端走的是**同一条** IPC 路径，差别只在主进程那侧的 `IThemeFileAdapter`
 * （`electron.ts` ↔ `adapter.android.ts`，已经有了构建期 alias 机制），所以渲染层只剩
 * `imageUrl/imageSrc` 里 `isUrl(imageUrlBase)` 一个分支。
 *
 * ## Android 接入点（骨架，未真机验证）
 *
 * 1. 文件操作：本文件不需要改。`@capacitor/*` 只出现在主进程的 `adapter.android.ts` 里，
 *    渲染层永远只说"把谁拷成哪个相对名"。
 * 2. `imageUrlBase`：由主进程 `getAllThemes()` 给出（Android = `Capacitor.convertFileSrc()`），
 *    本文件读到 URL 就走 `joinUrlPath()`，**不再**调 `pathToFileURL()`。
 * 3. ⚠️ 未验证：`winMain_show_select_dialog`（`nodeIntegration` 的文件选择器）在 Android 上
 *    要换成 SAF 选择器，返回的 `filePaths[0]` 会变成 `content://` URI；
 *    `extname()` 对 URI 的取值、以及主进程 `Filesystem.copy({ from: 'content://…' })`
 *    是否可用，都必须真机确认（见 `docs/android/ipc-contract.md` §3 的 `dialog.showOpenDialog` 一条）。
 */
import { buildThemeImageCssUrl, buildThemeImageSrc } from '@common/utils/themeImageUrl'
import { themeFileCopy, themeFileImport, themeFileMove, themeFileRemove } from '@renderer/utils/ipc'

/**
 * `path.extname` 的等价实现（浏览器侧无 `node:path`）。
 *
 * 逐条对齐 Node 的判定（`tests/unit/theme-image-url.test.cjs` 里对 `node:path.win32` 做了比对）：
 * - 只看最后一个分隔符之后的部分；
 * - 该部分以 `.` 开头且**没有第二个点**时返回 `''`（`.hidden` → `''`）；
 * - 该部分**整段都是点**时，只有长度 ≥ 3 才有扩展名 `'.'`（`.`/`..` → `''`，`...` → `'.'`）；
 * - 没有点时返回 `''`。
 */
export const extname = (filePath) => {
  const base = String(filePath ?? '').replaceAll('\\', '/').split('/').pop() ?? ''
  if (/^\.+$/.test(base)) return base.length >= 3 ? '.' : ''
  const index = base.lastIndexOf('.')
  return index <= 0 ? '' : base.slice(index)
}

/**
 * `path.basename` 的等价实现（同上，只处理最后一个分隔符之后的部分）。
 */
export const basename = (filePath) => {
  const normalized = String(filePath ?? '').replaceAll('\\', '/')
  if (normalized.endsWith('/')) return ''
  return normalized.split('/').pop() ?? ''
}

export const themeFiles = {
  extname,
  basename,
  /**
   * 主题图片文件名/相对名 → CSS `url(...)`（= 改动前的 `store/utils.ts` 的 `buildBgUrl`）
   * @param {string} name 主题里的 `--background-image` 值（相对名或外链 URL）
   * @param {string} dataPath 主进程给的主题图片目录（桌面 = 绝对路径）
   * @param {string} [imageUrlBase] 主进程给的可加载 URL 基址（桌面 = 与 dataPath 相同）
   */
  imageUrl: buildThemeImageCssUrl,
  /** 主题图片文件名/相对名 → `<img src>`（= 改动前的 `ThemeEditModal` 预览行） */
  imageSrc: buildThemeImageSrc,
  /** 把外部文件（用户选中的图）拷进主题目录；`toName` 可含 `temp/` 前缀，目录会自动创建 */
  importImage: themeFileImport,
  /** 主题目录内部复制（另存为新主题时的背景复制） */
  copyImage: themeFileCopy,
  /** 主题目录内部移动/重命名 */
  moveImage: themeFileMove,
  /** 删除主题目录内的图片（不存在视为成功，与改动前的 `removeFile` 一致） */
  removeImage: themeFileRemove,
}

export default themeFiles
