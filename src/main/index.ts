/**
 * 主进程入口
 *
 * ⚠️ 顺序极其关键：
 *   `applyPortableDataPath()` 必须真正跑在**所有其它模块（尤其是 electron-log）
 *   被求值之前**。
 *
 *   静态 import 会被 webpack 提升到模块体之前，并且与模块体混在一起打包，
 *   单靠 import 顺序并不足以保证「重定向」先于「库读取 userData」。
 *   这里采用最稳的写法：
 *     1. 顶部只 import 绝对必要的 `app` 与重定向模块（两者都不读 userData）
 *     2. 立刻执行重定向
 *     3. 在 `app.whenReady()` 里用「动态 import」延迟加载业务模块
 *
 *   实测若不这样做，`%APPDATA%\<productName>\logs\main.log` 会被 electron-log
 *   抢先创建在用户目录里，违背「不在工作目录外留痕」的要求。
 */

import { app } from 'electron'
import { applyPortableDataPath } from './utils/dataPath'
import { configureLogPath } from './utils/logInit'

// 第一件事：把 appData / userData 重定向到 exe 同级的 portable 目录
applyPortableDataPath()

// 紧接着固定日志路径：
// electron-log 的 file transport 只在「首次写日志」时解析一次路径并缓存，
// 而 startApp 的静态依赖链在模块加载阶段就会写第一条日志，
// 因此这里必须早于下面的动态 import。
configureLogPath()

// https://github.com/electron/electron/issues/16809
void app.whenReady().then(async() => {
  const { default: initApp } = await import('./startApp')
  initApp()
})
