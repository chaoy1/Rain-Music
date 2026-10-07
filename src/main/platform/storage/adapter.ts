/**
 * Rain Music Android 移植 · 阶段 2 / 线 B：**存储适配器入口（构建期可替换）**
 *
 * ## 这个文件是什么
 *
 * 主进程里**所有**「设置 / JSON 键值存储 / 配置文件 / 主题图片」的读写都要从这里 import。
 *
 * 当前内容 = **桌面实现**（`electron.ts`，逐字包住原来的 Node `fs` 行为），
 * 因此桌面端行为不变、且这是默认路径。
 *
 * ## Android 怎么换（阶段 3 的唯一改动点）
 *
 * 与 `docs/android/ipc-contract.md:682` 给渲染层的 `@platform` 别名是同一手法：
 * **用 webpack `resolve.alias` 做构建期替换**，不要用运行期 `if`。
 *
 * 理由（这条很重要）：运行期分支会为了"判断平台"而 `require('electron')`，
 * 那样 `electron` 模块会被打进 Android bundle，webpack 直接构建失败。
 * 契约里对渲染层写得很清楚（`docs/android/ipc-contract.md:680-682`），主进程同理。
 *
 * ### 具体做法
 *
 * 1. `build-config/main/webpack.config.base.js` 的 `resolve.alias` 追加：
 *
 *    ```js
 *    // Android（Capacitor）构建专用：见 build-config/main/webpack.config.capacitor.js
 *    '@main/platform/storage/adapter$': path.join(
 *      __dirname, '../../src/main/platform/storage/adapter.android.ts',
 *    ),
 *    ```
 *
 *    `$` 后缀让别名只精确命中这个模块，不会连带影响
 *    `@main/platform/storage/adapter.android` 之类的长路径。
 *
 * 2. Android 侧需要一个只编译 `src/main/platform/**` + 业务层的 webpack 配置
 *    （`target: 'web'`），不复用现在的 `target: 'electron-main'`。
 *    **本轮不建这个配置**：本机没有 Android 环境，建了也没法验证（见任务约束）。
 *
 * 3. 把 `adapter.android.ts` 里所有 `未实现` 的方法按注释落地，
 *    并把启动期的 `await hydrateStorage()` 接到应用初始化流程里。
 *
 * 4. 调用点的 `set()` 改成 `await setAsync()`：桌面同步、Android 异步
 *    （理由见 `src/common/storage/types.ts` 的 `IStore` 注释）。
 *
 * ## 为什么不做成 `export { default } from './electron'` 这种一行 re-export
 *
 * 因为 `adapter.android.ts` 的导出面必须与这里**完全一致**（`default` / `getStore` /
 * `Store` 类型），本文件同时也是那份"导出面清单"。写成 re-export 反而让读者
 * 需要跳两次才能确认差异。
 */

export { default, getStore, type Store } from './electron'
export { electronStoreAdapter, electronConfigFiles, electronThemeFiles } from './electron'

/**
 * 与平台无关的名字（阶段 3 / 线 C 新增）。
 *
 * 业务层（`src/main/utils/themeImages.ts`）只会 import 这个中性名，于是
 * `adapter.android.ts` **必须**导出同名成员，构建期换 alias 后类型检查立刻能指出缺口。
 * 之前只有 `electron*` / `android*` 两套不同名导出，alias 一换就会 "no exported member"。
 */
export { electronThemeFiles as themeFiles } from './electron'
