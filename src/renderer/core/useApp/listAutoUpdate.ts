import { getListUpdateInfo } from '@renderer/utils/data'
import { userLists } from '@renderer/store/list/state'
import syncSourceList from '@renderer/store/list/syncSourceList'
// 与 `useDataInit.ts` / `useApp/index.ts` 同一个降级入口（`platform/ipcFallback/subscribe.ts`）。
import { invokeSkippable } from '@renderer/platform/ipcFallback/subscribe'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

const handleSyncSourceList = async(waitUpdateLists: Rain.List.UserListInfo[]) => {
  if (!waitUpdateLists.length) return
  const targetListInfo = waitUpdateLists.shift()!
  // console.log(targetListInfo)
  try {
    await syncSourceList(targetListInfo)
  } catch {}
  void handleSyncSourceList(waitUpdateLists)
}

/**
 * 列表自动更新检查（Android 移植 · 阶段 3 / 线 J）。
 *
 * 这是 `useApp/index.ts` 的 `.then` 回调里**最后一步**，改动前是
 * `void getListUpdateInfo().then(…)` —— **没有 `.catch`**。它走的
 * `winMain_get_data`（`@renderer/utils/data.ts:106` → `getListUpdateInfoFromData`，
 * 目录里是 `DATA_KEYS.listUpdateInfo`）在 Android 上没有原生桥 ⇒ 这条取值必然 reject ⇒
 * 除了多一条未处理 rejection，`handleSyncSourceList()` 那一步永远不执行。
 * 它还是**桌面端也存在的隐患**：`getListUpdateInfoFromData()` 的声明返回类型本来就是
 * `Rain.List.ListUpdateInfo | null`（`utils/ipc.ts:188` 的 `?? {}` 只兜住 `null`，
 * 兜不住 reject），而改动前这里直接 `Object.entries(listUpdateInfo)`。
 *
 * 处理方式（`winMain_get_data` 是 **(C) 类**，见 `docs/android/ipc-contract.md` §4.3）：
 * - 走**同一个** `invokeSkippable`：取值失败 ⇒ `undefined` ⇒ **整个自动更新检查一步跳过**
 *   （`userLists` 保持它自己的状态，不塞任何假数据）；
 * - 顺带把 `if (!listUpdateInfo) return` 写清楚：`null` / `undefined` 都是这条通道
 *   本来就可能给出的"没有列表更新记录"的正常取值，不该走到 `Object.entries(null)` 上；
 * - **不假装成功**：降级留一条 `console.error`（含通道名 `winMain_get_data` 与 reason）。
 *
 * **桌面语义**：`invokeSkippable` 在桌面侧仍然是同一个 `invokeWithFallback`（通道名、参数、
 * 调用时机逐字不变，`getListUpdateInfo()` 仍在**同步段**里被调用）。唯一差异与
 * `useDataInit.ts` 的那 4 处同型：桌面端这条通道若真的 reject，改动前是"未处理 rejection +
 * 这一步不执行"，现在会变成一条 `console.error`（`已跳过…`）**并继续**（这里本来就是最后一步，
 * 所以"继续"等于什么都不做）。另外新增的 `if (!listUpdateInfo) return` 顺带修掉了
 * "通道 resolve 成 `null` 时 `Object.entries(null)` 抛 TypeError"这个桌面端既有的隐患。
 */
export default () => {
  const handleListAutoUpdate = async() => {
    const listUpdateInfo = await invokeSkippable(async() => getListUpdateInfo(), WIN_MAIN_RENDERER_EVENT_NAME.get_data, 'C', '已跳过列表自动更新检查')
    if (!listUpdateInfo) return
    const waitUpdateLists = Object.entries(listUpdateInfo)
      .map(([id, info]) => info.isAutoUpdate && userLists.find(l => l.id == id))
      .filter(_ => _) as Rain.List.UserListInfo[]
    // for (let i = 2; i > 0; i--) {
    //   void handleSyncSourceList(waitUpdateLists)
    void handleSyncSourceList(waitUpdateLists)
    // }
  }
  void handleListAutoUpdate()
}
