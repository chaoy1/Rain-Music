import { Tray, Menu, nativeTheme } from 'electron'
import { isMac, isWin } from '@common/utils'
import path from 'node:path'
import { buildTrayImage } from './trayImage'
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

const getTrayImage = () => buildTrayImage(
  path.join(global.staticPath, 'images/tray'),
  isWin && nativeTheme.shouldUseDarkColorsForSystemIntegratedUI,
  isWin,
)

export const createTray = () => {
  if (tray && !tray.isDestroyed()) return

  const image = getTrayImage()
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
