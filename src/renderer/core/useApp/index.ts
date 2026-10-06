import { getEnvParams, getViewPrevState, sendInited } from '@renderer/utils/ipc'

import { themeId, wallpaperUrl } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

import useStatusbarLyric from './useStatusbarLyric'
import useDataInit from './useDataInit'
import useHandleEnvParams from './useHandleEnvParams'
import useEventListener from './useEventListener'
import useDeeplink from './useDeeplink'
import usePlayer from './usePlayer'
import useSettingSync from './useSettingSync'
import { useRouter } from '@common/utils/vueRouter'
import { LEGACY_LOVE_LIST_ID } from '@common/constants'
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
  // common.startInFullscreen 设置项已移除，行为固定为「不以此启动」
  themeId.value = appSetting['theme.id']

  const router = useRouter()
  const initStatusbarLyric = useStatusbarLyric()
  useEventListener()
  const initPlayer = usePlayer()
  const handleEnvParams = useHandleEnvParams()
  const initData = useDataInit()
  const initDeeplink = useDeeplink()
  // const handleListAutoUpdate = useListAutoUpdate()

  useSettingSync()

  void getEnvParams().then(async(envParams) => {
    applyWallpaper(envParams.wallpaper)

    const state = await getViewPrevState()
    // 内置「我的收藏」列表已删除：老配置里记录的列表页选中项不再有效，
    // 此时不带上 query，让列表页回落到「试听列表」（见 utils/data.ts 的 getListPrevSelectId）
    const isRemovedLoveList = (state.query as { id?: string }).id === LEGACY_LOVE_LIST_ID
    await router.replace({ path: '/list', query: state.url === '/list' && !isRemovedLoveList ? state.query : {} })

    // 初始化我的列表、下载列表等数据
    void initData().then(() => {
      initPlayer()
      handleEnvParams(envParams) // 处理传入的启动参数
      void initDeeplink(envParams)
      void initStatusbarLyric()
      sendInited()

      handleListAutoUpdate()
    })
  })
}
