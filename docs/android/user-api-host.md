# Android / Web 自定义音源宿主

## 接入与职责

`src/common/platform/ipcBridge/capacitor.js` 在本地拦截自定义源组，其余通道仍走原生插件。`src/renderer/utils/ipc.ts`、`core/apiSource.ts`、`useInitUserApi.ts` 不需要改写。桌面构建仍选择 desktop bridge，不加载本模块。

本地桥首次 invoke 时动态加载 `renderer/platform/userApi/web.js`。该模块创建专属 Web Worker；webpack 已有 `new Worker(new URL(..., import.meta.url))` 的构建支持，生成单独 chunk，不需要新增依赖或 webpack 配置。

链路：既有 renderer IPC → capacitor 本地通道 → host → 私有 MessageChannel → Worker。HTTP 反向经过同一私有端口转给 WebView 的现有 `platform/http/web.js`。脚本看不到 `Capacitor`、原生插件、存储适配器或私有端口；Worker 全局 `postMessage` 不是宿主协议入口。仅可信宿主代码持有该端口。所有脚本执行均发生在 Worker；请勿在 WebView 直接调用 `installUserApiWorker`。

## 保持的 IPC 契约

| 通道（均加 `winMain_` 前缀） | 行为 |
| --- | --- |
| `import_user_api` | 原始 JavaScript 说明头解析、重复内容拒绝、保存后返回 `{apiInfo, apiList}`；列表不返回脚本 |
| `get_user_api_list` | 返回保存的公开元数据列表 |
| `remove_user_api` | 批量删除；活动源被删除时终止 Worker、拒绝在途请求、发布失败状态 |
| `set_user_api` | 保存选择，停止旧 Worker，等待新源初始化；初始化错误/超时 reject；选择内置源时停止自定义 Worker |
| `get_user_api_status` | 返回 `{status, apiInfo?, message?}` |
| `request_user_api` | 接收 `{requestKey,data:{source,action,info}}`，按脚本声明能力验证并返回桌面结果信封 |
| `request_user_api_cancel` | send 与 invoke 都有效，拒绝对应请求；晚到结果不能使其重新完成 |
| `user_api_set_allow_update_alert` | `{id,enable}`；写入成功后才改变运行中权限 |
| `user_api_status`（事件） | 成功、脚本错误、Worker 错误、初始化超时、移除活动源都会广播。**⚠️ 不含 `initing`** —— `setApi()` 只把 `initing` 写进本地 `status`（`host.js:220`）而**刻意不 `publish()`**：渲染层的状态处理把 `false` 当**终态失败**并永久结算播放就绪闸门，广播它会让一个正在初始化的源被提前判死。要看这个中间态请用 **`get_user_api_status`**（它返回本地 `status`）。另：移除活动源那条**不带 `apiInfo`**（源已经没了），所以渲染层那个要求 `apiInfo.id` 匹配的处理器会忽略它 —— 这是有意的 |
| `user_api_show_update_alert`（事件） | 仅活动源被允许时广播；HTTP(S) 之外的更新链接被剔除 |

事件仍以 `{event,params}` 传递；on / once / off / offAll 沿用桥的监听表。本地事件订阅不依赖原生插件已就绪。

`set_user_api` 初始化默认 15 秒、业务请求默认 20 秒。脚本 HTTP 默认 60 秒，上限 60 秒，覆盖响应体读取等待。每个宿主最多 128 个业务请求、64 个 HTTP 请求。源切换、Worker 失败或宿主 dispose 拒绝全部业务请求并终止旧 Worker，取消其在途 HTTP。Worker 回复还要核对 session generation，避免旧会话回包。

## 脚本公开接口

`globalThis.lx === globalThis.rain`，两者为同一个冻结对象。`version` 为 `2.0.0`，`env` 为 `mobile`，`currentScriptInfo` 包含 name / description / version / author / homepage / rawScript。

- `EVENT_NAMES`：`request` / `inited` / `updateAlert`。
- `on('request', handler)` 注册处理函数；同步值或 Promise 均可返回。
- `send('inited', {sources})` 只允许一次；沿桌面白名单、动作与音质交集过滤。
- `send('updateAlert', {log,updateUrl?})` 每次脚本会话只允许一次；空日志显式拒绝。
- `request(url, options, callback)` 保留 `(error,response,body)` 回调和返回取消函数。主 WebView 处理 HTTP，响应 JSON 自动解析；response 提供 statusCode / statusMessage / headers / raw / bytes / body；raw 在 Worker 恢复为 Buffer。

| 平台 | 动作白名单 | 音质白名单 |
| --- | --- | --- |
| `tx` / `kg` / `wy` | `musicUrl` | `128k`, `320k`, `flac`, `flac24bit` |
| `local` | `musicUrl`, `lyric`, `pic` | 空数组，与桌面初始化过滤一致 |
| 其他（含 `kw`, `mg`、原型属性名称） | 不提供 | 不提供 |

音质与动作还必须在脚本的初始化声明中出现。实际请求被拒绝时不会执行脚本处理函数。

返回信封保持 `{source, action, data}`：musicUrl 的 data 为 `{type,url}`；pic 的 data 为 URL 字符串；lyric 的 data 为 `{lyric,tlyric,rlyric,rainlyric}`。URL 限 HTTP(S)、最长 2048 字符；歌词主体最长 51200，附属字段按桌面限制处理，无效附属字段返回 null。主 WebView 再次验证返回值，不能通过手工构造 Worker 消息绕过。

| 工具 | 支持范围 |
| --- | --- |
| `utils.buffer.from` / `bufToString` | 已有 buffer polyfill，返回 Buffer |
| `utils.crypto.aesEncrypt` | AES 128/192/256 的 CBC/ECB，PKCS#7；返回 Buffer；密钥/IV长度与其他模式显式拒绝 |
| `utils.crypto.rsaEncrypt` | 复用公共纯 JS RSA_NO_PADDING；返回定长 Buffer |
| `utils.crypto.md5` | 字符串或字节，返回十六进制字符串 |
| `utils.crypto.randomBytes` | Web Crypto，返回 Buffer；单次限制 1 MiB |
| `utils.zlib.inflate` / `deflate` | 复用公共 pako 包装，Promise<Buffer>；错误 reject |

## 持久化与失败

本机实现使用同源 localStorage 的单个 `rain-music.user-api.v1` 快照键，包含 `{version:1,apis:[含原脚本],selectedId}`。一次 setItem 原子保存整个快照；写入串行，成功后才更新宿主内存。配额不足、存储不可用、损坏 JSON 或不合法持久化结构均 reject，绝不退化成“导入成功但未保存”。脚本最多 2 MiB 字符。不会迁移 Electron 的压缩脚本存储。

应用既有 `appSetting['common.apiSource']` 仍负责启动时选源并调用 `set_user_api`。宿主也保存 selectedId；独立嵌入者可调用 `host.restoreSelection()` 恢复。默认适配器不抢先启动第二个源会话。可注入 `{read(),write(snapshot)}` 替换存储，但 write 必须可确认失败，不能用无确认的 send 冒充成功。

## 明确限制与待真机验证

- 普通社区脚本的 lx/rain 初始化、事件、HTTP、工具与三种结果接口受到支持；这不是“所有社区脚本已验证”。依赖 Node、Electron、DOM、文件系统或外部私有接口的脚本不兼容。
- multipart `formData` 显式向 HTTP 回调报告 Unsupported capability；当前支持 body / form、HTTP(S) 和常见方法。不提供脚本直接原生插件能力。
- 初始化的 `openDevTools:true` 显式拒绝；移动宿主不提供桌面 DevTools 窗口。
- Worker 直接 fetch / XMLHttpRequest / WebSocket / WebTransport / EventSource / importScripts / 子 Worker 被替换为显式拒绝函数，indexedDB / caches / Capacitor 不提供。Worker 隔离不是针对任意恶意 JavaScript 的完整浏览器安全沙箱；JavaScript 动态 import 等语言机制不能仅靠覆盖全局 API 禁止。不要把它宣称为不可信代码的完整网络封锁。
- 执行导入 JavaScript 使用 Worker 中的 Function，宿主 CSP 必须允许该执行及 Worker chunk；被 CSP 拦截时应观察 Worker 错误或初始化超时，不能声称兼容。
- HTTP 复用已有 WebView transport：纯浏览器仍受 CORS / 禁止请求头影响；Android 的 CapacitorHttp patch 或 explicit 注入决定实际原生行为。Cookie / Referer / User-Agent、重定向、HTTP 明文策略、混合内容、请求取消和中文响应必须真机分别验证。沿用该 transport 的 UTF-8 解码限制。
- 业务取消立即拒绝宿主 Promise并忽略脚本晚到结果；脚本处理函数本身没有公开 AbortSignal，除源切换/移除/失败终止 Worker 外，不能强制停止某一个处理函数。`lx.request()` 自身的取消函数会转发 HTTP abort。
- 单个脚本若在初始化后无限占用 Worker，不会冻结主 WebView；业务请求会超时，但 Worker 要在源切换/移除时终止。尚未实现自动 CPU 配额。
- localStorage 可在清理应用数据或卸载时丢失，不是系统备份；Web Crypto 与 Worker/MessageChannel 需要当前 WebView 支持。

## 本地证据

执行：

```powershell
node --test tests/unit/android-user-api-host.test.cjs tests/unit/android-user-api-bridge.test.cjs tests/unit/android-user-api-utils.test.cjs tests/unit/android-user-api-web.test.cjs
node tests/unit/fixtures/android-user-api/mutate.cjs
node node_modules/eslint/bin/eslint.js --ext .js src/renderer/platform/userApi src/common/platform/ipcBridge/capacitor.js
node node_modules/typescript/bin/tsc -p src/renderer/tsconfig.json --noEmit
```

测试执行真实 Node Worker，通过 VM 提供浏览器形态的脚本全局，使用实际 MessageChannel 与生产 Worker runtime / host；WebView HTTP 适配器另用本地 HTTP server 验证真实 transport 回调与响应信封；这两者均不是 Android 真机证据。工具输出与 Node crypto / zlib 逐字节对比。变异副本创建在系统临时目录，不修改仓库生产代码；逐用例日志与 summary.json 保留在那里。
