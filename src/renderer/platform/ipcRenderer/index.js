/**
 * 渲染层"裸 `ipcRenderer`"的平台入口（Android 移植 · 阶段 3 / 线 D）。
 *
 * ## 与 `src/common/platform/ipcBridge/` 的分工
 *
 * `ipcBridge`（`src/common/rendererIpc.ts` 用）是**收口后的传输契约**：send / sendSync /
 * invoke / on / once / off / offAll，两端形状一致。
 *
 * 本模块是给"契约还没覆盖到的那一小撮调用点"用的逃生口。当前只有一处：
 * `src/renderer/utils/ipc.ts` 的 `onFullscreenChanged()` —— 它的回调签名是
 * `(_event: Electron.IpcRendererEvent, isFullscreen: boolean)`，也就是**要 Electron 的
 * 事件对象本身**；`ipcBridge.on` 刻意把它包成 `{ event, params }`（两平台通用形状），
 * 拿不到"原始事件"这件事本身就是平台差异，不该塞进共用契约里。
 *
 * ## 为什么必须存在
 *
 * 不换掉的话，`src/renderer/utils/ipc.ts` 顶层那句
 * `import { ipcRenderer } from 'electron'` 会把 npm 包 `node_modules/electron`
 * 打进 web 产物；该包顶层第 6 行就是 `__dirname`，而 web 目标里
 * `node.__dirname = false` ⇒ 加载期 `ReferenceError: __dirname is not defined`。
 * 这是本轮实测的**阻塞点 #2**（阻塞点 #1 是同一个包、同一条报错，只是触发它的
 * import 在 `src/common/rendererIpc.ts`；两处都修完，`node_modules/electron` 才彻底
 * 离开 Android 产物）。
 *
 * ## 契约
 *
 * 导出名固定为 `rawIpcRenderer`，桌面侧就是 Electron 的 `ipcRenderer`。
 * web / Capacitor 侧的 `./web.js` 导出**访问即抛错**的替身（见该文件说明）。
 * 这个模块**不**在 `target: 'web'` 的产物里出现（构建期替换）。
 */
import { ipcRenderer } from 'electron'

export const rawIpcRenderer = ipcRenderer
