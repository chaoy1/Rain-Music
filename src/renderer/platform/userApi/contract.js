// Keep these public filters aligned with main/modules/userApi/renderer/preload.js.
const qualities = ['128k', '320k', 'flac', 'flac24bit']
const platforms = {
  tx: { actions: ['musicUrl'], qualitys: qualities },
  kg: { actions: ['musicUrl'], qualitys: qualities },
  wy: { actions: ['musicUrl'], qualitys: qualities },
  local: { actions: ['musicUrl', 'lyric', 'pic'], qualitys: [] },
}

export const filterSources = info => {
  if (!info?.sources || typeof info.sources !== 'object') throw new Error('Missing required parameter init info.sources')
  if (info.openDevTools === true) throw new Error('Unsupported capability: openDevTools')
  const sources = {}
  for (const [source, supported] of Object.entries(platforms)) {
    const value = info.sources[source]
    if (!value || value.type !== 'music') continue
    if (!Array.isArray(value.actions) || !Array.isArray(value.qualitys)) throw new Error(`Invalid source actions/qualitys: ${source}`)
    sources[source] = {
      type: 'music',
      actions: supported.actions.filter(action => value.actions.includes(action)),
      qualitys: supported.qualitys.filter(quality => value.qualitys.includes(quality)),
    }
  }
  return sources
}

export const httpUrl = value => {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//.test(value)) throw new Error('Invalid HTTP URL')
  const url = new URL(value)
  if (!url.hostname || url.username || url.password) throw new Error('Invalid HTTP URL')
  return value
}

export const requestResult = (data, response) => {
  let result
  switch (data.action) {
    case 'musicUrl': result = { type: data.info?.type, url: httpUrl(response) }; break
    case 'pic': result = httpUrl(response); break
    case 'lyric':
      if (!response || typeof response !== 'object' || typeof response.lyric !== 'string' || response.lyric.length > 51200) throw new Error('failed: invalid lyric')
      result = { lyric: response.lyric }
      for (const [field, limit] of [['tlyric', 5120], ['rlyric', 5120], ['rainlyric', 8192]]) {
        result[field] = typeof response[field] === 'string' && response[field].length < limit ? response[field] : null
      }
      break
    default: throw new Error('Unsupported action')
  }
  return { source: data.source, action: data.action, data: result }
}

export const parseScriptInfo = script => {
  if (typeof script !== 'string' || script.length > 2 * 1024 * 1024) throw new Error('Invalid custom source script (max 2 MiB characters)')
  const header = /^\/\*[\s\S]+?\*\//.exec(script)
  if (!header) throw new Error('无效的自定义源文件')
  const info = {}
  const limits = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 }
  for (const line of header[0].split(/\r?\n/)) {
    const match = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line)
    if (match && Object.hasOwn(limits, match[1])) info[match[1]] = match[2].trim()
  }
  for (const [key, limit] of Object.entries(limits)) {
    info[key] ||= ''
    if (info[key].length > limit) info[key] = info[key].substring(0, limit) + '...'
  }
  info.name ||= `user_api_${new Date().toLocaleString()}`
  return info
}

export const USER_API_CHANNELS = {
  import_user_api: 'importApi',
  get_user_api_list: 'getApiList',
  remove_user_api: 'removeApi',
  set_user_api: 'setApi',
  get_user_api_status: 'getStatus',
  request_user_api: 'request',
  request_user_api_cancel: 'cancelRequest',
  user_api_set_allow_update_alert: 'setAllowShowUpdateAlert',
}

export const invokeUserApiChannel = (host, channel, params) => {
  const method = USER_API_CHANNELS[channel.replace(/^winMain_/, '')]
  if (!method) throw new Error(`Unsupported user API channel: ${channel}`)
  return method === 'setAllowShowUpdateAlert' ? host[method](params?.id, params?.enable) : host[method](params)
}
