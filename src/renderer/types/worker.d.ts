import { type workerMainTypes } from '@renderer/worker/main/index'
import { type workerDownloadTypes } from '@renderer/worker/download/index'


declare global {
  namespace Rain {
    type WorkerMainTypes = workerMainTypes
    type WorkerDownloadTypes = workerDownloadTypes
  }
}
