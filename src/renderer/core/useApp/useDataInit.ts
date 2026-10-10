import { getPlayInfo } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import { log } from '@common/utils'
import { getListMusics, getUserLists, registerAction } from '@renderer/store/list/action'
// 挂载后初始化链上"可跳过订阅 / 取值"的**同一个**降级入口（阻塞点 #8 引入，
// `src/renderer/platform/ipcFallback/subscribe.ts` 是它的唯一实现）。
// 本轮**没有**新造抽象：下面只是把它接到 4 个具体调用点上。
import { invokeSkippable, subscribeSkippable } from '@renderer/platform/ipcFallback/subscribe'
import { DISLIKE_EVENT_NAME, PLAYER_EVENT_NAME } from '@common/ipcNames'

import useInitUserApi from './useInitUserApi'
import { playList } from '@renderer/core/player'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { initDislikeInfo, registerRemoteDislikeAction } from '@renderer/core/dislikeList'

const initPrevPlayInfo = async() => {
  const info = await getPlayInfo()
  window.rain.restorePlayInfo = null
  if (!info?.listId || info.index < 0) return
  const list = await getListMusics(info.listId)
  if (!list[info.index]) return
  window.rain.restorePlayInfo = info
  playList(info.listId, info.index)
  // player.startupAutoPlay 设置项已移除，行为固定为「启动后不自动播放」，
  // 因此这里恢复播放列表后不再自动 play()。
}

/**
 * 挂载后初始化的**同步段**与取值链上一共 4 处平台通道（Android 移植 · 阶段 3 / 线 J）。
 *
 * `useDataInit()` 的返回值由 `src/renderer/core/useApp/index.ts` 的
 * `void initData().then(() => { … })` 调用。它是 **async** 函数，所以"同步抛错"与
 * "未处理 rejection"在这里表现为同一个东西：`initData()` 返回的 Promise reject。
 * 而那条链上（`registerAction` / `getUserLists` / `registerRemoteDislikeAction` /
 * `initDislikeInfo`）整组通道在 Android 上**都没有原生桥**
 * （`src/common/platform/ipcBridge/web.js` 是"调用即抛错"的占位实现）⇒
 * `initData()` 必然 reject ⇒ 后面 `initPlayer()` / `handleEnvParams()` / `initDeeplink()` /
 * `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()` **一行都不执行**
 * （阻塞点 **#11**，实测见 `docs/android/web-runtime-blockers.md` §4.8）。
 *
 * 下面 4 处的处理方式（**逐条**，全部复用 `platform/ipcFallback`，不新造抽象）：
 *
 * | 序 | 调用点 | 通道 | 归类 | 处理 |
 * | --- | --- | --- | --- | --- |
 * | 1 | `registerAction()`（→ `rendererListManage.ts:228-239`） | `player_list_data_overwire` 等 **12 条** `player_list_*` 广播 | A | `subscribeSkippable(…, 'A', …)`：整组订阅被跳过并留下 `console.error`（与 #8 的 9 处逐字同构） |
 * | 2 | `getUserLists()` | `player_list_get` | A | `invokeSkippable(…)` ⇒ `undefined` ⇒ **不赋值**（`window.rainData.userLists` 保持自己的初值，而不是塞一个 `[]` 假装"用户歌单确实为空"） |
 * | 3 | `registerRemoteDislikeAction()` | `dislike_add_dislike_music_infos` 等 **3 条** | A | 同 1（`subscribeSkippable`） |
 * | 4 | `initDislikeInfo()` | `dislike_get_dislike_music_infos` | A | 同 2（`invokeSkippable`）：取值失败 ⇒ **这一步整个跳过**，`store/dislikeList` 保持它自己的初值 |
 *
 * **不假装成功**：4 处降级各自留下可观测痕迹 —— 适配器一条
 * `[renderer/platform/ipcFallback] 平台通道 "…" 取值失败（通道未实现）…`（web 侧）；
 * 调用点一条 `[renderer/platform/ipcFallback] 平台通道 "…" 不可用（契约归类 A 类），已跳过…（reason=…）`。
 * 真正的列表 / 不喜欢数据仍然要等原生桥（`docs/android/ipc-contract.md` §4.1 的「列表与 DB」「收藏 / 不感兴趣」两组）。
 *
 * **没有动的两处（有意保留，理由各自写在下面）**：
 * - `initUserApi()`（`useInitUserApi.ts`）：它自己的取值点已经逐条接好（#8 修的就是它），
 *   并且这里的 `Promise.all([...]).catch(…)` 是**改动前就有**的"失败也要继续"分支；
 * - `initPrevPlayInfo()`（本文件顶部）：它的调用点**改动前就有** `.catch(err => log.error(err))`，
 *   所以 `winMain_get_data` 的失败**不阻断**后面的初始化，也没有未处理 rejection；
 *   保持原样，让那条失败继续以 `log.error` 的形状出现（"不假装成功"）。
 *
 * **桌面语义（逐条）**：
 * - `subscribeSkippable` / `invokeSkippable` 最终都走 `invokeWithFallback`，而
 *   `platform/ipcFallback` 的**桌面**适配器是 `invoke(channel)` 逐字透传、第三个参数**根本不读**
 *   ⇒ 桌面端 `register()` 仍在**同步段**里执行（`subscribeSkippable` 的 `async` 体里没有 `await`），
 *   调用时机、通道名、监听器、参数与改动前逐字一致；桌面端这条取值不会被换成兜底值；
 * - **唯一一处桌面差异（与 #8 完全同一个取舍，且已写在 `subscribe.ts:38-39`）**：
 *   桌面端这 4 条通道若**自己**抛错/报错，改动前是"同步穿出 `initData()`（或让它 reject）
 *   ⇒ 后面 6 步不执行"，现在会各变成**一条 `console.error`**（`已跳过…` / `降级处理本身失败：…`）
 *   **并继续**。理由：这 4 条通道在 Android 侧全部是"注定取不到"的 (A) 类通道，
 *   而 `initData()` 的调用点（`useApp/index.ts`）本轮已按 P0-8 补上"失败也要继续"的形状；
 *   桌面端的失败仍然**大声**（`console.error` + 原始错误对象），只是不再连带吃掉
 *   `initPlayer()` / `sendInited()` 那一段初始化。
 */
export default () => {
  const initUserApi = useInitUserApi()

  let unregister: null | (() => void) = null
  let unregisterDislikeEvent: null | (() => void) = null

  onBeforeUnmount(() => {
    if (unregister) unregister()
    if (unregisterDislikeEvent) unregisterDislikeEvent()
  })

  return async() => {
    await Promise.all([
      initUserApi(), // 自定义API
    ]).catch(err => {
      log.error(err)
    })
    void music.init() // 初始化音乐sdk
    // ① `player_list_*` 广播订阅（12 条，`rendererListManage.ts:228-239` 的整组 `rendererOn`）。
    //    整组只有一个"取消订阅"入口，所以这里按**一组**降级：跳过订阅 + 留一条 `console.error`，
    //    返回的取消订阅函数**仍然可以调用**（`onBeforeUnmount` 会调它）—— 与 #8 的 9 处逐字同构。
    //    通道名取组内**第一条**（实测就是它在 web 上先把异常抛出来的那条），详情里写明这是整组。
    unregister = subscribeSkippable(PLAYER_EVENT_NAME.list_data_overwire, 'A', () => registerAction((ids) => {
      window.app_event.myListUpdate(ids)
    }))
    // ② `player_list_get`：取不到用户歌单就**跳过这一步**（不赋值、不塞 `[]`），
    //    界面回落到它自己的"没有用户歌单"空状态。
    const userListInfos = await invokeSkippable(async() => getUserLists(), PLAYER_EVENT_NAME.list_get, 'A', '已跳过用户歌单取值（整组 player_list_* 广播订阅也已在上面跳过）')
    if (userListInfos) window.rainData.userLists = userListInfos // 获取用户列表
    // ③ `dislike_*` 广播订阅（3 条，`core/dislikeList.ts:42-44`）：与 ① 同一种形状。
    unregisterDislikeEvent = subscribeSkippable(DISLIKE_EVENT_NAME.add_dislike_music_infos, 'A', () => registerRemoteDislikeAction())
    // ④ `dislike_get_dislike_music_infos`：取不到就跳过这一步，`store/dislikeList` 保持初值。
    await invokeSkippable(async() => initDislikeInfo(), DISLIKE_EVENT_NAME.get_dislike_music_infos, 'A', '已跳过不喜欢列表初始化') // 获取不喜欢列表
    await initPrevPlayInfo().catch(err => {
      log.error(err)
    }) // 初始化上次的歌曲播放信息
  }
}
