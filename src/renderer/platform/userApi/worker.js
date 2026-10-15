import { installUserApiWorker } from './worker-runtime'
import { createUserApiUtils } from './utils'

installUserApiWorker(globalThis, createUserApiUtils(globalThis.crypto))
