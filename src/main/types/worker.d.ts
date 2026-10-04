import { type workerDBSeriveTypes } from '@main/worker/dbService'

declare global {
  // interface WorkerDBSeriveTypes {
  //   list: typeof list
  // }
  namespace Rain {
    type WorkerDBSeriveListTypes = workerDBSeriveTypes
  }
}
