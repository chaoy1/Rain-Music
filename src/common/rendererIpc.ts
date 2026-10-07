/**
 * 渲染层 IPC 门面。
 *
 * ⚠️ 这里**不要**直接 `import { ipcRenderer } from 'electron'`：
 * `electron` 不是浏览器能提供的东西，在 `target: 'web'` 的构建里会让 npm 包
 * `node_modules/electron` 被整包打进产物、并在加载期以
 * `ReferenceError: __dirname is not defined` 炸掉整个 `renderer.js`。
 * 传输实现收口在 `@common/platform/ipcBridge`（构建期替换，桌面 = `ipcRenderer` 透传，
 * web/Capacitor = 占位实现，见 `docs/android/web-runtime-blockers.md`）。
 */
import { bridge } from '@common/platform/ipcBridge'

export function rendererSend(name: string): void
export function rendererSend<T>(name: string, params: T): void
export function rendererSend<T>(name: string, params?: T): void {
  bridge.send(name, params)
}

export function rendererSendSync(name: string): void
export function rendererSendSync<T>(name: string, params: T): void
export function rendererSendSync<T>(name: string, params?: T): void {
  bridge.sendSync(name, params)
}

export async function rendererInvoke(name: string): Promise<void>
export async function rendererInvoke<V>(name: string): Promise<V>
export async function rendererInvoke<T>(name: string, params: T): Promise<void>
export async function rendererInvoke<T, V>(name: string, params: T): Promise<V>
export async function rendererInvoke <T, V>(name: string, params?: T): Promise<V> {
  return bridge.invoke(name, params)
}

export function rendererOn(name: string, listener: Rain.IpcRendererEventListener): void
export function rendererOn<T>(name: string, listener: Rain.IpcRendererEventListenerParams<T>): void
export function rendererOn<T>(name: string, listener: Rain.IpcRendererEventListenerParams<T>): void {
  bridge.on(name, listener)
}

export function rendererOnce(name: string, listener: Rain.IpcRendererEventListener): void
export function rendererOnce<T>(name: string, listener: Rain.IpcRendererEventListenerParams<T>): void
export function rendererOnce<T>(name: string, listener: Rain.IpcRendererEventListenerParams<T>): void {
  bridge.once(name, listener)
}

export const rendererOff = (name: string, listener: (...args: any[]) => any) => {
  bridge.off(name, listener)
}

export const rendererOffAll = (name: string) => {
  bridge.offAll(name)
}
