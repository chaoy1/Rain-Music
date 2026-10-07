/**
 * 主题图片目录的**文件操作服务**（Android 移植 · 阶段 3 / 线 C）。
 *
 * ## 为什么要有这个文件
 *
 * 改动前，主题图片的 `copyFile / moveFile / removeFile / createDir` 全部发生在**渲染层**
 * （`src/renderer/views/Setting/components/ThemeEditModal/index.vue`），因为桌面主窗口开着
 * `nodeIntegration: true`（`src/main/modules/winMain/main.ts:120-130`）。Android WebView 没有
 * `fs`，这批调用在那里必然失败，所以它们被整体挪到这里，由渲染层通过 4 条 IPC 通道调用：
 *
 * ```
 * 渲染层 ThemeEditModal
 *   → src/renderer/platform/themeFiles.js          （薄适配层，含 Android 注释式接入点）
 *   → winMain_theme_file_import / _copy / _move / _remove   （src/renderer/utils/ipc.ts）
 *   → 本文件（主进程：相对名 → 主题目录路径）
 *   → @main/platform/storage/adapter 的 themeFiles （IThemeFileAdapter）
 *   → electron.ts 的 electronThemeFiles（桌面：Node fs，逐字等价于改动前那几个函数）
 * ```
 *
 * ## 路径约定（重要）
 *
 * IPC 里传的是**主题图片目录内的相对名**（`probe_bg.png`、`temp/probe_bg.png`），
 * 不是绝对路径。这样渲染层完全不需要知道真实落点：
 * - 桌面：`<RainDatas>/theme_images/<相对名>`（`global.rainDataPath`，与改动前逐字相同）；
 * - Android：换成 `Directory.Data` 下的等价相对路径即可，无需改渲染层。
 *
 * 唯一的例外是 `importThemeImage()` 的 `sourcePath`：那是用户在文件选择器里选中的**外部**文件
 * 的路径（`winMain_show_select_dialog` 的返回值），天然是平台相关的。
 *
 * ## 桌面等价性
 *
 * | 渲染层原调用 | 现在 | 桌面语义 |
 * | --- | --- | --- |
 * | `checkPath(tempDir)` + `createDir(tempDir)` + `copyFile(path, tempDir/fileName)` | `importThemeImage(path, 'temp/' + fileName)` | `exists` → `mkdir` → `copyFile`，与 `@common/utils/nodejs.ts:22-36,78-96,192-194` 逐字同源 |
 * | `copyFile(bgImgRaw, joinPath(dataPath, fileName))` | `copyThemeImage(fromName, fileName)` | `fs.promises.copyFile`，不额外建目录（与原代码一致） |
 * | `moveFile(currentBgPath, joinPath(dataPath, name))` | `moveThemeImage(fromName, name)` | `fs.promises.rename` |
 * | `removeFile(joinPath(dataPath, name))` | `removeThemeImage(name)` | 不存在视为成功（`electronThemeFiles.remove`） |
 */
import path from 'node:path'
import { themeFiles } from '@main/platform/storage/adapter'

/** 主题图片目录（桌面：`<RainDatas>/theme_images` 的绝对路径）。**与改动前同一个值** */
export const getThemeImagesDir = (): string => path.join(global.rainDataPath, 'theme_images')

/**
 * 渲染层能直接加载的 URL 基址。
 *
 * 桌面 = 目录本身（`electronThemeFiles.toUrlBase` 是 identity）→ 渲染层仍走
 * `encodePath(joinPath(dataPath, name))`，CSS 逐字不变。
 * Android = `Capacitor.convertFileSrc(目录)`（见 `adapter.android.ts` 的骨架与未验证项）。
 */
export const getThemeImagesUrlBase = (): string => themeFiles.toUrlBase(getThemeImagesDir())

/** 主题图片目录内的相对名 → 平台路径（桌面：绝对路径） */
export const resolveThemeImage = (name: string): string => path.join(getThemeImagesDir(), name)

/**
 * 把**外部**文件（用户选中的图片）拷进主题目录。对应改动前 `selectBgImg()` 里的三步：
 * `checkPath(tempDir)` → `createDir(tempDir)` → `copyFile(path, bgPath)`。
 */
export const importThemeImage = async(sourcePath: string, toName: string): Promise<void> => {
  const target = resolveThemeImage(toName)
  const dir = path.dirname(target)
  if (!await themeFiles.exists(dir)) await themeFiles.mkdir(dir)
  await themeFiles.copy(sourcePath, target)
}

/**
 * 主题目录内部复制。对应改动前 `handleSaveNew()` 的
 * `copyFile(bgImgRaw, joinPath(themeInfo.dataPath, fileName))` —— 原实现**不**建目录，这里同样不建。
 */
export const copyThemeImage = async(fromName: string, toName: string): Promise<void> => {
  await themeFiles.copy(resolveThemeImage(fromName), resolveThemeImage(toName))
}

/** 主题目录内部移动/重命名（对应 `moveFile`） */
export const moveThemeImage = async(fromName: string, toName: string): Promise<void> => {
  await themeFiles.move(resolveThemeImage(fromName), resolveThemeImage(toName))
}

/** 删除主题目录内的图片；不存在视为成功（对应 `removeFile`，见 `electronThemeFiles.remove`） */
export const removeThemeImage = async(name: string): Promise<void> => {
  await themeFiles.remove(resolveThemeImage(name))
}
