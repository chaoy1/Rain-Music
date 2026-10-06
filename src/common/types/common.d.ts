// import './app_setting'

declare namespace Rain {
  interface CmdParams {
    /**
     * 搜索，启动软件时自动在搜索框搜索指定的内容，例如：-search="突然的自我 - 伍佰"
     */
    search?: string

    /**
     * 禁用硬件加速启动
     */
    dha?: boolean

    /**
     * 以非透明模式启动
     */
    dt?: boolean

    /**
     * 禁用硬件媒体密钥处理
     */
    dhmkh?: boolean

    /**
     * 启动时播放指定列表的音乐
     */
    play?: string

    /**
     * 启动后最小化到系统托盘
     */
    hidden?: boolean

    [key: string]: boolean | number | string
  }

  type OnlineSource = 'kg' | 'tx' | 'wy'
  type Source = OnlineSource | 'local'
  type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | '192k' | 'ape' | 'wav'

  type QualityList = Partial<Record<Rain.Source, Rain.Quality[]>>

  interface EnvParams {
    deeplink?: string | null
    cmdParams: CmdParams
    workAreaSize?: Electron.Size
    /**
     * 桌面壁纸的本地路径。
     * macOS 风格磨砂玻璃的实现依赖它：把壁纸重度模糊后作为应用底层背景，
     * 各面板再对其做 backdrop-filter 磨砂 —— 这样玻璃观感不依赖
     * Windows 的 DWM Acrylic（该系统材质偏弱且受系统设置影响）。
     * 取不到时为 null。
     */
    wallpaper?: string | null
  }

  interface HotKey {
    name: string
    action: string
    type: keyof typeof keyName
  }

  interface HotKeyDownInfo {
    type: 'local' | 'global'
    key: string
  }

  interface HotKeyConfig {
    enable: boolean
    keys: Record<string, HotKey>
  }
  interface HotKeyConfigAll {
    local: HotKeyConfig
    global: HotKeyConfig
  }
  interface RegisterKeyInfo {
    key: string
    info: HotKey
  }
  type HotKeyState = Map<string, {
    status: boolean
    info: HotKey
  }>
  /**
   * 全局快捷键注册失败信息（导入快捷键设置后用于提示用户）
   */
  interface HotKeyRegisterFailInfo {
    /** 快捷键按键，例如 mod+alt+p */
    key: string
    /** 动作名称，例如 player_toggle_play */
    name: string
    /** 动作 id，例如 player_toggle_play */
    action: string
  }
  interface HotKeyActionWrap<T, D> {
    action: T
    data: D
    source?: string
  }
  type HotKeyActions = HotKeyActionWrap<'config', HotKeyConfigAll>
  | HotKeyActionWrap<'enable', boolean>
  | HotKeyActionWrap<'register', RegisterKeyInfo>
  | HotKeyActionWrap<'unregister', string>

  interface HotKeyEvent {
    type: string
    key: string
  }

  interface TaskBarButtonFlags {
    empty: boolean
    play: boolean
    next: boolean
    prev: boolean
  }
}
