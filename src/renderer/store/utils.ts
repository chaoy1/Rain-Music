// import { getListFromState } from './list'
// import { downloadList } from './download'


// export const getList = (listId: string | null): Rain.Download.ListItem[] | Rain.Music.MusicInfo[] => {
//   return listId == 'download' ? downloadList : getListFromState(listId)
// }
import { markRaw, shallowReactive } from '@common/utils/vueTools'
import { getThemes as getTheme } from '@renderer/utils/ipc'
import { themeFiles } from '@renderer/platform/themeFiles'
import { qualityList, themeInfo, themeShouldUseDarkColors } from './index'

export const assertApiSupport = (source: Rain.Source): boolean => {
  return source == 'local' || qualityList.value[source] != null
}

/**
 * 主题图片的相对名 → CSS `url(...)`。
 *
 * 阶段 3 / 线 C：实现已收敛到 `@common/utils/themeImageUrl`（渲染层与主进程共用一份公式），
 * 并且**优先**用主进程给的 `imageUrlBase`：
 * - 桌面：`imageUrlBase` 与 `dataPath` 逐字相同且不是 `http(s)` URL → 与改动前那一行逐字等价；
 * - Android：`imageUrlBase` 是 `Capacitor.convertFileSrc()` 的 URL → 走新的 URL 分支，
 *   不再 `joinPath`（否则会把 URL 二次拼接拼坏）。
 *
 * @param originUrl 主题的 `--background-image`（相对名或外链 URL）
 * @param dataPath 主题图片目录（桌面 = 绝对路径）
 * @param imageUrlBase 可加载的 URL 基址（缺失时回退 `dataPath`）
 */
export const buildBgUrl = (originUrl: string, dataPath: string, imageUrlBase?: string): string =>
  themeFiles.imageUrl(originUrl, dataPath, imageUrlBase)

export const getThemes = (callback: (themeInfo: Rain.ThemeInfo) => void) => {
  if (themeInfo.themes.length) {
    callback(themeInfo)
    return
  }
  void getTheme().then(info => {
    themeInfo.themes = markRaw(info.themes)
    themeInfo.userThemes = shallowReactive(info.userThemes)
    themeInfo.dataPath = info.dataPath
    themeInfo.imageUrlBase = info.imageUrlBase ?? info.dataPath
    callback(themeInfo)
  })
}
export const buildThemeColors = (theme: Rain.Theme, dataPath: string, imageUrlBase?: string) => {
  if (theme.isCustom && theme.config.extInfo['--background-image'] != 'none') {
    theme = copyTheme(theme)
    theme.config.extInfo['--background-image'] = buildBgUrl(theme.config.extInfo['--background-image'], dataPath, imageUrlBase)
  }
  const colors: Record<string, string> = {
    ...theme.config.themeColors,
    ...theme.config.extInfo,
  }

  return colors
}

export const copyTheme = (theme: Rain.Theme): Rain.Theme => {
  return {
    ...theme,
    config: {
      ...theme.config,
      extInfo: { ...theme.config.extInfo },
      themeColors: { ...theme.config.themeColors },
    },
  }
}

export const findTheme = (themeInfo: Rain.ThemeInfo, id: string): Rain.Theme | undefined => {
  let theme = themeInfo.themes.find(theme => theme.id == id)
  if (theme) return theme
  theme = themeInfo.userThemes.find(theme => theme.id == id)
  return theme
}

export const applyTheme = (id: string, lightId: string, darkId: string, dataPath: string, imageUrlBase?: string) => {
  getThemes((themeInfo) => {
    let themeId = id == 'auto'
      ? themeShouldUseDarkColors.value
        ? darkId
        : lightId
      : id

    let theme = findTheme(themeInfo, themeId)
    if (!theme) {
      themeId = id == 'auto' && themeShouldUseDarkColors.value ? 'black' : 'green'
      theme = themeInfo.themes.find(theme => theme.id == themeId)!
    }
    document.documentElement.classList.toggle('dark', theme.isDark)
    document.documentElement.style.colorScheme = theme.isDark ? 'dark' : 'light'
    window.setTheme(buildThemeColors(theme, dataPath, imageUrlBase))
  })
}
