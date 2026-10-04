declare namespace Rain {
  interface IpcRendererEvent {
    event: Electron.IpcRendererEvent
  }
  interface IpcRendererEventParams<T> {
    event: Electron.IpcRendererEvent
    params: T
  }
  type IpcRendererEventListener = (params: Rain.IpcRendererEvent) => any
  type IpcRendererEventListenerParams<T> = (params: Rain.IpcRendererEventParams<T>) => any
}
