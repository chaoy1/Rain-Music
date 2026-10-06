export interface WindowSize {
  id: number
  name: string
  width: number
  height: number
}

// 注意：id 保持原值不重编号，否则用户已保存的 common.windowSizeId 会错位。
// 已删除 id 0（更小）、id 1（小）、id 6（巨大）三档。
// 数组按窗口尺寸升序排列，与设置页里的描述（小→中→大→超大）顺序一致。
export const windowSizeList: WindowSize[] = [
  // 小
  {
    id: 2,
    name: 'medium',
    width: 1020,
    height: 660,
  },
  // 中
  {
    id: 3,
    name: 'big',
    width: 1114,
    height: 718,
  },
  // 大
  {
    id: 4,
    name: 'larger',
    width: 1202,
    height: 776,
  },
  // 超大
  {
    id: 5,
    name: 'oversized',
    width: 1385,
    height: 896,
  },
]

export const navigationUrlWhiteList: RegExp[] = []

// 基础黑白色
// export const commonColorNames = [
//   '--color-000', '--color-050', '--color-100', '--color-200', '--color-300', '--color-400',
//   '--color-500', '--color-600', '--color-700', '--color-800', '--color-900',
// ] as const
// export const commonLightColorValues = [
//   'rgb(255, 255, 255)',
//   'rgb(217,217,217)',
//   'rgb(184,184,184)',
//   'rgb(156,156,156)',
//   'rgb(133,133,133)',
//   'rgb(113,113,113)',
//   'rgb(96,96,96)',
//   'rgb(82,82,82)',
//   'rgb(70,70,70)',
//   'rgb(60,60,60)',
//   'rgb(51,51,51)',
// ] as const
// export const commonDarkColorValues = [
//   'rgb(11, 11, 11)',
//   'rgb(60,60,60)',
//   'rgb(99,99,99)',
//   'rgb(130,130,130)',
//   'rgb(155,155,155)',
//   'rgb(175,175,175)',
//   'rgb(191,191,191)',
//   'rgb(204,204,204)',
//   'rgb(214,214,214)',
//   'rgb(222,222,222)',
//   'rgb(229,229,229)',
// ] as const

