/* eslint-disable no-var */
// import { Event as WinMainEvent } from '@main/modules/winMain/event'
// import { Event as WinLyricEvent } from '@main/modules/winLyric/event'
import { type DislikeType, type AppType, type ListType } from '@main/event'
import { type DBSeriveTypes } from '@main/worker/utils'

interface Rain {
  inited: boolean
  appSetting: Rain.AppSetting
  hotKey: {
    enable: boolean
    config: Rain.HotKeyConfigAll
    state: Rain.HotKeyState
  }
  /**
   * 是否跳过托盘退出
   */
  isSkipTrayQuit: boolean
  /**
   * main window 是否关闭
   */
  // mainWindowClosed: boolean
  event_app: AppType
  event_list: ListType
  event_dislike: DislikeType
  worker: {
    dbService: DBSeriveTypes
  }
  theme: Rain.ThemeSetting
  player_status: Rain.Player.Status
}

declare global {
  // declare module NodeJS {
  //   export interface Global {
  //     rain: {
  //       app_event: {
  //         winMain: WinMainEvent
  //         winLyric: WinLyricEvent
  //       }
  //     }
  //   }
  // }

  // var isDev: boolean
  var envParams: Rain.EnvParams
  var staticPath: string
  var rainDataPath: string
  var rainOldDataPath: string
  var rain: Rain
  var appWorder: AppWorder
}


