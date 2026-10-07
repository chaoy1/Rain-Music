<template>
  <div :class="$style.aside">
    <div :class="$style.windowHeader"><WindowControls /></div>
    <div :class="$style.brand"><span :class="$style.mark">Rain</span><span>Music</span></div>
    <NavBar />
  </div>
</template>

<script setup>
import WindowControls from '@renderer/platform/WindowControls.vue'
import NavBar from './NavBar.vue'

</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.aside {
  transition: @transition-normal;
  transition-property: background-color;
  -webkit-app-region: drag;
  -webkit-user-select: none;
  display: flex;
  flex-flow: column nowrap;
  box-sizing: border-box;
  background: var(--color-glass-sidebar);
  backdrop-filter: blur(48px) saturate(115%);
  border-right: 0;
  min-height: 0;
}
.windowHeader {
  display: flex;
  align-items: center;
  height: @height-toolbar;
  flex: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 22px 20px;
  font-size: 18px;
  letter-spacing: -.6px;
  color: var(--color-font);
  opacity: .75;
  flex: none;
}
.mark {
  font-weight: 600;
  letter-spacing: -1px;
}
</style>
