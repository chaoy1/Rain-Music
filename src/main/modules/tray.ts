import { Tray, Menu, nativeImage } from 'electron'
import { isMac, isWin } from '@common/utils'
import path from 'node:path'
import fs from 'node:fs'
import {
  hideWindow as hideMainWindow,
  isExistWindow as isExistMainWindow,
  isShowWindow as isShowMainWindow,
  sendTaskbarButtonClick,
  showWindow as showMainWindow,
} from './winMain'
import { quitApp } from '@main/app'

let tray: Electron.Tray | null
let isEnableTray: boolean = false
let isShowStatusBarLyric: boolean = false

const playerState = {
  empty: false,
  play: false,
  next: true,
  prev: true,
}

const watchConfigKeys = [
  'desktopLyric.enable',
  'desktopLyric.isLock',
  'player.isShowStatusBarLyric',
  'common.langId',
] satisfies Array<keyof Rain.AppSetting>

const messages = {
  'en-us': {
    play: 'Play',
    pause: 'Pause',
    next: 'Next Song',
    prev: 'Prev Song',
    hide_win_main: 'Hide Main Window',
    show_win_main: 'Show Main Window',
    hide_win_lyric: 'Hide Lyric Window',
    show_win_lyric: 'Show Lyric Window',
    lock_win_lyric: 'Lock Lyric Window',
    unlock_win_lyric: 'Unlock Lyric Window',
    show_statusbar_lyric: 'Show Lyrics on Statusbar',
    hide_statusbar_lyric: 'Hide Lyrics on Statusbar',
    exit: 'Exit',
    music_name: 'Title: ',
    music_singer: 'Artist: ',
  },
  'zh-cn': {
    play: '播放',
    pause: '暂停',
    next: '下一曲',
    prev: '上一曲',
    hide_win_main: '隐藏主界面',
    show_win_main: '显示主界面',
    hide_win_lyric: '关闭桌面歌词',
    show_win_lyric: '开启桌面歌词',
    lock_win_lyric: '锁定桌面歌词',
    unlock_win_lyric: '解锁桌面歌词',
    show_statusbar_lyric: '显示状态栏歌词',
    hide_statusbar_lyric: '隐藏状态栏歌词',
    exit: '退出',
    music_name: '歌曲名: ',
    music_singer: '艺术家: ',
  },
  'zh-tw': {
    play: '播放',
    pause: '暫停',
    next: '下一曲',
    prev: '上一曲',
    hide_win_main: '隱藏軟體視窗',
    show_win_main: '顯示軟體視窗',
    hide_win_lyric: '關閉歌詞視窗',
    show_win_lyric: '開啟歌詞視窗',
    lock_win_lyric: '鎖定歌詞視窗',
    unlock_win_lyric: '解鎖歌詞視窗',
    show_statusbar_lyric: '顯示狀態列歌詞',
    hide_statusbar_lyric: '隱藏狀態列歌詞',
    exit: '退出',
    music_name: '標題: ',
    music_singer: '演出者: ',
  },
  'ko-kr': {
    play: '재생',
    pause: '일시정지',
    next: '다음 곡',
    prev: '이전 곡',
    hide_win_main: '메인 창 숨기기',
    show_win_main: '메인 창 표시',
    hide_win_lyric: '가사 창 닫기',
    show_win_lyric: '가사 창 열기',
    lock_win_lyric: '가사 창 잠금',
    unlock_win_lyric: '가사 창 잠금 해제',
    show_statusbar_lyric: '상태 표시줄에 가사 표시',
    hide_statusbar_lyric: '상태 표시줄 가사 숨기기',
    exit: '종료',
    music_name: '제목: ',
    music_singer: '아티스트: ',
  },
} as const
type Messages = typeof messages
type Langs = keyof Messages
const i18n = {
  message: messages['zh-cn'] as Messages[Langs],
  fallbackLocale: 'en-us' as 'en-us',
  getMessage(key: keyof Messages[Langs]) {
    return this.message[key]
  },
  setLang(lang?: Langs | null) {
    this.message = lang
      ? messages[lang] ?? messages[this.fallbackLocale]
      : messages[this.fallbackLocale]
  },
}

// 托盘字形固定为黑色（等价于原来 themeList 里 id 2 = tray_black，也即 TRAY_THEME_ID）。
// 原来在这里的 themeList 映射表（trayTemplate / tray_origin / tray_black）
// 以及按任务栏明暗自动切换字形的 TRAY_AUTO_ID 逻辑，都因为只剩一种固定样式而删除。
const TRAY_IMAGE_NAME = 'tray_black'

const trayImageDir = () => path.join(global.staticPath, 'images/tray')

/** 基图路径：Windows 用 .ico，其它平台用 .png */
const trayImagePath = (fileName: string) =>
  path.join(trayImageDir(), fileName + (isWin ? '.ico' : '.png'))

/** PNG 文件头校验：addRepresentation 只接受真正的 PNG 数据。 */
const isPng = (buffer: Buffer) =>
  buffer.length > 8 &&
  buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47

/**
 * 读取某个分辨率变体的 PNG 数据，文件缺失或不是 PNG 时返回 null。
 *
 * tray 目录下基图只有 16×16，另有 @1.25x / @1.5x / @2x 的 PNG 变体。
 * 高分屏上只给基图会被系统放大导致发糊，因此这里逐个探测。
 * 缺图时必须能优雅降级，绝不能让应用因找不到文件而启动失败。
 */
const readTrayImagePng = (fileName: string): Buffer | null => {
  try {
    const buffer = fs.readFileSync(path.join(trayImageDir(), fileName + '.png'))
    return isPng(buffer) ? buffer : null
  } catch {
    return null
  }
}

/**
 * 构造带多分辨率表示的托盘图标。
 *
 * 基图（Windows 为 .ico，其它平台为 .png）仍用 createFromPath 加载，
 * 保持原有行为不变；再按 scaleFactor 依次加入 @1.25x / @1.5x / @2x 的
 * PNG 表示，缺失或不是 PNG 的变体直接跳过。
 *
 * Windows 上额外有 @2x.ico（与基图同格式，也是 32×32）：
 * 它不是 PNG，无法作为表示数据，但文件存在时不会影响结果 ——
 * 基图本身就已经是多分辨率 .ico，系统会自行挑选合适尺寸。
 * 因此这里不做任何可能失败的 ICO 解析。
 *
 * 连基图都读不到时返回空 nativeImage，由调用方决定是否创建托盘。
 */
const buildTrayImage = (): Electron.NativeImage => {
  const basePath = trayImagePath(TRAY_IMAGE_NAME)
  let baseExists = false
  try {
    baseExists = fs.statSync(basePath).isFile()
  } catch {
    baseExists = false
  }
  if (!baseExists) return nativeImage.createEmpty()

  const image = nativeImage.createFromPath(basePath)
  if (image.isEmpty()) return image

  const variants: Array<{ scaleFactor: number, fileName: string }> = [
    { scaleFactor: 1.25, fileName: `${TRAY_IMAGE_NAME}@1.25x` },
    { scaleFactor: 1.5, fileName: `${TRAY_IMAGE_NAME}@1.5x` },
    { scaleFactor: 2, fileName: `${TRAY_IMAGE_NAME}@2x` },
  ]
  for (const { scaleFactor, fileName } of variants) {
    const variantBuffer = readTrayImagePng(fileName)
    if (!variantBuffer) continue
    image.addRepresentation({
      scaleFactor,
      buffer: variantBuffer,
    })
  }

  return image
}

export const createTray = () => {
  if (tray && !tray.isDestroyed()) return

  const image = buildTrayImage()
  if (image.isEmpty()) {
    // 图标资源缺失：不创建托盘，避免 Tray 构造抛错导致启动失败。
    console.error('[tray] 找不到托盘图标资源，已跳过托盘创建')
    return
  }

  // 托盘
  tray = new Tray(image)

  // tray.setToolTip('Rain Music')
  // createMenu()
  tray.setIgnoreDoubleClickEvents(true)
  if (!isMac) {
    tray.on('click', () => {
      showMainWindow()
    })
  }
}

export const destroyTray = () => {
  if (!tray) return
  tray.destroy()
  isEnableTray = false
  isShowStatusBarLyric = false
  tray = null
}

const handleUpdateConfig = (setting: Partial<Rain.AppSetting>) => {
  global.rain.event_app.update_config(setting)
}

const createPlayerMenu = () => {
  let menu: Electron.MenuItemConstructorOptions[] = []
  menu.push(playerState.play ? {
    label: i18n.getMessage('pause'),
    click() {
      sendTaskbarButtonClick('pause')
    },
  } : {
    label: i18n.getMessage('play'),
    click() {
      sendTaskbarButtonClick('play')
    },
  })
  menu.push({
    label: i18n.getMessage('prev'),
    click() {
      sendTaskbarButtonClick('prev')
    },
  })
  menu.push({
    label: i18n.getMessage('next'),
    click() {
      sendTaskbarButtonClick('next')
    },
  })
  return menu
}

export const createMenu = () => {
  if (!tray) return
  let menu: Electron.MenuItemConstructorOptions[] = createPlayerMenu()
  if (playerState.empty) for (const m of menu) m.enabled = false
  menu.push({ type: 'separator' })
  menu.push(global.rain.appSetting['desktopLyric.enable']
    ? {
        label: i18n.getMessage('hide_win_lyric'),
        click() {
          handleUpdateConfig({ 'desktopLyric.enable': false })
        },
      }
    : {
        label: i18n.getMessage('show_win_lyric'),
        click() {
          handleUpdateConfig({ 'desktopLyric.enable': true })
        },
      })
  menu.push(global.rain.appSetting['desktopLyric.isLock']
    ? {
        label: i18n.getMessage('unlock_win_lyric'),
        click() {
          handleUpdateConfig({ 'desktopLyric.isLock': false })
        },
      }
    : {
        label: i18n.getMessage('lock_win_lyric'),
        click() {
          handleUpdateConfig({ 'desktopLyric.isLock': true })
        },
      })
  // 「使歌词总是在其他窗口之上」设置项已移除，行为固定为 true，
  // 因此托盘的「置顶歌词 / 取消置顶」切换项一并删除（top_win_lyric / untop_win_lyric 文案不再使用）。
  if (isMac) {
    menu.push({ type: 'separator' })
    menu.push(isShowStatusBarLyric
      ? {
          label: i18n.getMessage('hide_statusbar_lyric'),
          click() {
            handleUpdateConfig({ 'player.isShowStatusBarLyric': false })
          },
        }
      : {
          label: i18n.getMessage('show_statusbar_lyric'),
          click() {
            handleUpdateConfig({ 'player.isShowStatusBarLyric': true })
          },
        })
  }
  menu.push({ type: 'separator' })
  if (isExistMainWindow()) {
    const isShow = isShowMainWindow()
    menu.push(isShow
      ? {
          label: i18n.getMessage('hide_win_main'),
          click() {
            hideMainWindow()
          },
        }
      : {
          label: i18n.getMessage('show_win_main'),
          click() {
            showMainWindow()
          },
        })
  }
  menu.push({
    label: i18n.getMessage('exit'),
    click() {
      quitApp()
    },
  })
  const contextMenu = Menu.buildFromTemplate(menu)
  tray.setContextMenu(contextMenu)
}

const setLyric = (lyricLineText?: string) => {
  if (isShowStatusBarLyric && tray && lyricLineText != null) {
    tray.setTitle(lyricLineText)
  }
}

const defaultTip = 'Rain Music'
const setTip = () => {
  if (!tray) return

  let name = global.rain.player_status.name
  let tip: string
  if (name) {
    if (name.length > 20) name = name.substring(0, 20) + '...'
    let singer = global.rain.player_status.singer
    if (singer?.length > 20) singer = singer.substring(0, 20) + '...'

    tip = `${defaultTip}\n${i18n.getMessage('music_name')}${name}${singer ? `\n${i18n.getMessage('music_singer')}${singer}` : ''}`
  } else tip = defaultTip
  tray.setToolTip(tip)
}

const init = () => {
  // 托盘常驻：tray.enable 设置项已移除，行为固定为「始终启用」，
  // 因此这里不再有开关判断，只保证托盘对象存在。
  if (!isEnableTray) {
    isEnableTray = true
    createTray()
  }
  if (isShowStatusBarLyric !== global.rain.appSetting['player.isShowStatusBarLyric']) {
    isShowStatusBarLyric = global.rain.appSetting['player.isShowStatusBarLyric']
    if (isShowStatusBarLyric) {
      setLyric(global.rain.player_status.lyricLineText)
    } else {
      tray?.setTitle('')
    }
  }
  setTip()
  createMenu()
}

export default () => {
  global.rain.event_app.on('updated_config', (keys, setting) => {
    if (!watchConfigKeys.some(key => keys.includes(key))) return

    if (keys.includes('common.langId')) i18n.setLang(setting['common.langId'])

    init()
  })

  global.rain.event_app.on('main_window_ready_to_show', () => {
    createMenu()
  })
  global.rain.event_app.on('main_window_show', () => {
    createMenu()
  })
  if (!isWin) {
    global.rain.event_app.on('main_window_focus', () => {
      createMenu()
    })
    global.rain.event_app.on('main_window_blur', () => {
      createMenu()
    })
  }
  global.rain.event_app.on('main_window_hide', () => {
    createMenu()
  })
  global.rain.event_app.on('main_window_close', () => {
    destroyTray()
  })

  global.rain.event_app.on('app_inited', () => {
    i18n.setLang(global.rain.appSetting['common.langId'])
    init()
  })

  // 托盘字形已固定为黑色（TRAY_THEME_ID），不再跟随系统亮暗切换，
  // 因此 system_theme_change 里换成套图标的逻辑一并删除。

  global.rain.event_app.on('player_status', (status) => {
    let updated = false
    if (status.status) {
      switch (status.status) {
        case 'paused':
          playerState.play = false
          playerState.empty &&= false
          setLyric('')
          break
        case 'error':
          playerState.play = false
          playerState.empty &&= false
          setLyric('')
          break
        case 'playing':
          playerState.play = true
          playerState.empty &&= false
          setLyric(global.rain.player_status.lyricLineText)
          break
        case 'stoped':
          playerState.play &&= false
          playerState.empty = true
          setLyric('')
          break
      }
      updated = true
    } else {
      setLyric(status.lyricLineText)
    }
    if (status.name != null) setTip()
    if (status.singer != null) setTip()
    if (updated) init()
  })
}
