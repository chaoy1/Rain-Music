//! 更新默认主题配置后，需要执行 npm run build:theme 重新构建index.json

const fs = require('fs')
const path = require('path')
const { createThemeColors } = require('./utils')

const defaultThemes = [
  {
    id: 'mono',
    name: '月白',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(90, 100, 113)',
      font: 'rgb(38, 41, 46)',
      '--color-font': 'rgb(38, 41, 46)',
      '--color-font-label': 'rgb(101, 107, 116)',
      '--color-450': 'rgb(101, 107, 116)',
      '--color-500': 'rgb(101, 107, 116)',
      '--color-material-base': '#e7e8eb',
      '--wallpaper-opacity': '.04',
      '--color-app-background': 'rgba(234, 235, 238, 0.98)',
      '--color-main-background': 'rgba(250, 251, 252, 0.96)',
      '--color-nav-font': 'var(--color-primary)',
      '--color-nav-active-bar': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      // 窗口按钮同样保持中性灰阶
      '--color-btn-hide': 'rgba(158, 158, 163, 1)',
      '--color-btn-min': 'rgba(120, 120, 126, 1)',
      '--color-btn-close': 'rgba(127, 127, 132, 1)',

      '--color-badge-primary': 'var(--color-primary-light-500)',
      '--color-badge-secondary': 'rgba(110, 110, 116, 1)',
      '--color-badge-tertiary': 'rgba(165, 165, 170, 1)',
    },
  },
  {
    id: 'green',
    name: '绿意盎然',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(77, 175, 124)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#4baed5',
      '--color-badge-tertiary': '#e7aa36',
    },
  },
  {
    id: 'blue',
    name: '蓝田生玉',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(52, 152, 219)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#5cbf9b',
      '--color-badge-tertiary': '#5cbf9b',
    },
  },
  {
    id: 'blue_plus',
    name: '蛋雅深蓝',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(77, 131, 175)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-600)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': 'rgba(66.6, 150.7, 171, 1)',
      '--color-badge-tertiary': 'rgba(54, 196, 231, 1)',
    },
  },
  {
    id: 'orange',
    name: '橙黄橘绿',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(245, 171, 53)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#9ed458',
      '--color-badge-tertiary': '#9ed458',
    },
  },
  {
    id: 'red',
    name: '热情似火',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(214, 69, 65)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#dfbb6b',
      '--color-badge-tertiary': '#dfbb6b',
    },
  },
  {
    id: 'pink',
    name: '粉装玉琢',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(241, 130, 141)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#f5b684',
      '--color-badge-tertiary': '#f5b684',
    },
  },
  {
    id: 'purple',
    name: '重斤球紫',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(155, 89, 182)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#e5a39f',
      '--color-badge-tertiary': '#e5a39f',
    },
  },
  {
    id: 'grey',
    name: '灰常美丽',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(108, 122, 137)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#b19b9f',
      '--color-badge-tertiary': '#b19b9f',
    },
  },
  {
    id: 'ming',
    name: '青出于黑',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(51, 110, 123)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#6376a2',
      '--color-badge-tertiary': '#6376a2',
    },
  },
  {
    id: 'blue2',
    name: '清热板蓝',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(79, 98, 208)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'var(--color-primary-light-600-alpha-700)',
      '--color-main-background': 'rgba(255, 255, 255, 1)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#b080db',
      '--color-badge-tertiary': '#b080db',
    },
  },
  {
    id: 'mono_dark',
    name: '石墨',
    isDark: true,
    isDarkFont: false,
    config: {
      primary: 'rgb(196, 203, 213)',
      font: 'rgb(241, 242, 244)',
      '--color-font': 'rgb(241, 242, 244)',
      '--color-font-label': 'rgb(169, 173, 182)',
      '--color-450': 'rgb(169, 173, 182)',
      '--color-500': 'rgb(169, 173, 182)',
      '--color-material-base': '#25262a',
      '--wallpaper-opacity': '.03',
      '--color-app-background': 'rgba(37, 38, 42, 0.98)',
      '--color-main-background': 'rgba(48, 49, 54, 0.96)',
      // 深色下用「更暗」的色阶做选中态（isDark 时 dark-* 朝亮方向走，
      // 所以这里取 light 系列的极值 1000，即深灰）
      '--color-nav-font': 'var(--color-primary-light-1000)',
      '--background-image': 'none',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': 'rgba(158, 158, 163, 1)',
      '--color-btn-min': 'rgba(120, 120, 126, 1)',
      '--color-btn-close': 'rgba(127, 127, 132, 1)',

      '--color-badge-primary': 'var(--color-primary-light-1000)',
      '--color-badge-secondary': 'rgba(170, 170, 175, 1)',
      '--color-badge-tertiary': 'rgba(120, 120, 126, 1)',
    },
  },
  {
    id: 'black',
    name: '黑灯瞎火',
    isDark: true,
    isDarkFont: false,
    config: {
      primary: 'rgb(150, 150, 150)',
      font: 'rgb(229, 229, 229)',
      '--color-app-background': 'rgba(0, 0, 0, 0)',
      '--color-main-background': 'rgba(19, 19, 19, 0.9)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'url(./theme_images/landingMoon.png)',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary-dark-200)',
      '--color-badge-secondary': 'var(--color-primary)',
      '--color-badge-tertiary': 'var(--color-primary-dark-300)',
    },
  },
  {
    id: 'mid_autumn',
    name: '月里嫦娥',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(74, 55, 82)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'rgba(255, 255, 255, 0)',
      '--color-main-background': 'rgba(255, 255, 255, 0.9)',
      '--color-nav-font': 'var(--color-primary-light-600)',
      '--background-image': 'url(./theme_images/jqbg.jpg)',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',


      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': '#af9479',
      '--color-badge-tertiary': '#af9479',
    },
  },
  {
    id: 'naruto',
    name: '木叶之村',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(87, 144, 167)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'rgba(255, 255, 255, 0.15)',
      '--color-main-background': 'rgba(255, 255, 255, 0.8)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'url(./theme_images/myzcbg.jpg)',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': 'var(--color-primary)',
      '--color-badge-secondary': 'var(--color-primary-light-100)',
      '--color-badge-tertiary': 'var(--color-primary-light-100)',
    },
  },
  {
    id: 'china_ink',
    name: '近墨者黑',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgba(47, 47, 47, 1)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'rgba(255, 255, 255, 0)',
      '--color-main-background': 'rgba(255, 255, 255, 0.8)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'url(./theme_images/china_ink.jpg)',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',


      '--color-btn-hide': 'rgba(183, 212, 208, 1)',
      '--color-btn-min': 'rgba(200, 214, 183, 1)',
      '--color-btn-close': 'rgba(218, 195, 188, 1)',

      '--color-badge-primary': 'rgba(137, 70, 70, 1)',
      '--color-badge-secondary': 'rgba(67, 139, 65, 1)',
      '--color-badge-tertiary': 'rgba(132, 135, 65, 1)',
    },
  },
  {
    id: 'happy_new_year',
    name: '新年快乐',
    isDark: false,
    isDarkFont: false,
    config: {
      primary: 'rgb(192, 57, 43)',
      font: 'rgb(33, 33, 33)',
      '--color-app-background': 'rgba(255, 255, 255, 0.15)',
      '--color-main-background': 'rgba(255, 255, 255, 0.8)',
      '--color-nav-font': 'var(--color-primary)',
      '--background-image': 'url(./theme_images/xnkl.png)',
      '--background-image-position': 'center',
      '--background-image-size': 'cover',

      '--color-btn-hide': '#3bc2b2',
      '--color-btn-min': '#85c43b',
      '--color-btn-close': '#fab4a0',

      '--color-badge-primary': '#7fb575',
      '--color-badge-secondary': '#dfbb6b',
      '--color-badge-tertiary': 'var(--color-primary-light-100)',
    },
  },
]

// Accent colors stay in navigation and selections; the reading panel remains neutral.
// Preserve legacy IDs so saved palettes remain loadable even when not offered in settings.
const silver = defaultThemes.find(theme => theme.id == 'mono')
defaultThemes.push(...[
  { id: 'mist_blue', name: '雾蓝', primary: 'rgb(73, 107, 150)', base: '#e4e9ef', app: 'rgba(228, 233, 239, 0.98)', main: 'rgba(250, 251, 252, 0.96)' },
  { id: 'sand', name: '暖砂', primary: 'rgb(135, 107, 79)', base: '#eee9e2', app: 'rgba(238, 233, 226, 0.98)', main: 'rgba(252, 251, 249, 0.96)' },
  { id: 'sage', name: '鼠尾草', primary: 'rgb(95, 126, 110)', base: '#dae1d9', app: 'rgba(225, 232, 223, 0.96)', main: 'rgba(247, 250, 246, 0.80)' },
].map(({ id, name, primary, base, app, main }) => ({
  ...silver,
  id,
  name,
  config: {
    ...silver.config,
    primary,
    '--color-material-base': base,
    '--color-app-background': app,
    '--color-main-background': main,
  },
})))

// Structural glass is applied once per panel; text-heavy content has a denser tint.
// Keep translucent image themes intact via withGlassAlpha below.
const GLASS_THEMES = {
  mono: { app: 0.98, main: 0.96, sidebar: 'rgba(234, 235, 238, 0.72)', bar: 'rgba(243, 244, 246, 0.82)' },
  mono_dark: { app: 0.98, main: 0.96, sidebar: 'rgba(37, 38, 42, 0.78)', bar: 'rgba(42, 43, 48, 0.86)' },
  mist_blue: { app: 0.98, main: 0.96, sidebar: 'rgba(228, 233, 239, 0.72)', bar: 'rgba(241, 244, 248, 0.82)' },
  sand: { app: 0.98, main: 0.96, sidebar: 'rgba(238, 233, 226, 0.72)', bar: 'rgba(247, 243, 237, 0.82)' },
  sage: { app: 0.96, main: 0.80, sidebar: 'rgba(214, 225, 212, 0.54)', bar: 'rgba(232, 239, 228, 0.36)' },
}
const DEFAULT_GLASS = { light: { app: 0.94, main: 0.92 }, dark: { app: 0.94, main: 0.94 } }
const DARK_GLASS = { sidebar: 'rgba(32, 34, 39, 0.76)', bar: 'rgba(30, 32, 37, 0.84)' }
const LIGHT_GLASS = { sidebar: 'rgba(239, 241, 245, 0.72)', bar: 'rgba(250, 250, 253, 0.80)' }

const withGlassAlpha = (value, alpha) =>
  String(value).replace(
    /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/,
    (whole, r, g, b, a) => {
      const orig = a == null ? 1 : parseFloat(a)
      // 原本就半透明的（如 0.15 / 0.8）保留原值，避免把背景图主题洗得太淡
      const next = orig < 1 ? orig : alpha
      return `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${next})`
    },
  )

const themes = defaultThemes.map(({ config: { primary, font, ...extInfo }, ...themeInfo }) => {
  const glass = GLASS_THEMES[themeInfo.id] ??
    DEFAULT_GLASS[themeInfo.isDark ? 'dark' : 'light']
  const struct = themeInfo.isDark ? DARK_GLASS : LIGHT_GLASS
  return {
    ...themeInfo,
    isCustom: false,
    config: {
      themeColors: createThemeColors(primary, font, themeInfo.isDark),
      extInfo: {
        ...extInfo,
        '--color-app-background': withGlassAlpha(extInfo['--color-app-background'], glass.app),
        '--color-main-background': withGlassAlpha(extInfo['--color-main-background'], glass.main),
        '--color-glass-sidebar': glass.sidebar ?? struct.sidebar,
        '--color-glass-bar': glass.bar ?? struct.bar,
      },
    },
  }
})

fs.writeFileSync(path.join(__dirname, 'index.json'), JSON.stringify(themes, null, 2))
