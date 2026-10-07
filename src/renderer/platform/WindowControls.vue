<template>
  <TrafficLights v-if="isDesktopShell" />
  <div v-else data-mobile-title-bar aria-hidden="true" />
</template>

<script setup>
// 窗口控制槽位（Android 移植 · 阶段 1a）。
//
// 桌面（Electron）→ 原样渲染 macOS 风格交通灯，且**不额外包一层 DOM**：
//   `v-if` 为真时根节点就是 `<TrafficLights>` 组件 vnode，Vue 的属性透传会把
//   `data-detail-window-controls` 之类的属性继续落到 `TrafficLights` 的根 div 上，
//   所以 `tests/ui/responsive-layout.electron.cjs:89`（断言 3 个
//   `[data-native-window-control]`）与 `tests/ui/song-detail.electron.cjs:180`
//   （断言 `[data-detail-window-controls] button` 有 3 个）看到的 DOM 与改动前一致。
//
// Android（Capacitor WebView）→ 不渲染任何按钮，只留一个零尺寸占位元素：
//   · `Aside/index.vue`：外层 `.windowHeader` 自带 `height: @height-toolbar`，占位元素宽度为 0，
//     侧边栏标题栏高度不变，不会因为少了交通灯而上下跳动；
//   · `PlayDetail/index.vue`：header 是 `grid-template-columns: 88px minmax(0, 1fr) 88px`，
//     原本第 1 列由交通灯占住。占位元素成为第 1 个 grid item，继续占住左列，
//     标题才保持居中、右侧关闭按钮才留在第 3 列。
//
// 这个占位元素同时是 Android 后续放"返回 / 菜单"入口的唯一位置
// （`docs/android/ipc-contract.md` §5.3 方案 2：只改一处）。
import TrafficLights from '@renderer/components/layout/Toolbar/TrafficLights.vue'
import { isDesktopShell } from '@renderer/platform'

defineOptions({ name: 'WindowControls' })
</script>
