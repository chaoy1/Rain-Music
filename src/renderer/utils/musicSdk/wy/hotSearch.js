import { eapiRequest } from './utils/index'

export default {
  _requestObj: null,
  async getList(retryNum = 0) {
    if (this._requestObj) this._requestObj.cancelHttp()
    if (retryNum > 2) return Promise.reject(new Error('try max num'))

    const _requestObj = eapiRequest('/api/search/chart/detail', {
      id: 'HOT_SEARCH_SONG#@#',
    })
    const { body, status } = await _requestObj.promise
    if (status != 200 || body.code !== 200) throw new Error('获取热搜词失败')

    return { source: 'wy', list: this.filterList(body.data.itemList) }
  },
  filterList(rawList) {
    return rawList.map(item => item.searchWord)
  },
}
