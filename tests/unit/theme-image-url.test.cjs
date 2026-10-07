const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const load = require('./load-ts.cjs')

/**
 * Rain Music Android 移植 · 阶段 3 / 线 C 的回归网。
 *
 * 目的：证明「主题图片 URL 的平台化」对桌面端**没有行为变化**。
 *
 * 改动前，"主题图片相对名 → 可加载地址"有三处各自实现（见
 * `src/common/utils/themeImageUrl.ts` 的头部注释）。本用例把改动前的表达式**独立重写一遍**
 * （直接用 Node 自带的 `path.join` / `url.pathToFileURL`），再与被测实现逐字比对：
 *
 * 1. `buildThemeImageCssUrl(name, dataPath)`（2 参，老调用形态）
 * 2. `buildThemeImageCssUrl(name, dataPath, dataPath)`（3 参，桌面 `imageUrlBase` 的实际取值）
 * 3. `buildThemeImageCssUrl(name, dataPath, undefined)`（老主进程没有这个字段时的回退）
 * 4. `buildThemeImageSrc(name, dataPath)` —— `ThemeEditModal` 的 `<img src>` 那一行
 * 5. 主进程 `getTheme()` 那一行（`joinPath(global.rainDataPath, 'theme_images', name)`，**不带** `replaceAll`）
 *
 * 另外守住 Android 分支本身：`imageUrlBase` 是 `http://` 时**绝不能**再走
 * `pathToFileURL()`（那会拼成 `file:///…/http:/localhost/…`）。
 *
 * 加载方式说明：`load-ts.cjs` 只拦截**被加载文件自己**的顶层 require，
 * 所以 `themeImageUrl.ts` 内部的 `./common` / `./nodejs` 必须由依赖表注入
 * （存进 `tests/unit/storage-adapter.test.cjs` 注释里记录过的同一个坑）。
 */

const deps = () => {
  const common = load('src/common/utils/common.ts')
  const nodejs = load('src/common/utils/nodejs.ts', {
    '@common/utils': { log: { error() {} } },
  })
  const themeImageUrl = load('src/common/utils/themeImageUrl.ts', {
    './common': common,
    './nodejs': nodejs,
  })
  const themeFilesModule = load('src/renderer/platform/themeFiles.js', {
    '@common/utils/themeImageUrl': themeImageUrl,
    '@renderer/utils/ipc': {
      themeFileImport() {},
      themeFileCopy() {},
      themeFileMove() {},
      themeFileRemove() {},
    },
  })
  return { common, nodejs, themeImageUrl, themeFiles: themeFilesModule.themeFiles }
}

const { themeImageUrl, themeFiles } = deps()

/** 改动前的 `src/renderer/store/utils.ts:18-22` —— 独立重写，不引用被测实现 */
const legacyBuildBgUrl = (originUrl, dataPath) =>
  /https?:\/\//.test(originUrl)
    ? `url(${originUrl})`
    : `url(${pathToFileURL(path.join(dataPath, originUrl).replaceAll('\\', '/')).href})`

/** 改动前的 `src/main/utils/index.ts:262-269` —— 注意原式**没有** `.replaceAll('\\','/')` */
const legacyGetThemeUrl = (rainDataPath, originUrl) =>
  /https?:\/\//.test(originUrl)
    ? `url(${originUrl})`
    : `url(${pathToFileURL(path.join(rainDataPath, 'theme_images', originUrl)).href})`

/** 改动前的 `ThemeEditModal/index.vue:260-263` */
const legacyPreviewSrc = (originUrl, dataPath) =>
  pathToFileURL(/https?:\/\//.test(originUrl) ? originUrl : path.join(dataPath, originUrl)).href

const DATA_PATH = 'C:\\Users\\zhouc\\AppData\\Roaming\\rain-music-desktop\\RainDatas\\theme_images'
const RAIN_DATA_PATH = 'C:\\Users\\zhouc\\AppData\\Roaming\\rain-music-desktop\\RainDatas'

/** 真实会出现的名字：应用自己生成的 + 带 `temp/` 前缀的 + 带 `..` 的 + 外部 URL */
const NAMES = [
  'probe_bg.png',
  'user_theme_1700000000000_1700000000123.png',
  'temp/user_theme_1700000000000_1700000000123.webp',
  'temp/user_theme_1700000000000_1700000000123.WEBP',
  '中文 主题图.jpg',
  'a.b.c.png',
  '../outside.png',
  'https://cdn.example.com/bg.png',
  'http://cdn.example.com/bg.png?v=2',
]

test('desktop css url is byte-identical with and without imageUrlBase', () => {
  for (const name of NAMES) {
    const legacy = legacyBuildBgUrl(name, DATA_PATH)
    assert.equal(themeImageUrl.buildThemeImageCssUrl(name, DATA_PATH), legacy, `2-arg ${name}`)
    // 桌面 `getAllThemes()` 实际返回的 imageUrlBase === dataPath（identity）
    assert.equal(themeImageUrl.buildThemeImageCssUrl(name, DATA_PATH, DATA_PATH), legacy, `3-arg ${name}`)
    assert.equal(themeImageUrl.buildThemeImageCssUrl(name, DATA_PATH, undefined), legacy, `undefined ${name}`)
    // 老版本没有该字段时渲染层 `themeInfo.imageUrlBase` 是空串 —— 也必须落到老分支
    assert.equal(themeImageUrl.buildThemeImageCssUrl(name, DATA_PATH, ''), legacy, `empty ${name}`)
  }
})

test('desktop <img src> preview is byte-identical with and without imageUrlBase', () => {
  for (const name of NAMES) {
    const legacy = legacyPreviewSrc(name, DATA_PATH)
    assert.equal(themeImageUrl.buildThemeImageSrc(name, DATA_PATH), legacy, `2-arg ${name}`)
    assert.equal(themeImageUrl.buildThemeImageSrc(name, DATA_PATH, DATA_PATH), legacy, `3-arg ${name}`)
  }
})

test('main-process getTheme() css url keeps the original expression', () => {
  for (const name of NAMES) {
    const legacy = legacyGetThemeUrl(RAIN_DATA_PATH, name)
    const now = themeImageUrl.buildThemeImageCssUrl(name, path.join(RAIN_DATA_PATH, 'theme_images'), path.join(RAIN_DATA_PATH, 'theme_images'))
    assert.equal(now, legacy, name)
  }
})

test('posix dataPath (dev on macOS/Linux) also stays identical', () => {
  const dataPath = '/home/rain/.config/rain-music-desktop/RainDatas/theme_images'
  for (const name of ['probe_bg.png', 'temp/x.png', '中文 主题图.jpg']) {
    assert.equal(themeImageUrl.buildThemeImageCssUrl(name, dataPath, dataPath), legacyBuildBgUrl(name, dataPath), name)
    assert.equal(themeImageUrl.buildThemeImageSrc(name, dataPath, dataPath), legacyPreviewSrc(name, dataPath), name)
  }
})

test('a capacitor url base switches to plain url joining instead of pathToFileURL', () => {
  const base = 'http://localhost/_capacitor_file_/data/user/0/com.rain.music/files/theme_images'
  const css = themeImageUrl.buildThemeImageCssUrl('temp/x.png', '/data/user/0/com.rain.music/files/theme_images', base)
  assert.equal(css, `url(${base}/temp/x.png)`)
  // 关键：绝不能再被 pathToFileURL 拼成 file:///…http:/localhost/…
  assert.equal(css.includes('file://'), false)
  assert.equal(themeImageUrl.buildThemeImageSrc('a b.png', '/whatever', `${base}/`), `${base}/a b.png`)
  // 名字本身就是外链时，两端行为不变
  assert.equal(themeImageUrl.buildThemeImageCssUrl('https://cdn.example.com/bg.png', '/whatever', base), 'url(https://cdn.example.com/bg.png)')
})

test('extname/basename match node:path for every name the UI can produce', () => {
  const samples = [
    'probe_bg.png',
    'a.tar.gz',
    '.hidden',
    '..',
    'a.',
    'temp/user_theme_1.png',
    'temp\\user_theme_1.png',
    DATA_PATH + '\\probe_bg.png',
    'C:/Users/rain/theme_images/temp/x.PNG',
    'https://cdn.example.com/bg.png?v=2',
    'https://cdn.example.com/a/b/c',
    '',
    'noext',
  ]
  for (const sample of samples) {
    assert.equal(themeFiles.extname(sample), path.win32.extname(sample), `extname ${sample}`)
    if (!sample.endsWith('/') && !sample.endsWith('\\')) {
      assert.equal(themeFiles.basename(sample), path.win32.basename(sample), `basename ${sample}`)
    }
  }
})

test('the adapter exposes the file operations as ipc-backed functions', () => {
  for (const name of ['importImage', 'copyImage', 'moveImage', 'removeImage']) {
    assert.equal(typeof themeFiles[name], 'function', name)
  }
  assert.equal(themeFiles.imageUrl, themeImageUrl.buildThemeImageCssUrl)
  assert.equal(themeFiles.imageSrc, themeImageUrl.buildThemeImageSrc)
})
