import { throttle, isMac } from '@common/utils'
import migrateSetting from '@common/utils/migrateSetting'
import getStore from '@main/platform/storage/adapter'
import { STORE_NAMES, URL_SCHEME_RXP } from '@common/constants'
import defaultSetting from '@common/defaultSetting'
import defaultHotKey from '@common/defaultHotKey'
import { migrateDataJson, migrateHotKey, migrateUserApi, parseDataFile } from './migrate'
import { nativeTheme, powerSaveBlocker } from 'electron'
import { buildThemeImageCssUrl } from '@common/utils/themeImageUrl'
import { getThemeImagesDir, getThemeImagesUrlBase } from './themeImages'
import builtinThemes from '@common/theme/index.json'

// index.json 由 `npm run build:theme` 生成。
// TS 会把 JSON 里每个字面量键值推断成「字符串字面量联合类型」，
// 导致展开进 Record<string, string> 时报 TS2322；
// 这里统一按 Rain.Theme[] 使用，既符合真实结构也避免该问题。
const themes = builtinThemes as unknown as Rain.Theme[]

export const parseEnvParams = (argv = process.argv): { cmdParams: Rain.CmdParams, deeplink: string | null } => {
  const cmdParams: Rain.CmdParams = {}
  let deeplink = null
  const rx = /^-\w+/
  for (let param of argv) {
    if (URL_SCHEME_RXP.test(param)) {
      deeplink = param
    }

    if (!rx.test(param)) continue
    param = param.substring(1)
    let index = param.indexOf('=')
    if (index < 0) {
      cmdParams[param] = true
    } else {
      cmdParams[param.substring(0, index)] = param.substring(index + 1)
    }
  }
  return {
    cmdParams,
    deeplink,
  }
}

const primitiveType = ['string', 'boolean', 'number']
const checkPrimitiveType = (val: any): boolean => val === null || primitiveType.includes(typeof val)
// const handleMergeSetting = (defaultSetting: Rain.AppSetting, currentSetting: Partial<Rain.AppSetting>) => {
//   const updatedSettingKeys: Array<keyof Rain.AppSetting> = []
//   for (const key of Object.keys(defaultSetting) as Array<keyof Rain.AppSetting>) {
//     const currentValue: any = currentSetting[key]
//     const isPrimitive = checkPrimitiveType(currentValue)
//     // if (checkPrimitiveType(value)) {
//     if (!isPrimitive) continue
//     updatedSettingKeys.push(key)
//     // @ts-expect-error
//     defaultSetting[key] = currentValue
//     // } else {
//     //   if (!isPrimitive && currentValue != undefined) handleMergeSetting(value, currentValue)
//     // }
//   }
//   return {
//     setting: defaultSetting,
//     updatedSettingKeys,
//   }
// }

export const mergeSetting = (originSetting: Rain.AppSetting, targetSetting?: Partial<Rain.AppSetting> | null): {
  setting: Rain.AppSetting
  updatedSettingKeys: Array<keyof Rain.AppSetting>
  updatedSetting: Partial<Rain.AppSetting>
} => {
  let originSettingCopy: Rain.AppSetting = { ...originSetting }
  // const defaultVersion = targetSettingCopy.version
  const updatedSettingKeys: Array<keyof Rain.AppSetting> = []
  const updatedSetting: Partial<Rain.AppSetting> = {}

  if (targetSetting) {
    const originSettingKeys = Object.keys(originSettingCopy)
    const targetSettingKeys = Object.keys(targetSetting)

    if (originSettingKeys.length > targetSettingKeys.length) {
      for (const key of targetSettingKeys as Array<keyof Rain.AppSetting>) {
        const targetValue: any = targetSetting[key]
        const isPrimitive = checkPrimitiveType(targetValue)
        // if (checkPrimitiveType(value)) {
        if (!isPrimitive || targetValue == originSettingCopy[key] || originSettingCopy[key] === undefined) continue
        updatedSettingKeys.push(key)
        updatedSetting[key] = targetValue
        // @ts-expect-error
        originSettingCopy[key] = targetValue
        // } else {
        //   if (!isPrimitive && currentValue != undefined) handleMergeSetting(value, currentValue)
        // }
      }
    } else {
      for (const key of originSettingKeys as Array<keyof Rain.AppSetting>) {
        const targetValue: any = targetSetting[key]
        const isPrimitive = checkPrimitiveType(targetValue)
        // if (checkPrimitiveType(value)) {
        if (!isPrimitive || targetValue == originSettingCopy[key]) continue
        updatedSettingKeys.push(key)
        updatedSetting[key] = targetValue
        // @ts-expect-error
        originSettingCopy[key] = targetValue
        // } else {
        //   if (!isPrimitive && currentValue != undefined) handleMergeSetting(value, currentValue)
        // }
      }
    }
  }

  return {
    setting: originSettingCopy,
    updatedSettingKeys,
    updatedSetting,
  }
}

export const updateSetting = (setting?: Partial<Rain.AppSetting>, isInit: boolean = false) => {
  const electronStore_config = getStore(STORE_NAMES.APP_SETTINGS)

  let originSetting: Rain.AppSetting
  if (isInit) {
    setting &&= migrateSetting(setting)
    originSetting = { ...defaultSetting }
  } else originSetting = global.rain.appSetting

  const result = mergeSetting(originSetting, setting)

  // 注：原 applyInitSetting 会在「隐藏启动」时强制打开托盘；
  // tray.enable 设置项已移除且行为固定为启用，因此该函数一并删除。

  result.setting.version = defaultSetting.version

  electronStore_config.override({ version: result.setting.version, setting: result.setting })
  return result
}

/**
 * 初始化设置
 */
export const initSetting = async() => {
  const electronStore_config = getStore(STORE_NAMES.APP_SETTINGS)

  let setting = electronStore_config.get('setting') as Rain.AppSetting | undefined

  // migrate setting
  if (!setting) {
    const config = await parseDataFile<{ setting?: any }>('config.json')
    if (config?.setting) setting = config.setting as Rain.AppSetting
    await migrateUserApi()
    await migrateDataJson()
  }

  // console.log(setting)
  return updateSetting(setting, true)
}

/**
 * 初始化快捷键设置
 */
export const initHotKey = async() => {
  const electronStore_hotKey = getStore(STORE_NAMES.HOTKEY)

  let localConfig = electronStore_hotKey.get('local') as Rain.HotKeyConfig | null
  let globalConfig = electronStore_hotKey.get('global') as Rain.HotKeyConfig | null

  if (globalConfig) {
    // 移除v2.2.0及之前设置的全局媒体快捷键注册
    if (globalConfig.keys.MediaPlayPause) {
      delete globalConfig.keys.MediaPlayPause
      delete globalConfig.keys.MediaNextTrack
      delete globalConfig.keys.MediaPreviousTrack
      electronStore_hotKey.set('global', globalConfig)
    }
  } else {
    // migrate hotKey
    const config = await migrateHotKey()
    if (config) {
      localConfig = config.local
      globalConfig = config.global
    } else {
      localConfig = JSON.parse(JSON.stringify(defaultHotKey.local))
      globalConfig = JSON.parse(JSON.stringify(defaultHotKey.global))
    }

    electronStore_hotKey.set('local', localConfig)
    electronStore_hotKey.set('global', globalConfig)
  }

  return {
    local: localConfig!,
    global: globalConfig!,
  }
}

type HotKeyType = 'local' | 'global'

const saveHotKeyConfig = throttle<[Rain.HotKeyConfigAll]>((config: Rain.HotKeyConfigAll) => {
  for (const key of Object.keys(config) as HotKeyType[]) {
    global.rain.hotKey.config[key] = config[key]
    getStore(STORE_NAMES.HOTKEY).set(key, config[key])
  }
})
export const saveAppHotKeyConfig = (config: Rain.HotKeyConfigAll) => {
  saveHotKeyConfig(config)
}

export const openDevTools = (webContents: Electron.WebContents) => {
  webContents.openDevTools({
    mode: 'undocked',
  })
}


let userThemes: Rain.Theme[]
export const getAllThemes = () => {
  userThemes ??= getStore(STORE_NAMES.THEME).get('themes') as (Rain.Theme[] | null) ?? []
  return {
    themes,
    userThemes,
    dataPath: getThemeImagesDir(),
    /**
     * 阶段 3 / 线 C 新增：渲染层可以直接拼出可加载 URL 的基址。
     *
     * - **桌面**：`electronThemeFiles.toUrlBase` 是 identity，所以这里与 `dataPath` **逐字相同**，
     *   且因为 `isUrl()` 不认 Windows 路径，渲染层仍走改动前那一行
     *   `encodePath(joinPath(dataPath, name))` → `--background-image` 的 CSS 输出逐字不变。
     * - **Android**：`androidThemeFiles.toUrlBase` = `Capacitor.convertFileSrc(...)`，
     *   渲染层走新增的 URL 分支（不再 `pathToFileURL()`，避免把 `http://` 拼坏）。
     *
     * `dataPath` **原样保留**：它仍然是主题图片的落点，也是渲染层传给
     * `winMain_theme_file_*` 系列之外一切逻辑的既有字段。
     */
    imageUrlBase: getThemeImagesUrlBase(),
  }
}

export const saveTheme = (theme: Rain.Theme) => {
  const targetTheme = userThemes.find(t => t.id === theme.id)
  if (targetTheme) Object.assign(targetTheme, theme)
  else userThemes.push(theme)
  getStore(STORE_NAMES.THEME).set('themes', userThemes)
}

export const removeTheme = (id: string) => {
  const index = userThemes.findIndex(t => t.id === id)
  if (index < 0) return
  userThemes.splice(index, 1)
  getStore(STORE_NAMES.THEME).set('themes', userThemes)
}

const copyTheme = (theme: Rain.Theme): Rain.Theme => {
  return {
    ...theme,
    config: {
      ...theme.config,
      extInfo: { ...theme.config.extInfo },
      themeColors: { ...theme.config.themeColors },
    },
  }
}
export const getTheme = () => {
  // fs.promises.readdir()
  const shouldUseDarkColors = nativeTheme.shouldUseDarkColors
  let themeId = global.rain.appSetting['theme.id'] == 'auto'
    ? shouldUseDarkColors
      ? global.rain.appSetting['theme.darkId']
      : global.rain.appSetting['theme.lightId']
    : global.rain.appSetting['theme.id']
  // themeId = 'naruto'
  // themeId = 'pink'
  // themeId = 'black'
  let theme = themes.find(theme => theme.id == themeId)
  if (!theme) {
    userThemes = getStore(STORE_NAMES.THEME).get('themes') as Rain.Theme[] | null ?? []
    theme = userThemes.find(theme => theme.id == themeId)
    if (theme) {
      if (theme.config.extInfo['--background-image'] != 'none') {
        theme = copyTheme(theme)
        // 阶段 3 / 线 C：改为共用 `@common/utils/themeImageUrl` 的那一份实现。
        // 桌面下 `imageUrlBase` 与 `dataPath` 逐字相同且不是 URL，所以这里落到
        // "`url(encodePath(joinPath(dataPath, name)))`" 这一分支 —— 与原式等价（原式也没有
        // `.replaceAll('\\','/')`，`pathToFileURL()` 自己会归一化分隔符）。
        theme.config.extInfo['--background-image'] =
          buildThemeImageCssUrl(
            theme.config.extInfo['--background-image'],
            getThemeImagesDir(),
            getThemeImagesUrlBase(),
          )
      }
    } else {
      themeId = global.rain.appSetting['theme.id'] == 'auto' && shouldUseDarkColors ? 'black' : 'green'
      theme = themes.find(theme => theme.id == themeId)!
    }
  }

  const colors: Record<string, string> = {
    ...theme.config.themeColors,
    ...theme.config.extInfo,
  }

  return {
    shouldUseDarkColors,
    theme: {
      id: global.rain.appSetting['theme.id'],
      name: theme.name,
      isDark: theme.isDark,
      isDarkFont: theme.isDarkFont,
      colors,
    },
  }
}

let powerSaveBlockerId: number | null = null
export const setPowerSaveBlocker = (enabled: boolean) => {
  let isEnabled = powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId)
  if (enabled) {
    if (isEnabled) return
    powerSaveBlockerId = powerSaveBlocker.start(isMac ? 'prevent-display-sleep' : 'prevent-app-suspension')
  } else {
    if (!isEnabled) return
    powerSaveBlocker.stop(powerSaveBlockerId!)
    powerSaveBlockerId = null
  }
}
