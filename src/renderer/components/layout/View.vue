<template>
  <div :class="$style.view">
    <router-view v-slot="{ Component, route: viewRoute }">
      <transition
        :css="playlistTransition"
        :enter-active-class="$style.enterActive" :enter-from-class="$style.enterFrom" :enter-to-class="$style.settled"
        :leave-active-class="$style.leaveActive" :leave-from-class="$style.settled" :leave-to-class="$style.leaveTo"
      >
        <component :is="Component" :key="viewRoute.path" class="view-container" />
      </transition>
    </router-view>
  </div>
</template>

<script setup>
import { ref, watch } from '@common/utils/vueTools'
import { useRoute } from '@common/utils/vueRouter'
import { setShowPlayerDetail } from '@renderer/store/player/action'

const route = useRoute()
const playlistTransition = ref(false)
// Background pages normalize filters in the query string after mounting.
// Those updates must not interrupt an immersive view or its cover transition.
watch(() => route.path, (path, previousPath) => {
  playlistTransition.value = path === '/songList/detail' || previousPath === '/songList/detail'
  setShowPlayerDetail(false)
}, { flush: 'sync' })
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.view {
  position: relative;
  z-index: 1;
  > :global(.view-container) {
    position: absolute !important;
    left: 0;
    top: 0;
    height: 100%;
    width: 100%;
  }
  // background: #fff;
  // overflow: hidden;
}

.enterActive, .leaveActive {
  z-index: 1;
  will-change: opacity;
  &[data-playlist-detail] { z-index: 2; }
}
.view > .enterActive {
  transition: opacity 160ms ease-out;
}
.view > .leaveActive {
  pointer-events: none;
  transition: none;
}
.enterFrom, .leaveTo {
  opacity: .65;
}
.settled {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .view > .enterActive, .view > .leaveActive { transition-duration: 1ms; }
  .enterFrom, .leaveTo { transform: none; }
}

</style>
