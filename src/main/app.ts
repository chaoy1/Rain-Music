import path from 'node:path'
import { renameSync } from 'fs'
import { app, shell, screen, nativeTheme, dialog } from 'electron'
import { URL_SCHEME_RXP, TRANSPARENT_WINDOW } from '@common/constants'
import { getTheme, initHotKey, initSetting, parseEnvParams } from './utils'
import { navigationUrlWhiteList } from '@common/config'
import defaultSetting from '@common/defaultSetting'
import { isExistWindow as isExistMainWindow, showWindow as showMainWindow } from './modules/winMain'
import { createAppEvent, createDislikeEvent, createListEvent } from '@main/event'
import { isMac, log } from '@common/utils'
import createWorkers from './worker'
import { migrateDBData } from './utils/migrate'
import { openDirInExplorer } from '@common/utils/electron'
import { getWallpaperPath } from './utils/wallpaper'

export const initGlobalData = () => {
  const envParams = parseEnvParams()
  // envParams.cmdParams.dt = !!envParams.cmdParams.dt

  global.envParams = {
    cmdParams: envParams.cmdParams,
    deeplink: envParams.deeplink,
    wallpaper: getWallpaperPath(),
  }
  global.rain = {
    inited: false,
    isSkipTrayQuit: false,
    // mainWindowClosed: true,
    event_app: createAppEvent(),
    event_list: createListEvent(),
    event_dislike: createDislikeEvent(),
    appSetting: defaultSetting,
    worker: createWorkers(),
    hotKey: {
      enable: true,
      config: {
        local: {
          enable: false,
          keys: {},
        },
        global: {
          enable: false,
          keys: {},
        },
      },
      state: new Map(),
    },
    theme: {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      theme: {
        id: '',
        name: '',
        isDark: false,
        colors: {},
      },
    },
    player_status: {
      status: 'stoped',
      name: '',
      singer: '',
      albumName: '',
      picUrl: '',
      progress: 0,
      duration: 0,
      playbackRate: 1,
      lyricLineText: '',
      lyricLineAllText: '',
      lyric: '',
      tlyric: '',
      rlyric: '',
      rainlyric: '',
      volume: 0,
      mute: false,
    },
  }

  global.staticPath =
    process.env.NODE_ENV !== 'production'
      ? webpackStaticPath
      : path.join(__dirname, 'static')
}

export const initSingleInstanceHandle = () => {
  // 单例应用程序
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
  }

  app.on('second-instance', (event, argv, cwd) => {
    if (isExistMainWindow()) {
      const envParams = parseEnvParams(argv)
      if (envParams.deeplink) {
        global.envParams.deeplink = envParams.deeplink
        global.rain.event_app.deeplink(global.envParams.deeplink)
        return
      }
      if (envParams.cmdParams.hidden !== true) {
        showMainWindow()
      }
    } else {
      app.quit()
    }
  })
}

export const applyElectronEnvParams = () => {
  // Is disable hardware acceleration
  if (global.envParams.cmdParams.dha) app.disableHardwareAcceleration()
  if (global.envParams.cmdParams.dhmkh) app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

  // fix linux transparent fail. https://github.com/electron/electron/issues/25153#issuecomment-843688494
  if (process.platform == 'linux') app.commandLine.appendSwitch('use-gl', 'desktop')

  // https://github.com/electron/electron/issues/22691
  app.commandLine.appendSwitch('wm-window-animations-disabled')

  app.commandLine.appendSwitch('--disable-gpu-sandbox')
}

export const registerDeeplink = (startApp: () => void) => {
  if (process.env.NODE_ENV !== 'production' && process.platform === 'win32') {
    // Set the path of electron.exe and your app.
    // These two additional parameters are only available on windows.
    // console.log(process.execPath, process.argv)
    app.setAsDefaultProtocolClient('rainmusic', process.execPath, process.argv.slice(1))
  } else {
    app.setAsDefaultProtocolClient('rainmusic')
  }

  // deep link
  app.on('open-url', (event, url) => {
    if (!URL_SCHEME_RXP.test(url)) return
    event.preventDefault()
    global.envParams.deeplink = url
    if (isExistMainWindow()) {
      if (global.envParams.deeplink) global.rain.event_app.deeplink(global.envParams.deeplink)
      else showMainWindow()
    } else {
      startApp()
    }
  })
}

export const listenerAppEvent = (startApp: () => void) => {
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('navigation to url:', navigationUrl.length > 130 ? navigationUrl.substring(0, 130) + '...' : navigationUrl)
        return
      }
      if (!navigationUrlWhiteList.some(url => url.test(navigationUrl))) {
        event.preventDefault()
        return
      }
      console.log('navigation to url:', navigationUrl)
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (!/^devtools/.test(url) && /^https?:\/\//.test(url)) {
        void shell.openExternal(url)
      }
      console.log(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip away preload scripts if unused or verify their location is legitimate
      delete webPreferences.preload
      // delete webPreferences.preloadURL

      // Disable Node.js integration
      webPreferences.nodeIntegration = false

      // Verify URL being loaded
      if (!navigationUrlWhiteList.some(url => url.test(params.src))) {
        event.preventDefault()
      }
    })

    // disable create dictionary
    contents.session.setSpellCheckerDictionaryDownloadURL('http://0.0.0.0')
  })

  app.on('activate', () => {
    if (isExistMainWindow()) {
      showMainWindow()
    } else {
      startApp()
    }
  })

  app.on('before-quit', () => {
    global.rain.isSkipTrayQuit = true
  })
  app.on('window-all-closed', () => {
    if (isMac) return

    app.quit()
  })

  const initScreenParams = () => {
    global.envParams.workAreaSize = screen.getPrimaryDisplay().workAreaSize
  }
  // Business modules load after whenReady; subscribing to ready here misses it.
  screen.on('display-metrics-changed', initScreenParams)
  if (app.isReady()) initScreenParams()
  else app.once('ready', initScreenParams)

  nativeTheme.addListener('updated', () => {
    const shouldUseDarkColors = nativeTheme.shouldUseDarkColors
    if (shouldUseDarkColors == global.rain.theme.shouldUseDarkColors) return
    global.rain.theme.shouldUseDarkColors = shouldUseDarkColors
    global.rain?.event_app.system_theme_change(shouldUseDarkColors)
  })

  global.rain.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('player.volume')) {
      global.rain.event_app.player_status({ volume: Math.trunc(setting['player.volume']! * 100) })
    }
    if (keys.includes('player.isMute')) {
      global.rain.event_app.player_status({ mute: setting['player.isMute'] })
    }
  })
  global.rain.event_app.on('app_inited', () => {
    global.rain.event_app.player_status({ volume: Math.trunc(global.rain.appSetting['player.volume'] * 100) })
    global.rain.event_app.player_status({ mute: global.rain.appSetting['player.isMute'] })
  })
}

const initTheme = () => {
  global.rain.theme = getTheme()
  const themeConfigKeys = ['theme.id', 'theme.lightId', 'theme.darkId']
  global.rain.event_app.on('updated_config', (keys) => {
    let requireUpdate = false
    for (const key of keys) {
      if (themeConfigKeys.includes(key)) {
        requireUpdate = true
        break
      }
    }
    if (requireUpdate) {
      global.rain.theme = getTheme()
      global.rain.event_app.theme_change()
    }
  })
  global.rain.event_app.on('system_theme_change', () => {
    if (global.rain.appSetting['theme.id'] == 'auto') {
      global.rain.theme = getTheme()
      global.rain.event_app.theme_change()
    }
  })
}

const backupDB = (backupPath: string) => {
  const dbPath = path.join(global.rainDataPath, 'rain.data.db')
  renameSync(dbPath, backupPath)
  for (const suffix of ['-wal', '-shm']) {
    try {
      renameSync(`${dbPath}${suffix}`, `${backupPath}${suffix}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  openDirInExplorer(backupPath)
}

let isInitialized = false
export const initAppSetting = async() => {
  if (!global.rain.inited) {
    const config = await initHotKey()
    global.rain.hotKey.config.local = config.local
    global.rain.hotKey.config.global = config.global
    global.rain.inited = true
  }

  if (!isInitialized) {
    let dbFileExists = await global.rain.worker.dbService.init(global.rainDataPath)
    if (dbFileExists === null) {
      const backupPath = path.join(global.rainDataPath, `rain.data.db.${Date.now()}.bak`)
      dialog.showMessageBoxSync({
        type: 'warning',
        message: 'Database verify failed',
        detail: `数据库表结构校验失败，我们将把有问题的数据库备份到：${backupPath}\n若此问题导致你的数据丢失，你可以尝试从备份文件找回它们。\n\nThe database table structure verification failed, we will back up the problematic database to: ${backupPath}\nIf this problem causes your data to be lost, you can try to retrieve them from the backup file.`,
      })
      backupDB(backupPath)
      dbFileExists = await global.rain.worker.dbService.init(global.rainDataPath)
      if (dbFileExists === null) throw new Error('Database recovery failed; the backup has been preserved')
    }
    global.rain.appSetting = (await initSetting()).setting
    if (!dbFileExists) await migrateDBData().catch(err => { log.error(err) })
    initTheme()
    // 「主窗口使用软件内置的圆角及阴影」(common.transparentWindow) 设置项已移除，
    // 行为固定为 true（TRANSPARENT_WINDOW）——即始终不使用系统原生窗口样式。
    // 注意：命令行参数 --dt（非透明模式）仍然有效，只有未显式传入时才应用固定行为。
    if (envParams.cmdParams.dt == null) envParams.cmdParams.dt = !TRANSPARENT_WINDOW
  }
  // global.rain.theme = getTheme()

  isInitialized ||= true
}

export const quitApp = () => {
  global.rain.isSkipTrayQuit = true
  app.quit()
}
