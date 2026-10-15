# Android 下载执行器与主 WebView façade

本轮实现 `RainMusicDownloadTaskChannels` 和 `createAndroidDownloadFacade`。下载队列记录由 `RainMusicDownloadChannels` 管理；此执行器负责实际 HTTP、私有文件、歌词和 MP3 标签。两者的验证边界分别记录，JVM 探针不等于 Android 设备运行。

## 接线

原生插件 `load()` 注册一个执行器实例并保留到插件生命周期结束：

```java
new RainMusicDownloadTaskChannels(getContext()).register();
```

主 WebView 用 `createAndroidDownloadFacade()` 替换 `window.rain.worker.download`。该对象直接使用 `@common/platform/ipcBridge`，不经过 Comlink，不放进 Worker。桌面仍使用既有下载 Worker。

导出的八个方法保留既有下载调用约定：`checkList`、`createDownloadTasks`、`startTask`、`pauseTask`、`removeTask`、`updateUrl`、`writeMeta`、`saveLrc`。`startTask(downloadInfo, savePath, skipExistFile, callback, proxy?)` 的第四个参数仍是 action 回调。纯任务构造与查重放在 `platform/download/pure.ts`，不导入 `fs`、`node-id3`、`iconv-lite` 或桌面下载器。

Android façade 将传入 `savePath` 规范为空字符串，避免从桌面迁移的 Windows 目录进入原生。执行器把空目录映射为 `getExternalFilesDir(null)/downloads`，外部私有目录不可用时改用 `getFilesDir()/downloads`。原生 `start` 快速应答 `{filePath, savePath}`，网络传输交给三个后台线程；invoke 不等待整个下载。façade 在向调用方派发任何排队事件前更新原 `downloadInfo.metadata.filePath`，确保 store 的元数据、歌词写入使用真实私有路径。

## 通道契约

每次 invoke 的 `args` 为一个对象；以下名称需要加入公共 IPC 名称表。

| 通道（前缀 `winMain_download_task_`） | 参数 | 应答 |
| --- | --- | --- |
| `start` | `{downloadInfo, savePath, skipExistFile, token, proxy?}` | `{filePath, savePath}` |
| `pause` | `{id, token?}` | `null` |
| `remove` | `{id, token?}` | `null` |
| `update_url` | `{id, url, token?}` | `null` |
| `save_lyric` | `{filePath, text, format:'utf8'\|'gbk'}` | 文件成功原子提交后 `null` |
| `write_meta` | `{filePath, title?, artist?, album?, lyrics?, APIC?, proxy?}` | 标签成功原子提交后 `null` |

原生广播 `winMain_download_task_event` 的单一参数：

```ts
{ id: string, token: string, action: Rain.Download.DownloadTaskActions }
```

action 使用既有 `start`、`progress`、`complete`、`refreshUrl`、`error`。进度包含 `{downloaded,total,progress,speed,writeQueue:0}`。原生对每个 Task 实例检查当前所有权，façade 再按 token 过滤旧代次事件。同一 ID 的 start/pause/remove/update_url 命令在主 WebView 按顺序发送；过期 start 的失败不会污染新代次。带旧 token 的 pause/update_url 不影响新任务。

## HTTP 与文件完整性

- 仅接受 HTTP(S) URL；可选 HTTP 代理。连接和读取各有 10 秒超时。401、403、410 发 `refreshUrl`，等待 store 获取 URL 后调用 `updateUrl`；其它非 200/206 状态发错误。没有自动无限重试。
- 写入 `<file>.part`；只有读取字节数与声明总数完全一致、文件同步成功后，才以 `android.system.Os.rename` 原子替换成品并发 `complete`。下载失败时保留旧成品。缺少正数 Content-Length、压缩响应、截断响应、错误 Range 均拒绝完成。
- `<file>.resume` 保存完整请求 URL（包括 query）、最终响应 URL、任务 ID、总字节数和强 ETag/Last-Modified。重建执行器后，同一记录和资源可从 `.part` 长度续传。ETag 只在资源范围内有效；即使不同 URL 的 ETag/长度相同，也必须从零重下。签名 URL 刷新改变 query 时同样安全重下。旧清单未保存最终响应 URL 时从零重下；请求 URL 相同但重定向目标改变的 206 会拒绝续接，防止混入不同资源字节。
- 续传请求发送 Range 和 If-Range；206 必须严格匹配起点、终点、总数、Content-Length 和 validator。200 表示服务器未接受 Range，此时截断 partial 从零写。无可靠 validator 的 partial 也从零写。
- 同一路径的 HTTP 与标签写入串行；不同运行 ID 不能同时认领同一成品路径。暂停/删除使旧 Task 失效并断开连接；旧请求不能再广播或提交成品。删除队列任务保留成品和 partial，方便重建记录后恢复。
- 原生拒绝路径穿越、带目录的 fileName，以及私有 downloads 树以外的目标。没有共享 Downloads/SAF 导出实现。

## 歌词、标签与错误

歌词先真实写入临时文件并同步，再原子替换。UTF-8 含 BOM；GBK 使用系统字符集，并拒绝不可编码字符。失败通过 invoke reject 返回。

MP3 写入 ID3v2.3：TIT2、TPE1、TALB、USLT 和可选 APIC。文字使用带 BOM 的 UTF-16；HTTP(S) 封面仅接受 JPEG/PNG 标识，最大 8 MiB，读取检查 8 秒总时间窗口。已有 ID3v2.2/2.3/2.4 顶部标签会被替换；音频主体完整复制，未知旧标签不会保留。FLAC、WAV、APE 标签明确 reject；没有声称这些格式的元数据写入成功。

store `saveMeta`、`downloadLyric` 接住真实写入失败并 `console.error`；音频完成状态保持完成。启动或 URL 更新 invoke 失败则标记该下载出错、释放并发槽位并调度等待任务。删除等待任务只移除指定 ID，不再取消全部运行任务。

## 验证命令与边界

```powershell
node --test tests/unit/android-download-runtime.test.cjs tests/unit/android-download-runtime-store.test.cjs tests/unit/android-download-runtime-native.test.cjs
npx.cmd tsc -p src/renderer/tsconfig.json --noEmit
npx.cmd eslint src/renderer/platform/download/android.ts src/renderer/platform/download/pure.ts src/renderer/store/download/action.ts
node tests/unit/fixtures/android-download-runtime/run-mutations.cjs
```

行为测试使用本地 HTTP server、真实 HttpURLConnection、真实 JVM 文件 IO 和真实 façade/store；仅 Android Context、原子 rename 的 Android 系统入口、IPC 宿主与测试 JSON 实现被替换。覆盖快速应答、完整文件、HTTP 失败、半包、chunked 未知长度拒绝、重建后续传、Range/ETag 错误、忽略 Range、跨资源同 ETag 混包防护、旧代次命令、路径穿越、UTF-8/GBK、ID3/APIC、失败不改旧文件和 store 调度/移除范围。

额外签名探针编译当前全部 `android/app/src/main/java`，classpath 使用真实 Android 4.1.1.4 和 AOSP org.json jars；Capacitor/AndroidX 为既有编译替身，旧 Android jar 缺失的 `android.system.Os.rename` 单独隔离为声明替身。负向探针确认未处理的 JSONObject.put 受检 JSONException 编译失败。这不是现代 Android SDK/Gradle 编译，也没有验证 ART、WebView 插件时序、系统下载可见性或设备断网行为。

变异脚本只在系统临时目录写副本，并核对原始源文件字节不变。每项错误变体须使对应测试因预期行为失败；详情与失败日志写入脚本输出的 `rain-download-mutations-*` 目录。该脚本不修改仓库或 Git。

进程退出后任务不会持续传输；恢复依赖已有持久队列记录以及 `.part/.resume`。未实现前台服务、通知栏下载、Doze/系统杀进程保活、共享目录授权或系统下载管理器。支持文件系统原子重命名不等于已完成掉电耐久性测试。
