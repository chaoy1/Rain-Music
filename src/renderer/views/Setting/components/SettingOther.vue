<template lang="pug">
dt#other {{ $t('setting__maintenance') }}
//- 「主窗口使用软件内置的圆角及阴影」(common.transparentWindow) 设置项已移除，
//- 行为固定为 true（TRANSPARENT_WINDOW），因此控件与「更改后重启生效」提示一并删除。

dd
  h3#other_resource_cache
    | {{ $t('setting__other_resource_cache') }}
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__other_resource_cache_tip')")
  div
    .p
      | {{ $t('setting__other_resource_cache_label') }}
      span.auto-hidden {{ cacheSize }}
    .p
      base-btn.btn(min :disabled="isDisabledResourceCacheClear" @click="clearResourceCache") {{ $t('setting__other_resource_cache_clear_btn') }}
  //- 超过一定大小时自动清理（只有几个预设档位，不支持自由输入）
  h3#other_resource_cache_auto_clean {{ $t('setting__other_resource_cache_auto_clean') }}
  div
    select.settings-select(:value="appSetting['common.resourceCacheAutoCleanSize']" :aria-labelledby="'other_resource_cache_auto_clean'" @change="updateSetting({'common.resourceCacheAutoCleanSize': Number($event.target.value)})")
      option(v-for="item in resourceCacheAutoCleanSizeList" :key="item.id" :value="item.id") {{ item.label }}
  //- 原先独立的「其他缓存管理」分区已合并到此处：三个清理按钮功能保持不变
  details.settings-more(data-settings-more="cache")
    summary {{ $t('setting__more_cache') }}
    .p
      | {{ $t('setting__other_other_source_label') }}
      span.auto-hidden {{ otherSourceCount }}
    .p
      | {{ $t('setting__other_music_url_label') }}
      span.auto-hidden {{ musicUrlCount }}
    .p
      | {{ $t('setting__other_lyric_raw_label') }}
      span.auto-hidden {{ lyricRawCount }}
    .p
      base-btn.btn(min :disabled="isDisabledOtherSourceCacheClear" @click="handleClearOtherSourceCache") {{ $t('setting__other_other_source_clear_btn') }}
      base-btn.btn(min :disabled="isDisabledMusicUrlCacheClear" @click="handleClearMusicUrlCache") {{ $t('setting__other_music_url_clear_btn') }}
      base-btn.btn(min :disabled="isDisabledLyricRawCacheClear" @click="handleClearLyricRawCache") {{ $t('setting__other_lyric_raw_clear_btn') }}

dd
  h3#other_dislike {{ $t('setting__other_dislike_list') }}
  div
    .p
      | {{ $t('setting__other_dislike_list_label') }}
      span.auto-hidden {{ dislikeRuleCount }}
    .p
      base-btn.btn(min @click="isShowDislikeList = true") {{ $t('setting__other_dislike_list_show_btn') }}
  DislikeListModal(v-model="isShowDislikeList")

//- 「已调整过偏移时间的歌词管理」(setting__other_lyric_edited_cache) 分区已删除：
//- 歌词偏移时间的调整不再持久化（SAVE_EDITED_LYRIC = false），底层写入通道也已移除。
//- 「列表数据清理」(setting__other_listdata) 分区已删除：该危险操作的底层能力已停用
//- （CLEAR_LIST_DATA_ENABLE = false），overwriteListFull 的调用点一并清理。
</template>

<script>
import { computed, ref } from '@common/utils/vueTools'
import {
  clearCache, getCacheSize,
  getOtherSourceCount, clearOtherSource,
  getMusicUrlCount, clearMusicUrl,
  getLyricRawCount, clearLyricRaw,
} from '@renderer/utils/ipc'
import { sizeFormate } from '@common/utils/common'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { dislikeRuleCount } from '@renderer/store/dislikeList'
import DislikeListModal from './DislikeListModal.vue'

export default {
  name: 'SettingOther',
  components: {
    DislikeListModal,
  },
  setup() {
    const t = useI18n()

    const cacheSize = ref('0 B')
    const isDisabledResourceCacheClear = ref(false)
    const refreshCacheSize = () => {
      void getCacheSize().then(size => {
        cacheSize.value = sizeFormate(size)
      })
    }
    const clearResourceCache = async() => {
      if (!await dialog.confirm({
        message: t('setting__other_resource_cache_tip_confirm'),
        cancelButtonText: t('cancel_button_text'),
        confirmButtonText: t('setting__other_resource_cache_confirm'),
      })) return
      isDisabledResourceCacheClear.value = true
      void clearCache().then(() => {
        refreshCacheSize()
        isDisabledResourceCacheClear.value = false
      })
    }
    refreshCacheSize()

    // 资源缓存自动清理的预设档位（单位 MB，0 = 关闭）
    const resourceCacheAutoCleanSizeList = computed(() => [
      { id: 0, label: t('setting__other_resource_cache_auto_clean_off') },
      { id: 500, label: t('setting__other_resource_cache_auto_clean_500') },
      { id: 1024, label: t('setting__other_resource_cache_auto_clean_1g') },
      { id: 2048, label: t('setting__other_resource_cache_auto_clean_2g') },
      { id: 5120, label: t('setting__other_resource_cache_auto_clean_5g') },
    ])

    const otherSourceCount = ref(0)
    const isDisabledOtherSourceCacheClear = ref(false)
    const refreshOtherSourceCount = () => {
      void getOtherSourceCount().then(count => {
        otherSourceCount.value = count
      })
    }
    const handleClearOtherSourceCache = async() => {
      isDisabledOtherSourceCacheClear.value = true
      void clearOtherSource().then(() => {
        refreshOtherSourceCount()
        isDisabledOtherSourceCacheClear.value = false
      })
    }
    refreshOtherSourceCount()


    const musicUrlCount = ref(0)
    const isDisabledMusicUrlCacheClear = ref(false)
    const refreshMusicUrlCount = () => {
      void getMusicUrlCount().then(count => {
        musicUrlCount.value = count
      })
    }
    const handleClearMusicUrlCache = async() => {
      isDisabledMusicUrlCacheClear.value = true
      void clearMusicUrl().then(() => {
        refreshMusicUrlCount()
        isDisabledMusicUrlCacheClear.value = false
      })
    }
    refreshMusicUrlCount()

    const isShowDislikeList = ref(false)

    const lyricRawCount = ref(0)
    const isDisabledLyricRawCacheClear = ref(false)
    const refreshLyricRawCount = () => {
      void getLyricRawCount().then(count => {
        lyricRawCount.value = count
      })
    }
    const handleClearLyricRawCache = async() => {
      isDisabledLyricRawCacheClear.value = true
      void clearLyricRaw().then(() => {
        refreshLyricRawCount()
        isDisabledLyricRawCacheClear.value = false
      })
    }
    refreshLyricRawCount()


    return {
      appSetting,
      updateSetting,
      cacheSize,
      isDisabledResourceCacheClear,
      clearResourceCache,
      resourceCacheAutoCleanSizeList,

      otherSourceCount,
      isDisabledOtherSourceCacheClear,
      handleClearOtherSourceCache,

      musicUrlCount,
      isDisabledMusicUrlCacheClear,
      handleClearMusicUrlCache,

      dislikeRuleCount,
      isShowDislikeList,

      lyricRawCount,
      isDisabledLyricRawCacheClear,
      handleClearLyricRawCache,
    }
  },
}
</script>
