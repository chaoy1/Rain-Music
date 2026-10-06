export const URL_SCHEME_RXP = /^rainmusic:\/\//

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const STORE_NAMES = {
  APP_SETTINGS: 'config_v2',
  DATA: 'data',
  HOTKEY: 'hot_key',
  USER_API: 'user_api',
  LRC_RAW: 'lyrics',
  LRC_EDITED: 'lyrics_edited',
  THEME: 'theme',
  SOUND_EFFECT: 'sound_effect',
} as const

export const APP_EVENT_NAMES = {
  winMainName: 'win_main',
  winLyricName: 'win_lyric',
  trayName: 'tray',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const

// 已删除的内置「我的收藏」列表 id。
// 运行时不再存在这个列表；该常量只用于在导入旧备份 / 旧列表文件时
// 识别并忽略其中的收藏条目（见 SettingBackup.vue、MyList/useShare.ts）。
export const LEGACY_LOVE_LIST_ID = 'love'

export const DATA_KEYS = {
  viewPrevState: 'viewPrevState',
  playInfo: 'playInfo',
  searchHistoryList: 'searchHistoryList',
  listScrollPosition: 'listScrollPosition',
  listPrevSelectId: 'listPrevSelectId',
  listUpdateInfo: 'listUpdateInfo',

  leaderboardSetting: 'leaderboardSetting',
  songListSetting: 'songListSetting',
  searchSetting: 'searchSetting',
} as const

export const DEFAULT_SETTING = {
  leaderboard: {
    source: 'tx',
    boardId: 'tx__26',
  },

  songList: {
    source: 'tx',
    // QQ音乐(tx) 的 sortList 为 推荐(-1) / 最热(3) / 最新(2)，
    // 这里固定默认「推荐」，与 tx 的 getList 判断保持一致
    sortId: '-1',
    tagId: '',
  },

  search: {
    temp_source: 'tx',
    // 「聚合搜索」已移除：搜索固定使用当前选中的单个平台。
    source: 'tx',
    type: 'music',
  },

  viewPrevState: {
    url: '/list',
    query: {},
  },
}

export const DOWNLOAD_STATUS = {
  RUN: 'run',
  WAITING: 'waiting',
  PAUSE: 'pause',
  ERROR: 'error',
  COMPLETED: 'completed',
} as const

export const QUALITYS = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const

// 资源缓存自动清理阈值（单位：MB）。
// 0 表示不自动清理；用户配置里存的是这个数值本身（common.resourceCacheAutoCleanSize）。
// 预设档位见 src/renderer/views/Setting/components/SettingOther.vue 的 resourceCacheAutoCleanSizeList。
export const RESOURCE_CACHE_AUTO_CLEAN_SIZE_OFF_MB = 0

// ── 固定行为常量 ──────────────────────────────────────────────────────
// 原先这些行为由设置项控制，设置页精简后固定在代码里，
// 用户配置里对应的键已删除（读取处全部引用这里的常量）。
export const FONT_SIZE = 16
export const PLAY_DETAIL_LYRIC_ALIGN = 'center'
// 托盘图标固定黑色字形（tray_black），见 src/main/modules/tray.ts
export const TRAY_THEME_ID = 2

// 下载：设置页精简后固定的行为
export const MAX_DOWNLOAD_NUM = 3
// 下载目录存在同名文件时跳过该任务
export const SKIP_EXIST_FILE = true
// 下载文件名格式模板（formatMusicName 按「歌名」「歌手」两个占位词替换）
export const MUSIC_FILE_NAME_FORMAT = '歌名 - 歌手'
// 下载的歌词文件编码
export const LRC_FORMAT = 'utf8' as const
// 是否在歌曲文件里嵌入罗马音歌词
export const EMBED_LYRIC_ROMA = false
// 是否把罗马音歌词写入下载的歌词文件
export const DOWNLOAD_LYRIC_ROMA = false

// 我的列表：设置页精简后固定的行为
// 「添加歌曲到我的列表」的位置
export const ADD_MUSIC_LOCATION_TYPE: Rain.AddMusicLocationType = 'top'
// 下载时按「我的列表」名创建子目录
export const SAVE_PATH_GROUP_BY_LIST_NAME = true

// 播放：设置页精简后固定的行为
// 播放歌曲时阻止电脑休眠
export const POWER_SAVE_BLOCKER = true
// 记住播放进度
export const SAVE_PLAY_TIME = true
// 点击与当前播放列表相同的列表切歌时清空已播放列表
export const AUTO_CLEAN_PLAYED_LIST = false
// 显示歌词翻译
export const SHOW_LYRIC_TRANSLATION = true
// 显示罗马音歌词
export const SHOW_LYRIC_ROMA = false
// 调换翻译与罗马音歌词的位置
export const SWAP_LYRIC_TRANSLATION_AND_ROMA = false
// 播放错误时自动切换歌曲
export const AUTO_SKIP_ON_ERROR = true
// 使用卡拉OK歌词播放
export const PLAY_RAINLRC = true
// 在任务栏显示播放进度
export const SHOW_TASK_PROGRESS = false
// 使用设备能处理的最大声道数输出音频
export const MAX_OUTPUT_CHANNEL_COUNT = true
// 音频输出设备改变时暂停播放
export const MEDIA_DEVICE_REMOVED_STOP_PLAY = true

// 桌面歌词：设置页精简后固定的行为
// 歌词窗口总是置顶
export const DESKTOP_LYRIC_ALWAYS_ON_TOP = true
// 暂停时提高歌词透明度
export const DESKTOP_LYRIC_PAUSE_HIDE = true
// 主窗口使用软件内置的圆角及阴影
// （即原来的 common.transparentWindow —— 开启时不使用系统原生窗口样式）
export const TRANSPARENT_WINDOW = true

// 其他：设置页精简后停用的能力
// 是否记录（持久化）歌词偏移时间的调整。
// 「已调整过偏移时间的歌词管理」分区与底层能力已停用：
// 固定为 false 后，歌词偏移在同一播放会话内仍然可调，但不再写入数据库，
// 重启软件后回到歌词自带的 [offset:] 值。
export const SAVE_EDITED_LYRIC = false

// ── 默认主题 ──────────────────────────────────────────────────────────
// 默认跟随系统：浅色用黑白 mono，深色用黑白 mono_dark。
// 主题定义见 src/common/theme/createThemes.js（改动后需执行 npm run build:theme）。
export const DEFAULT_THEME_ID = 'auto'
export const THEME_LIGHT_ID = 'mono'
export const THEME_DARK_ID = 'mono_dark'
// 历史默认主题，仅用于迁移时判断「用户是否还停留在旧默认值」
export const LEGACY_DEFAULT_THEME_ID = 'green'
export const LEGACY_DEFAULT_DARK_THEME_ID = 'black'
