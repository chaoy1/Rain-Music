
import { throttle } from '@common/utils/common'
import { toRaw } from '@common/utils/vueTools'
import {
  getSearchHistoryList,
  saveSearchHistoryList,
} from '@renderer/utils/ipc'
import { searchText, historyList } from './state'


export const setSearchText = (text: string) => {
  searchText.value = text
}

let isInitedSearchHistory = false
const saveSearchHistoryListThrottle = throttle((list: Rain.List.SearchHistoryList) => {
  saveSearchHistoryList(list)
}, 500)


export const getHistoryList = async() => {
  if (isInitedSearchHistory || historyList.length) return
  historyList.push(...(await getSearchHistoryList() ?? []))
  isInitedSearchHistory ||= true
}
export const addHistoryWord = async(word: string) => {
  // search.isShowHistorySearch 设置项已移除，行为固定为「显示搜索历史」，
  // 因此不再有「未显示历史时不记录」的提前返回。
  if (!isInitedSearchHistory) await getHistoryList()
  let index = historyList.indexOf(word)
  if (index == 0) return
  if (index > -1) historyList.splice(index, 1)
  if (historyList.length >= 15) historyList.splice(14, historyList.length - 14)
  historyList.unshift(word)
  saveSearchHistoryListThrottle(toRaw(historyList))
}
export const removeHistoryWord = (index: number) => {
  historyList.splice(index, 1)
  saveSearchHistoryListThrottle(toRaw(historyList))
}
export const clearHistoryList = (id: string) => {
  historyList.splice(0, historyList.length)
  saveSearchHistoryList([])
}
