import { ref, reactive, shallowRef, markRaw, computed, watch } from '@common/utils/vueTools'
import { windowSizeList as configWindowSizeList } from '@common/config'
import { appSetting } from './setting'
import pkg from '../../../package.json'
import music from '@renderer/utils/musicSdk'
// 阶段 3：`process.versions.app` 的**唯一**读取处（`utils/request.js` 里的 `bHtml` deflate
// 分支）已随死代码一起删除。这里保留赋值以兼容外部读取，但补一层宿主判定 ——
// Web/Android 端的 `process` 是构建期 polyfill（webpack `ProvidePlugin` 注入的模块变量，
// **不**挂在 globalThis 上），不能再假设 Node 的 process 一定存在
// （`docs/android/native-bridge-needs.md` §2.6.1）。
if (globalThis.process?.versions != null) globalThis.process.versions.app = pkg.version

export const apiSource = ref<string | null>(null)


export const windowSizeActive = computed(() => {
  return windowSizeList.find(i => i.id === appSetting['common.windowSizeId']) ?? windowSizeList[0]
})

export const sourceNames = computed(() => {
  const prefix = 'source_'
  const sourceNames: Record<Rain.OnlineSource, string> = {
    tx: 'tx',
    kg: 'kg',
    wy: 'wy',
  }
  for (const { id } of music.sources) {
    sourceNames[id as Rain.OnlineSource] = window.i18n.t(prefix + id as any)
  }

  return sourceNames
})

export const windowSizeList = markRaw(configWindowSizeList)

export const userApi = reactive<{
  list: Rain.UserApi.UserApiInfo[]
  status: boolean
  message?: string
  apis: Partial<Rain.UserApi.UserApiSources>
}>({
  list: [],
  status: false,
  message: 'initing',
  apis: {},
})


export const isFullscreen = ref(false)
watch(isFullscreen, isFullscreen => {
  window.rain.rootOffset = window.dt || isFullscreen ? 0 : 8
}, { immediate: true })

export const themeShouldUseDarkColors = ref(window.shouldUseDarkColors)


export const qualityList = shallowRef<Rain.QualityList>({})
export const setQualityList = (_qualityList: Rain.QualityList) => {
  qualityList.value = _qualityList
}

export const themeId = ref('green')
export const themeInfo: Rain.ThemeInfo = {
  themes: [],
  userThemes: [],
  dataPath: '',
  // 阶段 3 / 线 C：主进程 `getAllThemes()` 新增的"可加载 URL 基址"。
  // 桌面 = dataPath（identity），Android = `Capacitor.convertFileSrc(...)`；
  // 在 `getThemes()` 的 IPC 回来之前保持空串，渲染层因此走旧的 dataPath 分支。
  imageUrlBase: '',
}

/**
 * macOS 磨砂玻璃底层的壁纸地址（本地 file URL）。
 * 由 useApp 从 envParams.wallpaper 转换后写入；
 * 为空时壁纸层保持透明，界面回退为原来的实底样式。
 */
export const wallpaperUrl = ref('')
