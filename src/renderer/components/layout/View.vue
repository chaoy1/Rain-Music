<template>
  <div :class="$style.view">
    <router-view v-slot="{ Component }">
      <!-- <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut"> -->
      <component :is="Component" class="view-container" />
      <!-- </transition> -->
    </router-view>
  </div>
</template>

<script setup>
import { watch } from '@common/utils/vueTools'
import { useRoute } from '@common/utils/vueRouter'
import { setShowPlayerDetail } from '@renderer/store/player/action'

const route = useRoute()
// Background pages normalize filters in the query string after mounting.
// Those updates must not interrupt an immersive view or its cover transition.
watch(() => route.path, () => { setShowPlayerDetail(false) })
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

</style>
