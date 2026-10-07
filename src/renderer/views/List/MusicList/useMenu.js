import { computed, ref, shallowReactive, reactive, nextTick } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { hasDislike } from '@renderer/core/dislikeList'

export default ({
  assertApiSupport,
  emit,

  handleShowDownloadModal,
  handlePlayMusic,
  handlePlayMusicLater,
  handleShowMusicAddModal,
  handleDislikeMusic,
  handleRemoveMusic,
}) => {
  const itemMenuControl = reactive({
    play: true,
    playLater: true,
    addTo: true,
    download: true,
    dislike: true,
    remove: true,
  })
  const t = useI18n()
  const menuLocation = shallowReactive({ x: 0, y: 0 })
  const isShowItemMenu = ref(false)

  const menus = computed(() => {
    return [
      {
        name: t('list__play'),
        action: 'play',
        disabled: !itemMenuControl.play,
      },
      {
        name: t('list__download'),
        action: 'download',
        disabled: !itemMenuControl.download,
      },
      {
        name: t('list__play_later'),
        action: 'playLater',
        disabled: !itemMenuControl.playLater,
      },
      {
        name: t('list__add_to'),
        action: 'addTo',
        disabled: !itemMenuControl.addTo,
      },
      {
        name: t('list__dislike'),
        action: 'dislike',
        disabled: !itemMenuControl.dislike,
      },
      {
        name: t('list__remove'),
        action: 'remove',
        disabled: !itemMenuControl.remove,
      },
    ]
  })

  const showMenu = (event, musicInfo) => {
    // itemMenuControl.play =
    //   itemMenuControl.playLater =
    itemMenuControl.download = assertApiSupport(musicInfo.source) && musicInfo.source != 'local'

    itemMenuControl.dislike = !hasDislike(musicInfo)

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowItemMenu.value) return

    emit('show-menu')
    nextTick(() => {
      isShowItemMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowItemMenu.value = false
  }

  const menuClick = (action, index) => {
    // console.log(action)
    hideMenu()
    if (!action) return
    switch (action.action) {
      case 'play':
        handlePlayMusic(index)
        break
      case 'playLater':
        handlePlayMusicLater(index)
        break
      case 'addTo':
        handleShowMusicAddModal(index)
        break
      case 'download':
        handleShowDownloadModal(index)
        break
      case 'dislike':
        handleDislikeMusic(index)
        break
      case 'remove':
        handleRemoveMusic(index)
        break
    }
  }

  return {
    menus,
    menuLocation,
    isShowItemMenu,
    showMenu,
    menuClick,
  }
}
