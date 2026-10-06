import type { I18n } from '../../lang/i18n'

declare global {

  declare namespace Rain {
    type AddMusicLocationType = 'top' | 'bottom'

    interface AppSetting {
      version: string

      /**
       * 窗口大小id
       */
      'common.windowSizeId': number

      /**
       * 窗口大小id
       */
      'common.fontSize': number

      /**
       * 语言id
       */
      'common.langId': I18n['locale'] | null

      /**
       * api id
       */
      'common.apiSource': string

      /**
       * 是否同意软件协议
       */
      'common.isAgreePact': boolean

      /**
       * 播放栏进度条样式
       */
      'common.playBarProgressStyle': 'mini' | 'full' | 'middle'

      /**
       * 资源缓存自动清理阈值（单位：MB）
       *
       * 0 表示关闭自动清理；启动时会检查软件资源缓存大小，
       * 超过该阈值就执行一次与「清理资源缓存」相同的清理。
       */
      'common.resourceCacheAutoCleanSize': number

      /**
       * 切歌模式
       */
      'player.togglePlayMethod': 'listLoop' | 'random' | 'list' | 'singleLoop' | 'none'

      /**
       * 优先播放的音质
       */
      'player.playQuality': Rain.Quality

      /**
       * 是否将歌词显示在状态栏
       */
      'player.isShowStatusBarLyric': boolean

      /**
       * 音量大小
       */
      'player.volume': number

      /**
       * 是否静音
       */
      'player.isMute': boolean

      /**
       * 播放速率
       */
      'player.playbackRate': number

      /**
       * 是否自动调整音频的音高以补偿对播放速率设置所做的更改
       */
      'player.preservesPitch': boolean

      /**
       * 音频输出设备id
       */
      'player.mediaDeviceId': string

      /**
       * 是否启用音频可视化
       */
      'player.audioVisualization': boolean

      /**
       * 定时暂停播放-是否等待歌曲播放完毕再暂停
       */
      'player.waitPlayEndStop': boolean

      /**
       * 定时暂停播放-倒计时时间
       */
      'player.waitPlayEndStopTime': string

      /**
       * 环境音效文件名
       */
      'player.soundEffect.convolution.fileName': string | null

      /**
       * 环境音效原始输出增益
       */
      'player.soundEffect.convolution.mainGain': number

      /**
       * 环境音效输出增益
       */
      'player.soundEffect.convolution.sendGain': number

      /**
       * 均衡器 31hz 值
       */
      'player.soundEffect.biquadFilter.hz31': number

      /**
       * 均衡器 62hz 值
       */
      'player.soundEffect.biquadFilter.hz62': number

      /**
       * 均衡器 125hz 值
       */
      'player.soundEffect.biquadFilter.hz125': number

      /**
       * 均衡器 250hz 值
       */
      'player.soundEffect.biquadFilter.hz250': number

      /**
       * 均衡器 500hz 值
       */
      'player.soundEffect.biquadFilter.hz500': number

      /**
       * 均衡器 1000hz 值
       */
      'player.soundEffect.biquadFilter.hz1000': number

      /**
       * 均衡器 2000hz 值
       */
      'player.soundEffect.biquadFilter.hz2000': number

      /**
       * 均衡器 4000hz 值
       */
      'player.soundEffect.biquadFilter.hz4000': number

      /**
       * 均衡器 8000hz 值
       */
      'player.soundEffect.biquadFilter.hz8000': number

      /**
       * 均衡器 16000hz 值
       */
      'player.soundEffect.biquadFilter.hz16000': number

      /**
       * 3D立体环绕是否启用
       */
      'player.soundEffect.panner.enable': boolean

      /**
       * 3D立体环绕声音距离
       */
      'player.soundEffect.panner.soundR': number

      /**
       * 3D立体环绕速度
       */
      'player.soundEffect.panner.speed': number

      /**
       * 升降声调
       */
      'player.soundEffect.pitchShifter.playbackRate': number

      /**
       * 播放详情页-歌词字体大小
       */
      'playDetail.style.fontSize': number


      /**
       * 是否启用桌面歌词
       */
      'desktopLyric.enable': boolean

      /**
       * 是否锁定桌面歌词
       */
      'desktopLyric.isLock': boolean

      /**
       * 是否自动刷新歌词置顶
       */
      'desktopLyric.isAlwaysOnTopLoop': boolean

      /**
       * 是否将歌词进程显示在任务栏
       */
      'desktopLyric.isShowTaskbar': boolean

      /**
       * 是否启用音频可视化
       */
      'desktopLyric.audioVisualization': boolean

      /**
       * 是否在全屏时隐藏歌词
       */
      'desktopLyric.fullscreenHide': boolean

      /**
       * 桌面歌词窗口宽度
       */
      'desktopLyric.width': number

      /**
       * 桌面歌词窗口高度
       */
      'desktopLyric.height': number

      /**
       * 桌面歌词窗口x坐标
       */
      'desktopLyric.x': number | null

      /**
       * 桌面歌词窗口y坐标
       */
      'desktopLyric.y': number | null

      /**
       * 是否允许桌面歌词窗口拖出主屏幕之外
       */
      'desktopLyric.isLockScreen': boolean

      /**
       * 是否延迟桌面歌词滚动
       */
      'desktopLyric.isDelayScroll': boolean

      /**
       * 歌词滚动位置
       */
      'desktopLyric.scrollAlign': 'top' | 'center'

      /**
       * 是否在鼠标划过桌面歌词窗口时降低歌词透明度
       */
      'desktopLyric.isHoverHide': boolean

      /**
       * 歌词方向
       */
      'desktopLyric.direction': 'horizontal' | 'vertical'

      /**
       * 歌词对齐方式
       */
      'desktopLyric.style.align': 'center' | 'left' | 'right'

      /**
       * 桌面歌词字体
       */
      'desktopLyric.style.font': string

      /**
       * 桌面歌词字体大小
       */
      'desktopLyric.style.fontSize': number

      /**
       * 歌词间距大小
       */
      'desktopLyric.style.lineGap': number

      /**
       * 桌面歌词未播放字体颜色
       */
      'desktopLyric.style.lyricUnplayColor': string

      /**
       * 桌面歌词已播放字体颜色
       */
      'desktopLyric.style.lyricPlayedColor': string

      /**
       * 桌面歌词字体阴影颜色
       */
      'desktopLyric.style.lyricShadowColor': string

      /**
       * 桌面歌词加粗字体
       */
      // 'desktopLyric.style.fontWeight': boolean

      /**
       * 桌面歌词字体透明度
       */
      'desktopLyric.style.opacity': number

      /**
       * 桌面歌词是否允许换行
       */
      'desktopLyric.style.ellipsis': boolean

      /**
       * 是否缩放当前正在播放的桌面歌词
       */
      'desktopLyric.style.isZoomActiveLrc': boolean

      /**
       * 是否加粗逐字歌词字体
       */
      'desktopLyric.style.isFontWeightFont': boolean

      /**
       * 是否加粗逐行歌词字体
       */
      'desktopLyric.style.isFontWeightLine': boolean

      /**
       * 是否加粗翻译、罗马音字体
       */
      'desktopLyric.style.isFontWeightExtended': boolean

      /**
       * 是否启用下载功能
       */
      'download.enable': boolean

      /**
       * 下载路径
       */
      'download.savePath': string

      /**
       * 主题id
       */
      'theme.id': string

      /**
       * 亮色主题id
       */
      'theme.lightId': string

      /**
       * 暗色主题id
       */
      'theme.darkId': string
    }

  }

}
