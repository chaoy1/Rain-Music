import { getEnvParams, getViewPrevState, sendInited } from '@renderer/utils/ipc'

// `invokeWithFallback` —— 与 `src/renderer/main.ts:82`（阻塞点 #7）同一个降级入口。
// 默认路径（`./index.js` → `./desktop.js`）是 `invoke(channel)` 逐字透传，桌面端**不读** `fallback`。
import { invokeWithFallback } from '@renderer/platform/ipcFallback'
// `invokeSkippable` —— 挂载后初始化链上"可跳过取值"的**同一个**降级入口（#8 引入，
// 与 `useDataInit.ts` / `event/index.ts` 共用 `platform/ipcFallback/subscribe.ts` 这一份实现）。
import { invokeSkippable } from '@renderer/platform/ipcFallback/subscribe'
import { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

import { themeId, wallpaperUrl } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

import useStatusbarLyric from './useStatusbarLyric'
import useDataInit from './useDataInit'
import useHandleEnvParams from './useHandleEnvParams'
import useEventListener from './useEventListener'
import useDeeplink from './useDeeplink'
import usePlayer from './usePlayer'
import useSettingSync from './useSettingSync'
import { useRouter } from '@common/utils/vueRouter'
import { LEGACY_LOVE_LIST_ID } from '@common/constants'
import handleListAutoUpdate from './listAutoUpdate'

/**
 * 设置 macOS 磨砂玻璃的底层背景（重度模糊的桌面壁纸）。
 *
 * 壁纸重度模糊后作为应用最底层背景，各面板再以半透明盖在其上，
 * 形成磨砂玻璃观感 —— 这样完全不依赖 Windows 的 DWM Acrylic
 * （该材质偏弱，且受系统「透明效果」设置影响，实测很多机器上看不出效果）。
 *
 * 取不到壁纸路径时 wallpaperUrl 保持空串，App.vue 里的壁纸层不加 .show，
 * 界面回退为原来的实底样式，不会显示异常。
 */
const applyWallpaper = (wallpaper?: string | null) => {
  if (!wallpaper) return
  // 本地绝对路径 → file URL。
  // 用 encodeURI 而不是项目自带的 encodePath：后者只处理 % 和 #，
  // 项目路径含空格时无法正确加载。
  wallpaperUrl.value = `file:///${encodeURI(wallpaper.replace(/\\/g, '/'))}`
}


export default () => {
  // apiSource.value = appSetting['common.apiSource']
  // common.startInFullscreen 设置项已移除，行为固定为「不以此启动」
  themeId.value = appSetting['theme.id']

  const router = useRouter()
  const initStatusbarLyric = useStatusbarLyric()
  useEventListener()
  const initPlayer = usePlayer()
  const handleEnvParams = useHandleEnvParams()
  const initData = useDataInit()
  const initDeeplink = useDeeplink()
  // const handleListAutoUpdate = useListAutoUpdate()

  useSettingSync()

  /**
   * 挂载后取一次启动参数（Android 移植 · 阶段 3 / 线 H，阻塞点 #9）。与 #7 逐字同构。
   *
   * 这一段以前是裸的 `void getEnvParams().then(...)`：`getEnvParams()` 走的
   * `common_get_env_params` 在 Android 上**没有原生桥**（`src/common/platform/ipcBridge/web.js`
   * 是"调用即抛错"的占位实现）⇒ Promise 一直 reject、`.then` 回调**永不执行**
   * ⇒ 挂载之后的一整段初始化（启动参数 / 路由恢复 / 列表数据 / 播放器 / 深链 / `sendInited`）
   * 全部不跑，页面停在"半空壳"，而且**没有同步异常**（只有一条未处理 rejection）。
   *
   * 修法：取值点显式降级 —— 用 `@renderer/platform/ipcFallback` 的 `invokeWithFallback`
   * 给这次取值配一个"没有启动参数"的 `envParams`（`{ cmdParams: {}, deeplink: null, wallpaper: null }`）：
   * - `cmdParams: {}` = 主进程 `src/main/utils/index.ts:19 parseEnvParams()` 在**一个 `-flag` 都没有**时的返回值；
   * - `deeplink: null` = 同一个函数的默认值（没有 `rainmusic://` 参数）；
   * - `wallpaper: null` = `Rain.EnvParams.wallpaper` 文档里写明的"取不到时为 null"。
   * **不是编造的假数据**，而是"这次启动确实没有启动参数"这一事实在渲染层的表示。
   * 取不到就带着它继续初始化，而不是整段不跑。
   *
   * **不假装成功**：降级不是静默的 —— web 侧 `platform/ipcFallback/web.js` 会打一条
   * `console.warn`（含通道名 `common_get_env_params`、失败原因、"已使用渲染层默认值继续挂载"）。
   * 真正的启动参数仍然要等原生桥（`docs/android/ipc-contract.md` §4.1）。
   *
   * **`envParams` 被下面这几步消费，逐条说明"降级后会发生什么"**（没有任何一步是"塞假数据让它看起来成功"）：
   * - `applyWallpaper(envParams.wallpaper)`：`null` ⇒ 立即 return，`wallpaperUrl` 保持空串，
   *   壁纸层不加 `.show`（`App.vue` 的既有回退路径，`store/index.ts:75` 有同样说明）；
   * - `handleEnvParams(envParams)`（`useHandleEnvParams.ts:83-86`）读 `envParams.cmdParams.search` /
   *   `.play` ⇒ **兜底值必须带 `cmdParams`**，否则这里会变成 `undefined.search` 的 TypeError
   *   （即"用一个假对象把失败换成另一种崩"）。`{}` 下两个启动参数都是 `undefined`，
   *   两个处理函数各自 `return`（"本次没有 `-search` / `-play`"）；
   * - `initDeeplink(envParams)`（`useDeeplink/index.ts:75-86`）读 `envParams.deeplink` ⇒
   *   `null` 时跳过深链处理，只把 `isInited` 置 true（"本次没有深链"的正常分支）。
   *
   * **桌面语义没有变化（逐条）**：
   * - `platform/ipcFallback` 默认路径是 `invoke(channel)` 逐字透传，第三个 `fallback` 参数
   *   桌面端**根本不读** ⇒ 这里传的兜底值在桌面端永远不会被构造；
   * - 桌面端 `invokeWithFallback(...)` 返回的就是 `getEnvParams()` 那个 Promise，
   *   调用时机、参数、时序与改动前一致；
   * - 桌面端 `common_get_env_params` 若真的 reject，仍然是**未处理的 rejection（大声失败）、
   *   下面的初始化依旧不执行** —— 与改动前完全一致，没有变成"拿空参数凑合"
   *   （理由与 #7 相同：主进程自己提供的通道坏掉 = IPC 整体是坏的，留着大声失败更有诊断价值）。
   *
   * **本回调的第二行**（`getViewPrevState()` → `winMain_get_data`）是同一形状的下一条阻塞点，
   * 本轮已按同一层降级接好，见下面那段注释（阻塞点 #10）。
   */
  void invokeWithFallback(async() => getEnvParams(), CMMON_EVENT_NAME.get_env_params, (): Rain.EnvParams => ({
    cmdParams: {},
    deeplink: null,
    wallpaper: null,
  })).then(async(envParams: Rain.EnvParams) => {
    applyWallpaper(envParams.wallpaper)

    /**
     * 恢复上次关闭时的视图（Android 移植 · 阶段 3 / 线 I，阻塞点 #10）。与上面 #9 逐字同构。
     *
     * 这一段以前是裸的 `const state = await getViewPrevState()`：`getViewPrevState()` 走的
     * `winMain_get_data`（`src/renderer/utils/ipc.ts:224` → `WIN_MAIN_RENDERER_EVENT_NAME.get_data`，
     * 即 `DATA_KEYS.viewPrevState`）在 Android 上**没有原生桥** ⇒ 这个 `await` 一 reject，
     * #9 修好之后才刚刚开始执行的整个 async 回调**就到此结束** ⇒ 后面的 `router.replace()`、
     * `initData()`（我的列表 / 下载列表）、`initPlayer()`、`handleEnvParams()`、`initDeeplink()`、
     * `initStatusbarLyric()`、`sendInited()`、`handleListAutoUpdate()` **一行都跑不到**
     * （#9 修好之前这一行**不可达**，所以它那时只以另一处调用点的 `console.error` 形状出现）。
     *
     * **兜底值为什么是 `null`，而不是 `{ ...DEFAULT_SETTING.viewPrevState }`** —— 这是本轮唯一的
     * 语义选择（`docs/android/web-runtime-blockers.md` #10 有完整理由）：
     * `getViewPrevState()` 自己已经写了 `?? { ...DEFAULT_SETTING.viewPrevState }`（`utils/ipc.ts:225`），
     * 但那只兜"通道 resolve 成 null/undefined"，**兜不住 reject**。这里**故意不复用那个默认值**：
     * `{ url: '/list', query: {} }` 的语义是"上次停在 /list" —— 那是一份**声称自己知道用户上次在哪里的
     * 断言**。取不到就是取不到，拿它去 `router.replace()` 等于把用户带到一个**他从未选择的页面**，
     * 并让后面的 `initData()` / `initPlayer()` 在伪造的路由状态上跑。所以：
     * - `null` = "这次没拿到上次的视图"，是**这一事实在渲染层的表示**，不是假数据；
     * - `state == null` ⇒ **整个 `router.replace()` 一步跳过**，应用停在它自己**当前的真实路由**上
     *   （本工程 `src/renderer/router.ts:65` 的 `/:pathMatch(.*)*` → `redirect: '/list'` 本来就会把
     *   空 hash 落到 `/list`，但那是一条**真实存在**的路由规则，不是这里编出来的 query）；
     * - `state != null` ⇒ 与改动前**逐字相同**的 `isRemovedLoveList` 判断 + `router.replace()`；
     * - **回调继续往下走**：`initData()` / `initPlayer()` / `sendInited()` 等该跑的一步不少 ——
     *   "降级但继续"，不是"整段不跑"。`initData()` 自己没有降级点，它缺数据时会按**它自己的**
     *   失败形状暴露（本轮实测见 #11），这里**不替它塞假数据**。
     *
     * **不假装成功**：降级不是静默的 —— web 侧 `platform/ipcFallback/web.js` 会打一条
     * `console.warn`（含通道名 `winMain_get_data`、失败原因、"已使用渲染层默认值继续挂载"）。
     * 真正的上次视图仍然要等原生桥（`docs/android/ipc-contract.md` §4.1 的 `winMain_get_data`）。
     *
     * **桌面语义没有变化（逐条）**：
     * - `platform/ipcFallback` 默认路径是 `invoke(channel)` 逐字透传，第三个 `fallback` 参数
     *   桌面端**根本不读** ⇒ `null` 这个兜底值在桌面端**永远不会被构造**，`if (state != null)`
     *   在桌面端**恒为真**，括号里的两行（`isRemovedLoveList` / `router.replace()`）与改动前逐字相同；
     * - 桌面端 `invokeWithFallback(...)` 返回的就是 `getViewPrevState()` 那个 Promise，
     *   调用时机、参数、时序与改动前一致（`invokeWithFallback` 是同步调用 `invoke`）；
     * - 桌面端 `winMain_get_data` 若真的 reject，仍然是**未处理的 rejection（大声失败）、
     *   下面的初始化照旧不执行** —— 与改动前完全一致，没有变成"没有视图就跳过路由恢复"还能往下走
     *   （理由与 #7 / #9 相同：主进程自己提供的通道坏掉 = IPC 整体是坏的，留着大声失败更有诊断价值）。
     */
    const state = await invokeWithFallback(async() => getViewPrevState(), WIN_MAIN_RENDERER_EVENT_NAME.get_data, () => null)
    if (state != null) {
      // 内置「我的收藏」列表已删除：老配置里记录的列表页选中项不再有效，
      // 此时不带上 query，让列表页回落到「试听列表」（见 utils/data.ts 的 getListPrevSelectId）
      const isRemovedLoveList = (state.query as { id?: string }).id === LEGACY_LOVE_LIST_ID
      await router.replace({ path: '/list', query: state.url === '/list' && !isRemovedLoveList ? state.query : {} })
    }

    /**
     * `initData()` 的调用点（Android 移植 · 阶段 3 / 线 J，阻塞点 #11 与同一链上的 `sendInited()`）。
     *
     * 改动前这里是 `void initData().then(() => { … })` —— **只有 `.then`、没有失败分支**。
     * `initData()` 内部那一组平台通道（`player_list_*` / `dislike_*`）在 Android 上没有原生桥，
     * 于是它必然 reject ⇒ 下面这几步（`initPlayer()` / `handleEnvParams()` / `initDeeplink()` /
     * `initStatusbarLyric()` / `sendInited()` / `handleListAutoUpdate()`）**一步都不执行**
     * （§4.8 的实测：A/B 两轮 PNG 逐字节相同，B 轮只多出两条来自 `initData()` 链路的 rejection）。
     * `useDataInit.ts` 本轮已把那 4 处逐条接上 `subscribeSkippable` / `invokeSkippable`，
     * 所以 web 侧 `initData()` 已经不会再因为"通道缺失"而 reject；这里补的是 **P0-8 要求的
     * 那个失败分支**，作用是把"一条数据通道坏掉就吃掉后面整段初始化"这件事彻底关掉：
     *
     * - 下面这几步的输入分别来自 `envParams`、store 与 `window.rain`，**没有一个来自
     *   `initData()` 的返回值** ⇒ "失败也继续"在语义上是良定义的，不是"拿假数据让它看起来成功"；
     * - 失败**大声**：`console.error` 带原始 error 对象，不静默、不吞掉；
     * - 顺序不变：成功路径与失败路径调用的是**同一个** `initInited()`，逐字相同。
     *
     * **桌面语义（本轮唯一一处桌面可见的变化，写在明处）**：桌面端 `initData()` 真的 reject 时
     * （= 主进程的列表 / DB 通道坏了），改动前是"未处理 rejection + 后面几步不执行"，
     * 现在是"一条 `console.error` + 后面几步照跑"。理由两条：
     * ① 这正是 P0-8 要求的形状（否则一条数据通道坏掉会连带吃掉播放器与 `winMain_inited` 握手）；
     * ② 它与本仓库**已有**的同型分支一致 —— `useDataInit.ts:38-40` 的
     * `Promise.all([initUserApi()]).catch(err => log.error(err))` 就是"失败也要继续"，改动前就在。
     * 桌面端各平台通道的**调用时机、参数、异常传播**都没有变，变的只是这一个调用点的控制流。
     *
     * `sendInited()` 是这条链上的**下一个**同步抛错点（`rendererSend` → 桥的 `send` 在 web 侧
     * "调用即抛错"）。改动前它会把整个 `.then` 回调打断 ⇒ 后面的 `handleListAutoUpdate()` 不执行，
     * 而且"是谁打断的"只以一条未处理 rejection 的形状出现。现在按同一层降级：
     * `invokeSkippable` 包住这一次 `send` —— web 侧跳过并留一条 `console.error`；
     * 桌面侧仍在**同步段**里调用 `rendererSend`（`platform/ipcFallback` 的桌面适配器是
     * `invoke(channel)` 逐字透传，第三个参数根本不读），时机与参数逐字不变。
     *
     * `winMain_inited` 是 **(A) 类通道**（`docs/android/ipc-contract.md` §4.1
     * 「设置 / 环境 / 初始化握手」）：Android 侧需要原生桥真的实现它，本轮只是"跳过并留下痕迹"。
     */
    const initInited = () => {
      initPlayer()
      handleEnvParams(envParams) // 处理传入的启动参数
      void initDeeplink(envParams)
      void initStatusbarLyric()
      // 这里用 `void` 显式表示"故意丢弃返回值"：`invokeSkippable` 内部已经 `.catch` 过，
      // 不会留下未处理 rejection（与 `subscribe.ts:131` 的写法一致）。
      void invokeSkippable(async() => {
        sendInited()
      }, WIN_MAIN_RENDERER_EVENT_NAME.inited, 'A', '已跳过「渲染层初始化完成」握手通知')

      handleListAutoUpdate()
    }

    // 初始化我的列表、下载列表等数据
    void initData().then(initInited, (err: unknown) => {
      console.error('[renderer/core/useApp] initData() 失败（我的列表 / 下载列表 / 不喜欢列表未初始化），已按"失败也要继续"的分支执行不依赖它的初始化步骤（阻塞点 #11 的兜底）：', err)
      initInited()
    })
  })
}
