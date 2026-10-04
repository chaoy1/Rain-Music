import { getEnvParams, getViewPrevState, sendInited } from '@renderer/utils/ipc'

import { proxy, isFullscreen, themeId, wallpaperUrl } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

import useSync from './useSync'
import useOpenAPI from './useOpenAPI'
import useStatusbarLyric from './useStatusbarLyric'
import useDataInit from './useDataInit'
import useHandleEnvParams from './useHandleEnvParams'
import useEventListener from './useEventListener'
import useDeeplink from './useDeeplink'
import usePlayer from './usePlayer'
import useSettingSync from './useSettingSync'
import { useRouter } from '@common/utils/vueRouter'
import handleListAutoUpdate from './listAutoUpdate'

/**
 * 设置 macOS 磨砂玻璃的底层背景（重度模糊的桌面壁纸）。
 *
 * 壁纸重度模糊后作为应用最底层背景，各面板再以半透明盖在其上，
 * 形成磨砂玻璃观感 —— 这样完全不依赖 Windows 的 DWM Acrylic
 * （该材质偏弱，且受系统「透明效果」设置影响，实测很多机器上看不出效果）。
 *
 * 取不到壁纸路径时 wallpaperUrl 保持空串，App.vue 里的壁纸层不加 .show，
 * 界面回退为原来的实底样式，不会显示异常。
 */
const applyWallpaper = (wallpaper?: string | null) => {
  if (!wallpaper) return
  // 本地绝对路径 → file URL。
  // 用 encodeURI 而不是项目自带的 encodePath：后者只处理 % 和 #，
  // 项目路径含空格时无法正确加载。
  wallpaperUrl.value = `file:///${encodeURI(wallpaper.replace(/\\/g, '/'))}`
}


export default () => {
  // apiSource.value = appSetting['common.apiSource']
  proxy.enable = appSetting['network.proxy.enable']
  proxy.host = appSetting['network.proxy.host']
  proxy.port = appSetting['network.proxy.port']
  isFullscreen.value = appSetting['common.startInFullscreen']
  themeId.value = appSetting['theme.id']

  const router = useRouter()
  const initSyncService = useSync()
  const initOpenAPI = useOpenAPI()
  const initStatusbarLyric = useStatusbarLyric()
  useEventListener()
  const initPlayer = usePlayer()
  const handleEnvParams = useHandleEnvParams()
  const initData = useDataInit()
  const initDeeplink = useDeeplink()
  // const handleListAutoUpdate = useListAutoUpdate()

  useSettingSync()

  void getEnvParams().then(async(envParams) => {
    // 移除代理相关的环境变量设置，防止请求库自动应用它们
    // eslint-disable-next-line no-undef
    // const processEnv = ENVIRONMENT
    // for (const key of Object.keys(processEnv)) {
    //   // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    //   if (/^(?:http_proxy|https_proxy|NO_PROXY)$/i.test(key)) delete processEnv[key]
    // }
    applyWallpaper(envParams.wallpaper)

    const envProxy = envParams.cmdParams['proxy-server']
    if (envProxy && typeof envProxy == 'string') {
      const [host, port = ''] = envProxy.split(':')
      proxy.envProxy = {
        host,
        port,
      }
    }

    const state = await getViewPrevState()
    await router.replace({ path: '/list', query: state.url === '/list' ? state.query : {} })

    // 初始化我的列表、下载列表等数据
    void initData().then(() => {
      initPlayer()
      handleEnvParams(envParams) // 处理传入的启动参数
      void initDeeplink(envParams)
      void initSyncService()
      void initOpenAPI()
      void initStatusbarLyric()
      sendInited()

      handleListAutoUpdate()
    })
  })
}
