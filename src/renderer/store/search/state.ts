import { ref, shallowReactive } from '@common/utils/vueTools'


export const searchText = ref('')

export type onlineSource = Rain.OnlineSource


export const historyList = shallowReactive<string[]>([])
