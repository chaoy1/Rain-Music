import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log/node'

log.transports.file.level = 'info'
// log.initialize()

/**
 * 把日志文件固定到 Electron 的 userData 目录下。
 *
 * 为什么必须显式指定：
 *   `electron-log/node` 使用的是 NodeExternalApi，其 appData 取自
 *   `process.env.APPDATA`（见 node_modules/electron-log/src/node/NodeExternalApi.js），
 *   完全绕过 Electron 的 app.setPath('appData')。
 *   因此即便主进程已把 appData/userData 重定向到便携目录，
 *   electron-log 仍会在 `%APPDATA%\<appName>\logs\main.log` 留下文件，
 *   违背「不在工作目录外留痕」的要求。
 *
 *   `vars.electronDefaultDir` 与 `app.getPath('userData')` 都走 Electron 的路径系统，
 *   会正确遵循重定向。
 *
 * ⚠️ 调用时机：
 *   electron-log 的 file transport 首次写日志时会缓存解析结果，
 *   而本项目的业务模块在**模块加载阶段**就可能写日志，
 *   这些模块经 app.ts 被静态引入。webpack 保证静态依赖先于模块体执行，
 *   所以本函数必须在 `import('./startApp')` **之前**调用，
 *   否则第一条日志已经落到错误目录，且路径被缓存下来。
 *   因此这里刻意放在独立模块中，由 index.ts 尽早调用。
 */
export const configureLogPath = () => {
  try {
    // 直接使用 Electron 的 userData，而不是 electron-log 的 vars.electronDefaultDir：
    // 后者在某些情况下会退回到 %APPDATA%\<appName>，导致日志仍落在用户目录。
    log.transports.file.resolvePathFn = vars => join(
      app.getPath('userData'),
      'logs',
      vars.fileName ?? 'main.log',
    )
  } catch (err) {
    console.error('configureLogPath failed', err)
  }
}
