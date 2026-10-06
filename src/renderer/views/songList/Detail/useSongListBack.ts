import { useRouter } from '@common/utils/vueRouter'
import { setVisibleListDetail } from '@renderer/store/songList/action'

export default () => {
  const router = useRouter()
  return () => {
    setVisibleListDetail(false)
    const fromName = window.rain.songListInfo.fromName
    if (fromName && fromName !== 'SongListDetail' && router.hasRoute(fromName)) void router.replace({ name: fromName })
    else if (router.options.history.state.back) router.back()
    else void router.replace({ name: 'SongList' })
  }
}
