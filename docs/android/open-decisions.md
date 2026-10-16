# Rain Music Android · **需要拍板的 5 件事**（2026-10-16）

## 这份文档为什么存在

首版三个功能面（**听歌 / 歌单管理 / 下载**）的实现与**可验证检查**都已经就位，而且每个提交在 CI 上都是绿的：

| 检查 | 现状 |
|---|---|
| lint / 四个 tsc / 470 条单测 / 桌面 `build` | `npm run verify` 本机 exit 0；CI `verify` = success |
| web 产物 `build:web` + 产物级守卫（worker chunk、同步后的 assets 是否为本轮产物） | 在 Android workflow 里跑，绿 |
| **真产物移动分支走查**（在 Chromium 里直接跑 `dist-web`：无交通灯、逐条路由渲染、设置页没有桌面专用"保存路径"行） | 11 条断言，本机与 CI 都绿（变异验证过） |
| 9 个 UI 套件矩阵 | 全 success |
| 真机 APK（`debug-apk`） | success，产物 `rain-music-android-debug` |

下面 5 条**不是"还没做"，而是"需要你选一条路"**。每条都给出：现状与证据（`file:line`）、
可选方案与代价、我的建议、以及"怎么算做完了"。**在你拍板之前，我不会动其中任何一条** ——
它们要么改变用户可见行为，要么只能在真机验证。

---

## 1. 自定义源脚本能用 `import()` 拉远程模块（**唯一还开着的安全口子**）

**现状与证据**（全部是**实测**，探针见 `docs/android/handoff.md` §6.4.6b）：

| 场景 | Worker 起得来吗 | 远程 `import()` 成功吗 | 本地服务器收到那个模块请求吗 |
|---|---|---|---|
| **当前 App 的形态**：同源 worker + 页面**没有 CSP** | 是 | **成功** | **收到了** |
| 同源 worker + 页面 `script-src 'self' 'unsafe-eval'` | 是 | **仍然成功** | **收到了** |
| blob worker + 只给 `script-src`（不给 `worker-src`） | 否（worker 被拦死） | — | 没有 |
| blob worker + `worker-src 'self' blob:` | 是 | **仍然成功** | **收到了** |

- 应用页面**完全没有 CSP**（`src/renderer/index.html` 与构建产物 `dist-web/index.html` 都没有）。
- `src/renderer/platform/userApi/worker-runtime.js` 的能力黑名单**原理上删不掉** `import()`：它是语法，不是可 `defineProperty` 掉的全局。
- 后果：恶意社区源可以 `import()` 一个远程 ES 模块，那段代码**以 App 的 origin 运行** ⇒ 能读 `rain:store:*`（曲库/歌单/**已导入的源脚本本体**）、能外联，绕开被校验的 `lx.request`。

**方案**

| 方案 | 代价 | 备注 |
|---|---|---|
| **(a) 给 worker 脚本那个响应加 CSP 头**（`script-src 'self' 'unsafe-eval'`） | 原生改动（Capacitor asset loader / 自定义 scheme handler），**只能真机验** | Worker 的 CSP 按规范取自**它自己的响应头** |
| (b) `WebViewClient.shouldInterceptRequest` 拒绝"由 App origin 发起、跨源、type 为 script/module"的请求 | 原生改动，同样只能真机验 | 可作为 (a) 的兜底 |
| (c) 把自定义源从 Worker 改成**沙箱 iframe**（opaque origin，无同源存储） | 架构级改动，回归面很大 | 只挡"读 App 存储"，不挡外联 |
| ~~(d) 页面加 meta CSP~~ | **已实测无效** | ⚠️ 不要走这条 |

**我的建议**：(a) 为主 + (b) 兜底，两条都是原生改动，做完在真机上用同一个探针复测。

**怎么算做完**：真机上在自定义源脚本里执行 `import('https://…/x.js')` **必须失败**（且
正常播放/取 URL 不受影响）。验证步骤并入 `acceptance.md`。

---

## 2. Android 的下载目录是**平的**，桌面按歌单名分目录

**现状与证据**：

- 渲染层刻意传空目录：`src/renderer/platform/download/android.ts:42-44`
  （`savePath: ''`，注释写明"桌面目录偏好里可能是 Windows 路径，绝不能进 Android 执行器"）；
- 原生把空目录映射到私有根：`RainMusicDownloadTaskChannels.java:30-32`
  （`getExternalFilesDir(null)/downloads`，取不到就 `getFilesDir()/downloads`）；
- 桌面侧"按列表名分目录"是**固定启用**的常量（`SAVE_PATH_GROUP_BY_LIST_NAME`）。

**后果**：同一个歌单里的重名还好说，**不同歌单里的同名文件会撞** —— 表现为被"跳过已存在文件"
跳过，或原生抛 `Another task already owns this download path`。桌面端因为分目录，两首都能下。

**方案**

| 方案 | 代价 |
|---|---|
| **(a) 保持平的**，并在 `acceptance.md` 的"已知不支持"里写明"Android 不按歌单分目录" | 零风险；用户可见的差异需要文档兜住 |
| (b) 渲染层传**相对**子目录（如 `filterFileName(歌单名)`）：原生 `safeFile()` 接受相对路径（`RainMusicDownloadTaskChannels.java:75-85` 只拒绝目录**之外**的路径与 `..`） | 小改动 + 需要一条新用例；但**会改变文件落点**（用户可见），且与"下载记录里已存的旧 filePath"要相容 |

**我的建议**：先 (a)（本轮就能写进文档），(b) 作为后续增强单独排期 —— 因为它动的是"用户的文件在哪"。

**怎么算做完**：选 (a) ⇒ `acceptance.md` 那行在；选 (b) ⇒ 两个歌单各放一首**同名**歌，都能落盘且路径不同。

---

## 3. **W4**：本地音乐把会话级 `blob:` URL 当成歌曲身份持久化

**现状与证据**：`src/common/platform/filePicker/web.js:27` 的选择器返回**会话级 `blob:` URL**；
全仓只有 `UserApiModal.vue:95` 会 `releaseSelectedFile`。本地音乐那条路把 blob URL 当身份写进
`id` / `meta.filePath` / `meta.songId` ⇒ **重载后是一堆永远播不了的歌**，且 File 句柄泄漏整场。

**方案**

| 方案 | 代价 |
|---|---|
| (a) 把选中的文件**拷进应用私有存储**，用真实路径当身份 | 按**功能**算工作量（要处理大文件、重复选、清理） |
| **(b) 明确"本地音乐仅本会话"**，写进 `acceptance.md` 的已知不支持 | 零代码；那一行**已经在了**（当初就是这么定的） |

**我的建议**：(b)。**本地音乐本来就不在首版范围**（听歌=内置 kg/tx/wy + 自定义源），
而 (a) 是一个新功能而不是缺陷修复。

**怎么算做完**：选 (b) ⇒ 不加代码，只确认 `acceptance.md` 那行仍然准确。

---

## 4. **§6.2 第 4 处**：未完成的 `.part` / `.resume` 从不回收

**现状与证据**：`RainMusicDownloadTaskChannels.java:143-146` 的注释：
"Removing a queue item never deletes a completed media file. A `.part` is retained too, so
deleting/recreating the record can safely resume."（**刻意**保留；只有**被拒的 resume** 才会
把不可用的部分丢掉，见 `resumeRejected()` `:317-321`）

**后果**：下载目录是**应用私有目录**（用户看不见），空间只能靠"清除应用数据"回收。
一次下载到一半取消，`.part` 会一直留着。

**方案**

| 方案 | 代价 |
|---|---|
| **(a) 保持现状**（删记录后仍可续传） | 空间占用不可见、不可回收 |
| (b) 删记录时一并回收 `.part` / `.resume` / `.resume.part` / `.meta.part` | 会**砍掉"删了记录还能续传"**这个能力 |

**我的建议**：(a) + 在设置页或文档里说明"未完成的临时文件保留在应用私有目录"。
理由：(b) 去掉的是用户可能正需要的行为，而空间问题有系统级出口。

**怎么算做完**：选 (a) ⇒ 文档写明；选 (b) ⇒ 删记录后目录里不再有那四类文件。

---

## 5. **§6.3 L2**：`data_overwire` 对保留 id（`default` / `temp`）的拒绝

**现状与证据**：`RainMusicListMutationChannels.java:88` 对 `default` 走 dedupe 分支；
`data_overwire` 不接受保留 id。**拒绝是站得住的**：否则会产生一条**删不掉的**记录
（保留 id 的删除路径被刻意关掉）。

**方案**

| 方案 | 代价 |
|---|---|
| **(a) 保持拒绝**，并把这条契约写进 `docs/android/ipc-contract.md` | 只写文档；目前它只散落在 handoff 里 |
| (b) 允许写保留 id | 需要同时定义"怎么删"，风险面更大 |

**我的建议**：(a)。这条**唯一缺的就是文档**——所以它其实是 5 条里最容易收尾的一条。

---

## 附：这不是"待拍板"，而是"设备活"

`docs/android/acceptance.md` 的 10 项（设备端搜索/播放/下载/重启恢复、SAF 选择、HTTP/CORS/明文、
`convertFileSrc` 映射、后台保活）**必须有真机**。本机能做的替代证据已经做到位：真产物在
Chromium 里走移动分支（见上表），但它**不是**设备验收。

⚠️ 另外记一次**未完成**的机械核对（省得下一个人重做）：本轮尝试用脚本重新推导
"渲染层用到的通道 vs 原生注册的通道"，结论是**不能直接当成守卫** ——
- 渲染层那侧会把**桌面专有**通道（`winMain_close` / `min` / `quit` / `fullscreen` / `hotKey_*` …）
  全算进来，差集有 **75** 条，而 handoff §6.1 那张表只列了**其中对 Android 有实际影响**的部分；
- 原生那侧的注册名混了常量、`PREFIX + "x"`、`bind(plugin, "x", …)`、以及**循环拼出来的名字**
  （`"get_lyric_" + source`），脚本解析出 **45** 条（含 1 条前缀假名），与 §6.1 记的 **48** 条对不上。
⇒ **§6.1 那张表仍然是权威**；要做成自动守卫，先得把"桌面专有/范围外"这 75 条**逐条分类**。
