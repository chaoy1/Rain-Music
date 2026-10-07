const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

const compareVer = (a, b) => (a || '0').localeCompare(b, undefined, { numeric: true })
const migrate = () => load('src/common/utils/migrateSetting.ts', {
  './index': { compareVer }, '../constants': {},
}).default

// 注：本轮已移除 `player.isPlayRainlrc` 设置项（行为固定为「使用卡拉OK歌词播放」＝ true，
// 见 src/common/constants.ts 的 PLAY_RAINLRC），因此这个用例改为验证
// 迁移不再产出该键（旧配置里的该键也不会被带进新的设置对象）。
test('removed player settings are not migrated any more', () => {
  const migrated = migrate()({ version: '1.9.0', player: { isPlayRainlrc: false } })
  assert.equal('player.isPlayRainlrc' in migrated, false)
  assert.ok(!Object.keys(migrated).some(key => key.includes('isPlayRainlrc')))
})

// 注：原先这里有 3 个关于 `tray.enable` 的用例（隐藏启动强制开启托盘、
// 普通启动保留用户关闭的托盘）。本轮已删除 tray.enable 设置项、
// 行为固定为「托盘常驻」，src/main/utils/index.ts 里的 applyInitSetting
// 也随之删除，因此这些用例已无对应实现，改为验证默认设置合并仍然生效。
const settingUtils = () => load('src/main/utils/index.ts', {
  '@common/utils': { throttle: f => f },
  '@common/utils/migrateSetting': { default: x => x, __esModule: true },
  '@main/platform/storage/adapter': () => ({ override() {} }),
  '@common/constants': { STORE_NAMES: {} },
  '@common/defaultSetting': { version: '2.12.8', 'common.fontSize': 16, 'theme.id': 'auto' },
  '@common/defaultHotKey': {}, './migrate': {},
  electron: {}, '@common/utils/nodejs': {}, '@common/theme/index.json': [],
  // 阶段 3 / 线 C 新增的两个依赖：只服务主题图片的 URL 拼接与文件操作，
  // 与本文件断言的「设置合并」无关。`load-ts.cjs` 只拦截被加载文件的顶层 require，
  // 因此这两个必须显式注入（同 `./migrate`）。
  '@common/utils/themeImageUrl': { buildThemeImageCssUrl: () => '' },
  './themeImages': { getThemeImagesDir: () => '', getThemeImagesUrlBase: () => '' },
}, { envParams: { cmdParams: { hidden: true } } })

test('startup merges stored settings over the defaults', () => {
  const { setting } = settingUtils().updateSetting({ 'common.fontSize': 15 }, true)
  assert.equal(setting['common.fontSize'], 15)
  assert.equal(setting['theme.id'], 'auto')
  assert.equal(setting.version, '2.12.8')
})

test('startup falls back to defaults when there are no stored settings', () => {
  const { setting } = settingUtils().updateSetting(undefined, true)
  assert.equal(setting['common.fontSize'], 16)
  assert.equal(setting['theme.id'], 'auto')
})
