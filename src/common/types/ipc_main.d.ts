declare namespace Rain {
  interface IpcMainEvent {
    event: Electron.IpcMainEvent
  }
  interface IpcMainEventParams<T> {
    event: Electron.IpcMainEvent
    params: T
  }
  type IpcMainEventListener = (params: Rain.IpcMainEvent) => void
  type IpcMainEventListenerParams<T> = (params: Rain.IpcMainEventParams<T>) => void

  interface IpcMainInvokeEvent {
    event: Electron.IpcMainInvokeEvent
  }
  interface IpcMainInvokeEventParams<T> {
    event: Electron.IpcMainInvokeEvent
    params: T
  }

  type IpcMainInvokeEventListener = (params: Rain.IpcMainInvokeEvent) => Promise<void>
  type IpcMainInvokeEventListenerParams<T> = (params: Rain.IpcMainInvokeEventParams<T>) => Promise<void>
  type IpcMainInvokeEventListenerValue<V> = (params: Rain.IpcMainInvokeEvent) => Promise<V>
  type IpcMainInvokeEventListenerParamsValue<T, V> = (params: Rain.IpcMainInvokeEventParams<T>) => Promise<V>
}
