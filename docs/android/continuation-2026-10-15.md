# 2026-10-15 Android 续开发记录

续开发基线为 `b33c2332`。本记录区分实现、本机行为探针、构建和设备验收；新提交的CI结果须按完整SHA查询。

## 已接通的首版链路

- `RainMusicListMutationChannels`：剩余八条歌单/歌曲删除、移动、更新、排序、覆盖及清空通道。复用共用锁和提交顺序广播；普通歌单覆盖遇重复ID回滚，默认队列按既有身份规则去重。非法同歌单移动明确拒绝。默认队列读取修复是桌面已有的独立事务，发生在主要写事务之前。
- [播放队列恢复](playback-restore.md)：先依旧ID/身份快照定位，再持久保存新身份，成功后清理SQLite快照；进程内只做一次启动快照，不阻止后续脏队列修复。
- [下载存储](download-storage.md)：既有13列与桌面读写契约，事务回滚，删除记录不删除成品。
- [下载执行](download-runtime.md)：主WebView façade转原生HTTP/文件IO，.part/.resume、Range校验、任务ID/原始URL/最终响应URL身份绑定，暂停、取消、失败释放槽位、UTF-8/GBK歌词与MP3 ID3/APIC。下载目录固定为应用私有目录，返回真实路径后再派发完成事件。
- [媒体缓存](media-cache.md)：实际播放入口依赖的URL和歌词13通道已接入，缓存错误不伪装成未命中。
- [自定义音源](user-api-host.md)：主WebView保存/转发，真实Worker执行脚本；lx/rain同对象，tx/kg/wy/local白名单，取消/超时/切源。初始化中不向renderer广播失败，最终成功才打开播放就绪闸门。
- 本地导入音源使用WebView文件input；已选File在主页面直接读取，避免被CapacitorHttp当作网络URL代理。成功、读取失败、导入失败都会释放blob句柄；选择或读取失败会显示现有错误对话框。目录选择/持久化外部文件授权不在此实现内。
- Web构建独立选择文件URL、文件读取、parseBuffer和下载实现；桌面继续用Node实现。移除无副作用但会把Node下载Worker打入Web包的重复import。
- 已启用CapacitorHttp、HTTP明文策略和混合内容配置。系统CA校验保留；设备侧请求头/Cookie/CORS/重定向/HTTP媒体仍待实测。

## 已知边界

原生下载不包含前台服务、通知栏下载或系统杀进程保活；下次启动依持久队列和partial恢复。FLAC/WAV/APE标签写入明确失败，音频完成状态保留；MP3更新会替换顶部旧ID3标签，未知旧标签不保留。通用外部文件保存、SAF导出和本地音乐文件的跨重启授权尚未实现。

Chromium探针可以证明Web bundle、Worker和模块交互，不能证明Android插件注入、ART、系统选择器、设备网络或后台行为。当前没有SDK/adb/连接真机，设备验收仍需执行 `cleartext-verification.md`。

## 验证证据

本机证据保存在系统TEMP，不混入源码。完整工作区单测 **455 / 455，fail 0、skip 0**（`rain-submit-unit.log`）；提交快照和CI须独立验证，工作区包含用户另线尚未提交的测试。

- Java+真实SQLite：歌单8项、下载存储10项、媒体缓存7项；写失败/缺表/坏数据/提交后锁外广播等分别断言。
- 原生下载：真实本地HTTP服务、JVM文件IO、完整字节与截断/Range/跨资源/重定向目标变化等场景。
- 自定义源：真实Node Worker行为、工具与Node crypto/zlib对照、真实renderer状态handler；另有真正Chromium生产Worker+MessagePort+HTTP转发联调。
- Chromium证据目录：`%TEMP%/rain-user-api-chromium-20261015/`，状态闸门true、dialogs=0，真实renderer生成的getMusicUrl调用、中文POST、取消和切源通过。
- 实际Web Worker歌词/WAV解析证据：`%TEMP%/rain-worker-web-review-run.cjs`，无Node权限的浏览器读取中文/空格/#/%文件路径，解析真实WAV。
- Web应用窄窗口冒烟：`%TEMP%/rain-web-app-smoke/report.json`及mobile.png，页面挂载、主Worker查询和无交通灯检查通过。无原生插件的HTTP页面会记录明确的未实现通道告警，不能据此宣称设备播放通过。
- 所有变异注入只在TEMP副本；歌曲/平台/文件选择18项、下载执行23项、下载存储12种、音源16项及renderer闸门1项、恢复8项、媒体缓存7项分别留有失败日志。未在共享源码注入。

用户原有30项UI/主题文件用SHA-256逐文件保护，不stash、不批量暂存；提交仅包含本轮Android相关文件。
