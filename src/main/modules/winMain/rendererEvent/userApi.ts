import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import {
  getApiList,
  importApi,
  removeApi,
  setApi,
  getStatus,
  request,
  cancelRequest,
  setAllowShowUpdateAlert,
} from '@main/modules/userApi'
import { sendEvent } from '@main/modules/winMain/main'

export default () => {
  mainHandle<string, Rain.UserApi.ImportUserApi>(WIN_MAIN_RENDERER_EVENT_NAME.import_user_api, async({ params: script }) => {
    return importApi(script)
  })

  mainHandle<string[], Rain.UserApi.UserApiInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.remove_user_api, async({ params: apiIds }) => {
    return removeApi(apiIds)
  })

  mainHandle<Rain.UserApi.UserApiSetApiParams>(WIN_MAIN_RENDERER_EVENT_NAME.set_user_api, async({ params: apiId }) => {
    await setApi(apiId)
  })

  mainHandle<Rain.UserApi.UserApiInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_list, async() => {
    return getApiList()
  })

  mainHandle<Rain.UserApi.UserApiStatus>(WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_status, async() => {
    return getStatus()
  })

  mainHandle<Rain.UserApi.UserApiSetAllowUpdateAlertParams>(WIN_MAIN_RENDERER_EVENT_NAME.user_api_set_allow_update_alert, async({ params: { id, enable } }) => {
    setAllowShowUpdateAlert(id, enable)
  })

  mainHandle<Rain.UserApi.UserApiRequestParams>(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, async({ params }) => {
    return request(params)
  })
  mainHandle<Rain.UserApi.UserApiRequestCancelParams>(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api_cancel, async({ params: requestKey }) => {
    cancelRequest(requestKey)
  })
}

export const sendStatusChange = (status: Rain.UserApi.UserApiStatus) => {
  sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, status)
}
export const sendShowUpdateAlert = (info: Rain.UserApi.UserApiUpdateInfo) => {
  sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, info)
}

