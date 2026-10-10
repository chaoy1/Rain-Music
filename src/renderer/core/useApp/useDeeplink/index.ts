import { onBeforeUnmount } from '@common/utils/vueTools'
import { clearEnvParamsDeeplink, focusWindow, onDeeplink } from '@renderer/utils/ipc'
// 这个 composable 在 **App.vue setup() 的同步段**里被调（`useApp/index.ts:47`），
// 所以下面那条 `onDeeplink` 订阅必须走"可跳过"的降级入口（阻塞点 #8）。
import { subscribeSkippable } from '@renderer/platform/ipcFallback/subscribe'
import { CMMON_EVENT_NAME } from '@common/ipcNames'

import { useDialog } from './utils'
import useMusicAction from './useMusicAction'
import useSonglistAction from './useSonglistAction'
import usePlayerAction from './usePlayerAction'

export default () => {
  let isInited = false

  const showErrorDialog = useDialog()

  const handleMusicAction = useMusicAction()
  const handleSonglistAction = useSonglistAction()
  const handlePlayerAction = usePlayerAction()


  const handleLinkAction = async(link: string) => {
    // console.log(link)
    const [url, search] = link.split('?')
    const [type, action, ...paths] = url.replace('rainmusic://', '').split('/')
    const params: {
      paths: string[]
      data?: any
      [key: string]: any
    } = {
      paths: [],
    }
    if (search) {
      for (const param of search.split('&')) {
        const [key, value] = param.split('=')
        params[key] = value
      }
      if (params.data) params.data = JSON.parse(decodeURIComponent(params.data))
    }
    params.paths = paths.map(p => decodeURIComponent(p))
    console.log(params)
    switch (type) {
      case 'music':
        await handleMusicAction(action, params)
        break
      case 'songlist':
        await handleSonglistAction(action, params)
        break
      case 'player':
        await handlePlayerAction(action as any)
        break
      default: throw new Error('Unknown type: ' + type)
    }
  }

  // `common_deeplink` — 契约归类 (C)：Android 侧由 `@capacitor/app` 的 `appUrlOpen`
  // （+ Manifest Intent filter）换成同名广播（`ipc-contract.md` §4.3）。
  const rDeeplink = subscribeSkippable(CMMON_EVENT_NAME.deeplink, 'C', () => onDeeplink(async({ params: link }) => {
    console.log(link)
    if (!isInited) return
    clearEnvParamsDeeplink()
    try {
      await handleLinkAction(link)
    } catch (err: any) {
      showErrorDialog(err.message)
      focusWindow()
    }
  }))

  onBeforeUnmount(() => {
    rDeeplink()
  })

  return async(envParams: Rain.EnvParams) => {
    if (envParams.deeplink) {
      clearEnvParamsDeeplink()
      try {
        await handleLinkAction(envParams.deeplink)
      } catch (err: any) {
        showErrorDialog(err.message)
        focusWindow()
      }
    }
    isInited = true
  }
}
