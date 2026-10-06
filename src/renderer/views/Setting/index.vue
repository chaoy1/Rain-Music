<template>
  <div :class="$style.main">
    <nav data-settings-directory ignore-tip :class="$style.toc" :aria-label="$t('setting__directory')">
      <button
        v-for="item in tocList" :key="item.id" type="button" :data-settings-nav="item.id"
        :class="[$style.tocItem, { [$style.active]: activeSection == item.id }]"
        :aria-current="activeSection == item.id ? 'true' : undefined"
        :aria-controls="item.id" @click="scrollToSection(item.id)"
      >{{ item.title }}</button>
    </nav>
    <div ref="contentRef" class="scroll" data-settings-scroll :class="$style.setting" @scroll.passive="handleScroll">
      <section v-for="item in tocList" :id="item.id" :key="item.id" :data-settings-section="item.id" :aria-label="item.title" ignore-tip :class="$style.section">
        <dl><component :is="item.id" /></dl>
      </section>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch, nextTick } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { useRoute } from '@common/utils/vueRouter'
import SettingBasic from './components/SettingBasic.vue'
import SettingPlay from './components/SettingPlay.vue'
import SettingDesktopLyric from './components/SettingDesktopLyric.vue'
import SettingDownload from './components/SettingDownload.vue'
import SettingHotKey from './components/SettingHotKey.vue'
import SettingBackup from './components/SettingBackup.vue'
import SettingOther from './components/SettingOther.vue'

export default {
  name: 'Setting',
  components: { SettingBasic, SettingPlay, SettingDesktopLyric, SettingDownload, SettingHotKey, SettingBackup, SettingOther },
  setup() {
    const t = useI18n()
    const route = useRoute()
    const contentRef = ref(null)
    const activeSection = ref('SettingBasic')
    const tocList = computed(() => [
      { id: 'SettingBasic', title: t('setting__basic') },
      { id: 'SettingPlay', title: t('setting__play') },
      { id: 'SettingDesktopLyric', title: t('setting__desktop_lyric') },
      { id: 'SettingDownload', title: t('setting__download') },
      { id: 'SettingHotKey', title: t('setting__hot_key') },
      { id: 'SettingBackup', title: t('setting__backup') },
      { id: 'SettingOther', title: t('setting__maintenance') },
    ])
    const handleScroll = () => {
      const content = contentRef.value
      if (!content) return
      if (content.scrollTop + content.clientHeight >= content.scrollHeight - 2) {
        activeSection.value = tocList.value[tocList.value.length - 1].id
        return
      }
      const top = content.getBoundingClientRect().top + 64
      let current = tocList.value[0].id
      for (const section of content.querySelectorAll('[data-settings-section]')) {
        if (section.getBoundingClientRect().top > top) break
        current = section.id
      }
      activeSection.value = current
    }
    const scrollToSection = (id, animate = true) => {
      const content = contentRef.value
      const section = content?.querySelector(`[data-settings-section="${id}"]`)
      if (!section) return
      const top = section.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - 20
      content.scrollTo({ top: Math.max(0, top), behavior: animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' })
    }
    const restoreRouteSection = () => {
      if (tocList.value.some(item => item.id == route.query.name)) {
        void nextTick(() => { scrollToSection(route.query.name, false) })
      }
    }
    onMounted(restoreRouteSection)
    watch(() => route.query.name, restoreRouteSection)
    return { tocList, contentRef, activeSection, handleScroll, scrollToSection }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.main { display: flex; height: 100%; min-height: 0; }
.toc { flex: 0 0 138px; padding: 20px 10px; box-sizing: border-box; border-right: 1px solid var(--glass-edge); }
.tocItem {
  display: block; width: 100%; padding: 9px 10px; margin-bottom: 4px;
  border: 0; border-radius: 8px; background: transparent; color: var(--color-font);
  text-align: left; font-family: inherit; font-size: 12px; line-height: 1.5; cursor: pointer;
  transition: background-color 120ms ease;
  &:hover { background: var(--surface-hover); }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
  &.active { background: var(--surface-selected); }
}
.setting {
  --control-radius: 8px;
  --control-raised-shadow: none;
  --control-pressed-shadow: none;
  flex: 1; min-width: 0; padding: 20px 28px 36px; overflow-y: auto;
  overscroll-behavior: contain; box-sizing: border-box; font-size: 13px; position: relative;
  :global {
    button[data-round-control] {
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid var(--glass-edge);
      background: var(--surface-hover);
      background-image: none;
      box-shadow: none;
      font-weight: 400;
      line-height: 1.4;
    }
    dl { margin: 0; }
    dt { margin: 0 0 18px; font-size: 16px; font-weight: 500; }
    dd { margin: 0; padding: 14px 0; border-bottom: 1px solid var(--glass-edge); }
    dd:last-of-type { border-bottom: 0; }
    h3 { font-size: 12px; margin: 0 0 10px; font-weight: 500; }
    dd > h3:not(:first-child) { margin-top: 16px; }
    .p { padding: 4px 0; line-height: 1.6; }
    .p .btn + .btn { margin-left: 10px; }
    .help-btn { padding: 0; margin: 0 .4em; border: 0; background: none; color: var(--color-button-font); cursor: pointer; }
    .help-icon { margin: 0 .4em; }
    .settings-fields { display: flex; flex-wrap: wrap; gap: 16px 24px; }
    .settings-field { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .settings-field h3 { margin: 0; }
    .settings-select {
      min-width: 100px; max-width: 100%; height: 32px; padding: 0 26px 0 10px;
      border: 1px solid var(--glass-edge); border-radius: 7px; font: inherit;
      color: var(--control-ink); background: var(--surface-hover); cursor: pointer;
      &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
      &:disabled { opacity: .5; cursor: default; }
      option { color: var(--color-font); background: var(--color-app-background); }
    }
    .settings-more {
      margin-top: 12px;
      summary { width: fit-content; padding: 5px 0; color: var(--color-font); opacity: .8; cursor: pointer; font-size: 12px; }
      summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; border-radius: 3px; }
      &[open] > summary { margin-bottom: 10px; }
    }
  }
}
.section {
  max-width: 780px; margin: 0 auto 28px; padding: 20px 24px 8px;
  border: 1px solid var(--glass-edge); border-radius: 14px; background: var(--surface-hover);
  &:last-child { margin-bottom: 0; }
}
@media (max-width: 950px) {
  .toc { flex-basis: 122px; padding: 16px 8px; }
  .setting { padding: 16px 18px 28px; }
  .section { padding: 18px 18px 8px; margin-bottom: 20px; }
}
</style>
