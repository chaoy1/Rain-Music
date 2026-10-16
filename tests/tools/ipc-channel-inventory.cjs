// 通道清单核对工具（**不是测试**：`node --test tests/unit/*.test.cjs` 不会跑它）：
// 把"渲染层用到的通道"与"Android 侧注册的通道"各解析一遍，打印差集。
//
// ⚠️ 2026-10-16 实测结论：**它现在还不能当守卫用**，因为两边口径不同 ——
//   · 渲染层那侧把**桌面专有**通道（winMain_close/min/quit/fullscreen/hotKey_* …）全算进来，
//     差集 75 条；而 docs/android/handoff.md §6.1 那张表只列"对 Android 有实际影响"的部分；
//   · 原生那侧的名字混了常量、`PREFIX + "x"`、`bind(plugin, "x", …)`、以及**循环拼出来**的名字
//     （`"get_lyric_" + source`）：本工具解析出 45 条（含 1 条前缀假名），与 §6.1 记的 48 条对不上。
// ⇒ 要做成自动守卫，得先把"桌面专有 / 范围外"那 75 条**逐条分类**并固化进用例；
//   在那之前，**§6.1 那张表仍然是权威**。用法：`node tests/tools/ipc-channel-inventory.cjs`
const fs = require('node:fs')
const path = require('node:path')

const repo = 'D:/Documents/Projects/Rain Music/rain-music-desktop'
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const walk = (dir, extensions, out = []) => {
  for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(relative, extensions, out)
    else if (extensions.some(ext => entry.name.endsWith(ext))) out.push(relative)
  }
  return out
}

// ---------------------------------------------------------------- 1) 契约：ipcNames.ts
const ipcNames = read('src/common/ipcNames.ts')
const contract = new Set()
const moduleOfConstant = {}
{
  const start = ipcNames.indexOf('const modules = {')
  const end = ipcNames.indexOf('\n}\n', start)
  let module = null
  for (const line of ipcNames.slice(start, end).split('\n')) {
    const moduleMatch = /^  (\w+):\s*\{/.exec(line)
    if (moduleMatch) { module = moduleMatch[1]; continue }
    const keyMatch = /^    (\w+):/.exec(line)
    if (keyMatch && module) contract.add(`${module}_${keyMatch[1]}`)
  }
  for (const match of ipcNames.matchAll(/export const (\w+_EVENT_NAME) = modules\.(\w+)/g)) moduleOfConstant[match[1]] = match[2]
}
console.log(`contract channels (ipcNames.ts): ${contract.size}`)
console.log(`exported module constants: ${JSON.stringify(moduleOfConstant)}`)

// ---------------------------------------------------------------- 2) 渲染层用到哪些
const rendererFiles = [...walk('src/renderer', ['.ts', '.js', '.vue']), ...walk('src/common/platform/ipcBridge', ['.ts', '.js'])]
const usedBy = new Map()
const note = (channel, where) => { if (!usedBy.has(channel)) usedBy.set(channel, where) }
for (const file of rendererFiles) {
  const text = read(file)
  for (const match of text.matchAll(/\b(CMMON_EVENT_NAME|PLAYER_EVENT_NAME|DISLIKE_EVENT_NAME|WIN_MAIN_RENDERER_EVENT_NAME|WIN_LYRIC_RENDERER_EVENT_NAME|HOTKEY_RENDERER_EVENT_NAME)\.(\w+)/g)) {
    const module = moduleOfConstant[match[1]]
    if (module) note(`${module}_${match[2]}`, `${file}`)
  }
  // 直接写字符串的通道。⚠️ 必须排除 `__`：i18n 的键就是 `player__play` 这种形状，
  // 第一版没排除，于是 40 多个翻译键被当成了通道（教训：先看差额里有没有明显的假阳性）。
  for (const match of text.matchAll(/['"]((?:winMain|common|player|dislike|hotKey|winLyric)_[A-Za-z0-9_]+)['"]/g)) {
    if (!match[1].includes('__')) note(match[1], `${file}`)
  }
}
console.log(`channels referenced by the renderer: ${usedBy.size}`)

// ---------------------------------------------------------------- 3) 原生注册了哪些
const javaFiles = walk('android/app/src/main/java/com/rainmusic/mobile/ipc', ['.java'])
const registered = new Map()
const perFile = {}
for (const file of javaFiles) {
  const text = read(file)
  let count = 0
  const add = (channel, where) => { registered.set(channel, where); count++ }
  const constants = {}
  for (const match of text.matchAll(/(?:static final\s+)?String\s+(\w+)\s*=\s*"([^"]*)"/g)) constants[match[1]] = match[2]
  const arrays = {}
  for (const match of text.matchAll(/String\[\]\s+(\w+)\s*=\s*\{([^}]*)\}/g)) {
    arrays[match[1]] = [...match[2].matchAll(/"([^"]+)"/g)].map(item => item[1])
  }
  // register(<X>, ...) / register("lit", ...) / register(PREFIX + "lit", ...)
  for (const match of text.matchAll(/RainMusicIpcHandlers\.register\(\s*([^,]+?),/gs)) {
    const argument = match[1].trim()
    let channel = null
    if (/^"[^"]*"$/.test(argument)) channel = argument.slice(1, -1)
    else if (constants[argument] != null) channel = constants[argument]
    else {
      const pair = /^(\w+)\s*\+\s*"([^"]*)"$/.exec(argument)
      if (pair && constants[pair[1]] != null) channel = constants[pair[1]] + pair[2]
    }
    if (channel) add(channel, file)
  }
  // bind(plugin, "lit", ...) ⇒ "winMain_" + lit（RainMusicMediaCacheChannels.bind）
  // ⚠️ 允许 `bind(` 与 `plugin` 之间有换行。另外这一族里有**循环生成**的名字：
  //   for (String source : new String[] { "raw", "edited" }) { bind(plugin, "get_lyric_" + source, ...) }
  // 所以下面把「循环变量 → 取值」也算出来，再展开 `"前缀" + 变量` 与 `"前缀" + 变量 + "后缀"`。
  const loopValues = {}
  for (const match of text.matchAll(/for\s*\(\s*String\s+(\w+)\s*:\s*(?:new\s+String\[\]\s*\{([^}]*)\}|(\w+))\s*\)/g)) {
    const inline = match[2] != null ? [...match[2].matchAll(/"([^"]+)"/g)].map(item => item[1]) : (arrays[match[3]] ?? [])
    loopValues[match[1]] = inline
  }
  const expand = expression => {
    const plain = /^"([^"]+)"$/.exec(expression)
    if (plain) return [plain[1]]
    const sum = /^"([^"]*)"\s*\+\s*(\w+)(?:\s*\+\s*"([^"]*)")?$/.exec(expression)
    if (sum && loopValues[sum[2]]) return loopValues[sum[2]].map(value => sum[1] + value + (sum[3] ?? ''))
    return []
  }
  for (const match of text.matchAll(/bind\(\s*plugin\s*,\s*([^,]+?)\s*,\s*"[^"]*"\s*,/g)) {
    for (const name of expand(match[1].trim())) add(`winMain_${name}`, file)
  }
  // String channel = "<prefix>" + <loopVar>;  +  for (String <loopVar> : <ARRAY>)
  for (const match of text.matchAll(/String\s+\w+\s*=\s*"([^"]*)"\s*\+\s*(\w+)\s*;/g)) {
    const prefix = match[1]
    const arrayName = new RegExp(`for\\s*\\(\\s*String\\s+${match[2]}\\s*:\\s*(\\w+)\\s*\\)`).exec(text)?.[1]
    for (const value of arrays[arrayName] ?? []) add(prefix + value, file)
  }
  perFile[path.basename(file)] = count
}
console.log(`natively registered channels: ${registered.size}`)
console.log('per file: ' + JSON.stringify(perFile))

// ---------------------------------------------------------------- 4) 差额
const usedButNotRegistered = [...usedBy].filter(([channel]) => !registered.has(channel))
const registeredButNotContract = [...registered].filter(([channel]) => !contract.has(channel))
const usedButNotContract = [...usedBy].filter(([channel]) => !contract.has(channel))
console.log(`\nrenderer-used but NOT registered: ${usedButNotRegistered.length}`)
for (const [channel, where] of usedButNotRegistered.sort()) console.log(`  ${channel.padEnd(42)} ${where}`)
console.log(`\nregistered but NOT in the contract: ${registeredButNotContract.length}`)
for (const [channel, where] of registeredButNotContract.sort()) console.log(`  ${channel.padEnd(42)} ${where}`)
console.log(`\nrenderer-used but NOT in the contract: ${usedButNotContract.length}`)
for (const [channel, where] of usedButNotContract.sort()) console.log(`  ${channel.padEnd(42)} ${where}`)
