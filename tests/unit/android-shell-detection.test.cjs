const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-ts.cjs')

// `src/renderer/platform/index.ts` 的 shell 判定是验收项「Android 上不出现 macOS 交通灯」的
// **唯一**开关：`WindowControls.vue` 只按它决定渲染交通灯、还是渲染那个零尺寸占位元素。
//
// 真机上只会落到其中一条分支（Android 一条、桌面一条），其余分支在实机永远跑不到，
// 所以在这里把整张判定表逐条钉住。`tests/ui/window-controls-shell.electron.cjs` 负责另一半
// 证据：这两条分支**渲染出来的 DOM** 确实一个有三颗按钮、一个一颗都没有。
const shellOf = globals => load('src/renderer/platform/index.ts', {}, globals)
const electronVersions = { versions: { electron: '42.11.6' } }
const androidBridge = { getPlatform: () => 'android', isNativePlatform: () => true }

test('Capacitor 原生壳判定为移动端，渲染层不该有窗口控制', () => {
  // Android WebView 里没有 Node 的 `process`（`index.ts:47-48` 就是为此写的属性访问），
  // 所以这一条同时证明「process 完全缺失时不能抛 ReferenceError」——真抛了，
  // 渲染层会在启动时白屏，比多三颗假按钮严重得多。
  const mod = shellOf({ Capacitor: androidBridge, process: undefined })
  assert.equal(mod.shell, 'capacitor')
  assert.equal(mod.isDesktopShell, false, '移动端不能判定为桌面壳')
  assert.equal(mod.isMobileShell, true)
  assert.equal(mod.hasWindowControls, false)
})

test('原生桥与 Electron 痕迹同时存在时仍判定为移动端', () => {
  // `index.ts:74-77` 的判定顺序是**原生桥优先**，防的就是这一类：某个 polyfill 让
  // `process.versions.electron` 在 WebView 里也出现。一旦这里退化，Android 上就会渲染出
  // 三颗按不动的交通灯 —— 也就是本次移植要根除的那个现象。
  const mod = shellOf({ Capacitor: androidBridge, process: electronVersions })
  assert.equal(mod.shell, 'capacitor')
  assert.equal(mod.isDesktopShell, false)
  assert.equal(mod.hasWindowControls, false)
})

test('Electron 渲染进程判定为桌面壳，交通灯必须照旧渲染', () => {
  // 反方向同样要钉：交通灯是桌面版关闭 / 最小化 / 全屏的**唯一**入口
  // （主窗口 `frame: false`）。把判定写死成 false 能让 Android 通过，却会让桌面用户
  // 无法关闭窗口，所以这两条必须是成对的用例。
  const mod = shellOf({ process: electronVersions })
  assert.equal(mod.shell, 'electron')
  assert.equal(mod.isDesktopShell, true)
  assert.equal(mod.isMobileShell, false)
  assert.equal(mod.hasWindowControls, true)
})

test('既不是 Electron 也不是原生壳时按非桌面处理', () => {
  // 纯浏览器里跑构建产物（`docs/android/ipc-contract.md` 的调试方式）：宁可没有窗口控制，
  // 也不能渲染三个点了没反应的按钮。
  const mod = shellOf({ process: undefined })
  assert.equal(mod.shell, 'unknown')
  assert.equal(mod.isDesktopShell, false)
  assert.equal(mod.hasWindowControls, false)
})

test('浏览器端 Capacitor 运行时不算原生壳', () => {
  // Capacitor 的 JS 运行时在普通网页里也会注入 `window.Capacitor`，
  // 此时 `isNativePlatform()` 为 false（`index.ts:61`）。认错它会直接把桌面版判成移动端。
  const mod = shellOf({
    Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
    process: undefined,
  })
  assert.equal(mod.shell, 'unknown')
  assert.equal(mod.isDesktopShell, false)
})

test('没有 isNativePlatform 的旧桥退回 getPlatform 判断', () => {
  // `index.ts:65-66` 的兜底分支：只有 `getPlatform()` 时按它是否等于 'web' 决定。
  const legacyAndroid = shellOf({ Capacitor: { getPlatform: () => 'android' }, process: undefined })
  assert.equal(legacyAndroid.shell, 'capacitor')
  const legacyWeb = shellOf({ Capacitor: { getPlatform: () => 'web' }, process: undefined })
  assert.equal(legacyWeb.shell, 'unknown')
  assert.equal(legacyWeb.isDesktopShell, false)
})
