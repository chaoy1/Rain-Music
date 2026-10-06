<template lang="pug">
dt#basic {{ $t('setting__basic') }}
//- 原先这一节的「显示动画效果 / 弹出层随机动画 / 全屏模式启动 / 关闭窗口最小化 / 定时关闭」
//- 控件已全部移除，对应行为固定在代码里（见 src/common/constants.ts 与各处注释）。
dd
  h3#basic_theme {{ $t('setting__basic_theme') }}
  div
    ul#settings-themes(:class="$style.theme")
      li(v-for="theme in themeList" :key="theme.id" :aria-label="theme.name" :style="theme.styles" :class="[$style.themeItem, {[$style.active]: themeId == theme.id}]" @click="toggleTheme(theme)" @contextmenu="handleEditTheme(theme)")
        div(:class="$style.bg")
        span(:class="$style.label") {{ theme.name }}
      li(v-if="showAllTheme || themeId == 'auto'" :aria-label="$t('theme_auto_tip')" :style="autoTheme" :class="[$style.themeItem, $style.auto, {[$style.active]: themeId == 'auto'}]" @click="handleSetThemeAuto" @contextmenu="isShowThemeSelectorModal = true")
        div(:class="$style.bg")
          div(:class="$style.bgContent")
            div(:class="$style.light")
            div(:class="$style.dark")
        span(:class="$style.label") {{ $t('theme_auto') }}
      li(v-if="showAllTheme" :aria-label="$t('theme_add')" :class="[$style.themeItem, $style.add]" @click="handleEditTheme()")
        div(:class="$style.bg")
          div(:class="$style.bgContent")
            svg-icon(:class="$style.icon" name="plus")
        span(:class="$style.label") {{ $t('theme_add') }}
    base-btn(:class="$style.themeToggle" data-theme-toggle :aria-expanded="showAllTheme" aria-controls="settings-themes" @click="showAllTheme = !showAllTheme")
      | {{ $t(showAllTheme ? 'theme_more_btn_hide' : 'theme_more_btn_show') }}
      span(aria-hidden="true") {{ showAllTheme ? '−' : '+' }}

dd
  h3#basic_source {{ $t('setting__basic_source') }}
  div
    .gap-top(v-for="item in apiSources" :key="item.id")
      base-checkbox(
        :id="`setting_api_source_${item.id}`" name="setting_api_source"
        need :model-value="appSetting['common.apiSource']" :disabled="item.disabled" :value="item.id" :aria-label="item.label" @update:model-value="updateSetting({'common.apiSource': $event})")
        span(:class="$style.sourceLabel")
          | {{ item.name }}
          span(v-if="item.desc" :class="$style.desc") {{ item.desc }}
          span(v-if="item.statusLabel" :class="$style.status") {{ item.statusLabel }}
    .p.gap-top
      base-btn.btn(min @click="isShowUserApiModal = true") {{ $t('setting__basic_source_user_api_btn') }}

dd
  .settings-fields
    .settings-field
      label(for="setting_window_size") {{ $t('setting__basic_window_size') }}
      select#setting_window_size.settings-select(:value="appSetting['common.windowSizeId']" :disabled="isFullscreen" @change="updateSetting({'common.windowSizeId': Number($event.target.value)})")
        option(v-for="item in windowSizeList" :key="item.id" :value="item.id") {{ $t('setting__basic_window_size_' + item.name) }}
    .settings-field
      label(for="setting_font_size") {{ $t('setting__basic_font_size') }}
      select#setting_font_size.settings-select(:value="appSetting['common.fontSize']" :disabled="isFullscreen" @change="updateSetting({'common.fontSize': Number($event.target.value)})")
        option(v-for="item in fontSizeList" :key="item.id" :value="item.id") {{ item.label }}
    .settings-field
      label(for="setting_language") {{ $t('setting__basic_lang') }}
      select#setting_language.settings-select(:value="appSetting['common.langId']" @change="updateSetting({'common.langId': $event.target.value})")
        option(v-for="item in langList" :key="item.locale" :value="item.locale") {{ item.name }}

//- 「字体」分区与「控制按钮位置」分区已整体删除：
//- common.font 固定使用主题默认字体，common.controlBtnPosition 固定为 'left'。
ThemeSelectorModal(v-model="isShowThemeSelectorModal")
ThemeEditModal(v-model="isShowThemeEditModal" :theme-id="editThemeId" @submit="handleRefreshTheme")
user-api-modal(v-model="isShowUserApiModal")
</template>

<script>
import { computed, ref, watch, reactive, shallowReactive } from '@common/utils/vueTools'
import { userApi, isFullscreen, themeId, windowSizeList } from '@renderer/store'
import { langList, useI18n } from '@root/lang'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { dialog } from '@renderer/plugins/Dialog'

import ThemeSelectorModal from './ThemeSelectorModal.vue'
import ThemeEditModal from './ThemeEditModal/index.vue'
import UserApiModal from './UserApiModal.vue'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { getThemes, applyTheme, findTheme, buildBgUrl } from '@renderer/store/utils'

export default {
  name: 'SettingBasic',
  components: {
    ThemeSelectorModal,
    ThemeEditModal,
    UserApiModal,
  },
  setup() {
    const t = useI18n()

    const showAllTheme = ref(false)
    const defaultThemesRaw = shallowReactive([])
    const defaultThemes = computed(() => {
      return defaultThemesRaw.map(theme => ({ ...theme, isDefault: true, name: t('theme_' + theme.id) }))
    })
    const userThemes = shallowReactive([])
    const allThemes = computed(() => {
      return [...defaultThemes.value, ...userThemes]
    })
    const themeList = computed(() => {
      if (!allThemes.value.length) return []
      return showAllTheme.value
        ? allThemes.value
        : themeId.value == 'auto'
          ? []
          : [allThemes.value.find(t => t.id == themeId.value) ?? allThemes.value[0]]
    })
    const autoTheme = reactive({})
    const updateAutoTheme = (info) => {
      let light = findTheme(info, appSetting['theme.lightId'])
      light ??= info.themes.find(theme => theme.id == 'green')
      let dark = findTheme(info, appSetting['theme.darkId'])
      dark ??= info.themes.find(theme => theme.id == 'black')
      autoTheme['--color-primary-theme-light'] = light.config.themeColors['--color-theme']
      autoTheme['--background-image-theme-light'] = light.isCustom
        ? light.config.extInfo['--background-image'] == 'none'
          ? 'none'
          : buildBgUrl(light.config.extInfo['--background-image'], info.dataPath)
        : light.config.extInfo['--background-image']
      autoTheme['--color-primary-theme-dark'] = dark.config.themeColors['--color-theme']
      autoTheme['--background-image-theme-dark'] = dark.isCustom
        ? dark.config.extInfo['--background-image'] == 'none'
          ? 'none'
          : buildBgUrl(dark.config.extInfo['--background-image'], info.dataPath)
        : dark.config.extInfo['--background-image']
    }

    let dataPath = ''
    const init = () => {
      getThemes((info) => {
        // console.log(info)
        dataPath = info.dataPath
        defaultThemesRaw.splice(0, defaultThemesRaw.length, ...info.themes.map(t => {
          return {
            id: t.id,
            styles: {
              '--color-primary-theme': t.config.themeColors['--color-theme'],
              '--background-image-theme': t.id == 'mono'
                ? 'linear-gradient(145deg, #f4f4f5, #c4c4c7)'
                : t.id == 'mono_dark'
                  ? 'linear-gradient(145deg, #4a4a4e, #1c1c1e)'
                  : t.config.extInfo['--background-image'],
            },
          }
        }))
        userThemes.splice(0, userThemes.length, ...info.userThemes.map(t => {
          return {
            id: t.id,
            name: t.name,
            styles: {
              '--color-primary-theme': t.config.themeColors['--color-theme'],
              '--background-image-theme': t.config.extInfo['--background-image'] == 'none'
                ? 'none'
                : buildBgUrl(t.config.extInfo['--background-image'], info.dataPath),
            },
          }
        }))
        updateAutoTheme(info)
      })
    }
    const editThemeId = ref('')
    const handleEditTheme = (theme) => {
      // console.log(theme)
      if (theme?.isDefault) return
      if (!theme && userThemes.length >= 10) {
        void dialog({
          message: t('theme_max_tip'),
          confirmButtonText: t('alert_button_text'),
        })
        return
      }
      editThemeId.value = theme ? theme.id : ''
      isShowThemeEditModal.value = true
    }
    const handleRefreshTheme = () => {
      init()
    }
    init()
    const toggleTheme = (theme) => {
      if (themeId.value == theme.id) return
      themeId.value = theme.id
      applyTheme(theme.id, appSetting['theme.lightId'], appSetting['theme.darkId'], dataPath)
      updateSetting({ 'theme.id': theme.id })
    }

    watch(() => [appSetting['theme.lightId'], appSetting['theme.darkId']], () => {
      getThemes(updateAutoTheme)
    })
    const isShowThemeSelectorModal = ref(false)
    const handleSetThemeAuto = () => {
      if (themeId.value == 'auto') return
      if (window.localStorage.getItem('theme-auto-tip') != 'true') {
        window.localStorage.setItem('theme-auto-tip', 'true')
        void dialog({
          message: t('setting__basic_theme_auto_tip'),
          confirmButtonText: t('ok'),
        })
      }
      toggleTheme({ id: 'auto' })
    }
    const isShowThemeEditModal = ref(false)

    const isShowUserApiModal = ref(false)
    const getApiStatus = () => {
      let status
      if (userApi.status) status = t('setting__basic_source_status_success')
      else if (userApi.message == 'initing') status = t('setting__basic_source_status_initing')
      else status = `${t('setting__basic_source_status_failed')}`

      return status
    }
    const apiSources = computed(() => {
      return [
        ...apiSourceInfo.map(api => ({
          id: api.id,
          name: api.name,
          label: api.name,
          disabled: api.disabled,
        })),
        ...userApi.list.map(api => ({
          id: api.id,
          name: api.name,
          label: `${api.name}${api.id == appSetting['common.apiSource'] ? `[${getApiStatus()}]` : ''}`,
          desc: [/^\d/.test(api.version) ? `v${api.version}` : api.version].filter(Boolean).join(', '),
          statusLabel: api.id == appSetting['common.apiSource'] ? `[${getApiStatus()}]` : '',
          status: api.status,
          message: api.message,
          disabled: false,
        })),
      ]
    })

    // common.controlBtnPosition 设置项已移除，控件与分区一并删除，行为固定为 'left'。
    // common.font 分区已删除，字体固定使用主题默认字体。

    const fontSizeList = computed(() => {
      // 只保留中文标签为「小」「标准」「大」的三档
      return [
        { id: 15, label: t('setting__basic_font_size_15px') },
        { id: 16, label: t('setting__basic_font_size_16px') },
        { id: 17, label: t('setting__basic_font_size_17px') },
      ]
    })


    return {
      appSetting,
      updateSetting,
      userThemes,
      autoTheme,
      showAllTheme,
      themeList,
      // currentStting,
      // themes,
      // themeClassName,
      isShowThemeSelectorModal,
      isShowThemeEditModal,
      handleSetThemeAuto,
      apiSources,
      isShowUserApiModal,
      windowSizeList,
      langList,
      isFullscreen,
      toggleTheme,
      themeId,
      handleRefreshTheme,
      editThemeId,
      handleEditTheme,
      fontSizeList,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.theme {
  display: flex;
  flex-flow: row wrap;
  // padding: 0 15px;
  margin-bottom: 0;

  .themeItem {
    display: flex;
    flex-flow: column nowrap;
    align-items: center;
    cursor: pointer;
    // color: var(--color-primary);
    margin-right: 8px;
    transition: .3s ease;
    transition-property: color, opacity;
    margin-bottom: 18px;
    width: 86px;

    &:hover {
      opacity: .7;
    }

    &:last-child {
      margin-right: 0;
    }

    &.active {
      color: var(--color-primary-font-active);
      .bg {
        border-color: var(--control-ink);
      }

      &:hover {
        opacity: 1;
      }
    }

    .bg {
      display: block;
      width: 36px;
      height: 36px;
      margin-bottom: 5px;
      border: 1px solid transparent;
      padding: 2Px;
      transition: border-color .3s ease;
      border-radius: 12px;
      &:after {
        display: block;
        content: ' ';
        width: 100%;
        height: 100%;
        border-radius: @radius-border;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        background-color: var(--color-primary-theme);
        background-image: var(--background-image-theme);
      }
    }

    .label {
      width: 100%;
      text-align: center;
      height: 1.2em;
    }

    &.auto {

      &.active {
        color: var(--color-primary-font-active);
        .bg {
          border-color: var(--color-primary-font-active);
        }
      }

      >.bg {
        &:after {
          content: none;
        }
      }
      .bgContent {
        position: relative;
        height: 100%;
        overflow: hidden;
        border-radius: 5px;
      }
      .light, .dark {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        &:after {
          display: block;
          content: ' ';
          width: 100%;
          height: 100%;
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
        }
      }
      .light {
        &:after {
          clip-path: polygon(0 0, 100% 0, 0 100%);
        }
        svg {
          fill: var(--color-primary-theme-light);
        }
        &:after {
          background-color: var(--color-primary-theme-light);
          background-image: var(--background-image-theme-light);
        }
      }
      .dark {
        &:after {
          clip-path: polygon(0 100%, 100% 0, 100% 100%);
        }
        svg {
          fill: var(--color-primary-theme-dark);
        }
        &:after {
          background-color: var(--color-primary-theme-dark);
          background-image: var(--background-image-theme-dark);
        }
      }
    }

    &.add {
      >.bg {
        &:after {
          content: none;
        }
        .bgContent {
          transition: .3s ease;
          transition-property: border, color;
          box-sizing: border-box;
          border: 1Px dashed var(--color-primary-light-100-alpha-300);
          color: var(--color-primary-light-100-alpha-300);
          position: relative;
          height: 100%;
          overflow: hidden;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .icon {
          // position: absolute;
          // font-size: 16px;
          width: 66%;
          height: auto;
        }
      }
      .label {
        color: var(--color-primary-dark-100-alpha-300);
      }
    }

    &.moreThme {
      flex-direction: row;
      width: auto;
      gap: 5px;
      color: var(--color-primary-font-active);
      .label {
        height: auto;
      }
    }
  }
}

.sourceLabel {
  flex: auto;
  margin-left: 5px;
  line-height: 1.5;
  cursor: pointer;

  .desc {
    color: var(--color-500);
    font-size: 12px;
    margin-left: 5px;
  }

  .status {
    margin-left: 5px;
  }
}

.themeToggle { margin-top: 2px; }

</style>
