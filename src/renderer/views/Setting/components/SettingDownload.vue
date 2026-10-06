<template lang="pug">
dt#download {{ $t('setting__download') }}
dd
  .gap-top
    base-checkbox(id="setting_download_enable" :model-value="appSetting['download.enable']" :label="$t('setting__download_enable')" @update:model-value="updateSetting({'download.enable': $event})")
//- 其余下载设置项（同名文件跳过、按列表名分目录、同时下载任务数、自动换源、
//- 文件命名方式、歌词编码、歌词下载、嵌入内容）已从设置页移除，
//- 行为固定为 src/common/constants.ts 中的常量，见报告说明。
dd(:aria-label="$t('setting__download_path_title')")
  h3#download_path {{ $t('setting__download_path') }}
  div
    .p
      | {{ $t('setting__download_path_label') }}
      span.auto-hidden.hover(:class="$style.savePath" :aria-label="$t('setting__download_path_open_label')" @click="openDirInExplorer(appSetting['download.savePath'])") {{ appSetting['download.savePath'] }}
    .p
      base-btn.btn(min @click="handleChangeSavePath") {{ $t('setting__download_path_change_btn') }}
</template>

<script>
// import { getSystemFonts } from '@renderer/utils/tools'
import { showSelectDialog, openDirInExplorer } from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'

export default {
  name: 'SettingDownload',
  setup() {
    const t = useI18n()

    const handleChangeSavePath = () => {
      void showSelectDialog({
        title: t('setting__download_select_save_path'),
        defaultPath: appSetting['download.savePath'],
        properties: ['openDirectory'],
      }).then(result => {
        if (result.canceled) return
        updateSetting({ 'download.savePath': result.filePaths[0] })
      })
    }

    return {
      appSetting,
      updateSetting,
      openDirInExplorer,
      handleChangeSavePath,
    }
  },
}
</script>

<style lang="less" module>
// .savePath {
//   font-size: 12px;
// }
</style>
