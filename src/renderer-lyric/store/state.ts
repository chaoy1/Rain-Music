import { ref, shallowReactive } from '@common/utils/vueTools'

export const setting = shallowReactive<Rain.DesktopLyric.Config>({
  'desktopLyric.enable': false,
  'desktopLyric.isLock': false,
  // 这两项已从设置页移除、行为固定为 true（见 src/common/constants.ts 的
  // DESKTOP_LYRIC_ALWAYS_ON_TOP / DESKTOP_LYRIC_PAUSE_HIDE），
  // 主进程 buildLyricConfig 在读取配置时会下发同样的固定值。
  'desktopLyric.isAlwaysOnTop': true,
  'desktopLyric.isAlwaysOnTopLoop': false,
  'desktopLyric.isShowTaskbar': true,
  'desktopLyric.pauseHide': true,
  'desktopLyric.audioVisualization': false,
  'desktopLyric.width': 450,
  'desktopLyric.height': 300,
  'desktopLyric.x': null,
  'desktopLyric.y': null,
  'desktopLyric.isLockScreen': true,
  'desktopLyric.isDelayScroll': true,
  'desktopLyric.scrollAlign': 'center',
  'desktopLyric.isHoverHide': false,
  'desktopLyric.direction': 'horizontal',
  'desktopLyric.style.align': 'center',
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.14)',
  'desktopLyric.style.font': '',
  'desktopLyric.style.fontSize': 20,
  'desktopLyric.style.lineGap': 15,
  // 'desktopLyric.style.fontWeight': true,
  'desktopLyric.style.opacity': 95,
  'desktopLyric.style.ellipsis': false,
  'desktopLyric.style.isFontWeightFont': false,
  'desktopLyric.style.isFontWeightLine': false,
  'desktopLyric.style.isFontWeightExtended': false,
  'desktopLyric.style.isZoomActiveLrc': true,
  'common.langId': 'zh-cn',
  'player.playbackRate': 1,
})

// export const themeList = markRaw([
//   {
//     id: 0,
//     className: 'green',
//   },
//   {
//     id: 1,
//     className: 'yellow',
//   },
//   {
//     id: 2,
//     className: 'blue',
//   },
//   {
//     id: 3,
//     className: 'red',
//   },
//   {
//     id: 4,
//     className: 'pink',
//   },
//   {
//     id: 5,
//     className: 'purple',
//   },
//   {
//     id: 6,
//     className: 'orange',
//   },
//   {
//     id: 7,
//     className: 'grey',
//   },
//   {
//     id: 8,
//     className: 'ming',
//   },
//   {
//     id: 9,
//     className: 'blue2',
//   },
// ])

// export type Status = 'playing' | 'paused' | 'stopped'

// export const status = ref<Status>('stopped')
export const isPlay = ref(false)

export const musicInfo = shallowReactive<{
  id: string | null
  name: string
  singer: string
  album: string | null
}>({
  id: null,
  name: '^',
  singer: '^',
  album: null,
})
