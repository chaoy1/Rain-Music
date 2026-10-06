import { BrowserWindow, dialog, session } from 'electron'
import path from 'node:path'
import { createTaskBarButtons, getWindowSizeInfo } from './utils'
import { getOSVersion, getPlatform, isWin } from '@common/utils'
import { openDevTools as handleOpenDevTools } from '@main/utils'
import { mainSend } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { sendFocus, sendTaskbarButtonClick } from './rendererEvent'
import { encodePath } from '@common/utils/electron'

let browserWindow: Electron.BrowserWindow | null = null
let fullscreenTransition: Promise<boolean> = Promise.resolve(false)
let windowedResizable = false

const winEvent = () => {
  if (!browserWindow) return

  browserWindow.on('close', event => {
    // 托盘常驻：原先的 tray.enable 设置项已移除，行为固定为启用。
    // 只有明确要退出应用时才真正关闭窗口，否则隐藏到托盘。
    if (global.rain.isSkipTrayQuit) {
      browserWindow!.setProgressBar(-1)
      // global.rain.mainWindowClosed = true
      global.rain.event_app.main_window_close()
      return
    }

    event.preventDefault()
    browserWindow!.hide()
  })

  browserWindow.on('closed', () => {
    // global.rain.mainWindowClosed = true
    browserWindow = null
  })

  // browserWindow.on('restore', () => {
  //   browserWindow.webContents.send('restore')
  // })
  browserWindow.on('focus', () => {
    sendFocus()
    global.rain.event_app.main_window_focus()
  })

  browserWindow.on('blur', () => {
    global.rain.event_app.main_window_blur()
  })
  browserWindow.on('enter-full-screen', () => {
    global.rain.event_app.main_window_fullscreen(true)
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen_state, true)
  })
  browserWindow.on('leave-full-screen', () => {
    global.rain.event_app.main_window_fullscreen(false)
    sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen_state, false)
    // Electron updates isFullScreen() and restores bounds after this event callback.
    setImmediate(() => {
      if (browserWindow && !browserWindow.isFullScreen()) browserWindow.setResizable(windowedResizable)
    })
  })

  browserWindow.once('ready-to-show', () => {
    if (!global.envParams.cmdParams.hidden) {
      showWindow()
      setThumbarButtons()
    }
    global.rain.event_app.main_window_ready_to_show()
  })

  browserWindow.on('show', () => {
    global.rain.event_app.main_window_show()

    // 修复隐藏窗口后再显示时任务栏按钮丢失的问题
    setThumbarButtons()
  })
  browserWindow.on('hide', () => {
    global.rain.event_app.main_window_hide()
  })
}


export const createWindow = () => {
  closeWindow()
  const windowSizeInfo = getWindowSizeInfo(global.rain.appSetting['common.windowSizeId'])

  // macOS 风格磨砂玻璃（最终方案）：
  // 不再依赖 Windows 的 DWM Acrylic（backgroundMaterial）。
  // 原因：该材质观感偏弱，且受系统「透明效果」开关影响，实测多台机器上看不出效果；
  // 且它与窗口圆角（roundedCorners）互斥，而圆角是 macOS 风格的必要特征。
  //
  // 现在改为：窗口保持不透明以取得 DWM 圆角，玻璃观感由渲染进程自绘 ——
  // 见 src/renderer/App.vue 的 #wallpaper-layer（重度模糊的桌面壁纸）
  // 与各面板的半透明底色。

  const { shouldUseDarkColors, theme } = global.rain.theme
  const ses = session.fromPartition('persist:win-main')

  /**
   * Initial window options
   */
  const options: Electron.BrowserWindowConstructorOptions = {
    height: windowSizeInfo.height,
    useContentSize: true,
    width: windowSizeInfo.width,
    frame: false,
    // macOS 风格下窗口本身不透明：
    // 玻璃观感由渲染进程的「壁纸模糊层 + 半透明面板」自绘，不依赖透明窗口。
    // 保持不透明是为了拿到 DWM 的圆角（roundedCorners 在透明窗口上不生效）。
    transparent: false,
    // DWM 圆角：macOS 风格窗口的关键特征
    roundedCorners: true,
    // 圆角窗口需要有阴影才有层次
    hasShadow: true,
    // enableRemoteModule: false,
    // icon: join(global.__static, isWin ? 'icons/256x256.ico' : 'icons/512x512.png'),
    // 保留系统最大化能力；绿色交通灯通过全屏接口切换。
    resizable: false,
    maximizable: true,
    fullscreenable: true,
    show: false,
    webPreferences: {
      session: ses,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      webSecurity: false,
      nodeIntegration: true,
      sandbox: false,
      enableWebSQL: false,
      webgl: false,
      spellcheck: false, // 禁用拼写检查器
    },
  }
  // 窗口不透明，直接用主题的主底色作为窗口底色。
  // 真正的玻璃观感由渲染进程自绘（壁纸模糊层 + 半透明面板）。
  options.backgroundColor = theme.colors['--color-primary-light-1000']
  // common.startInFullscreen 设置项已移除，行为固定为「不以此启动」
  browserWindow = new BrowserWindow(options)

  const winURL = process.env.NODE_ENV !== 'production' ? 'http://localhost:9080' : `file://${path.join(encodePath(__dirname), 'index.html')}`
  void browserWindow.loadURL(winURL + `?os=${getPlatform()}&osver=${encodeURIComponent(getOSVersion())}&dt=${global.envParams.cmdParams.dt}&dark=${shouldUseDarkColors}&theme=${encodeURIComponent(JSON.stringify(theme))}`)

  winEvent()

  if (global.envParams.cmdParams.odt) handleOpenDevTools(browserWindow.webContents)

  // global.rain.mainWindowClosed = false
  // browserWindow.webContents.openDevTools()
  global.rain.event_app.main_window_created(browserWindow)
}

export const isExistWindow = (): boolean => !!browserWindow
export const isShowWindow = (): boolean => {
  if (!browserWindow) return false
  return browserWindow.isVisible() && (isWin ? true : browserWindow.isFocused())
}

export const closeWindow = () => {
  if (!browserWindow) return
  browserWindow.close()
}

export const sendEvent = <T = any>(name: string, params?: T) => {
  if (!browserWindow) return
  mainSend(browserWindow, name, params)
}

export const showSelectDialog = async(options: Electron.OpenDialogOptions) => {
  if (!browserWindow) throw new Error('main window is undefined')
  return dialog.showOpenDialog(browserWindow, options)
}
export const showDialog = ({ type, message, detail }: Electron.MessageBoxSyncOptions) => {
  if (!browserWindow) return
  dialog.showMessageBoxSync(browserWindow, {
    type,
    message,
    detail,
  })
}
export const showSaveDialog = async(options: Electron.SaveDialogOptions) => {
  if (!browserWindow) throw new Error('main window is undefined')
  return dialog.showSaveDialog(browserWindow, options)
}
export const minimize = () => {
  if (!browserWindow) return
  browserWindow.minimize()
}
export const maximize = () => {
  if (!browserWindow) return
  browserWindow.maximize()
}
export const unmaximize = () => {
  if (!browserWindow) return
  browserWindow.unmaximize()
}
export const toggleHide = () => {
  if (!browserWindow) return
  browserWindow.isVisible()
    ? browserWindow.hide()
    : browserWindow.show()
}
export const toggleMinimize = () => {
  if (!browserWindow) return
  if (browserWindow.isVisible()) {
    if (browserWindow.isMinimized()) browserWindow.restore()
    else browserWindow.minimize()
  } else browserWindow.show()
}
export const showWindow = () => {
  if (!browserWindow) return
  if (browserWindow.isVisible()) {
    if (browserWindow.isMinimized()) browserWindow.restore()
    else browserWindow.focus()
  } else browserWindow.show()
}
export const hideWindow = () => {
  if (!browserWindow) return
  browserWindow.hide()
}
export const setWindowBounds = (options: Partial<Electron.Rectangle>) => {
  if (!browserWindow) return
  browserWindow.setBounds(options)
}
export const setProgressBar = (progress: number, options?: Electron.ProgressBarOptions) => {
  if (!browserWindow) return
  browserWindow.setProgressBar(progress, options)
}
export const setIgnoreMouseEvents = (ignore: boolean, options?: Electron.IgnoreMouseEventsOptions) => {
  if (!browserWindow) return
  browserWindow.setIgnoreMouseEvents(ignore, options)
}
export const toggleDevTools = () => {
  if (!browserWindow) return
  if (browserWindow.webContents.isDevToolsOpened()) {
    browserWindow.webContents.closeDevTools()
  } else {
    handleOpenDevTools(browserWindow.webContents)
  }
}

export const getFullScreen = (): boolean => browserWindow?.isFullScreen() ?? false

export const setFullScreen = async(isFullscreen: boolean): Promise<boolean> => {
  // Buttons, hotkeys and native transitions share one window state.
  fullscreenTransition = fullscreenTransition.catch(() => getFullScreen()).then(async() => {
    const win = browserWindow
    if (!win || win.isDestroyed()) return false
    if (win.isFullScreen() === isFullscreen) return win.isFullScreen()
    if (isFullscreen) {
      windowedResizable = win.isResizable()
      // Electron 41+ needs this for fixed-size Windows/Linux windows.
      win.setResizable(true)
    }
    return new Promise<boolean>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        win.removeListener('enter-full-screen', finish)
        win.removeListener('leave-full-screen', finish)
        win.removeListener('closed', finish)
        // Inside the native event, isFullScreen() still contains the previous state.
        setImmediate(() => {
          const actual = !win.isDestroyed() && win.isFullScreen()
          if (!actual && !win.isDestroyed()) win.setResizable(windowedResizable)
          resolve(actual)
        })
      }
      // A denied OS transition must also unlock the control and report actual state.
      const timer = setTimeout(finish, 2500)
      win.once('enter-full-screen', finish)
      win.once('leave-full-screen', finish)
      win.once('closed', finish)
      try {
        win.setFullScreen(isFullscreen)
      } catch {
        finish()
      }
    })
  })
  return fullscreenTransition
}

const taskBarButtonFlags: Rain.TaskBarButtonFlags = {
  empty: true,
  play: false,
  next: true,
  prev: true,
}
export const setThumbarButtons = ({ empty, play, next, prev }: Rain.TaskBarButtonFlags = taskBarButtonFlags) => {
  if (!isWin || !browserWindow) return
  taskBarButtonFlags.empty = empty
  taskBarButtonFlags.play = play
  taskBarButtonFlags.next = next
  taskBarButtonFlags.prev = prev
  browserWindow.setThumbarButtons(createTaskBarButtons(taskBarButtonFlags, action => {
    sendTaskbarButtonClick(action)
  }))
}

export const setThumbnailClip = (region: Electron.Rectangle) => {
  if (!browserWindow) return
  browserWindow.setThumbnailClip(region)
}


export const clearCache = async() => {
  if (!browserWindow) throw new Error('main window is undefined')
  await browserWindow.webContents.session.clearCache()
}

export const getCacheSize = async() => {
  if (!browserWindow) throw new Error('main window is undefined')
  return browserWindow.webContents.session.getCacheSize()
}

/**
 * 资源缓存「超过一定大小时自动清理」。
 *
 * 阈值来自设置项 `common.resourceCacheAutoCleanSize`（单位 MB，0 表示关闭），
 * 由用户在设置页选择预设档位。清理复用上面的 clearCache()，
 * 不额外实现一套删除逻辑（清理的就是 Electron 会话缓存，
 * 与设置页「清理资源缓存」按钮完全一致）。
 *
 * 触发时机：软件启动、主窗口创建后检查一次。
 * 之所以不做定期检查：该缓存由 Electron 自己按磁盘空间动态管理，
 * 启动时清理上一轮会话残留的缓存已经能覆盖「缓存无限增长」的场景，
 * 定期轮询会带来不必要的 IO 与复杂度。
 */
export const autoCleanResourceCache = async() => {
  if (!browserWindow) return
  const autoCleanSize = global.rain.appSetting['common.resourceCacheAutoCleanSize']
  if (!autoCleanSize || autoCleanSize <= 0) return
  const maxCacheSize = autoCleanSize * 1024 * 1024
  const cacheSize = await getCacheSize()
  if (cacheSize <= maxCacheSize) return
  await clearCache()
  console.log(`resource cache auto cleaned: ${cacheSize} > ${maxCacheSize}`)
}

export const getWebContents = (): Electron.WebContents => {
  if (!browserWindow) throw new Error('main window is undefined')
  return browserWindow.webContents
}
