/**
 * Rain Music Android 移植 · 阶段 2 / 线 B：**兼容转发层（薄）**
 *
 * 原来的 `Store` 实现（Node `fs` 原子写 + `.bak` 损坏恢复）已经搬到
 * `src/main/platform/storage/`：
 *
 * - 平台无关内核：`src/main/platform/storage/core.ts`
 * - 桌面实现：`src/main/platform/storage/electron.ts`（逐字等价，默认路径）
 * - Android 骨架：`src/main/platform/storage/adapter.android.ts`
 * - 构建期入口：`src/main/platform/storage/adapter.ts`
 *
 * 这个文件保留下来只为**兜住旧 import 路径**（`@main/utils/store`），
 * 新代码请直接 import `@main/platform/storage/adapter`。
 */
export { default, getStore, type Store } from '@main/platform/storage/adapter'
