<template>
  <div ref="dom_menu" :class="$style.menu">
    <ul :class="$style.list">
      <li v-for="item in menus" :key="item.to" :class="$style.navItem" role="presentation">
        <router-link :class="[$style.link, {[$style.active]: $route.meta.name == item.name}]" data-ui-control :aria-current="$route.meta.name == item.name ? 'page' : undefined" :to="item.to" :aria-label="item.tips" @click="setShowPlayerDetail(false)">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
            <path :d="item.path" />
          </svg>
          <span :class="$style.label">{{ item.tips }}</span>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { appSetting } from '@renderer/store/setting'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { useI18n } from '@root/lang'
import { ref, computed } from '@common/utils/vueTools'

export default {
  name: 'NavBar',
  setup() {
    const t = useI18n()
    const dom_menu = ref<HTMLElement>()

    const menus = computed(() => {
      return [
        {
          to: '/search',
          tips: t('search'),
          path: 'M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM15 15l5 5',
          name: 'Search',
          enable: true,
        },
        {
          to: '/songList/list',
          tips: t('song_list'),
          path: 'M6 3.5h13a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V5A1.5 1.5 0 0 1 6 3.5ZM1.5 7v14M11 15V8.5l5-1v6.5M11 15c0 1.1-1.1 2-2.5 2S6 16.4 6 15.5s1.1-1.5 2.5-1.5H11ZM16 14c0 1.1-1.1 2-2.5 2S11 15.4 11 14.5s1.1-1.5 2.5-1.5H16Z',
          name: 'SongList',
          enable: true,
        },
        {
          to: '/leaderboard',
          tips: t('leaderboard'),
          path: 'M4 20V12M12 20V4M20 20V8M2.5 20.5h19',
          name: 'Leaderboard',
          enable: true,
        },
        {
          to: '/list',
          tips: t('my_list'),
          path: 'M20.5 4.5H9M20.5 9H9M6 3.5v6M3 6.5h6M20.5 13.5H9M5 13.5h.01M20.5 18H9M5 18h.01',
          name: 'List',
          enable: true,
        },
        {
          to: '/download',
          tips: t('download'),
          path: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M4 16.5v3a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3',
          enable: appSetting['download.enable'],
          name: 'Download',
        },
        {
          to: '/setting',
          tips: t('setting'),
          path: 'M4 6h16M4 12h16M4 18h16M8 3.5v5M16 9.5v5M10 15.5v5',
          enable: true,
          name: 'Setting',
        },
      ].filter(m => m.enable)
    })
    return {
      appSetting,
      menus,
      setShowPlayerDetail,
      dom_menu,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.menu { flex: auto; min-height: 0; padding: 0 12px 16px; overflow: auto; }
.list { display: flex; flex-direction: column; gap: 5px; height: 100%; min-height: 280px; -webkit-app-region: no-drag; }
.navItem { flex: none; &:last-child { margin-top: auto; padding-top: 16px; } }
.link {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 11px;
  box-sizing: border-box;
  color: var(--color-font);
  text-decoration: none;
  font-size: 13px;
  transition: background-color @transition-fast, box-shadow @transition-fast, transform @transition-fast;
  -webkit-app-region: no-drag;
  svg { flex: none; opacity: .75; fill: none; }
  &:hover { color: var(--color-font); background: var(--surface-hover); }
  &:active { box-shadow: var(--control-pressed-shadow); }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
  &.active {
    background: var(--surface-selected);
    box-shadow: inset 0 1px 0 var(--glass-highlight), 0 1px 3px var(--glass-edge);
    font-weight: 500;
    svg { opacity: 1; }
  }
}
.label { .mixin-ellipsis-1(); }

</style>
