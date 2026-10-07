import { rendererSend, rendererInvoke, rendererOn, rendererOff } from '@common/rendererIpc'
import { ipcRenderer } from 'electron'
import { HOTKEY_RENDERER_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME, CMMON_EVENT_NAME } from '@common/ipcNames'
import { markRaw } from '@common/utils/vueTools'
import * as hotKeys from '@common/hotKey'
import { APP_EVENT_NAMES, DATA_KEYS, DEFAULT_SETTING, SAVE_EDITED_LYRIC } from '@common/constants'

type RemoveListener = () => void

export const getSetting = async() => {
  return rendererInvoke<Rain.AppSetting>(CMMON_EVENT_NAME.get_app_setting)
}
export const updateSetting = async(setting: Partial<Rain.AppSetting>) => {
  await rendererInvoke(CMMON_EVENT_NAME.set_app_setting, setting)
}
export const onSettingChanged = (listener: Rain.IpcRendererEventListenerParams<Partial<Rain.AppSetting>>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, listener)
  }
}

export const sendInited = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.inited)
}

export const getOtherSource = async(id: string): Promise<Rain.Music.MusicInfoOnline[]> => {
  return rendererInvoke<string, Rain.Music.MusicInfoOnline[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_other_source, id)
}
export const saveOtherSource = async(id: string, sourceInfo: Rain.Music.MusicInfoOnline[]) => {
  await rendererInvoke<Rain.Music.MusicInfoOtherSourceSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_other_source, {
    id,
    list: sourceInfo,
  })
}
export const clearOtherSource = async() => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_other_source)
}
export const getOtherSourceCount = async() => {
  return rendererInvoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.get_other_source_count)
}

// export const updateDislikeInfo = async(dislikeInfo: Rain.Dislike.ListItem[]) => {
//   await rendererInvoke<Rain.Dislike.ListItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.update_dislike_music_infos, dislikeInfo)
// }
// export const removeDislikeInfo = async(ids: string[]) => {
//   await rendererInvoke<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.remove_dislike_music_infos, ids)
// }
// export const clearDislikeInfo = async() => {
//   await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_dislike_music_infos)
// }

export const getHotKeyConfig = async() => {
  return rendererInvoke<Rain.HotKeyConfigAll>(WIN_MAIN_RENDERER_EVENT_NAME.get_hot_key)
}

export const setIgnoreMouseEvents = (ignore: boolean) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.set_ignore_mouse_events, ignore)
}

export const getEnvParams = async() => {
  return rendererInvoke<Rain.EnvParams>(CMMON_EVENT_NAME.get_env_params)
}

export const clearEnvParamsDeeplink = () => {
  rendererSend(CMMON_EVENT_NAME.clear_env_params_deeplink)
}

export const onDeeplink = (listener: Rain.IpcRendererEventListenerParams<string>): RemoveListener => {
  rendererOn(CMMON_EVENT_NAME.deeplink, listener)
  return () => {
    rendererOff(CMMON_EVENT_NAME.deeplink, listener)
  }
}


export const importUserApi = async(fileText: string) => {
  return rendererInvoke<string, Rain.UserApi.ImportUserApi>(WIN_MAIN_RENDERER_EVENT_NAME.import_user_api, fileText)
}
export const setUserApi = async(source: Rain.UserApi.UserApiSetApiParams): Promise<void> => {
  return rendererInvoke<Rain.UserApi.UserApiSetApiParams>(WIN_MAIN_RENDERER_EVENT_NAME.set_user_api, source)
}
export const removeUserApi = async(ids: string[]) => {
  return rendererInvoke<string[], Rain.UserApi.UserApiInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.remove_user_api, ids)
}
export const onShowUserApiUpdateAlert = (listener: Rain.IpcRendererEventListenerParams<Rain.UserApi.UserApiUpdateInfo>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, listener)
  }
}
export const setAllowShowUserApiUpdateAlert = async(id: string, enable: boolean): Promise<void> => {
  return rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.user_api_set_allow_update_alert, { id, enable })
}
export const onUserApiStatus = (listener: Rain.IpcRendererEventListenerParams<Rain.UserApi.UserApiStatus>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, listener)
  }
}
export const getUserApiList = async() => {
  return rendererInvoke<Rain.UserApi.UserApiInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_list)
}
export const sendUserApiRequest = async({ requestKey, data }: Rain.UserApi.UserApiRequestParams): Promise<any> => {
  return rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, {
    requestKey,
    data,
  })
}
export const userApiRequestCancel = (requestKey: Rain.UserApi.UserApiRequestCancelParams) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api_cancel, requestKey)
}

// export const setDesktopLyricInfo = (type, data, info) => {
//   rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.set_lyric_info, {
//     type,
//     data,
//     info,
//   })
// }
// export const onGetDesktopLyricInfo = callback => {
//   rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_info, callback)
//   return () => {
//     rendererOff(callback)
//   }
// }

export const sendPlayerStatus = (status: Partial<Rain.Player.Status>) => {
  rendererSend<Partial<Rain.Player.Status>>(WIN_MAIN_RENDERER_EVENT_NAME.player_status, status)
}


export const savePlayInfo = (playInfo: Rain.Player.SavedPlayInfo) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.playInfo,
    data: playInfo,
  })
}
// 获取上次关闭时的当前歌曲播放信息
export const getPlayInfo = async() => {
  return rendererInvoke<string, Rain.Player.SavedPlayInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.playInfo)
}

export const saveSearchHistoryList = (list: Rain.List.SearchHistoryList) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.searchHistoryList,
    data: list,
  })
}
// 获取搜索历史列表
export const getSearchHistoryList = async() => {
  return rendererInvoke<string, string[] | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.searchHistoryList)
}

export const saveListPositionInfo = (listPosition: Rain.List.ListPositionInfo) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.listScrollPosition,
    data: listPosition,
  })
}
// 获取搜索历史列表
export const getListPositionInfo = async() => {
  return rendererInvoke<string, Rain.List.ListPositionInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.listScrollPosition)
}

export const saveListPrevSelectId = (listPosition: string | null) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.listPrevSelectId,
    data: listPosition,
  })
}
// 获取上一次选中的列表id
export const getListPrevSelectId = async() => {
  return rendererInvoke<string, string | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.listPrevSelectId)
}

export const saveListUpdateInfo = (listPosition: Rain.List.ListUpdateInfo) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.listUpdateInfo,
    data: listPosition,
  })
}
// 获取列表更新记录
export const getListUpdateInfo = async() => {
  return rendererInvoke<string, Rain.List.ListUpdateInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.listUpdateInfo)
}

export const saveLeaderboardSetting = (source: typeof DEFAULT_SETTING['leaderboard']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.leaderboardSetting,
    data: source,
  })
}
export const getLeaderboardSetting = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['leaderboard']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.leaderboardSetting)) ?? { ...DEFAULT_SETTING.leaderboard }
}
export const saveSongListSetting = (setting: typeof DEFAULT_SETTING['songList']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.songListSetting,
    data: setting,
  })
}
export const getSongListSetting = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['songList']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.songListSetting)) ?? { ...DEFAULT_SETTING.songList }
}
export const saveSearchSetting = (setting: typeof DEFAULT_SETTING['search']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.searchSetting,
    data: setting,
  })
}
export const getSearchSetting = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['search']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.searchSetting)) ?? { ...DEFAULT_SETTING.search }
}
export const saveViewPrevState = (state: typeof DEFAULT_SETTING['viewPrevState']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.viewPrevState,
    data: state,
  })
}
export const getViewPrevState = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['viewPrevState']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.viewPrevState)) ?? { ...DEFAULT_SETTING.viewPrevState }
}


export const getSystemFonts = async() => {
  return rendererInvoke<string[]>(CMMON_EVENT_NAME.get_system_fonts).catch(() => {
    return []
  })
}

export const getUserSoundEffectEQPresetList = async() => {
  return rendererInvoke<Rain.SoundEffect.EQPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset)
}

export const saveUserSoundEffectEQPresetList = (list: Rain.SoundEffect.EQPreset[]) => {
  rendererSend<Rain.SoundEffect.EQPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_eq_preset, list)
}

export const getUserSoundEffectConvolutionPresetList = async() => {
  return rendererInvoke<Rain.SoundEffect.ConvolutionPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_convolution_preset)
}

export const saveUserSoundEffectConvolutionPresetList = (list: Rain.SoundEffect.ConvolutionPreset[]) => {
  rendererSend<Rain.SoundEffect.ConvolutionPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_convolution_preset, list)
}

// export const getUserSoundEffectPitchShifterPresetList = async() => {
//   return rendererInvoke<Rain.SoundEffect.PitchShifterPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_pitch_shifter_preset)
// }

// export const saveUserSoundEffectPitchShifterPresetList = (list: Rain.SoundEffect.PitchShifterPreset[]) => {
//   rendererSend<Rain.SoundEffect.PitchShifterPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_pitch_shifter_preset, list)
// }

// 可配置的快捷键动作已收窄为四个（见 src/common/hotKey.ts）：
// 播放/暂停、上一曲、下一曲、显示/隐藏程序
export const allHotKeys = markRaw({
  local: [
    {
      name: hotKeys.HOTKEY_PLAYER.toggle_play.name,
      action: hotKeys.HOTKEY_PLAYER.toggle_play.action,
      type: APP_EVENT_NAMES.winMainName,
    },
    {
      name: hotKeys.HOTKEY_PLAYER.prev.name,
      action: hotKeys.HOTKEY_PLAYER.prev.action,
      type: APP_EVENT_NAMES.winMainName,
    },
    {
      name: hotKeys.HOTKEY_PLAYER.next.name,
      action: hotKeys.HOTKEY_PLAYER.next.action,
      type: APP_EVENT_NAMES.winMainName,
    },
    {
      name: hotKeys.HOTKEY_COMMON.hide_toggle.name,
      action: hotKeys.HOTKEY_COMMON.hide_toggle.action,
      type: APP_EVENT_NAMES.winMainName,
    },
  ],
  global: [
    {
      name: hotKeys.HOTKEY_PLAYER.toggle_play.name,
      action: hotKeys.HOTKEY_PLAYER.toggle_play.action,
      type: APP_EVENT_NAMES.winMainName,
    },
    {
      name: hotKeys.HOTKEY_PLAYER.prev.name,
      action: hotKeys.HOTKEY_PLAYER.prev.action,
      type: APP_EVENT_NAMES.winMainName,
    },
    {
      name: hotKeys.HOTKEY_PLAYER.next.name,
      action: hotKeys.HOTKEY_PLAYER.next.action,
      type: APP_EVENT_NAMES.winMainName,
    },
    {
      name: hotKeys.HOTKEY_COMMON.hide_toggle.name,
      action: hotKeys.HOTKEY_COMMON.hide_toggle.action,
      type: APP_EVENT_NAMES.winMainName,
    },
  ],
})

export const hotKeySetEnable = async(enable: boolean) => {
  return rendererInvoke(HOTKEY_RENDERER_EVENT_NAME.enable, enable)
}

export const hotKeySetConfig = async(config: Rain.HotKeyActions) => {
  return rendererInvoke(HOTKEY_RENDERER_EVENT_NAME.set_config, config)
}

export const hotKeyGetStatus = async() => {
  return rendererInvoke<Rain.HotKeyState>(HOTKEY_RENDERER_EVENT_NAME.status)
}

/**
 * 应用快捷键配置并重新注册全局快捷键（导入设置时使用）
 * @param config 快捷键配置
 * @returns 注册失败的快捷键列表
 */
export const hotKeyApplyConfig = async(config: Rain.HotKeyConfigAll) => {
  return rendererInvoke<Rain.HotKeyConfigAll, Rain.HotKeyRegisterFailInfo[]>(HOTKEY_RENDERER_EVENT_NAME.apply_config, config)
}

// 主进程操作播放器状态
export const onPlayerAction = (listener: Rain.IpcRendererEventListenerParams<{
  action: Rain.Player.StatusButtonActions
  data?: unknown
}>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.player_action_on_button_click, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.player_action_on_button_click, listener)
  }
}
// export const setTaskbarThumbnailClip = async(clip: Electron.Rectangle) => {
//   await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.taskbar_set_thumbnail_clip, clip)
// }
// 播放器状态更新 通知主进程
export const setPlayerAction = (buttons: Rain.TaskBarButtonFlags) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.player_action_set_buttons, buttons)
}

/**
 * On Theme Change
 * @param listener Rain.IpcRendererEventListenerParams<shouldUseDarkColors: boolean>
 * @returns RemoveListener Fn
 */
export const onThemeChange = (listener: Rain.IpcRendererEventListenerParams<Rain.ThemeSetting>): RemoveListener => {
  rendererOn(CMMON_EVENT_NAME.theme_change, listener)
  return () => {
    rendererOff(CMMON_EVENT_NAME.theme_change, listener)
  }
}

/**
 * 选择路径
 */
export const showSelectDialog = async(options: Electron.OpenDialogOptions) => {
  return rendererInvoke<Electron.OpenDialogOptions, Electron.OpenDialogReturnValue>(WIN_MAIN_RENDERER_EVENT_NAME.show_select_dialog, options)
}

/**
 * 打开保存对话框
 */
export const openSaveDir = async(options: Electron.SaveDialogOptions) => {
  return rendererInvoke<Electron.SaveDialogOptions, Electron.SaveDialogReturnValue>(WIN_MAIN_RENDERER_EVENT_NAME.show_save_dialog, options)
}

/**
 * 在资源管理器中定位文件
 */
export const openDirInExplorer = async(path: string) => {
  return rendererSend<string>(WIN_MAIN_RENDERER_EVENT_NAME.open_dir_in_explorer, path)
}

/**
 * 获取缓存大小
 */
export const getCacheSize = async() => {
  return rendererInvoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.get_cache_size)
}

/**
 * 清除缓存
 */
export const clearCache = async() => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_cache)
}

/**
 * 设置窗口大小
 * @param {*} width
 * @param {*} height
 */
export const setWindowSize = (width: number, height: number) => {
  const params: Partial<Electron.Rectangle> = {
    width,
    height,
  }
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.set_window_size, params)
}


export const getPlayerLyric = async(musicInfo: Rain.Music.MusicInfo) => {
  return rendererInvoke<string, Rain.Player.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, musicInfo.id)
}

export const getLyricRaw = async(musicInfo: Rain.Music.MusicInfo): Promise<Rain.Music.LyricInfo> => {
  return rendererInvoke<string, Rain.Music.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw, musicInfo.id)
}

export const clearLyricRaw = async() => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_lyric_raw)
}

export const getLyricRawCount = async() => {
  return rendererInvoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw_count)
}


export const getLyricEdited = async(musicInfo: Rain.Music.MusicInfo): Promise<Rain.Music.LyricInfo> => {
  return rendererInvoke<string, Rain.Music.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited, musicInfo.id)
}
export const saveLyric = async(musicInfo: Rain.Music.MusicInfo, lyricInfo: Rain.Music.LyricInfo | Rain.Player.LyricInfo) => {
  // console.log(musicInfo)
  if ('rawlrcInfo' in lyricInfo) {
    const { rawlrcInfo } = lyricInfo
    // 这里原本还会在歌词与原始歌词不一致时写入「已编辑歌词」
    // （WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited）。
    // 「已调整过偏移时间的歌词管理」已停用：歌词偏移时间的调整不再持久化，
    // 该写入通道与 saveLyricEdited() 一并删除，只保存原始歌词。
    // 若日后需要恢复，判断条件为 SAVE_EDITED_LYRIC（见 src/common/constants.ts）。
    if (SAVE_EDITED_LYRIC) console.warn('SAVE_EDITED_LYRIC is enabled but the save_lyric_edited channel has been removed')
    await rendererInvoke<Rain.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, {
      id: musicInfo.id,
      lyrics: rawlrcInfo,
    })
  } else {
    await rendererInvoke<Rain.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, {
      id: musicInfo.id,
      lyrics: lyricInfo,
    })
  }
}

export const clearLyric = async() => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_lyric_raw)
}

export const clearLyricEdited = async() => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_lyric_edited)
}

export const getLyricEditedCount = async() => {
  return rendererInvoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited_count)
}


export const saveTheme = async(theme: Rain.Theme) => {
  return rendererInvoke<Rain.Theme>(WIN_MAIN_RENDERER_EVENT_NAME.save_theme, theme)
}
export const removeTheme = async(id: string) => {
  return rendererInvoke<string>(WIN_MAIN_RENDERER_EVENT_NAME.remove_theme, id)
}
export const getThemes = async() => {
  return rendererInvoke<{ themes: Rain.Theme[], userThemes: Rain.Theme[], dataPath: string, imageUrlBase?: string }>(WIN_MAIN_RENDERER_EVENT_NAME.get_themes)
}

/**
 * 主题图片的文件操作（Android 移植 · 阶段 3 / 线 C）。
 *
 * 参数一律是**主题图片目录内的相对名**（`probe_bg.png` / `temp/probe_bg.png`），
 * 唯一例外是 `importThemeImage` 的 `sourcePath` —— 用户在文件选择器里选中的外部文件路径。
 * 真实落点由主进程 `src/main/utils/themeImages.ts` 决定，渲染层不需要也不应该知道。
 *
 * 调用方：`src/renderer/platform/themeFiles.js`（不要在这些通道之上再造分支）。
 */
export const themeFileImport = async(sourcePath: string, toName: string) => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.theme_file_import, { sourcePath, toName })
}
export const themeFileCopy = async(fromName: string, toName: string) => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.theme_file_copy, { fromName, toName })
}
export const themeFileMove = async(fromName: string, toName: string) => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.theme_file_move, { fromName, toName })
}
export const themeFileRemove = async(name: string) => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.theme_file_remove, { name })
}

/**
 * 生成 music_url 缓存条目的 id。
 * 缓存条目的形状是 `<musicInfo.id>_<quality>`（例如 `tx_000Jiy0M0GoxRh_128k`、`kw_629445_128k`），
 * 读取 / 写入 / 删除都复用这一个函数，避免三处各拼一次字符串而写歪。
 * @param musicInfo 歌曲信息
 * @param type URL音质
 */
export const createMusicUrlId = (musicInfo: Rain.Music.MusicInfo, type: Rain.Quality) => `${musicInfo.id}_${type}`

/**
 * 从缓存获取歌曲URL
 * @param musicInfo 歌曲信息
 * @param type URL音质
 * @returns
 */
export const getMusicUrl = async(musicInfo: Rain.Music.MusicInfo, type: Rain.Quality): Promise<string> => {
  return rendererInvoke<string, string>(WIN_MAIN_RENDERER_EVENT_NAME.get_music_url, createMusicUrlId(musicInfo, type))
}

/**
 * 缓存歌曲URL
 * @param musicInfo 歌曲信息
 * @param type URL音质
 * @param url 歌曲URL
 */
export const saveMusicUrl = async(musicInfo: Rain.Music.MusicInfo, type: Rain.Quality, url: string) => {
  await rendererInvoke<Rain.Music.MusicUrlInfo>(WIN_MAIN_RENDERER_EVENT_NAME.save_music_url, {
    id: createMusicUrlId(musicInfo, type),
    url,
  })
}

/**
 * 删除单条缓存的歌曲URL（按 id）
 * @param musicInfo 歌曲信息
 * @param type URL音质
 */
export const removeMusicUrl = async(musicInfo: Rain.Music.MusicInfo, type: Rain.Quality) => {
  await rendererInvoke<string>(WIN_MAIN_RENDERER_EVENT_NAME.remove_music_url, createMusicUrlId(musicInfo, type))
}

/**
 * 清理所有缓存的歌曲URL
 */
export const clearMusicUrl = async() => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_music_url)
}

export const getMusicUrlCount = async() => {
  return rendererInvoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.get_music_url_count)
}

/**
 * 退出应用
 */
export const quitApp = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.quit)
}

/**
 * 关闭窗口
 */
export const closeWindow = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.close)
}

/**
 * 最小化窗口
 */
export const minWindow = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.min)
}

/**
 * 最大化窗口
 */
export const maxWindow = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.max)
}

/**
 * 最小化、最大化窗口切换
 */
export const minMaxWindowToggle = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.min_toggle)
}
/**
 * 显示、隐藏窗口切换
 */
export const showHideWindowToggle = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.hide_toggle)
}
/**
 * 聚焦窗口
 */
export const focusWindow = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.focus)
}
/**
 * 是否启用电源锁
 */
export const setPowerSaveBlocker = (enabled: boolean) => {
  rendererSend<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.set_power_save_blocker, enabled)
}

/**
 * 窗口获取焦点事件
 * @param listener
 * @returns
 */
export const onFocus = (listener: Rain.IpcRendererEventListener): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.focus, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.focus, listener)
  }
}

/**
 * 快捷键触发事件
 * @param listener
 * @returns
 */
export const onKeyDown = (listener: Rain.IpcRendererEventListenerParams<Rain.HotKeyEvent>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.key_down, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.key_down, listener)
  }
}

/**
 * 快捷键设置更新事件
 * @param listener
 * @returns
 */
export const onUpdateHotkey = (listener: Rain.IpcRendererEventListenerParams<Rain.HotKeyConfigAll>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.set_hot_key_config, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.set_hot_key_config, listener)
  }
}

/**
 * 设置全屏
 * @param isFullscreen 是否全屏
 * @returns
 */
export const setFullScreen = async(isFullscreen: boolean): Promise<boolean> => {
  return rendererInvoke<boolean, boolean>(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen, isFullscreen)
}

export const getFullScreen = async(): Promise<boolean> => {
  return rendererInvoke<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen_state)
}

export const onFullscreenChanged = (listener: (isFullscreen: boolean) => void): RemoveListener => {
  const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => { listener(isFullscreen) }
  ipcRenderer.on(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen_state, handler)
  return () => { ipcRenderer.removeListener(WIN_MAIN_RENDERER_EVENT_NAME.fullscreen_state, handler) }
}

/**
 * 打开开发者工具
 * @returns
 */
export const openDevTools = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.open_dev_tools)
}

/**
 * 桌面歌词进程创建事件
 * @param listener
 * @returns
 */
export const onNewDesktopLyricProcess = (listener: Rain.IpcRendererEventListener): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.process_new_desktop_lyric_client, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.process_new_desktop_lyric_client, listener)
  }
}


export const downloadTasksGet = async() => {
  return rendererInvoke<Rain.Download.ListItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_get)
}
export const downloadTasksCreate = async(list: Rain.Download.ListItem[], addMusicLocationType: Rain.AddMusicLocationType) => {
  return rendererInvoke<Rain.Download.saveDownloadMusicInfo>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_add, {
    list,
    addMusicLocationType,
  })
}
export const downloadTasksUpdate = async(list: Rain.Download.ListItem[]) => {
  return rendererInvoke<Rain.Download.ListItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_update, list)
}
export const downloadTasksRemove = async(ids: string[]) => {
  return rendererInvoke<string[]>(WIN_MAIN_RENDERER_EVENT_NAME.download_list_remove, ids)
}
export const downloadListClear = async() => {
  return rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.download_list_clear)
}
