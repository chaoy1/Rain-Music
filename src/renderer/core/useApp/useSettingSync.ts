import { watch } from '@common/utils/vueTools'
import { windowSizeActive } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { setWindowSize } from '@renderer/utils/ipc'
import { setLanguage } from '@root/lang'
import { setUserApi } from '../apiSource'
// import { applyTheme, getThemes } from '@renderer/store/utils'


export default () => {
  // 按 id 查找（与 store 里的 windowSizeActive 一致），而不是按下标取值：
  // 窗口尺寸列表已删掉若干档，下标与 id 不再一一对应。
  watch(windowSizeActive, (info) => {
    if (!info) return
    setWindowSize(info.width, info.height)
  })
  watch(() => appSetting['common.fontSize'], (fontSize) => {
    document.documentElement.style.fontSize = `${fontSize}px`
  })

  watch(() => appSetting['common.langId'], (id) => {
    if (!id) return
    setLanguage(id)
    window.setLang(id)
  })

  watch(() => appSetting['common.apiSource'], apiSource => {
    void setUserApi(apiSource)
  })

  // common.font 设置项已移除（字体分区整体删除），
  // 行为固定为使用主题默认字体，因此这里不再设置 fontFamily。
}
