<template>
  <div :class="[$style.toolbar, { [$style.fullscreen]: isFullscreen }]">
    <h1 :class="$style.title">{{ title }}</h1>
    <DetailDismissButton v-if="route.name === 'SongListDetail'" data-playlist-back @click="handleSongListBack" />
  </div>
</template>

<script setup>
import { isFullscreen } from '@renderer/store'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import { computed } from '@common/utils/vueTools'
import { useRoute } from '@common/utils/vueRouter'
import { useI18n } from '@root/lang'
import DetailDismissButton from '@renderer/components/common/DetailDismissButton.vue'
import useSongListBack from '@renderer/views/songList/Detail/useSongListBack'

const route = useRoute()
const t = useI18n()
const handleSongListBack = useSongListBack()
const titles = { Search: 'search', SongList: 'song_list', Leaderboard: 'leaderboard', List: 'my_list', Download: 'download', Setting: 'setting' }
const title = computed(() => t(isShowPlayerDetail.value ? 'player__detail_title' : titles[route.meta.name] || 'song_list'))

</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.toolbar {
  display: flex;
  height: @height-toolbar;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  gap: 20px;
  box-sizing: border-box;
  -webkit-app-region: drag;
  z-index: 2;
  background: var(--color-glass-bar);
  backdrop-filter: blur(40px) saturate(115%);
  border-bottom: 0;

  &.fullscreen {
    -webkit-app-region: no-drag;
  }
}

// macOS：交通灯是左上角的第一个元素，左侧不留任何其它图标
.title {
  min-width: 0;
  .mixin-ellipsis-1();
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -.4px;
}
</style>
