import { ref, reactive, shallowRef, markRaw, computed, watch } from '@common/utils/vueTools'
import { windowSizeList as configWindowSizeList } from '@common/config'
import { appSetting } from './setting'
import pkg from '../../../package.json'
import music from '@renderer/utils/musicSdk'
process.versions.app = pkg.version

export const apiSource = ref<string | null>(null)
export const proxy: {
  enable: boolean
  host: string
  port: string

  envProxy?: {
    host: string
    port: string
  }
} = {
  enable: false,
  host: '',
  port: '',
}
export const sync: {
  enable: boolean
  mode: Rain.AppSetting['sync.mode']
  isShowSyncMode: boolean
  isShowAuthCodeModal: boolean
  deviceName: string
  type: keyof Rain.Sync.ModeTypes
  server: {
    port: string
    status: {
      status: boolean
      message: string
      address: string[]
      code: string
      devices: Rain.Sync.ServerKeyInfo[]
    }
  }
  client: {
    host: string
    status: {
      status: boolean
      message: string
      address: string[]
    }
  }
} = reactive({
  enable: false,
  mode: 'server',
  isShowSyncMode: false,
  isShowAuthCodeModal: false,
  deviceName: '',
  type: 'list',
  server: {
    port: '',
    status: {
      status: false,
      message: '',
      address: [],
      code: '',
      devices: [],
    },
  },
  client: {
    host: '',
    status: {
      status: false,
      message: '',
      address: [],
    },
  },
})

export const openAPI = reactive({
  address: '',
  message: '',
})


export const windowSizeActive = computed(() => {
  return windowSizeList.find(i => i.id === appSetting['common.windowSizeId']) ?? windowSizeList[0]
})

export const getSourceI18nPrefix = () => {
  return appSetting['common.sourceNameType'] == 'real' ? 'source_' : 'source_alias_'
}

export const sourceNames = computed(() => {
  const prefix = getSourceI18nPrefix()
  const sourceNames: Record<Rain.OnlineSource | 'all', string> = {
    kw: 'kw',
    tx: 'tx',
    kg: 'kg',
    mg: 'mg',
    wy: 'wy',
    all: window.i18n.t(prefix + 'all' as any),
  }
  for (const { id } of music.sources) {
    sourceNames[id as Rain.OnlineSource] = window.i18n.t(prefix + id as any)
  }

  return sourceNames
})

export const windowSizeList = markRaw(configWindowSizeList)

export const isShowPact = ref(false)

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
}

/**
 * macOS 磨砂玻璃底层的壁纸地址（本地 file URL）。
 * 由 useApp 从 envParams.wallpaper 转换后写入；
 * 为空时壁纸层保持透明，界面回退为原来的实底样式。
 */
export const wallpaperUrl = ref('')
