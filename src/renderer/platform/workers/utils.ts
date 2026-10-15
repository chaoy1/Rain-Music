import * as Comlink from 'comlink'
import { createAndroidDownloadFacade } from '../download/android'

export const createMainWorker = () => Comlink.wrap<Rain.WorkerMainTypes>(new Worker(new URL('../../worker/main', import.meta.url)))
export const createDownloadWorker = createAndroidDownloadFacade
export const proxyCallback = <Args extends any[]>(callback: (...args: Args) => void) => callback
