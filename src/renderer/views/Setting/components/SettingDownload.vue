<template lang="pug">
dt#download {{ $t('setting__download') }}
dd
  .gap-top
    base-checkbox(id="setting_download_enable" :model-value="appSetting['download.enable']" :label="$t('setting__download_enable')" @update:model-value="updateSetting({'download.enable': $event})")
//- 其余下载设置项（同名文件跳过、按列表名分目录、同时下载任务数、自动换源、
//- 文件命名方式、歌词编码、歌词下载、嵌入内容）已从设置页移除，
//- 行为固定为 src/common/constants.ts 中的常量，见报告说明。
//- Android（Capacitor）上没有"选择保存目录"这回事：执行器**固定**写应用私有目录
//- （`platform/download/android.ts:44` 明确把 `savePath` 规范成空串，原生侧
//- `RainMusicDownloadTaskChannels.java` 把空目录映射到 `getExternalFilesDir(null)/downloads`，
//- 并**拒绝**任何私有目录之外的路径）。所以这一整行在移动端是双重的坏：显示的是
//- 桌面默认路径（web 构建里 `os.homedir()` 是 polyfill，形如 `/home/user/Desktop`）——
//- **不是文件真正落地的地方**；而"更改"按钮点下去 `filePicker/web.js:17` 会明确抛
//- "Directory selection requires Android document-tree support"。
//- 收口成 `v-if="isDesktopShell"`：与交通灯同一个开关（`renderer/platform/index.ts`），
//- 移动端**不渲染**这一行（下面 `dt` 的"启用下载"开关不受影响，照旧可用）。
dd(v-if="isDesktopShell" :aria-label="$t('setting__download_path_title')")
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
import { dialog } from '@renderer/plugins/Dialog'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { isDesktopShell } from '@renderer/platform'

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
      }).catch(error => {
        // 原来这里**没有 catch** ⇒ 未处理 rejection、点"更改保存路径"**静默无反应**。
        // Android 上这条路径必然走到（`filePicker/web.js:17` 明确抛
        // "Directory selection requires Android document-tree support"），
        // 桌面侧则是弹窗自身失败时的兜底。失败必须说出来，不能什么都不发生。
        void dialog({ message: `${t('setting__download_select_save_path')}: ${error?.message ?? error}` })
      })
    }

    return {
      appSetting,
      updateSetting,
      openDirInExplorer,
      handleChangeSavePath,
      isDesktopShell,
    }
  },
}
</script>

<style lang="less" module>
// .savePath {
//   font-size: 12px;
// }
</style>
