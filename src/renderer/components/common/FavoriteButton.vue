<template>
  <button
    type="button" :class="[$style.btn, { [$style.active]: isFavorite }]"
    data-favorite-btn data-song-favorite :aria-label="buttonTitle" :aria-pressed="isFavorite"
    :disabled="!musicInfoId" @click="handleClick"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        v-if="isFavorite"
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
      />
      <path
        v-else
        d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"
      />
    </svg>
  </button>
  <common-list-add-modal
    v-model:show="isShowListAdd" :music-info="currentMusicInfo" :exclude-list-id="excludeListIds"
    teleport="#root" @select="handleSelectList"
  />
</template>

<script>
import { computed, ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { playMusicInfo } from '@renderer/store/player/state'
import { userLists } from '@renderer/store/list/state'
import { getMusicExistListIds } from '@renderer/store/list/action'
import { useI18n } from '@renderer/plugins/i18n'
import { LIST_IDS } from '@common/constants'

export default {
  name: 'FavoriteButton',
  setup() {
    const t = useI18n()
    const isShowListAdd = ref(false)
    const isFavorite = ref(false)
    const currentMusicInfo = computed(() => {
      const music = playMusicInfo.musicInfo
      if (!music) return null
      return 'progress' in music ? music.metadata.musicInfo : music
    })
    const musicInfoId = computed(() => currentMusicInfo.value?.id ?? '')
    const excludeListIds = [LIST_IDS.DEFAULT]
    const userListIds = computed(() => userLists.map(list => list.id))
    let checkId = 0
    const refreshFavoriteState = async() => {
      const revision = ++checkId
      const id = musicInfoId.value
      isFavorite.value = false
      if (!id) return
      try {
        const ids = await getMusicExistListIds(id)
        if (revision == checkId) isFavorite.value = ids.some(listId => userListIds.value.includes(listId))
      } catch {
        if (revision == checkId) isFavorite.value = false
      }
    }
    watch([musicInfoId, userListIds], () => { void refreshFavoriteState() }, { immediate: true })
    watch(musicInfoId, () => { isShowListAdd.value = false })
    const handleMyListUpdate = () => { void refreshFavoriteState() }
    window.app_event.on('myListUpdate', handleMyListUpdate)
    onBeforeUnmount(() => {
      ++checkId
      window.app_event.off('myListUpdate', handleMyListUpdate)
    })
    const buttonTitle = computed(() => musicInfoId.value ? t('favorite__btn_title_no_list') : t('player__detail_empty_title'))
    const handleClick = () => { if (musicInfoId.value) isShowListAdd.value = true }
    const handleSelectList = () => { void refreshFavoriteState() }
    return { isShowListAdd, isFavorite, currentMusicInfo, musicInfoId, excludeListIds, buttonTitle, handleClick, handleSelectList }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  opacity: .75;
  transition: @transition-fast;
  transition-property: color, opacity;

  &[data-favorite-btn] svg {
    display: block;
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  &:hover:not([disabled]) {
    opacity: 1;
  }
  &:disabled {
    opacity: .25;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid var(--control-outline);
    outline-offset: 1px;
  }
}

.active {
  opacity: 1;
  color: #df6370;
  &[data-favorite-btn] svg { fill: #df6370; }
}
</style>
