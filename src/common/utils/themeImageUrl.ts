/**
 * 主题图片 URL 拼接（Android 移植 · 阶段 3 / 线 C）—— **两端唯一的实现**。
 *
 * ## 为什么集中在一个文件
 *
 * 改动前，"主题图片相对名 → 可加载地址"这件事有**三处**各写一遍：
 *
 * | 位置 | 原式 |
 * | --- | --- |
 * | 渲染层 `src/renderer/store/utils.ts:18-22` `buildBgUrl()` | `isUrl(n) ? url(n) : url(encodePath(joinPath(dataPath, n).replaceAll('\\','/')))` |
 * | 渲染层 `ThemeEditModal/index.vue:260-263` 的 `<img src>` | `encodePath(isUrl(n) ? n : joinPath(dataPath, n))` |
 * | 主进程 `src/main/utils/index.ts:262-269` `getTheme()` | `isUrl(n) ? url(n) : url(encodePath(joinPath(global.rainDataPath,'theme_images',n)))` |
 *
 * 三处的分支条件不同（尤其 `<img>` 那处连 URL 也会被 `encodePath()` 拼一次），
 * 所以这里**逐处复刻**，而不是"统一成一种更漂亮的行为"——桌面输出必须逐字不变。
 *
 * ## `imageUrlBase` 是什么
 *
 * 阶段 3 / 线 C 新增的字段（`getAllThemes()` 的返回值，见 `src/main/utils/index.ts`）：
 * 一个**渲染层可以直接加载**的 URL 基址。
 *
 * - 桌面：`identity`，就等于 `dataPath`（`<RainDatas>/theme_images` 的绝对路径）。
 *   因为 `isUrl()`（`./common.ts:75`，只认 `http(s)://`）判定它不是 URL，
 *   本文件所有函数都落到"改动前那一行"，所以桌面 CSS 逐字不变。
 * - Android：`Capacitor.convertFileSrc()` 的产物（`http://localhost/_capacitor_file_/…`）。
 *   此时走 URL 分支，**不能**再调 `encodePath()`（= `pathToFileURL()`）——它会把 `http:`
 *   当普通路径拼成 `file:///…/http:/localhost/…`，主题图就再也加载不出来。
 */
import { encodePath, isUrl } from './common'
import { joinPath } from './nodejs'

/**
 * URL 基址 + 相对名 → URL。只做分隔符归一（`\` → `/`、去掉重复 `/`），
 * **不做 percent-encoding**：`convertFileSrc()` 返回的基址已经处理过编码，
 * 文件名本身由本应用生成（`<主题id>_<时间戳>.<扩展名>`）。
 */
export const joinUrlPath = (base: string, name: string): string =>
  `${base.replace(/[\\/]+$/, '')}/${name.replaceAll('\\', '/').replace(/^\/+/, '')}`

/**
 * 主题图片文件名/相对名 → 可加载地址（不含 `url()` 包装）。
 *
 * 非 URL 名 + 桌面基址时，结果与改动前的
 * `encodePath(joinPath(dataPath, name).replaceAll('\\', '/'))` **逐字相同**。
 */
export const resolveThemeImagePath = (name: string, dataPath: string, imageUrlBase?: string): string =>
  imageUrlBase != null && isUrl(imageUrlBase)
    ? joinUrlPath(imageUrlBase, name)
    : encodePath(joinPath(dataPath, name).replaceAll('\\', '/'))

/**
 * 主题图片文件名/相对名 → CSS `url(...)` 值。
 *
 * 等价于改动前的 `buildBgUrl()`（渲染层）与 `getTheme()`（主进程）里那一行：
 * 名本身就是 URL 时直接透传，否则按平台基址拼接。
 */
export const buildThemeImageCssUrl = (name: string, dataPath: string, imageUrlBase?: string): string =>
  isUrl(name) ? `url(${name})` : `url(${resolveThemeImagePath(name, dataPath, imageUrlBase)})`

/**
 * 主题图片文件名/相对名 → `<img src>` 值（`ThemeEditModal` 的背景预览用）。
 *
 * ⚠️ 与 `buildThemeImageCssUrl` **故意不同**：名本身就是 URL 时先 `encodePath()` 再返回。
 * 这是改动前 `ThemeEditModal/index.vue:260-263` 的历史行为（URL 背景的预览图本来就是坏的），
 * 本阶段的目标是"桌面行为逐字不变"，所以原样保留，只把 Android 的基址分支加在"本地图"这条路上。
 */
export const buildThemeImageSrc = (name: string, dataPath: string, imageUrlBase?: string): string =>
  isUrl(name) ? encodePath(name) : resolveThemeImagePath(name, dataPath, imageUrlBase)
