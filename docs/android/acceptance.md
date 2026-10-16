# Rain Music Android 首版验收清单（阶段 6）

> **这份文档的用途**：照着做就能对"首版是否可用"给出**可复核的结论**，而不是凭感觉。
> 它**不**重复 [`cleartext-verification.md`](cleartext-verification.md) 的 638 行网络矩阵（明文/CORS/请求头
> 那一套在那里），而是把目标里的三件事（**听歌 / 歌单管理 / 下载**）拆成一条条**可观察证据**，并给出取证命令。
>
> **两份文档一起用**：本文给"功能是否可用"，那份给"网络层为什么不可用"。
> 逐项状态请直接写在本文的表格里（或另开一份记录），**别忘了写 SHA 与设备信息**。

---

## 0. 先拿到 APK（本机不需要 Android SDK）

- 工作流：`.github/workflows/build-android.yml`；产物名 **`rain-music-android-debug`**（约 9.7 MB）。
- 取法：GitHub → Actions → 对应 SHA 的运行 → Artifacts。
- ⚠️ **本机没有 Android SDK**（`ANDROID_HOME` 为空、`%LOCALAPPDATA%\Android\Sdk` 不存在）
  ⇒ `assembleDebug` **只能靠 CI**，本地不要试图构建 APK。
- **验收记录必须写明你装的是哪个 SHA** —— 每推一次代码 CI 都会重出包，不带 SHA 的结论无法回代。
- 基线（2026-10-15）：`9cccfba9` 的 `verify` 与 `debug-apk` 均为 `success`。

### 0.1 这个包能装在哪些设备上（2026-10-16 核对）

| 项 | 值 | 说明 |
|---|---|---|
| `minSdkVersion` | **24**（Android 7.0） | **低于它的设备装不上**；定义在 `android/variables.gradle`（有单测钉住，见下） |
| `targetSdkVersion` / `compileSdkVersion` | 36 | 目标 / 编译 SDK |
| `applicationId` | `com.rainmusic.mobile` | 与 `capacitor.config.ts` 的 `appId` 一致；也决定数据目录（第 D3 项要用的那条路径） |
| 签名 | **debug** keystore | 可直接 `adb install -r`；但**与将来的 release 签名不能互相覆盖安装**（换签名要先卸载，数据会一起没） |

**另外核对过一次"APK 真正读的那份运行时配置"**：`android/app/src/main/assets/capacitor.config.json`
（由 `cap sync` 生成、**未纳入版本控制**）与源配置逐项一致 —— `appId`、`webDir: 'dist-web'`、
`CapacitorHttp.enabled: true`、`android.allowMixedContent: true`。

> ⚠️ 这一项值得单独看：**那份 JSON 才是 WebView 里真正生效的配置**。它若与 `capacitor.config.ts`
> 分叉（最要命的是 `CapacitorHttp.enabled` 变成 `false`），**CI 照样编译成功、本机门禁全绿**，
> 而真机上所有 HTTP 会换一条完全不同的路径（这正是 [`cleartext-verification.md`](cleartext-verification.md)
> 那一套矩阵要区分的情况）。CI 每次都跑 `cap sync`，所以**CI 出的包不会有这个问题**；
> 但**本机手工出包**（没跑过 `cap sync`）用的是工作区里那份旧文件 —— 真机网络出问题时，先看它。

### 0.2 装上之后先看三眼（品牌素材，2026-10-17 起）

这三眼**没有任何自动化门禁能替代**（图标/名称/启动屏渲染出来长什么样，只能在设备上看）。
素材由 `scripts/gen-android-icons.py` 从桌面端在用的 `resources/icons/icon.png` 派生，
`tests/unit/android-brand-assets.test.cjs` 只保证"尺寸/alpha/背景色对、不是脚手架默认图"。

| # | 看哪里 | 应该是 | 不应该出现 |
|---|---|---|---|
| B1 | 应用列表 / 桌面图标 | **黑底 + 白色音符与播放三角**；自适应图标裁成圆形、方形都不露方块底 | Capacitor 的 X 形 logo、白底方块、方块边缘的接缝 |
| B2 | 图标下方的应用名 | **Rain Music** | `LX Music`、`lx-music-mobile` 等旧名 |
| B3 | 冷启动那一瞬（启动屏） | **纯黑底、正中一个白色音符**，居中不偏移 | Capacitor 的默认启动图、白底、内容偏到一边 |

> 判定 B1 时注意：**自适应图标在不同启动器上会被裁成不同形状**（圆形 / 方形 / squircle），
> 所以只要出现"一个方块"就说明前景图的 alpha 丢了（守卫里那条"颜色类型必须是 6"就是防这个）。


---

## 1. 准备与取证命令

```bash
adb devices
adb install -r rain-music-android-debug.apk
adb shell am start -n com.rainmusic.mobile/.MainActivity
```

按需取证：

```bash
# ① 应用私有库：文件名与版本号是本项目最容易"静默分叉"的两处（见 D3）
adb shell run-as com.rainmusic.mobile ls -l databases
adb shell run-as com.rainmusic.mobile sh -c \
  'sqlite3 databases/rain.dataSQLite.db "PRAGMA user_version; SELECT name FROM sqlite_master WHERE type=\"table\" ORDER BY name;"'
# ⚠️ 设备上不一定装了 sqlite3。没有就退化成"把库拉出来"：
adb exec-out run-as com.rainmusic.mobile cat databases/rain.dataSQLite.db > rain.dataSQLite.db
#    然后在能跑 sqlite3 的机器上查 PRAGMA user_version。

# ② 设置落点（@capacitor/preferences 的默认 group）
adb shell run-as com.rainmusic.mobile cat shared_prefs/CapacitorStorage.xml

# ③ 下载目录（应用外部私有目录，用户可见性有限）
adb shell ls -l /storage/emulated/0/Android/data/com.rainmusic.mobile/files/downloads
#    正常完成后：<名>.mp3 / .lrc，且没有残留的 .part / .resume

# ④ **未实现通道**的告警：invoke 变体的文案是固定的中文串，用它当判据
adb logcat -d | grep -F '还没有注册通道'
#    ⚠️ `send` 变体打的是另一句（"send 到未注册的通道："），**不要**把它算进来（见 §3 的说明）

# ⑤ JS 侧 console（WebView 的 console 会进 logcat）
adb logcat -d | grep -iE 'chromium|rainmusic' | tail -200
```

---

## 2. 逐项验收

每一项填 **通过 / 不通过 / 未做**，不通过时把现象与日志一起记下来。

### A. 听歌

| # | 怎么做 | 期望的可观察证据 |
|---|---|---|
| A1 | 内置平台（tx / kg / wy）各搜一首并播放 | 有声音；进度条推进；歌词能出；`adb logcat` 里没有异常 |
| A2 | 让当前源播放失败（例如先断网再恢复），观察是否换源/重取 URL | 要么自动换源成功，要么给出明确失败提示；**不要**卡死或静默无反应 |
| A3 | 设置 → 自定义源 → 导入一个 `.js` 源 → 选中 → 播放 | 导入成功；源状态变"已初始化"；能播放 |
| A4 | 用**一个会发 POST + `Content-Type: application/json`** 的社区源 | 源可用。**这条对应 §6.4 W1**：修复前这类源的请求体会被表单序列化、服务端按 JSON 解析直接失败。**没有这种脚本就不用做** —— W1 已有单测与变异证据，不必为它专门造脚本 |
| A5 | 用一个**初始化成功之后还会抛异步错误**的源（很多脚本都有"发了不管"的 `lx.request`） | 源**必须继续可用**，不弹"源码初始化失败"、不中断播放。**这条对应 §6.4 W2** |
| A6 | 看窗口顶部 | **没有 macOS 风格的红黄绿三个圆点**，也没有它们的占位空白 |

### B. 歌单管理

| # | 怎么做 | 期望的可观察证据 |
|---|---|---|
| B1 | 新建 / 改名 / 删除一个歌单 | 列表立刻反映；杀进程重开后仍在 |
| B2 | 加歌到歌单（含"下一首播放"与插队到顶部） | 顺序正确 |
| B3 | 歌单内拖动排序 / 移到别的歌单 / 删歌 / 清空 | 结果正确，且**别的歌单不受影响** |
| B4 | 加上十几首歌后**强杀进程**再开 | 歌单与歌曲完整（对应 `player_list_*` 的 16 条通道） |
| B5 | 导入一份**旧备份**（里面带数值型 list id，v2.3.0 之前那种） | 导入成功。**这条对应 §6.3 L1**：修复前整单 `data_overwire` 会被拒 |
| B6 | 收藏几首歌进"试听列表"（temp），然后删除一个普通歌单 | **试听列表不能被清空**（对应 §8 第 4 类：删保留 id 会静默清空子表） |

### C. 下载

| # | 怎么做 | 期望的可观察证据 |
|---|---|---|
| C1 | 下载一首歌 | 成品文件出现；标题/歌手/专辑写入；歌词与封面按设置写入（`ls` 看 `.lrc`，播放器看封面） |
| C2 | 下载中**暂停**，再**继续** | 从断点续传（服务端日志能看到 `Range`），最终字节完整 |
| C3 | 下载中**强杀进程**，再开、再继续 | 能续传完成；`.part` / `.resume` 被正确使用与清理 |
| C4 | 先放一个 >100 字节的同名文件、打开"跳过已存在文件"，再下载同一首 | **明确报"目标已存在"**，且原文件**一个字节都没变**（对应 §6.2 第 1 处） |
| C5 | 断网，或让服务端稳定返回 500，然后下载并观察 | 会**重试**（约 1 秒一次、最多 3 次），最终**只报一条错误**（对应 §6.2 第 5 处） |
| C6 | 下载列表中删除一条**已完成**的记录 | **成品文件不被删**（只删记录） |

### D. 数据与设置

| # | 怎么做 | 期望的可观察证据 |
|---|---|---|
| D1 | 改几项设置（主题色、播放相关开关），**强杀**后重开 | 设置仍在。落点见 §1 的 ②：`CapacitorStorage.xml` 里的 `rain:store:config_v2` |
| D2 | 停在某个歌单/某首歌，强杀后重开 | 回到上次的视图；播放队列能恢复 |
| D3 | 跑 §1 的 ① | **`PRAGMA user_version` 必须是 `4`**；库名必须是 **`rain.dataSQLite.db`**。⚠️ 这两条一旦不一致，就是"两边各开一份库 ⇒ 歌单看起来丢了"那类静默分叉（`rain.dataSQLite.db` 这个名字是 `@capacitor-community/sqlite` 改写出来的，原生侧是按插件规则取的名） |

---

## 3. 已知**不支持**的（先看这张表，别当 bug 报）

| 功能 | 现象 | 依据 |
|---|---|---|
| **主题设置页** | 主题列表为空、切换无效；打开时可能留下一条未处理 rejection | `handoff.md` §6.1（7 条主题通道原生未注册，属首版范围之外） |
| **本地音乐** | 跨重启不可播（选择器给的是会话级 `blob:` URL，被当成歌曲身份持久化了） | §6.4 W4 |
| 自定义源的 `formData`（multipart） | 明确报 `Unsupported capability: multipart formData` | §6.4 W10（**是显式不支持，不是静默**） |
| 不喜欢（dislike） | 初始化被**有意跳过**；手动"不喜欢"或改规则会报错 | §6.1 |
| 音效预设 | 进设置打开预设列表会报错 | §6.1 |
| 缓存大小 / 清缓存、另存对话框、定位文件、系统字体、省电阻塞 | 未注册 | §6.1 |
| 桌面歌词窗口、托盘、全局快捷键、窗口按钮 | Android 不实现 | `ipc-contract.md` §4.2（B 类） |
| **下载目录用户看不见** | 需要回收空间时只能"清应用数据" | §6.2 第 4 处（**待拍板**：删除记录时是保留进度还是释放空间） |
| 前台服务 / 通知栏下载 / 系统杀进程保活 | 不实现；下次启动靠持久队列与 `.part` 恢复 | `continuation-2026-10-15.md` |

> **关于 logcat 里的"未注册通道"告警**：`invoke` 到未注册通道的文案是
> `原生侧还没有注册通道 "…" 的 handler（P0-2 待做）` —— **这句是要看的**。
> 而 `send` 到未注册通道只会打 `send 到未注册的通道：…`（`RainMusicIpcPlugin.dispatch()` 的
> `expectsResponse == false` 分支，不 emit、不 reject）—— 启动时那条 `winMain_inited` 属于后者，
> **语义等价于"注册成空实现"，不是缺陷**（见 §6.1 更正的说明）。

---

## 4. 结果怎么回报

把下面五样一起发回来，就能直接定位：

1. **SHA**（`git log -1 --format='%h %s'`，以及你从哪个 Actions 运行取的包）；
2. **设备信息**：机型、Android 版本、**WebView 版本**（`adb shell dumpsys package com.google.android.webview | grep versionName`，
   或设置里看"Android System WebView"）；
3. **哪一项不通过**，以及它的现象（截图/录屏更好）；
4. **日志**：`adb logcat -d | grep -F '还没有注册通道'` 的输出 + `chromium` 尾 200 行；
5. **文件清单**：`adb shell run-as com.rainmusic.mobile ls -l databases` 与下载目录的 `ls -l`
   （有 `.part` / `.resume` 残留时要特别说明）。

---

## 5. 这份清单本身的状态

- 它是**从已实现的通道与已知缺口倒推**出来的，**没有在真机上跑过** —— 本机没有 Android SDK、没有 adb、
  也没有连接设备。所以：**它是一条待执行的清单，不是一份验收结论。**
- A4 / A5 / B5 / C4 / C5 这几项是**专门为我这几轮修掉的缺陷**加的；如果你没有对应的素材
  （社区源脚本、旧备份、可控的服务端），它们可以标"未做" —— 那几条已有单测 + 变异证据，
  设备上不复现**不等于**修复无效，只等于"没验"。
- 与 `cleartext-verification.md` 的分工：**播放/下载失败且日志里能看到 HTTP 层错误**时，
  转去那份文档走明文/CORS/请求头矩阵。
