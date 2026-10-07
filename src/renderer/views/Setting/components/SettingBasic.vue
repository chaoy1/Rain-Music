<template lang="pug">
dt#basic {{ $t('setting__basic') }}
//- 原先这一节的「显示动画效果 / 弹出层随机动画 / 全屏模式启动 / 关闭窗口最小化 / 定时关闭」
//- 控件已全部移除，对应行为固定在代码里（见 src/common/constants.ts 与各处注释）。
dd
  h3#basic_theme {{ $t('setting__basic_theme') }}
  div
    ul#settings-themes(:class="$style.theme" :aria-label="$t('setting__basic_theme')")
      li(v-for="theme in themeList" :key="theme.id")
        button(type="button" data-round-control :data-theme-preset="theme.id" :aria-label="theme.name" :aria-pressed="themeId == theme.id" :style="theme.styles" :class="[$style.themeItem, {[$style.active]: themeId == theme.id}]" @click="toggleTheme(theme)")
          span(:class="$style.swatch" aria-hidden="true")
          span(:class="$style.label") {{ theme.name }}

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
      select#setting_font_size.settings-select(:value="appSetting['common.fontSize']" @change="updateSetting({'common.fontSize': Number($event.target.value)})")
        option(v-for="item in fontSizeList" :key="item.id" :value="item.id") {{ item.label }}
    .settings-field
      label(for="setting_language") {{ $t('setting__basic_lang') }}
      select#setting_language.settings-select(:value="appSetting['common.langId']" @change="updateSetting({'common.langId': $event.target.value})")
        option(v-for="item in langList" :key="item.locale" :value="item.locale") {{ item.name }}

//- 「字体」分区与「控制按钮位置」分区已整体删除：
//- common.font 固定使用主题默认字体，common.controlBtnPosition 固定为 'left'。
user-api-modal(v-model="isShowUserApiModal")
</template>

<script>
import { computed, ref, shallowReactive } from '@common/utils/vueTools'
import { userApi, isFullscreen, themeId, windowSizeList } from '@renderer/store'
import { langList, useI18n } from '@root/lang'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'

import UserApiModal from './UserApiModal.vue'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { getThemes, applyTheme } from '@renderer/store/utils'

export default {
  name: 'SettingBasic',
  components: {
    UserApiModal,
  },
  setup() {
    const t = useI18n()

    // Keep the underlying theme engine and saved themes intact; offer a curated set here.
    const presetIds = ['mono', 'mono_dark', 'mist_blue', 'sand']
    const presetStyles = shallowReactive([])
    const themeList = computed(() => [
      ...presetStyles.map(theme => ({ ...theme, name: t('theme_' + theme.id) })),
      {
        id: 'auto',
        name: t('theme_auto'),
        styles: {
          '--theme-swatch': 'linear-gradient(90deg, #eaebee 50%, #25262a 50%)',
          '--theme-preview-paper': 'linear-gradient(90deg, #fafbfc 50%, #303136 50%)',
          '--theme-preview-accent': '#87909e',
        },
      },
    ])
    let dataPath = ''
    getThemes((info) => {
      dataPath = info.dataPath
      presetStyles.splice(0, presetStyles.length, ...presetIds.flatMap(id => {
        const theme = info.themes.find(theme => theme.id == id)
        if (!theme) return []
        const previews = {
          mono: ['#eaebee', '#fafbfc', '#5a6471'],
          mono_dark: ['#25262a', '#303136', '#c4cbd5'],
          mist_blue: ['#e4e9ef', '#fafbfc', '#496b96'],
          sand: ['#eee9e2', '#fcfbf9', '#876b4f'],
        }
        const [shell, paper, accent] = previews[id]
        return [{ id, styles: { '--theme-swatch': shell, '--theme-preview-paper': paper, '--theme-preview-accent': accent } }]
      }))
    })
    const toggleTheme = (theme) => {
      if (theme.id == 'auto') {
        // Follow system uses a predictable light/dark pair without another setup dialog.
        updateSetting({ 'theme.id': 'auto', 'theme.lightId': 'mono', 'theme.darkId': 'mono_dark' })
        themeId.value = 'auto'
        applyTheme('auto', 'mono', 'mono_dark', dataPath)
        return
      }
      if (themeId.value == theme.id) return
      themeId.value = theme.id
      applyTheme(theme.id, appSetting['theme.lightId'], appSetting['theme.darkId'], dataPath)
      updateSetting({ 'theme.id': theme.id })
    }

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
      themeList,
      // currentStting,
      // themes,
      // themeClassName,
      apiSources,
      isShowUserApiModal,
      windowSizeList,
      langList,
      isFullscreen,
      toggleTheme,
      themeId,
      fontSizeList,
    }
  },
}
</script>

<style lang="less" module>
.theme {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  max-width: 560px;
  margin-bottom: 0;

  li { min-width: 0; }

  .themeItem[data-theme-preset] {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-sizing: border-box;
    width: 100%;
    min-height: 76px;
    padding: 8px 4px;
    border: 1px solid var(--glass-edge);
    border-radius: 8px;
    background: var(--surface-subtle);
    background-image: none;
    box-shadow: none;
    color: var(--color-font);
    font-family: inherit;
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    transition: background-color .18s ease, border-color .18s ease;

    &:hover { background: var(--surface-hover); }

    &:focus-visible {
      outline: 2px solid var(--control-ink);
      outline-offset: 2px;
    }

    &.active {
      background: var(--surface-selected);
      border-color: var(--control-outline);
      box-shadow: inset 0 0 0 1px var(--control-outline);
      font-weight: 600;
    }
  }

  .swatch {
    display: block;
    flex: none;
    position: relative;
    width: 40px;
    height: 28px;
    border-radius: 5px;
    background: var(--theme-swatch);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08);

    &::after {
      content: '';
      position: absolute;
      right: 1px;
      bottom: 1px;
      width: 24px;
      height: 15px;
      box-sizing: border-box;
      border-left: 3px solid var(--theme-preview-accent);
      border-radius: 2px;
      background: var(--theme-preview-paper);
    }
  }

  .label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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


</style>
