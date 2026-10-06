<template>
  <div id="wallpaper-layer" :class="{ show: wallpaperUrl }" :style="wallpaperUrl ? { backgroundImage: `url(&quot;${wallpaperUrl}&quot;)` } : undefined" />
  <div id="container" class="view-container">
    <div id="app-chrome" :class="{ 'detail-settled': detailSettled }" :inert="detailPresent ? '' : undefined" :aria-hidden="detailPresent ? 'true' : undefined">
      <layout-aside id="left" data-glass />
      <div id="right">
        <layout-toolbar id="toolbar" data-glass />
        <layout-view id="view" data-glass />
        <layout-play-bar id="player" data-glass />
      </div>
    </div>
    <Transition :css="false" v-bind="detailTransition">
      <PlayDetail v-if="isShowPlayerDetail" />
    </Transition>
    <layout-icons />
  </div>
</template>

<script setup>
import { onMounted } from '@common/utils/vueTools'
// import BubbleCursor from '@common/utils/effects/cursor-effects/bubbleCursor'
// import '@common/utils/effects/snow.min'
import useApp from '@renderer/core/useApp'
import { wallpaperUrl } from '@renderer/store'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import usePlayerDetailTransition from '@renderer/utils/compositions/usePlayerDetailTransition'
import PlayDetail from '@renderer/components/layout/PlayDetail/index.vue'

useApp()
const { detailPresent, detailSettled, detailTransition } = usePlayerDetailTransition()

onMounted(() => {
  document.getElementById('root').style.display = 'block'

  // const styles = getComputedStyle(document.documentElement)
  // window.rainData.bubbleCursor = new BubbleCursor({
  //   fillStyle: styles.getPropertyValue('--color-primary-alpha-900'),
  //   strokeStyle: styles.getPropertyValue('--color-primary-alpha-700'),
  // })
})

// onBeforeUnmount(() => {
//   window.rainData.bubbleCursor?.destroy()
// })

</script>


<style lang="less">
@import './assets/styles/index.less';
@import './assets/styles/layout.less';
@import './assets/styles/surfaces.less';
@import './assets/styles/controls.less';
html, body { height: 100%; box-sizing: border-box; overflow: hidden; }
body { user-select: none; }
#root {
  height: 100%;
  position: relative;
  overflow: hidden;
  color: var(--color-font);
  box-sizing: border-box;
  background-color: var(--color-material-base, var(--color-app-background));
  background-image: var(--background-image), radial-gradient(ellipse at 5% 10%, var(--glass-ambient), transparent 65%), radial-gradient(ellipse at 90% 95%, var(--glass-warm), transparent 60%);
  background-position: var(--background-image-position);
  background-repeat: no-repeat;
  background-size: var(--background-image-size);
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    box-shadow: inset 0 0 0 1px var(--glass-edge), inset 0 1px 0 var(--glass-highlight);
  }
}
.disableAnimation *, .disableAnimation *::before, .disableAnimation *::after { transition: none !important; animation: none !important; }
.transparent { padding: 0; #root { box-shadow: none; border-radius: 0; } }
#wallpaper-layer {
  position: absolute;
  inset: -36px;
  z-index: 0;
  pointer-events: none;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  filter: blur(64px) saturate(45%);
  opacity: 0;
  transition: opacity @transition-normal;
  &.show { opacity: var(--wallpaper-opacity, .28); }
}
#container {
  position: relative; display: flex; height: 100%;
  // One continuous chrome layer also fills the cut-outs of the content corners.
  background: var(--color-glass-sidebar);
  backdrop-filter: blur(48px) saturate(115%);
}
#left { flex: none; width: @width-app-left; background: transparent; backdrop-filter: none; }
#app-chrome { display: flex; width: 100%; height: 100%; min-width: 0; }
#app-chrome.detail-settled { visibility: hidden; }
#right { flex: auto; min-width: 0; display: flex; flex-flow: column nowrap; background: transparent; }
#toolbar, #player { flex: none; }
#toolbar { background: transparent; backdrop-filter: none; }
#player {
  background: transparent;
  backdrop-filter: none;
  border-top: 0;
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
#view {
  position: relative; flex: auto; min-height: 0;
  background-color: var(--color-main-background);
  backdrop-filter: blur(40px) saturate(110%);
  margin-right: 10px;
  border-radius: 18px;
  overflow: hidden;
  clip-path: inset(0 round 18px);
  box-shadow: inset 0 0 0 1px var(--glass-highlight);
}
.view-container { transition: opacity @transition-fast; }
#root.show-modal > .view-container, #view.show-modal > .view-container { opacity: .9; }
#root.show-modal > #container { background-color: var(--color-app-background); }
#view.show-modal > .view-container { opacity: .2; }
@media (max-width: 880px) { #left { width: 156px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }

</style>

