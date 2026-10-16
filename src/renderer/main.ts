import '@common/error'
import { createApp } from 'vue'

import './core/globalData'

import '@renderer/event'

// Components
import mountComponents from './components'

// Plugins
import initPlugins from './plugins'
import { i18nPlugin } from './plugins/i18n'

import App from './App.vue'
import router from './router'
// import store from './store'


import { getSetting, updateSetting } from './utils/ipc'
import { langList } from '@root/lang'
import type { I18n } from '@root/lang/i18n'

import { invokeWithFallback } from '@renderer/platform/ipcFallback'
import { CMMON_EVENT_NAME } from '@common/ipcNames'
import defaultSetting from '@common/defaultSetting'

import { initSetting } from './store/setting'
import { getStandardPlaybackPatch } from './utils/standardPlayback'
// import { bubbleCursor } from './utils/cursor-effects/bubbleCursor'

import { saveViewPrevState } from './utils/data'

// sync(store, router)

router.afterEach((to) => {
  if (to.path != '/songList/detail') {
    saveViewPrevState({
      url: to.path,
      query: { ...to.query },
    })
  }
})

/**
 * 挂载前取一次设置（Android 移植 · 阶段 3 / 线 F，阻塞点 #7）。
 *
 * 这一段以前是裸的 `void getSetting().then(...)`：`app.mount('#root')` 在 `.then` 里，
 * 而 `getSetting()` 走的 `common_get_app_setting` **当时**在 Android 上还没有原生实现
 * （`src/common/platform/ipcBridge/web.js` 是"调用即抛错"的占位实现；该通道已在 P0-2 注册，
 * 见文末 2026-10-16 的更正）⇒ Promise 一直 reject、
 * `.then` 永不执行 ⇒ **页面全白，且没有任何同步异常**（只有一条未处理 rejection）。
 *
 * 修法：取值点显式降级 —— 用 `@renderer/platform/ipcFallback` 的 `invokeWithFallback`
 * 给这次取值配一个 `fallback`（渲染层默认设置 `@common/defaultSetting`，与
 * `store/setting.ts` 里 `window.rainData.appSetting` 的初值同一个来源），取不到就带着默认值继续挂载。
 * **不假装成功**：降级不是静默的 —— web 侧 `platform/ipcFallback/web.js` 会打一条
 * `console.warn`（含通道名、失败原因、"已使用渲染层默认值继续挂载"），默认设置只是"能看见界面"，
 * 真正的设置数据仍然要等原生桥（见 `docs/android/ipc-contract.md` §4.1）。
 *
 * **桌面语义没有变化（逐条）**：
 * - `platform/ipcFallback` 默认路径（`./index.js` → `./desktop.js`）是 `invoke(channel)` **逐字透传**，
 *   第三个 `fallback` 参数桌面端**根本不读** ⇒ 这里传的 `fallback` 在桌面端永远不会被调用；
 * - 桌面端 `invokeWithFallback(...)` 返回的就是 `getSetting()` 本身那个 Promise，
 *   调用时机、参数、时序与改动前一致（`invokeWithFallback` 是同步调用 `invoke`）；
 * - 桌面端 `common_get_app_setting` 若真的 reject，仍然是**未处理的 rejection（大声失败）、
 *   依旧不挂载** —— 桌面行为与改动前**完全一致**，没有变成"拿默认设置凑合"。
 *
 * 为什么桌面**故意**不跟着降级：桌面的设置通道由主进程自己提供
 * （`src/main/app.ts:32` 的 `appSetting: defaultSetting`），它 reject 意味着"渲染层 ↔ 主进程"
 * 这条 IPC 整体是坏的。那种情况下用默认设置挂一个什么都读不到、什么都控制不了的界面，
 * 只是把"启动即坏"变成"到处是空的怪行为"，更难查；桌面保持**大声失败**更有诊断价值
 * （上一轮 `platform/ipcFallback/desktop.js` 的头注释就是这个决定）。
 * 代价写明：桌面端若设置通道真坏了，仍然是全白页（本轮**没有**改这一点）。
 * 若将来决定"桌面也退化挂载"，那是 `platform/ipcFallback/desktop.js` 的一次**显式**语义变更，
 * 而不该在本文件里绕过适配器另写一条 `.catch`。
 *
 * 另外：`.then` 里那两次 `updateSetting(...)`（写回语言 / 窗口尺寸）**不降级** ——
 * 这是**故意保留**的诚实失败（写不进去就应该看得见）。
 *
 * ⚠️ **2026-10-16 更正**：这里原来写的是"`common_set_app_setting` 在 Android 上同样没有桥，
 * 所以它会照旧 reject……也是下一段要处理的通道（P0-2）"。**这两句今天都不成立**：
 * `common_set_app_setting` 早在 P0-2 就注册了 ——
 * `android/app/src/main/java/com/rainmusic/mobile/ipc/RainMusicAppSettingChannels.java:107`
 * 的 `CHANNEL_SET`，注册在 `:169`，落点是 `CapacitorStorage` → `rain:store:config_v2`；
 * 而且原生写入失败时是**抛异常**、不假装成功（`:226-231`：`SharedPreferences.commit()` 返回 false
 * 就 `throw`）。所以真机上这两次写入**正常落盘、不会 reject**（本机跑 web 产物时会 reject，
 * 但那是因为那个页面**根本没有原生桥**，属于环境固有现象，见
 * `tests/ui/web-bundle-smoke.electron.cjs` 的说明）。
 * "不降级"这条决定**保留**，但理由变了：不是为了兜住"没有桥"，而是**写失败必须看得见** ——
 * 与原生侧 `commit()==false` 就抛异常是同一条原则。
 */
void invokeWithFallback(async() => getSetting(), CMMON_EVENT_NAME.get_app_setting, () => ({ ...defaultSetting })).then((setting: Rain.AppSetting) => {
  // window.rain.appSetting = setting
  // Set language automatically
  if (!setting['common.langId'] || !window.i18n.availableLocales.includes(setting['common.langId'])) {
    let langId: I18n['locale'] | null = null
    const locale = window.navigator.language.toLocaleLowerCase() as I18n['locale']
    if (window.i18n.availableLocales.includes(locale)) {
      langId = locale
    } else {
      for (const lang of langList) {
        if (lang.alternate == locale) {
          langId = lang.locale
          break
        }
      }
      langId ??= 'en-us'
    }
    setting['common.langId'] = langId
    void updateSetting({ 'common.langId': langId })
    console.log('Set lang', setting['common.langId'])
  }
  window.setLang(setting['common.langId'])
  window.i18n.setLanguage(setting['common.langId'])

  // common.startInFullscreen 设置项已移除，行为固定为「不以此启动」，条件里不再判断它。
  // 注意：窗口尺寸列表已删掉 id 0/1（更小、小）与 id 6（巨大），
  // 这里的兜底尺寸从原来的 id 1 改为列表中最小的 id 2（medium），
  // 否则会写入一个列表里不存在的 id（渲染进程按窗口尺寸换算会取不到值）。
  if ((document.body.clientHeight > window.screen.availHeight || document.body.clientWidth > window.screen.availWidth) && setting['common.windowSizeId'] > 1) {
    void updateSetting({ 'common.windowSizeId': 2 })
  }

  // store.commit('setSetting', setting)
  const standardPlayback = getStandardPlaybackPatch(setting)
  if (Object.keys(standardPlayback).length) {
    Object.assign(setting, standardPlayback)
    void updateSetting(standardPlayback)
  }
  initSetting(setting)

  const app = createApp(App)
  app
    .use(router)
    // .use(store)
    .use(i18nPlugin)
  initPlugins(app)
  mountComponents(app)
  app.mount('#root')
})

// bubbleCursor()
