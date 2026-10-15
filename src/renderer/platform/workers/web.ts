import { createMainWorker } from './utils'
import { createAndroidDownloadFacade } from '../download/android'

// Download sockets and file writes run natively; pure list/lyric processing keeps
// using the existing browser Worker. Callback functions stay in the WebView.
export default () => ({ main: createMainWorker(), download: createAndroidDownloadFacade() })
