# Rain Music Android 移植 · 阶段 0：IPC 契约与平台依赖清单

> 上游文档：[android-port-plan.md](../android-port-plan.md)（路径 A：Capacitor 封装 Vue 渲染层 + 重写主进程业务层；首版范围 = 听歌 + 歌单 + 下载；硬性要求：Android 不得有 macOS 风格窗口控制按钮）。
>
> 本文档是**只读分析**产物：不修改任何产品代码。所有结论都给出 `文件:行` 证据；无法从代码确定的标注 **需确认**。
>
> 基线：`HEAD = d17025d7`（2026-10-06，`test: synchronize playlist transition assertions with frames`）。工作区在分析前已有未提交改动（`package.json`、`src/common/ipcNames.ts`、`src/main/modules/tray.ts` 等），**本文档中的所有行号均指分析当时的当前工作区状态**，与会话开始时的工作区一致。

---

## 0. 路径别名与统计口径

### 0.1 路径别名

| 别名 | 实际路径 |
| --- | --- |
| `R:ipc` | `src/renderer/utils/ipc.ts` |
| `R:listManage` | `src/renderer/store/list/listManage/rendererListManage.ts` |
| `R:dislike` | `src/renderer/core/dislikeList.ts` |
| `R:lyricIpc` | `src/renderer-lyric/utils/ipc.ts` |
| `R:commonIpc` | `src/common/rendererIpc.ts` |
| `M:common` | `src/main/modules/commonRenderers/common/rendererEvent.ts` |
| `M:commonSend` | `src/main/modules/commonRenderers/common/winRendererEvent.ts` |
| `M:list` | `src/main/modules/commonRenderers/list/rendererEvent.ts` |
| `M:listSend` | `src/main/modules/commonRenderers/list/winRendererEvent.ts` |
| `M:dislike` | `src/main/modules/commonRenderers/dislike/rendererEvent.ts` |
| `M:dislikeSend` | `src/main/modules/commonRenderers/dislike/winRendererEvent.ts` |
| `M:app` | `src/main/modules/winMain/rendererEvent/app.ts` |
| `M:data` | `src/main/modules/winMain/rendererEvent/data.ts` |
| `M:dl` | `src/main/modules/winMain/rendererEvent/download.ts` |
| `M:hk` | `src/main/modules/winMain/rendererEvent/hotKey.ts` |
| `M:music` | `src/main/modules/winMain/rendererEvent/music.ts` |
| `M:proc` | `src/main/modules/winMain/rendererEvent/process.ts` |
| `M:se` | `src/main/modules/winMain/rendererEvent/soundEffect.ts` |
| `M:ua` | `src/main/modules/winMain/rendererEvent/userApi.ts` |
| `M:hotkey` | `src/main/modules/hotKey/rendererEvent.ts` |
| `M:lyric` | `src/main/modules/winLyric/rendererEvent.ts` |
| `M:lyricPreload` | `src/main/modules/winLyric/preload.ts` |
| `M:mainIpc` | `src/common/mainIpc.ts` |
| `M:winMainMain` | `src/main/modules/winMain/main.ts` |

通道名的生成规则见 `src/common/ipcNames.ts:165-170`：对象键在运行期被改写为 `` `${模块名}_${原值}` ``。例：`WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric` 的真实通道名是 **`winMain_get_lyric`**（键名与通道名不同，容易踩坑）。

### 0.2 统计口径

从 `src/common/ipcNames.ts` 解析出的通道定义总计 **128** 条：`common 8 + player 24 + dislike 4 + winMain 77 + winLyric 11 + hotKey 4`。

**"渲染层真正调用"的判定方法**：在 `src/renderer/**` + `src/renderer-lyric/**` 中检索通道常量的引用（`WIN_MAIN_RENDERER_EVENT_NAME.<key>` 等），并**排除仅出现在注释里的引用**；桌面歌词窗口通过 `window.lyricBridge`（preload 暴露）间接使用 `winLyric_*`，已人工归入。

| 集合 | 条数 | 说明 |
| --- | --- | --- |
| ① 渲染层真正调用（含双向） | **97** | 见 §1.1 – §1.12、§1.15 |
| ② 主进程已注册但渲染层从不调用 | **11** | 见 §1.14 |
| ③ 已定义但无任何调用者（死通道） | **20** | 见 §1.13 |
| 合计 | **128** | 与 `ipcNames.ts` 定义数一致 |

> ⚠️ "只在主进程内部使用、不跨进程"的东西**不是 IPC 通道**，不能计入上表。它们是 `global.rain.event_app` / `event_list` / `event_dislike` 三个 `EventEmitter` 事件总线（`src/main/event/AppEvent.ts:6`）以及 `global.rain.worker.dbService.*` 的 Comlink 调用（`src/main/worker/index.ts:4-8`）。这些内部事件名另行列在 §1.16，仅供对照，不作为桥接工作量。

---

## 1. 渲染层 → 主进程的完整调用面

方向图例：`R→M invoke` = `ipcRenderer.invoke` / `ipcMain.handle`；`R→M send` = `ipcRenderer.send` / `ipcMain.on`；`M→R send` = `webContents.send` / `ipcRenderer.on`。

### 1.1 窗口控制（全部为桌面专有）

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_close` | `closeWindow` `R:ipc:532` | `M:app:60` (`mainOn`) | `boolean?`（`isForce`，渲染层实际不传）→ `void` | 关闭窗口（不传 `isForce` 时走托盘隐藏） |
| `winMain_min` | `minWindow` `R:ipc:539` | `M:app:48` (`mainOn`) | `void` | 最小化窗口 |
| `winMain_max` | `maxWindow` `R:ipc:546` | `M:app:51` (`mainOn`) | `void` | 最大化窗口。**渲染层无调用者 → 见 §1.14** |
| `winMain_min_toggle` | `minMaxWindowToggle` `R:ipc:553` | `M:app:42` (`mainOn`) | `void` | 最小化/还原切换。**渲染层无调用者 → 见 §1.14** |
| `winMain_hide_toggle` | `showHideWindowToggle` `R:ipc:559`（调用点 `src/renderer/core/useApp/useEventListener.ts:117`） | `M:app:45` (`mainOn`) | `void` | 显示/隐藏窗口（快捷键触发） |
| `winMain_focus` | 双向：发送 `focusWindow` `R:ipc:565`；监听 `onFocus` `R:ipc:580` | 接收 `M:app:54`；发送 `sendFocus` `M:app:137` | 双向 `void` | 渲染层请求聚焦；主进程在窗口 `focus` 事件时通知渲染层（`M:winMainMain:41`） |
| `winMain_fullscreen` | `setFullScreen` `R:ipc:616` | `M:app:68` (`mainHandle`) | `boolean` → `boolean`（实际生效的全屏状态） | 全屏切换（交通灯绿点、F11） |
| `winMain_fullscreen_state` | 双向：`getFullScreen` `R:ipc:620`；直连监听 `onFullscreenChanged` `R:ipc:624-627` | 接收 `M:app:71`；发送 `M:winMainMain:50` / `:54` | `void` → `boolean`；事件参数 `boolean` | 全屏状态查询与变更广播 |
| `winMain_set_window_size` | `setWindowSize` `R:ipc:396` | `M:app:103` (`mainOn`) | `{width,height}` → `void` | 按设置项切换窗口尺寸 |
| `winMain_open_dev_tools` | `openDevTools` `R:ipc:634`（调用点 `useEventListener.ts:61`，F12） | `M:app:99` (`mainOn`) | `void` | 打开/关闭 DevTools |
| `winMain_quit` | `quitApp` `R:ipc:525` | `M:app:39` (`mainOn`) | `void` | 退出应用。**渲染层无调用者 → 见 §1.14** |
| `winMain_set_ignore_mouse_events` | `setIgnoreMouseEvents` `R:ipc:57` | `M:app:107` (`mainOn`) | `boolean` → `void` | 鼠标事件穿透。**渲染层无调用者 → 见 §1.14** |

### 1.2 设置 / 环境 / 主题

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `common_get_app_setting` | `getSetting` `R:ipc:11`（`src/renderer/main.ts:42`） | `M:common:7` (`mainHandle`) | 无 → `Rain.AppSetting` | 启动时读取全量设置 |
| `common_set_app_setting` | `updateSetting` `R:ipc:14`（86 处调用） | `M:common:10` (`mainHandle`) | `Partial<Rain.AppSetting>` → `void` | 写入设置（主进程落盘后回广播 `winMain_on_config_change`） |
| `winMain_on_config_change` | `onSettingChanged` `R:ipc:16` | 发送 `sendConfigChange` `M:app:144`（由 `M:index:34` 订阅 `event_app.updated_config` 触发） | 事件参数 `Partial<Rain.AppSetting>` | 设置变更广播（含托盘菜单改设置的回流） |
| `common_get_env_params` | `getEnvParams` `R:ipc:61`（`src/renderer/core/useApp/index.ts:52`） | `M:common:14` (`mainHandle`) | 无 → `Rain.EnvParams`（`deeplink` / `cmdParams` / `workAreaSize` / `wallpaper`，见 `src/common/types/common.d.ts:44-56`） | 取启动参数、桌面壁纸路径 |
| `common_deeplink` | `onDeeplink` `R:ipc:69` | 发送 `M:commonSend:7` | 事件参数 `string`（`rainmusic://…`） | 深链广播（协议唤起 / 第二实例） |
| `common_clear_env_params_deeplink` | `clearEnvParamsDeeplink` `R:ipc:65` | `M:common:18` (`mainOn`) | 无 → `void` | 消费掉已处理的深链 |
| `common_theme_change` | `onThemeChange` `R:ipc:349`；歌词窗口经 `M:lyricPreload:53` | 发送 `M:commonSend:10`（源：`src/main/app.ts:208-212` 的 `nativeTheme` updated） | 事件参数 `Rain.ThemeSetting` | 系统亮暗主题变化广播 |
| `common_get_system_fonts` | `getSystemFonts` `R:ipc:226` | `M:common:22` (`mainHandle`) | 无 → `string[]` | 枚举系统字体（歌词字体选择） |

### 1.3 列表与数据库（首版核心）

主进程侧全部转发到 `global.rain.worker.dbService.*`（better-sqlite3，`src/main/worker/dbService/db.ts:1`）。

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `player_list_get` | `getUserLists` `R:listManage:28` | `M:list:6` | 无 → `Rain.List.UserListInfo[]` | 读全部歌单 |
| `player_list_add` | `createUserList` `R:listManage:38` | `M:list:12` | `{position, listInfos}` → `void` | 新建歌单 |
| `player_list_remove` | `removeUserList` `R:listManage:46` | `M:list:15` | `ids: string[]` → `void` | 删除歌单 |
| `player_list_update` | `updateUserList` `R:listManage:55` | `M:list:18` | `listInfos[]` → `void` | 改歌单元信息 |
| `player_list_update_position` | `updateUserListPosition` `R:listManage:63` | `M:list:21` | `{position, ids}` → `void` | 歌单排序 |
| `player_list_data_overwire` | 双向：`overwriteUserLists` `R:listManage:149`；监听 `R:listManage:228` | 接收 `M:list:9`；发送 `M:listSend:7` | `Rain.List.ListActionDataOverwrite` → `void` | 整表覆盖（导入备份） |
| `player_list_music_get` | `getListMusics` `R:listManage:73` | `M:list:24` | `listId: string` → `Rain.Music.MusicInfo[]` | 读歌单内歌曲 |
| `player_list_music_add` | `addListMusics` `R:listManage:82` | `M:list:27` | `{id, musicInfos, addMusicLocationType}` → `void` | 加歌 |
| `player_list_music_move` | `moveListMusics` `R:listManage:90` | `M:list:30` | `{fromId, toId, musicInfos, addMusicLocationType}` → `void` | 跨歌单移动 |
| `player_list_music_remove` | `removeListMusics` `R:listManage:98` | `M:list:33` | `{listId, ids}` → `void` | 移除歌曲 |
| `player_list_music_update` | `updateListMusics` `R:listManage:106` | `M:list:36` | `musicInfos[]` → `void` | 更新歌曲元信息 |
| `player_list_music_update_position` | `updateListMusicsPosition` `R:listManage:114` | `M:list:39` | `{listId, position, ids}` → `void` | 歌单内排序 |
| `player_list_music_overwrite` | `overwriteListMusics` `R:listManage:122` | `M:list:42` | `{listId, musicInfos}` → `void` | 整表覆盖 |
| `player_list_music_clear` | `clearListMusics` `R:listManage:130` | `M:list:45` | `ids: string[]` → `void` | 清空歌单 |
| `player_list_music_check_exist` | `checkListExistMusic` `R:listManage:158` | `M:list:48` | `{listId, musicInfoId}` → `boolean` | 判断歌曲是否已在歌单 |
| `player_list_music_get_list_ids` | `getMusicExistListIds` `R:listManage:166` | `M:list:51` | `musicInfoId: string` → `string[]` | 反查歌曲所属歌单 |

> **已发现的缺陷（证据充分，建议实现时一并修）**：`M:listSend:39-41` 的 `list_music_clear` 广播函数错误地发送了 `PLAYER_EVENT_NAME.list_data_overwire` 而不是 `list_music_clear`。因此 `player_list_music_clear` 实际上只有"渲染层 → 主进程"一个方向。Android 侧不需要复制这个 bug，但要注意桌面版的广播语义是错的。

### 1.4 收藏 / 不感兴趣

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `dislike_get_dislike_music_infos` | `R:dislike:8` | `M:dislike:6` | 无 → `Rain.Dislike.DislikeInfo` | 读不感兴趣规则（启动时） |
| `dislike_add_dislike_music_infos` | 双向：`R:dislike:17`；监听 `R:dislike:42` | 接收 `M:dislike:9`；发送 `M:dislikeSend:7` | `Rain.Dislike.DislikeMusicInfo[]` → `void` | 新增不感兴趣条目 |
| `dislike_overwrite_dislike_music_infos` | 双向：`R:dislike:21`；监听 `R:dislike:43` | 接收 `M:dislike:12`；发送 `M:dislikeSend:10` | `Rain.Dislike.DislikeRules` → `void` | 整表覆盖 |
| `dislike_clear_dislike_music_infos` | 双向：`R:dislike:25`；监听 `R:dislike:44` | 接收 `M:dislike:15`；发送 `M:dislikeSend:13` | 无 → `void` | 清空 |

### 1.5 播放器状态

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_player_status` | `sendPlayerStatus` `R:ipc:128`（`src/renderer/core/useApp/usePlayer/usePlayStatus.ts` 内 7 处） | `M:app:117` (`mainOn`) | `Partial<Rain.Player.Status>` → `void` | 把播放状态推给主进程：**仅**用于任务栏缩略图按钮（`src/main/modules/winMain/index.ts:42`）与 macOS 状态栏歌词（`src/main/modules/tray.ts:341`） |
| `winMain_player_action_on_button_click` | `onPlayerAction` `R:ipc:327`（`usePlayStatus.ts:70`） | 发送 `sendTaskbarButtonClick` `M:app:141`（源：任务栏缩略图按钮 `M:winMainMain:292`） | 事件参数 `{action, data?}` → `void` | 任务栏按钮点击回传 |
| `winMain_player_action_set_buttons` | `setPlayerAction` `R:ipc:340` | **主进程无该通道实现** | — | **死通道，见 §1.13** |

### 1.6 歌词（歌曲歌词数据，非桌面歌词窗口）

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_get_lyric` | `getPlayerLyric` `R:ipc:405`（`src/renderer/core/music/utils.ts:9`） | `M:music:7` | `musicId: string` → `Rain.Player.LyricInfo` | 读取要显示的歌词（原始 + 扩展） |
| `winMain_save_lyric_raw` | `saveLyric` `R:ipc:425`（`core/music/local.ts:92`、`core/music/online.ts:95`） | `M:music:17` | `{id, lyrics}` → `void` | 缓存原始歌词 |
| `winMain_clear_lyric_raw` | `clearLyricRaw` `R:ipc:413`（`SettingOther.vue:151`） | `M:music:20` | 无 → `void` | 清空歌词缓存 |
| `winMain_get_lyric_raw_count` | `getLyricRawCount` `R:ipc:417`（`SettingOther.vue:145`） | `M:music:23` | 无 → `number` | 歌词缓存条数 |
| `winMain_get_lyric_raw` | `getLyricRaw` `R:ipc:409` | `M:music:14` | `musicId: string` → `Rain.Music.LyricInfo` | 读原始歌词。**渲染层无调用者 → §1.14** |
| `winMain_get_lyric_edited` | `getLyricEdited` `R:ipc:422` | `M:music:31` | `musicId: string` → `Rain.Music.LyricInfo` | 读「已编辑歌词」。**渲染层无调用者 → §1.14** |
| `winMain_clear_lyric_edited` | `clearLyricEdited` `R:ipc:451` | `M:music:34` | 无 → `void` | **渲染层无调用者 → §1.14** |
| `winMain_get_lyric_edited_count` | `getLyricEditedCount` `R:ipc:455` | `M:music:37` | 无 → `number` | **渲染层无调用者 → §1.14** |

> 注：`R:ipc:429-434` 说明 `save_lyric_edited` 写入通道已随「已调整过偏移时间的歌词管理」停用而删除，但**读取通道仍保留**。

### 1.7 自定义源（首版必须保留 `lx` 兼容）

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_get_user_api_list` | `getUserApiList` `R:ipc:101` | `M:ua:28` | 无 → `Rain.UserApi.UserApiInfo[]` | 列出已导入音源 |
| `winMain_import_user_api` | `importUserApi` `R:ipc:77` | `M:ua:16` | `fileText: string` → `Rain.UserApi.ImportUserApi` | 导入音源脚本文本 |
| `winMain_set_user_api` | `setUserApi` `R:ipc:80` | `M:ua:24` | `Rain.UserApi.UserApiSetApiParams` → `void` | 启用/切换音源 |
| `winMain_remove_user_api` | `removeUserApi` `R:ipc:83` | `M:ua:20` | `ids: string[]` → `Rain.UserApi.UserApiInfo[]` | 删除音源 |
| `winMain_request_user_api` | `sendUserApiRequest` `R:ipc:104` | `M:ua:40` | `{requestKey, data}` → `any` | 向自定义源脚本转发一次请求（`lx.request`） |
| `winMain_request_user_api_cancel` | `userApiRequestCancel` `R:ipc:110`（**用的是 `rendererSend`**） | `M:ua:43`（**用的是 `mainHandle`**） | `Rain.UserApi.UserApiRequestCancelParams` | 取消请求。⚠️ **通道类型不匹配**：`ipcRenderer.send` 到 `ipcMain.handle` 注册的通道不会被接收，取消请求实际不生效。Android 桥接层应统一为 invoke |
| `winMain_user_api_status` | `onUserApiStatus` `R:ipc:95` | 发送 `M:ua:49` | 事件参数 `Rain.UserApi.UserApiStatus` | 音源加载/失败状态广播 |
| `winMain_user_api_show_update_alert` | `onShowUserApiUpdateAlert` `R:ipc:86` | 发送 `M:ua:52` | 事件参数 `Rain.UserApi.UserApiUpdateInfo` | 提示音源有更新 |
| `winMain_user_api_set_allow_update_alert` | `setAllowShowUserApiUpdateAlert` `R:ipc:92` | `M:ua:36` | `{id, enable}` → `void` | 关闭某音源的更新提示 |
| `winMain_get_user_api_status` | 无渲染层封装 | `M:ua:32` | 无 → `Rain.UserApi.UserApiStatus` | **渲染层无调用者 → §1.14** |

### 1.8 URL 缓存（短时效直链，必须能自愈）

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_get_music_url` | `getMusicUrl` `R:ipc:485`（34 处调用） | `M:music:43` | `id: string`（`<musicId>_<quality>`，见 `R:ipc:477`）→ `string`（无命中返回 `''`） | 读缓存的播放直链 |
| `winMain_save_music_url` | `saveMusicUrl` `R:ipc:495` | `M:music:46` | `{id, url}` → `void` | 写缓存 |
| `winMain_remove_music_url` | `removeMusicUrl` `R:ipc:507`（`core/music/utils.ts:8`，直链失效时丢弃） | `M:music:50` | `id: string` → `void` | 删除单条缓存 |
| `winMain_clear_music_url` | `clearMusicUrl` `R:ipc:514`（`SettingOther.vue:133`） | `M:music:53` | 无 → `void` | 清空 URL 缓存 |
| `winMain_get_music_url_count` | `getMusicUrlCount` `R:ipc:518`（`SettingOther.vue:127`） | `M:music:56` | 无 → `number` | 缓存条数 |

### 1.9 换源（其它音源同一首歌）

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_get_other_source` | `getOtherSource` `R:ipc:27`（14 处调用） | `M:music:61` | `id: string` → `Rain.Music.MusicInfoOnline[]` | 读取「换源」候选列表 |
| `winMain_save_other_source` | `saveOtherSource` `R:ipc:30` | `M:music:64` | `{id, list}` → `void` | 写入换源候选 |
| `winMain_clear_other_source` | `clearOtherSource` `R:ipc:36`（`SettingOther.vue:116`） | `M:music:67` | 无 → `void` | 清空换源缓存 |
| `winMain_get_other_source_count` | `getOtherSourceCount` `R:ipc:39`（`SettingOther.vue:110`） | `M:music:70` | 无 → `number` | 条数 |

### 1.10 主题文件 / 音效预设 / 键值存储

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_get_themes` | `getThemes` `R:ipc:466`（11 处调用） | `M:app:126` | 无 → `{themes, userThemes, dataPath}`（`dataPath` 是**绝对文件路径**，`src/main/utils/index.ts:219`） | 读内置 + 用户主题；`dataPath` 供主题图片落盘 |
| `winMain_save_theme` | `saveTheme` `R:ipc:460` | `M:app:129` | `Rain.Theme` → `void` | 保存用户主题 |
| `winMain_remove_theme` | `removeTheme` `R:ipc:463` | `M:app:132` | `id: string` → `void` | 删除用户主题 |
| `winMain_get_sound_effect_eq_preset` | `getUserSoundEffectEQPresetList` `R:ipc:232` | `M:se:7` | 无 → `Rain.SoundEffect.EQPreset[]` | 读 EQ 预设 |
| `winMain_save_sound_effect_eq_preset` | `saveUserSoundEffectEQPresetList` `R:ipc:236` | `M:se:10` (`mainOn`) | `Rain.SoundEffect.EQPreset[]` → `void` | 写 EQ 预设 |
| `winMain_get_sound_effect_convolution_preset` | `getUserSoundEffectConvolutionPresetList` `R:ipc:240` | `M:se:14` | 无 → `Rain.SoundEffect.ConvolutionPreset[]` | 读卷积混响预设 |
| `winMain_save_sound_effect_convolution_preset` | `saveUserSoundEffectConvolutionPresetList` `R:ipc:244` | `M:se:17` (`mainOn`) | `Rain.SoundEffect.ConvolutionPreset[]` → `void` | 写卷积混响预设 |
| `winMain_get_data` | `getPlayInfo` `R:ipc:140`、`getSearchHistoryList` `:151`、`getListPositionInfo` `:162`、`getListPrevSelectId` `:173`、`getListUpdateInfo` `:184`、`getLeaderboardSetting` `:194`、`getSongListSetting` `:203`、`getSearchSetting` `:212`、`getViewPrevState` `:221` | `M:data:7` | `path: DATA_KEYS` → `any \| null`（`playInfo` 特殊：会做播放队列恢复校正并可能返回 `null`） | 读 JSON 键值存储（`electron-store` 替代品，`src/main/utils/store.ts:12`） |
| `winMain_save_data` | 对应的 9 个 `save*`（`R:ipc:133,144,155,166,177,188,197,206,215`，全部 `rendererSend`） | `M:data:30` (`mainOn`) | `{path, data}` → `void` | 写 JSON 键值存储 |

### 1.11 缓存 / 对话框 / 下载 / 快捷键 / 初始化握手

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winMain_get_cache_size` | `getCacheSize` `R:ipc:380`（`SettingOther.vue:80`） | `M:app:95` | 无 → `number` | Chromium 会话缓存大小 |
| `winMain_clear_cache` | `clearCache` `R:ipc:387`（`SettingOther.vue:91`） | `M:app:91` | 无 → `void` | 清理会话缓存 |
| `winMain_set_power_save_blocker` | `setPowerSaveBlocker` `R:ipc:571`（`core/player/utils.ts:51`） | `M:app:57` (`mainOn`) | `boolean` → `void` | 播放期间阻止休眠 |
| `winMain_show_select_dialog` | `showSelectDialog` `R:ipc:359`（14 处） | `M:app:74` | `Electron.OpenDialogOptions` → `Electron.OpenDialogReturnValue` | 选择文件/目录（导入歌单、选下载目录、导入音源、选主题图） |
| `winMain_show_save_dialog` | `openSaveDir` `R:ipc:366`（6 处） | `M:app:82` | `Electron.SaveDialogOptions` → `Electron.SaveDialogReturnValue` | 选择保存路径（导出歌单、导出备份） |
| `winMain_open_dir_in_explorer` | `openDirInExplorer` `R:ipc:373`（`views/Download/index.vue:71` 等 6 处） | `M:app:86` (`mainOn`) | `path: string` → `void` | 在系统文件管理器中定位文件 |
| `winMain_download_list_get` | `downloadTasksGet` `R:ipc:651` | `M:dl:6` | 无 → `Rain.Download.ListItem[]` | 读下载任务 |
| `winMain_download_list_add` | `downloadTasksCreate` `R:ipc:654` | `M:dl:9` | `{list, addMusicLocationType}` → `void` | 新建下载任务 |
| `winMain_download_list_update` | `downloadTasksUpdate` `R:ipc:660` | `M:dl:12` | `Rain.Download.ListItem[]` → `void` | 更新任务进度/状态 |
| `winMain_download_list_remove` | `downloadTasksRemove` `R:ipc:663` | `M:dl:15` | `ids: string[]` → `void` | 删除任务 |
| `winMain_download_list_clear` | `downloadListClear` `R:ipc:666` | `M:dl:18` | 无 → `void` | 清空任务列表 |
| `winMain_inited` | `sendInited` `R:ipc:23`（`core/useApp/index.ts:67`） | `M:app:122` (`mainOn`) | 无 → `void` | 渲染层初始化完成的握手信号 |
| `winMain_get_hot_key` | `getHotKeyConfig` `R:ipc:53` | `M:hk:22` | 无 → `Rain.HotKeyConfigAll` | 读快捷键配置 |
| `winMain_key_down` | `onKeyDown` `R:ipc:592` | 发送 `M:hk:36` | 事件参数 `Rain.HotKeyEvent` | 全局快捷键按下通知渲染层 |
| `winMain_set_hot_key_config` | `onUpdateHotkey` `R:ipc:604` | 发送 `M:hk:40` | 事件参数 `Rain.HotKeyConfigAll` | 配置变更通知 |
| `hotKey_enable` | `hotKeySetEnable` `R:ipc:305` | `M:hotkey:27` | `boolean` → `void` | 启用/停用全局快捷键 |
| `hotKey_set_config` | `hotKeySetConfig` `R:ipc:309` | `M:hotkey:7` | `Rain.HotKeyActions` → `boolean` | 配置/注册/注销快捷键 |
| `hotKey_status` | `hotKeyGetStatus` `R:ipc:313` | `M:hotkey:25` | 无 → `Rain.HotKeyState` | 查询注册状态 |
| `hotKey_apply_config` | `hotKeyApplyConfig` `R:ipc:322` | `M:hotkey:35` | `Rain.HotKeyConfigAll` → `Rain.HotKeyRegisterFailInfo[]` | 导入设置后重新注册 |
| `winMain_process_new_desktop_lyric_client` | `onNewDesktopLyricProcess` `R:ipc:643`（`core/lyric.ts:109`） | `M:proc:14`（用 `webContents.postMessage` 传 `MessagePort`） | 事件带 `MessagePort`；渲染层从 `event.ports[0]` 取（`core/lyric.ts:111`） | 建立主窗口 ↔ 桌面歌词窗口的直连通道 |

### 1.12 桌面歌词窗口的桥（`winLyric_*`，仅歌词窗口使用）

歌词窗口的渲染层不直接用 `ipcRenderer`，而是通过 preload 暴露的 `window.lyricBridge`（`M:lyricPreload:63`），契约见 `src/renderer-lyric/types/bridge.ts:1-11`。

| 通道名 | 渲染层封装（文件:行） | 主进程 handler（文件:行） | 参数 → 返回值 | 用途 |
| --- | --- | --- | --- | --- |
| `winLyric_get_config` | `getSetting` `R:lyricIpc:6` ← `M:lyricPreload:34` | `M:lyric:33` | 无 → `Rain.DesktopLyric.Config \| undefined`（非本窗口主 frame 调用返回 `undefined`） | 读歌词窗口配置 |
| `winLyric_set_config` | `updateSetting` `R:lyricIpc:7` ← `M:lyricPreload:37`（含白名单校验 `M:lyricPreload:7-19`） | `M:lyric:25` | `Partial<Rain.DesktopLyric.Config>` → `void` | 写歌词窗口配置 |
| `winLyric_set_win_bounds` | `setWindowBounds` `R:lyricIpc:11` ← `M:lyricPreload:43` | `M:lyric:38` (`mainOn`) | `{x,y,w,h}` → `void` | 拖动/缩放歌词窗口 |
| `winLyric_request_main_window_channel` | `sendConnectMainWindowEvent` `R:lyricIpc:20` ← `M:lyricPreload:45` | `M:lyric:48` (`mainOn`) | 无 → `void` | 请求与主窗口建立 `MessagePort` |
| `winLyric_provide_main_window_channel` | `onProvideMainWindowChannel` `R:lyricIpc:21`（消费 `window.postMessage` 转发的 port） | 发送 `M:lyric:55`（`senderFrame.postMessage`） | `MessagePort` | 回传通道端 |
| `winLyric_mouse_enter_leave` | 双向：`sendMouseEnterLeave` `R:lyricIpc:30` ← `M:lyricPreload:48`；监听 `R:lyricIpc:31` | 接收 `M:lyric:61`；发送 `M:lyric:82` | `boolean` → `void` | 鼠标悬停自动隐藏逻辑 |
| `winLyric_on_config_change` | `onSettingChanged` `R:lyricIpc:8` ← `M:lyricPreload:50` | 发送 `M:lyric:74` | 事件参数 `Partial<Rain.DesktopLyric.Config>` | 配置变更广播 |
| `winLyric_main_window_inited` | `onMainWindowInited` `R:lyricIpc:29` ← `M:lyricPreload:51` | 发送 `M:lyric:78` | 无 → `void` | 主窗口就绪通知 |
| `winLyric_set_win_resizeable` | 无发送方：`R:lyricIpc:13-18` 的 `setWindowResizeable` 是**空实现** | `M:lyric:43` (`mainOn`) | — | **死通道 → §1.14** |
| `winLyric_close` | 无 | 无 | — | **死通道 → §1.13** |
| `winLyric_key_down` | 无 | 无 | — | **死通道 → §1.13** |

### 1.13 死通道：已定义但无任何调用者（20 条，可直接删除）

这些通道在 `src/common/ipcNames.ts` 里有定义，但渲染层与主进程都没有实现/调用（或只有被注释掉的代码）。**Android 侧零工作量。**

| # | 通道名 | 证据 |
| --- | --- | --- |
| 1 | `player_play_music` | 无任何引用（`player` 模块 8 条 `invoke_*`/`player_*` 全部如此） |
| 2 | `player_play_next` | 同上 |
| 3 | `player_play_prev` | 同上 |
| 4 | `player_toggle_play` | 同上 |
| 5 | `player_player_play` | 同上 |
| 6 | `player_player_pause` | 同上 |
| 7 | `player_player_stop` | 同上 |
| 8 | `player_player_error` | 同上 |
| 9 | `common_system_theme_change` | 无任何引用（主进程用 `common_theme_change` 代替，`M:commonSend:10`） |
| 10 | `winLyric_close` | 无任何引用 |
| 11 | `winLyric_key_down` | 无任何引用 |
| 12 | `winMain_change_tray` | 无任何引用，主进程也无实现 |
| 13 | `winMain_handle_request` | 无任何引用，主进程也无实现 |
| 14 | `winMain_cancel_request` | 无任何引用，主进程也无实现 |
| 15 | `winMain_restart_window` | 无任何引用，主进程也无实现 |
| 16 | `winMain_set_config` | 无任何引用，主进程也无实现 |
| 17 | `winMain_set_app_name` | 仅 `M:app:32-38` 的注释代码 |
| 18 | `winMain_get_lyric_info` | 仅 `R:ipc:121-126` 与 `M:lyric:16-22` 的注释代码 |
| 19 | `winMain_set_lyric_info` | 仅 `R:ipc:114-120` 的注释代码 |
| 20 | `winMain_player_action_set_buttons` | 渲染层有封装 `R:ipc:340` 但无调用者；主进程**完全没有**该通道的 handler |

### 1.14 集合 ②：主进程已注册、但渲染层从不调用（11 条）

这些通道**已实现**（有 handler），但渲染层没有调用者——包括"渲染层封装函数存在却无人 import"的情况。它们是缩小 Android 桥接工作量的关键：**不必移植**。

| # | 通道名 | 主进程实现 | 渲染层状态 |
| --- | --- | --- | --- |
| 1 | `winMain_show_dialog` | `M:app:78`（`dialog.showMessageBoxSync`） | 无封装函数 |
| 2 | `winMain_get_user_api_status` | `M:ua:32` | 无封装函数 |
| 3 | `winMain_get_lyric_raw` | `M:music:14` | 封装 `getLyricRaw` `R:ipc:409` 无调用者 |
| 4 | `winMain_get_lyric_edited` | `M:music:31` | 封装 `getLyricEdited` `R:ipc:422` 无调用者 |
| 5 | `winMain_clear_lyric_edited` | `M:music:34` | 封装 `clearLyricEdited` `R:ipc:451` 无调用者 |
| 6 | `winMain_get_lyric_edited_count` | `M:music:37` | 封装 `getLyricEditedCount` `R:ipc:455` 无调用者 |
| 7 | `winMain_set_ignore_mouse_events` | `M:app:107` | 封装 `setIgnoreMouseEvents` `R:ipc:57` 无调用者 |
| 8 | `winMain_max` | `M:app:51` | 封装 `maxWindow` `R:ipc:546` 无调用者 |
| 9 | `winMain_min_toggle` | `M:app:42` | 封装 `minMaxWindowToggle` `R:ipc:553` 无调用者 |
| 10 | `winMain_quit` | `M:app:39` | 封装 `quitApp` `R:ipc:525` 无调用者 |
| 11 | `winLyric_set_win_resizeable` | `M:lyric:43` | 渲染层 `setWindowResizeable` `R:lyricIpc:13-18` 是空实现，从不发送 |

### 1.15 补充：不是 IPC、但同样跨上下文的调用（Worker RPC）

渲染层还有一整套 **Comlink over Web Worker** 的调用面，形如 `window.rain.worker.main.*` / `window.rain.worker.download.*`。它们**不是 IPC 通道**（`globalData.ts:26` 在本进程内 `new Worker()`），但同样是 Android 必须重写的跨上下文边界，且 worker 内部大量使用 Node API。契约定义：`src/renderer/worker/main/index.ts:11`、`src/renderer/worker/download/index.ts:10`。

| Worker 方法 | 调用点 |
| --- | --- |
| `main.langS2t` | `src/renderer/utils/index.ts:56` |
| `main.filterMusicList` | `src/renderer/core/player/utils.ts:28` |
| `main.getMusicFilePic` | `core/music/download.ts:34`、`core/music/local.ts:108` |
| `main.getMusicFileLyric` | `core/music/download.ts:67`、`core/music/local.ts:139` |
| `main.createLocalMusicInfos` | `views/List/MyList/actions.ts:8` |
| `main.sortListMusicInfo` | `views/List/MyList/components/ListSortModal.vue:116` |
| `main.filterDuplicateMusic` | `views/List/MyList/components/DuplicateMusicModal.vue:71` |
| `main.searchListMusic` | `views/List/MusicList/components/SearchList.vue:216` |
| `main.createSortedList` | `store/list/listManage/action.ts:303` |
| `main.saveRainConfigFile` / `readRainConfigFile` | `views/List/MyList/useShare.ts:23,43`；`views/Setting/components/SettingBackup.vue:188,237,256,271,306,321` |
| `download.createDownloadTasks` | `store/download/action.ts:354` |
| `download.startTask` / `pauseTask` / `removeTask` / `updateUrl` | `store/download/action.ts:271,389,248,281,411,239` |
| `download.writeMeta` / `saveLrc` | `store/download/action.ts:168,196` |

### 1.16 补充：主进程内部事件总线（非 IPC，不计入通道数）

`global.rain.event_app` / `event_list` / `event_dislike` 是主进程内的 `EventEmitter`（`src/main/event/AppEvent.ts:6`），只在主进程内部通信。事件名示例：`app_inited`、`updated_config`、`theme_change`、`system_theme_change`、`deeplink`、`player_status`、`hot_key_down`、`hot_key_config_update`、`main_window_*`、`desktop_lyric_window_created`。Android 业务层可沿用同样的分层（事件总线 → 广播），但**不要把它们当作 IPC 通道**。

---

## 2. 渲染层里的 Electron / Node 专有依赖

> 范围：`src/renderer/**`、`src/renderer-lyric/**`，以及它们直接 import 的 `src/common/**`（因为会被打进渲染层 bundle）。
>
> 前提事实：主窗口的 `webPreferences` 是 **`nodeIntegration: true` + `contextIsolation: false` + `webSecurity: false` + `nodeIntegrationInWorker: true`**（`M:winMainMain:120-130`），且**没有配置 preload**。所以渲染层能直接 `import 'fs'`、用 `Buffer`、读 `process.*`。Android WebView 完全没有这些能力。

### 2.1 Electron IPC / preload 接口

| 文件:行 | 用途 | Android WebView 是否有等价能力 |
| --- | --- | --- |
| `src/common/rendererIpc.ts:1` | `import { ipcRenderer } from 'electron'` | ❌ 无。需换成 Capacitor 桥（自定义 plugin 或 `postMessage` 协议） |
| `src/common/rendererIpc.ts:6,12,20,26,34,40,44` | `send` / `sendSync` / `invoke` / `on` / `once` / `removeListener` / `removeAllListeners` 封装 | ❌ 无。适配层需要把 `invoke` 映射为 Promise 请求-响应、`on` 映射为事件订阅 |
| `R:ipc:2` | 直接 `import { ipcRenderer } from 'electron'` | ❌ 无 |
| `R:ipc:626-627` | 直接 `ipcRenderer.on` / `removeListener`（`fullscreen_state`，绕过了 `rendererIpc` 封装） | ❌ 无。这是唯一一处"绕过封装"的 IPC，收敛时应一并处理 |
| `src/renderer/core/lyric.ts:16` | `Electron.IpcRendererEvent['ports'][0]` 类型；`:111` `event.ports` | ❌ 无（`MessagePort` 由 Electron 的 `postMessage` 传递）。Android 单进程单窗口场景建议改为直接函数调用 / `BroadcastChannel` |
| `src/renderer-lyric/types/bridge.ts:15` | `window.lyricBridge`（由 `M:lyricPreload:63` 用 `contextBridge` 注入） | ❌ 无 preload 概念。首版不做桌面歌词窗口，可直接删除 |
| `src/renderer/worker/utils/index.ts:6,25` | `new Worker(new URL(...))` + `Comlink.wrap` | ⚠️ 部分有：Web Worker 本身可用，Comlink 也可用；但这两个 worker **依赖 `nodeIntegrationInWorker`**（`M:winMainMain:122`）才能跑，Android 无此能力 |
| `src/renderer/worker/main/music.ts:2-4` | `node:path` / `node:os` / `node:fs/promises` | ❌ 无 |
| `src/renderer/worker/download/utils.ts:4` | `import fs from 'fs'`；`:17` `await import('iconv-lite')` | ❌ 无（`iconv-lite` 可换 `TextDecoder('gbk')`） |
| `src/renderer/worker/download/download.ts:11` | `@common/utils/nodejs`（`checkAndCreateDir` / `checkPath` / `getFileStats` / `removeFile`） | ❌ 无（Capacitor Filesystem） |
| `src/renderer/worker/main/common.ts:4-5` | `Buffer.from(..., 'base64')` | ⚠️ 有替代：`atob` / `Uint8Array` / `TextDecoder` |
| `src/renderer/worker/download/lrcTool.ts:67-76` | `Buffer.from(...).toString('base64')` | ⚠️ 有替代：`btoa`（注意 UTF-8） |

### 2.2 运行时探测 / 全局注入

| 文件:行 | 用途 | Android WebView 是否有等价能力 |
| --- | --- | --- |
| `src/renderer/core/globalData.ts:4-32` | **`window.rain` / `window.rainData` 是渲染层自己创建的**（不是 preload 注入） | ✅ 可原样保留。这是好消息：`window.rain` 不是 Electron 契约，只是本进程内的命名空间 |
| `src/renderer/core/globalData.ts:27,34` | `process.env.NODE_ENV`、`process.env.ELECTRON_DISABLE_SECURITY_WARNINGS` | ❌ 无 `process`。需改为构建期常量或 `import.meta.env` |
| `src/renderer/store/index.ts:6` | `process.versions.app = pkg.version` | ❌ 无。改用打包进来的版本常量 |
| `src/renderer/utils/request.js:270-271` | `process.versions.app.split(...)` 参与请求头签名 | ❌ 无。必须换成显式版本常量（否则 `tx` 接口签名会崩） |
| `src/renderer/utils/env.js:1` | `process.env.NODE_ENV === 'development'` | ❌ 无 |
| `src/renderer/utils/ipc.ts` 全文 | 通过 `@common/rendererIpc` 走 IPC | ❌ 无 |
| `src/renderer/index.html:28-33` | 从 URL query 解析 `?os=` / `?osver=` / `?dark=` / `?dt=`，并 `classList.add(os, ...)` | ❌ Capacitor 下 URL 是 `capacitor://localhost`，**无 query**。此时 `os` 为 `undefined`，`classList.add(undefined, "undefined-")` 会给 `<html>` 加上垃圾 class（实测推断，**需确认**在目标 WebView 上的具体表现）。必须改成运行时 `Capacitor.getPlatform()` |
| `src/renderer/index.html:35-46` | `window.setTheme` / `applyThemeColor`（写 `<style>` 注入 CSS 变量） | ✅ 纯浏览器能力，可保留 |
| `src/renderer/store/index.ts:45-47` | `window.rain.rootOffset`（`window.dt` / 全屏决定，0 或 8px） | ⚠️ 有替代：Android 应恒为 `0`（无窗口边框） |
| `src/renderer/components/base/Popup.vue:65,81` | 用 `window.rain.rootOffset` 换算弹层坐标 | ⚠️ 同上 |
| `src/renderer/utils/compositions/useMenuLocation.js:63-64` | 同上 | ⚠️ 同上 |
| `src/renderer/components/layout/Aside/index.vue:22` 等 **23 处**（`Aside/index.vue:22`、`Aside/NavBar.vue:87,101`、`Aside/ControlBtns.vue:64`、`Toolbar/index.vue:37,44`、`Toolbar/ControlBtns.vue:66`、`Toolbar/TrafficLights.vue:93,111`、`PlayDetail/index.vue:124,158`、`PlayDetail/WindowHeader.vue:27,30,49`、`PlayDetail/ControlBtnsLeftHeader.vue:77,92,99`、`PlayDetail/ControlBtnsRightHeader.vue:84,99,107`、`DetailDismissButton.vue:21`、`material/SearchInput.vue:205`、`views/Setting/components/ThemeEditModal/index.vue:705`） | `-webkit-app-region: drag` / `no-drag` 实现窗口拖动区域 | ❌ WebView 中无效（会被忽略），应移除；Android 无需自绘拖动条 |
| `src/renderer/App.vue:77` + `src/renderer/core/useApp/useEventListener.ts:79-83` | `.transparent` / `.disableTransparent` class（`window.dt`） | ⚠️ 有替代：Android 固定用不透明布局 |
| `src/renderer-lyric/utils/platform.ts:1` | `window.os === 'windows'` | ⚠️ 有替代：`Capacitor.getPlatform()`（但首版不做歌词窗口） |
| `src/renderer-lyric/index.html:20` | 从 `?os=` 解析平台 | ⚠️ 同上 |

### 2.3 Node 内置模块与 Node-only 依赖（渲染层实际执行的代码）

| 文件:行 | 依赖 | 用途 | Android 是否有等价能力 |
| --- | --- | --- | --- |
| `src/renderer/utils/request.js:1` | **`needle`（Node HTTP 客户端）** | 所有内置音源的 HTTP 请求入口（`httpFetch`） | ❌ 无。**这是渲染层最大的单点阻塞**：必须整层换成 `fetch`（+ CapacitorHttp 绕过 CORS） |
| `src/renderer/utils/request.js:6` | `zlib.deflateRaw` | 构造 `tx` 接口签名请求头（`:247-252`） | ⚠️ 有替代：`pako` 的 `deflateRaw`，或原生桥 |
| `src/renderer/utils/request.js:267-272` | `Buffer` + `process.versions.app` | 同上 | ⚠️ 有替代 |
| `src/renderer/utils/musicSdk/utils.js:1` | `crypto`（`createHash('md5')`） | `toMD5` | ✅ 有替代：WebCrypto 无 MD5，需 JS 实现（如 `js-md5`） |
| `src/renderer/utils/musicSdk/utils.js:2,15,29` | **`dns.lookup`** | 给部分接口做 Host 预解析 | ❌ 无。需删除该优化或改原生桥 |
| `src/renderer/utils/musicSdk/tx/qrcDecode.js:1` | `zlib.inflate` | 解码 QQ 音乐 QRC 歌词 | ⚠️ 有替代：`pako.inflate` |
| `src/renderer/utils/musicSdk/tx/utils/crypto.js:1` | `node:crypto` | `Buffer.from` + 哈希 | ⚠️ 部分有替代 |
| `src/renderer/utils/musicSdk/wy/utils/crypto.js:2,22` | `createCipheriv` / **`publicEncrypt` with `RSA_NO_PADDING`** | 网易云 eapi/weapi 加密 | ❌ WebCrypto **不支持** `RSA_NO_PADDING`。需纯 JS 大数实现或原生桥（**首版必须解决**，见 `docs/android-port-plan.md` §1 的"网络层"） |
| `src/renderer/utils/musicSdk/kg/lyric.js:82` | `Buffer.from(content,'base64')` | 酷狗歌词 base64 解码 | ⚠️ 有替代 |
| `src/common/utils/index.ts:2,5-10,17-22` | `node:os`、`process.platform`、`os.release()` | `isMac`/`isWin`/`isLinux`、`getPlatform`、`getOSVersion` | ⚠️ 有替代：`Capacitor.getPlatform()` / `Device.getInfo()` |
| `src/common/utils/nodejs.ts:1-5` | `node:fs` / `node:crypto` / `node:zlib` / `node:path` / `node:os` | 文件读写、`joinPath`、gzip 存档、网卡枚举 | ❌ 无。**该类被渲染层多处 import**（`worker/download/download.ts:11`、`worker/main/music.ts:5`、`views/Setting/...`、`views/List/MyList/...`），必须拆成"纯路径工具（浏览器可用）"+"IO 实现（Capacitor Filesystem）"两层 |
| `src/common/utils/request.ts:1` + `request_node16.ts:1` | `node:querystring` | 请求参数序列化 | ⚠️ 有替代：`URLSearchParams` |
| `src/common/utils/download/Downloader.ts:1-6` | `fs` / `path` / `events` / `http` | 下载器（断点续传） | ❌ 无。首版建议改用 Capacitor Filesystem `downloadFile` + 自建进度/重试 |
| `src/common/utils/download/request.ts:1-3` | `url` / `http` / `https` | 下载请求 | ❌ 无 |
| `src/common/utils/musicMeta/*.js`（`mp3Meta.js:2-3`、`flacMeta.js:1,3`、`downloader.js:3`、`index.js:1`） | `fs` / `path` | 写入/读取音频元数据与封面（下载后置元数据） | ❌ 无。首版可降级：不写元数据，只写文件 + 同名 `.lrc` |
| `src/common/utils/lyricUtils/kg.js:1` | `zlib.inflate` | 酷狗 KRC 歌词解码 | ⚠️ 有替代：`pako` |
| `src/common/utils/pinyin/parser.js:1,4-5` | `fs.promises` / `path` / `__dirname` | 构建期生成拼音表 | ❌ 构建期脚本，**不应进渲染层**；需确认是否被打进 bundle |
| `src/common/defaultSetting.ts:1-2,5` | `node:path` / `node:os` / `process.platform` | 默认下载目录等 | ❌ 无。Android 默认目录应来自 `Filesystem.getUri('ExternalStorage')` |
| `src/common/utils/common.ts:3` | `pathToFileURL`（`url`） | 路径 → file URL | ⚠️ 有替代：手写 `file://` 拼接或 `Capacitor.convertFileSrc()` |
| `src/renderer/utils/index.ts:56` | `Buffer.from(...)` | 简繁转换的 base64 桥 | ⚠️ 有替代：`TextEncoder`/`atob`（并可顺手去掉 worker 往返） |
| `src/renderer/router.ts:12,20,…` | `require('./views/...')` | webpack 动态 require | ✅ 构建器能力，不是 Node 运行时依赖，可保留（Vite 下需改 `import()`） |
| `src/renderer/core/useApp/usePlayer/useMediaSessionInfo.ts:11`、`useSoundEffect.ts:21` | `require('@renderer/assets/...')` | webpack 资源加载 | ✅ 同上，需改成 `new URL(..., import.meta.url)` |

---

## 3. Electron API 使用点（主进程侧）

实测 `import ... from 'electron'` 出现在以下文件（`src/main/**`、`src/common/**`）：

```
src/main/app.ts:3                     → app, shell, screen, nativeTheme, dialog
src/main/index.ts:19 / index-dev.ts:8 → app
src/main/event/AppEvent.ts:4          → 仅类型 BrowserWindow
src/main/modules/appMenu.ts:1         → app, Menu
src/main/modules/tray.ts:1            → Tray, Menu, nativeTheme
src/main/modules/trayImage.ts:1       → nativeImage
src/main/modules/hotKey/index.ts:1    → app
src/main/modules/hotKey/utils.ts:1    → globalShortcut
src/main/modules/userApi/main.ts:2    → BrowserWindow
src/main/modules/winLyric/main.ts:2   → BrowserWindow
src/main/modules/winLyric/mouseCheckTools.ts:1 → screen
src/main/modules/winLyric/rendererEvent.ts:7   → MessageChannelMain
src/main/modules/winLyric/preload.ts:1         → contextBridge, ipcRenderer
src/main/modules/userApi/renderer/preload.js:1 → contextBridge, ipcRenderer, webFrame
src/main/modules/winMain/main.ts:1    → BrowserWindow, dialog, session
src/main/modules/winMain/utils.ts:4   → nativeImage
src/main/modules/winMain/rendererEvent/app.ts:2 → app
src/main/utils/dataPath.ts:20         → app
src/main/utils/index.ts:8             → nativeTheme, powerSaveBlocker
src/main/utils/logInit.ts:2           → app
src/main/utils/store.ts:2             → dialog, shell
src/main/utils/winLegacy.ts:3         → dialog
src/common/mainIpc.ts:1               → ipcMain
src/common/utils/electron.ts:1        → shell, clipboard
```

| Electron 能力 | 主要使用点 | Android 有无对应概念 | 替代方案（一句话） |
| --- | --- | --- | --- |
| `app`（生命周期） | `src/main/index.ts:33`（`whenReady`）、`app.ts:191`（`before-quit`）、`:194`（`window-all-closed`）、`:183`（`activate`） | **有替代** | 用 `Application.ActivityLifecycleCallbacks` / Capacitor `App` 插件的 `appStateChange`、`pause`、`resume` |
| `app.getPath` / `app.setPath` | `src/main/utils/dataPath.ts:26,41,52,56`、`logInit.ts:35` | **无** | 数据目录改由 `Filesystem.getUri('Data')` / `getUri('External')` 决定；取消"便携目录重定向"概念 |
| `app.requestSingleInstanceLock` | `src/main/app.ts:85` | **有替代** | `AndroidManifest.xml` 的 `android:launchMode="singleTask"` |
| `app.setAsDefaultProtocolClient` / `open-url` | `src/main/app.ts:126,128,132` | **有替代** | Intent filter 注册 `rainmusic://` + Capacitor `App.addListener('appUrlOpen')` |
| `app.commandLine.appendSwitch` | `src/main/app.ts:110,113,116,118` | **无 / 需重写** | Chromium 启动开关在 Android WebView 上不可用，逐条评估后删除 |
| `app.disableHardwareAcceleration` | `src/main/app.ts:109` | **无** | 删除 |
| `app.exit` / `app.quit` | `M:app:62`（`:60` 的 `isForce` 分支）、`src/main/app.ts:86,102,197,303` | **有替代** | `Activity.finishAndRemoveTask()` / `System.exit(0)`（经原生桥） |
| `BrowserWindow`（主窗口） | `M:winMainMain:136` | **有替代** | Capacitor 主 WebView（`MainActivity` 的 `BridgeActivity`） |
| `BrowserWindow`（桌面歌词窗口） | `src/main/modules/winLyric/main.ts:114` | **需重写** | 首版不做；后续用系统通知栏歌词或 `TYPE_APPLICATION_OVERLAY` 悬浮窗 |
| `BrowserWindow`（自定义源宿主） | `src/main/modules/userApi/main.ts:45` | **需重写** | 用隐藏 `iframe`/`Web Worker` 承载 `user-api.html` 并提供 `lx`/`rain`（见 `docs/custom-source.md`） |
| `BrowserWindow` 选项（`frame:false`、`transparent`、`roundedCorners`、`setThumbarButtons`…） | `M:winMainMain:100-131,286-295` | **无** | 删除；`frame:false` 正是"自绘交通灯"的根源 |
| `Tray` | `src/main/modules/tray.ts:134,140,148,259,264,281` | **无** | 首版移除；如需常驻用前台 Service + 常驻通知（媒体通知可复用 `MediaSession`） |
| `Menu`（应用菜单 / 托盘菜单） | `src/main/modules/appMenu.ts:47,49`、`tray.ts:258` | **无** | 删除（Android 无原生应用菜单） |
| `globalShortcut` | `src/main/modules/hotKey/utils.ts:30,32,41,47` | **无** | Android 无全局热键。可用 `MediaSession` 接收媒体键（播放/上一曲/下一曲），但**不能**映射到用户任意组合键 |
| `nativeImage` | `src/main/modules/trayImage.ts:6,12,13`、`M:winMainMain:11`（`winMain/utils.ts:10-11`） | **有替代** | Android `BitmapFactory` 读 `assets`/`res` 图片；任务栏缩略图按钮整体删除 |
| `session.fromPartition` | `M:winMainMain:95` | **无** | Capacitor 无 partition 概念；自定义源若需隔离 Cookie，用独立 `WebView` 实例 + `CookieManager` |
| `session.clearCache` / `getCacheSize` | `M:winMainMain:305,310` | **有替代** | `WebView.clearCache(true)` / 统计 `cacheDir` 大小 |
| `session.clearAuthCache` / `clearStorageData` / `setPermissionRequestHandler` | `src/main/modules/userApi/main.ts:79,107-109` | **有替代**（部分） | `CookieManager.removeAllCookies` / `WebStorage.deleteAllData`；权限回调走 `WebChromeClient.onPermissionRequest` |
| `session.setSpellCheckerDictionaryDownloadURL` | `src/main/app.ts:180` | **无** | 删除 |
| `protocol` | **实测未使用** | — | 无工作量（协议相关只用到了 `app.setAsDefaultProtocolClient`） |
| `dialog.showOpenDialog` | `M:winMainMain:168` | **需降级** | Android SAF：`Intent.ACTION_OPEN_DOCUMENT` + `onActivityResult`（Capacitor `@capawesome/capacitor-file-picker`） |
| `dialog.showSaveDialog` | `M:winMainMain:180` | **需降级** | SAF：`Intent.ACTION_CREATE_DOCUMENT` |
| `dialog.showMessageBoxSync` | `M:winMainMain:172`、`src/main/app.ts:279`（数据库校验失败）、`src/main/utils/store.ts:94`（store 损坏）、`src/main/utils/winLegacy.ts:20,30` | **有替代** | 前两者是"启动期同步阻断式告警"，Android 无同步对话框 → 改为启动后弹 UI 提示 + 写日志；`winLegacy`（Win7 提示）直接删除 |
| `powerSaveBlocker` | `src/main/utils/index.ts:295,298,301` | **有替代** | Capacitor `@capacitor-community/keep-awake`（或 `FLAG_KEEP_SCREEN_ON`） |
| `screen.getPrimaryDisplay` / `display-metrics-changed` / `getCursorScreenPoint` | `src/main/app.ts:201,204`、`src/main/modules/winLyric/mouseCheckTools.ts:20` | **有替代** | `DisplayMetrics` / `WindowManager.getCurrentWindowMetrics`；后者（桌面歌词鼠标检测）随歌词窗口一起删除 |
| `nativeTheme.shouldUseDarkColors` / `updated` | `src/main/app.ts:49,208,209`、`src/main/utils/index.ts:249`、`tray.ts:119` | **有替代** | `Configuration.uiMode & UI_MODE_NIGHT_MASK`；渲染层也可直接用 `matchMedia('(prefers-color-scheme: dark)')` |
| `webContents.send` | `M:mainIpc:53` | **需重写** | `WebView.postWebMessage` / 自定义 JavaScriptInterface 回推 |
| `webContents.postMessage`（传 `MessagePort`） | `M:proc:15` | **无等价** | 删除（桌面歌词专有） |
| `webContents.openDevTools` / `closeDevTools` / `isDevToolsOpened` | `M:winMainMain:232-235`、`src/main/utils/index.ts:207` | **有替代**（调试期） | `WebView.setWebContentsDebuggingEnabled(true)` + Chrome `chrome://inspect` |
| `webContents.setWindowOpenHandler` / `will-navigate` / `will-attach-webview` | `src/main/app.ts:146-177`、`userApi/main.ts:73-88` | **需重写** | `WebViewClient.shouldOverrideUrlLoading` + `WebChromeClient`；导航白名单逻辑（`navigationUrlWhiteList`）应保留 |
| `ipcMain.on/handle/removeHandler` | `M:mainIpc:6,14,20,24,32,42,47` | **需重写** | 用 Capacitor plugin 的 `@PluginMethod` + `notifyListeners`，或自定义 `postMessage` 协议在 JS 侧模拟同名通道 |
| `shell.openExternal` | `src/main/app.ts:160`、`src/common/utils/electron.ts:19` | **有替代** | `Intent.ACTION_VIEW`；或 `@capacitor/app` + `window.open(url,'_system')` |
| `shell.showItemInFolder` | `src/main/utils/store.ts:99`、`src/common/utils/electron.ts:9` | **无** | Android 无"在文件夹中显示"；降级为"用系统应用打开该文件"或分享 |
| `clipboard.writeText` / `readText` | `src/common/utils/electron.ts:28,36` | **有替代** | `@capacitor/clipboard` 或 `navigator.clipboard`（WebView 需 HTTPS/`capacitor://` 安全上下文，`capacitor://localhost` 满足） |
| `MessageChannelMain` | `src/main/modules/winLyric/rendererEvent.ts:51` | **无等价** | 删除 |
| `contextBridge.exposeInMainWorld` | `userApi/renderer/preload.js:329,330,332`、`M:lyricPreload:63` | **需重写** | Android 无 preload；自定义源宿主里直接把 `lx`/`rain` 挂到宿主上下文（iframe 用 `contentWindow`，Worker 用 `importScripts` 前的全局注入） |
| `webFrame.executeJavaScript` | `userApi/renderer/preload.js:338,349` | **需重写** | 宿主内 `new Function(script)` / `iframe.srcdoc` 注入；沙箱化策略需重新设计 |
| `node:worker_threads` + `comlink/dist/esm/node-adapter` | `src/main/worker/utils/index.ts:1,8,13`、`worker/utils/worker.ts:1,8` | **有替代** | 数据库访问移到主线程或 Web Worker（`postMessage` 通道）；Comlink 的 web adapter 可直接用 |
| `process.env` / `process.platform` / `process.argv` | `src/main/utils/index.ts:18,23`、`dataPath.ts:23,24`、`previewMode.ts`、`winLegacy.ts:10` | **需重写** | 用 `Build.VERSION` / `Capacitor.getPlatform()` / Intent extras 表达同等语义 |

### 3.1 主进程对 Node 内置模块的依赖（业务层重写的真实工作量）

| 模块 | 使用点 | 说明 |
| --- | --- | --- |
| `better-sqlite3`（原生模块） | `src/main/worker/dbService/db.ts:1,22,32` | 数据库层。schema 与迁移：`tables.ts:217` 行、`migrate.ts:103` 行、6 个 `modules/*/` 业务模块 |
| `node:worker_threads` | `worker/utils/index.ts:1,8`、`worker/utils/worker.ts:1` | 数据库跑在 worker 线程 |
| `node:fs`（同步） | `src/main/utils/store.ts:20,23,24,27,35,38,42,92` | JSON store 的**同步**原子写（临时文件 + rename） |
| `node:path` / `node:os` / `node:child_process` | `dataPath.ts:18`、`wallpaper.ts:13`（`execFileSync('reg', ...)` 读注册表壁纸）、`index.ts:2` | Windows 壁纸读取在 Android 无意义，直接删除 |
| `electron-log` | `src/main/utils/logInit.ts`、`src/common/utils/index.ts:1`（`electron-log/node`） | 日志；Android 改用 `Logcat` 或文件日志 |
| `font-list` | `src/main/utils/fontManage.ts:6` | `common_get_system_fonts` 的后端；Android 无等价"列出所有字体"，可返回 `Typeface` 内置族名列表 |

---

## 4. 分类结论表

统计对象 = §1 的 **97 条活跃通道**（`② 11 条` 与 `③ 20 条` 不计入，因为它们无需移植）。

### 4.1 A 类：必须重写（Android 侧需要等价实现）— **52 条**

| 功能域 | 通道名 | 条数 |
| --- | --- | --- |
| 设置 / 环境 / 初始化握手 | `common_get_app_setting`、`common_set_app_setting`、`common_get_env_params`、`winMain_on_config_change`、`winMain_inited` | 5 |
| 列表与 DB | `player_list_get`、`player_list_add`、`player_list_remove`、`player_list_update`、`player_list_update_position`、`player_list_data_overwire`、`player_list_music_get`、`player_list_music_add`、`player_list_music_move`、`player_list_music_remove`、`player_list_music_update`、`player_list_music_update_position`、`player_list_music_overwrite`、`player_list_music_clear`、`player_list_music_check_exist`、`player_list_music_get_list_ids` | 16 |
| 收藏 / 不感兴趣 | `dislike_get_dislike_music_infos`、`dislike_add_dislike_music_infos`、`dislike_overwrite_dislike_music_infos`、`dislike_clear_dislike_music_infos` | 4 |
| 歌词数据 | `winMain_get_lyric`、`winMain_save_lyric_raw`、`winMain_clear_lyric_raw`、`winMain_get_lyric_raw_count` | 4 |
| 自定义源 | `winMain_get_user_api_list`、`winMain_import_user_api`、`winMain_set_user_api`、`winMain_remove_user_api`、`winMain_request_user_api`、`winMain_request_user_api_cancel`、`winMain_user_api_status`、`winMain_user_api_show_update_alert`、`winMain_user_api_set_allow_update_alert` | 9 |
| URL 缓存 | `winMain_get_music_url`、`winMain_save_music_url`、`winMain_remove_music_url`、`winMain_clear_music_url`、`winMain_get_music_url_count` | 5 |
| 换源 | `winMain_get_other_source`、`winMain_save_other_source`、`winMain_clear_other_source`、`winMain_get_other_source_count` | 4 |
| 下载 | `winMain_download_list_get`、`winMain_download_list_add`、`winMain_download_list_update`、`winMain_download_list_remove`、`winMain_download_list_clear` | 5 |
| **小计** | | **52** |

### 4.2 B 类：可直接移除（桌面专有）— **26 条**

| 功能域 | 通道名 | 条数 |
| --- | --- | --- |
| 窗口按钮 / 全屏 / 尺寸 | `winMain_close`、`winMain_min`、`winMain_hide_toggle`、`winMain_focus`、`winMain_fullscreen`、`winMain_fullscreen_state`、`winMain_set_window_size` | 7 |
| 开发者工具 | `winMain_open_dev_tools` | 1 |
| 任务栏缩略图按钮 | `winMain_player_status`、`winMain_player_action_on_button_click` | 2 |
| 全局快捷键 | `winMain_get_hot_key`、`winMain_key_down`、`winMain_set_hot_key_config`、`hotKey_enable`、`hotKey_set_config`、`hotKey_status`、`hotKey_apply_config` | 7 |
| 桌面歌词窗口 | `winMain_process_new_desktop_lyric_client`、`winLyric_get_config`、`winLyric_set_config`、`winLyric_set_win_bounds`、`winLyric_request_main_window_channel`、`winLyric_provide_main_window_channel`、`winLyric_mouse_enter_leave`、`winLyric_on_config_change`、`winLyric_main_window_inited` | 9 |
| **小计** | | **26** |

> 处理原则：这些通道在 Android 侧**不实现、不注册、不广播**。但**不要**直接删 `ipcNames.ts` 里的定义并让渲染层组件报错——正确做法是让适配层对"桌面专有能力"返回中性值（例如 `setFullScreen` 返回 `false`），并让相关 UI 在 Android 下不渲染（见 §5）。

### 4.3 C 类：需降级（能用但要换实现）— **19 条**

| 通道名 | 桌面实现 | Android 降级方案 |
| --- | --- | --- |
| `winMain_show_select_dialog` | `dialog.showOpenDialog`（`M:winMainMain:168`） | SAF 文件选择器（`ACTION_OPEN_DOCUMENT`）；返回结构需适配成 `{canceled, filePaths[]}` 以少改渲染层 |
| `winMain_show_save_dialog` | `dialog.showSaveDialog`（`M:winMainMain:180`） | SAF 创建文档（`ACTION_CREATE_DOCUMENT`）；适配成 `{canceled, filePath}` |
| `winMain_open_dir_in_explorer` | `shell.showItemInFolder`（`src/common/utils/electron.ts:9`） | 无"定位文件夹"；降级为"用系统应用打开文件"（`FileOpener`）或 Share |
| `winMain_get_cache_size` | `session.getCacheSize()`（`M:winMainMain:310`） | 统计 `context.cacheDir` + `WebView` 缓存目录大小（需原生桥）；或直接返回 `0` 并隐藏该设置项 |
| `winMain_clear_cache` | `session.clearCache()`（`M:winMainMain:305`） | `WebView.clearCache(true)` |
| `common_get_system_fonts` | `font-list`（`src/main/utils/fontManage.ts:6`） | 返回内置 `Typeface` 族名白名单，或返回 `[]`（渲染层已有 `.catch(() => [])` 兜底，`R:ipc:227`） |
| `common_theme_change` | `nativeTheme` updated（`src/main/app.ts:208`） | 渲染层自监听 `matchMedia('(prefers-color-scheme: dark)')`，桥接层保留同名广播以便组件不改 |
| `winMain_set_power_save_blocker` | `powerSaveBlocker`（`src/main/utils/index.ts:294`） | `@capacitor-community/keep-awake` |
| `winMain_get_data` | JSON store 读（`src/main/utils/store.ts:52`） | `@capacitor/preferences`（键值）或 SQLite 表；需保证 `playInfo` 的"播放队列恢复校正"语义（`M:data:11-24`） |
| `winMain_save_data` | JSON store 写（`src/main/utils/store.ts:60`） | 同上；注意桌面版是**同步**原子写，Android 侧要保证写序（队列化） |
| `winMain_get_themes` | 读内置主题 + store（`src/main/utils/index.ts:214`），返回 `dataPath` 绝对路径 | `dataPath` 改为 `Filesystem.getUri('Data')` 下的主题图片目录，并用 `Capacitor.convertFileSrc()` 转成 WebView 可加载的 URL |
| `winMain_save_theme` | `saveTheme`（`src/main/utils/index.ts:223`） | 写入 SQLite/Preferences；主题图片走 Filesystem |
| `winMain_remove_theme` | `removeTheme`（`src/main/utils/index.ts:230`） | 同上 |
| `winMain_get_sound_effect_eq_preset` | store 读（`M:se:7`） | Preferences |
| `winMain_save_sound_effect_eq_preset` | store 写（`M:se:10`） | Preferences |
| `winMain_get_sound_effect_convolution_preset` | store 读（`M:se:14`） | Preferences |
| `winMain_save_sound_effect_convolution_preset` | store 写（`M:se:17`） | Preferences |
| `common_deeplink` | 协议唤起 / 第二实例（`src/main/app.ts:132`） | Intent filter + `App.addListener('appUrlOpen')`，桥接层仍以同名事件推给渲染层（渲染层的 `rainmusic://` 解析逻辑 `useDeeplink/index.ts:19-51` 可完全复用） |
| `common_clear_env_params_deeplink` | `M:common:18` | 内存标志位清除，无平台差异 |
| **小计** | | **19** |

### 4.4 汇总

| 分类 | 条数 | 占比 |
| --- | --- | --- |
| **A 必须重写** | **52** | 53.6% |
| **B 可直接移除** | **26** | 26.8% |
| **C 需降级** | **19** | 19.6% |
| **活跃通道合计** | **97** | 100% |
| （附）② 主进程单方面注册，不必移植 | 11 | — |
| （附）③ 死通道，可直接删除 | 20 | — |

**对阶段 1 的直接含义**：桥接层只需要覆盖 A + C = **71 条**通道；其中首版范围（听歌 + 歌单 + 下载）真正必需的约 **42 条**（设置 5 + 列表 16 + 歌词 4 + 自定义源 9 + URL 缓存 5 + 换源 4 + 下载 5，减去首版可暂缓的歌词编辑/换源高级项）。B 类的 26 条在 Android 侧应当**完全不实现**。

---

## 5. 交通灯（窗口控制）清单

### 5.1 用户硬性要求

> "Android 界面不得包含 macOS 风格窗口控制按钮（交通灯）" — `docs/android-port-plan.md:5`

### 5.2 全部实现位置

**组件本体**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/components/layout/Toolbar/TrafficLights.vue`（全文 160 行） | 唯一实现。三个 `<button>`：关闭（`:3-15`）、最小化（`:16-28`）、全屏切换（`:29-44`），均带 `data-native-window-control`（`:5,18,31`） |
| `…/TrafficLights.vue:121-123` | 颜色定义：`.close { --light-color: #ff5f57 }` / `.min { --light-color: #febc2e }` / `.max { --light-color: #28c840 }` |
| `…/TrafficLights.vue:116-119` | 12px 圆形 `::before` + macOS 内描边 `inset 0 0 0 1px rgba(0,0,0,.12)` |
| `…/TrafficLights.vue:84-94` | 注释直接写明"macOS 实测规格：圆直径 12px、圆心间距 20px、距窗口左边缘 20px"；`padding-left: 14px` |
| `…/TrafficLights.vue:128-146` | 图标默认隐藏、hover 时才显示（macOS 行为） |
| `…/TrafficLights.vue:148-154` | 窗口失焦时统一变灰（`.blur`） |
| `…/TrafficLights.vue:70-77` | 用 `window.focus`/`blur` 事件驱动 `.blur` |

**挂载点（活代码，共 2 处；阶段 1a 起统一经过 `WindowControls`，见 §5.3）**

| 位置 | 说明 |
| --- | --- |
| `src/renderer/components/layout/Aside/index.vue:3`（import 在 `:10`） | 左侧边栏顶部 `<div :class="$style.windowHeader"><WindowControls /></div>`。`WindowControls` 在桌面壳下渲染的就是 `<TrafficLights />`，且不额外包一层 DOM |
| `src/renderer/components/layout/PlayDetail/index.vue:5`（import 在 `:48`） | 歌曲详情页 header `<WindowControls data-detail-window-controls />`。该属性透传到 `TrafficLights` 的根 `div[role=group]` |

**孤儿组件（5 个，阶段 1a 已全部删除）**

| 位置 | 状态 | 删除前的内容 |
| --- | --- | --- |
| `src/renderer/components/layout/Aside/ControlBtns.vue` | **已删除（阶段 1a）** | 非 macOS 风格的最小化/关闭按钮（`:3,:8`），删除前已**全项目无 import** |
| `src/renderer/components/layout/Toolbar/ControlBtns.vue` | **已删除（阶段 1a）** | 同上（`:3,:8`），删除前**无 import** |
| `src/renderer/components/layout/PlayDetail/ControlBtnsLeftHeader.vue` | **已删除（阶段 1a）** | 关闭/最小化/退出全屏（`:7,:10,:15`），删除前**无 import** |
| `src/renderer/components/layout/PlayDetail/ControlBtnsRightHeader.vue` | **已删除（阶段 1a）** | 同上（`:7,:10,:15`），删除前**无 import** |
| `src/renderer/components/layout/PlayDetail/WindowHeader.vue` | **已删除（阶段 1a）** | 也调用 `<TrafficLights />`（`:3`），但**本身无 import**（详情页直接用 `TrafficLights`） |

> 恢复方式：删除前已逐文件复核零引用（无 import、不在构建与测试的引用链上），需要时用 `git checkout HEAD -- <上述路径>`（或 `git show HEAD:<路径> > <路径>`）从 `HEAD = d17025d7` 取回即可，对 Android 分支无影响。

**IPC 通道**

| 通道名 | 渲染层调用点 | 分类 |
| --- | --- | --- |
| `winMain_close` | `TrafficLights.vue:10,49` | B 移除 |
| `winMain_min` | `TrafficLights.vue:23,49` | B 移除 |
| `winMain_fullscreen` | `TrafficLights.vue:59,49` | B 移除 |
| `winMain_fullscreen_state` | `useEventListener.ts:103-104`（写入 `isFullscreen`，供 `TrafficLights.vue:51,59` 读）、`R:ipc:620,626` | B 移除 |
| `winMain_max` | （仅封装 `R:ipc:546`，无调用） | ② 死代码 |
| `winMain_min_toggle` | （仅封装 `R:ipc:553`，无调用） | ② 死代码 |

**平台分支（关键结论）**

| 位置 | 说明 |
| --- | --- |
| `src/common/utils/index.ts:7` | `isMac` 定义 |
| `src/renderer/utils/keyBind.ts:13` | `isMac` 用于 `meta`/`ctrl` → `mod` 的映射 |
| `src/renderer/views/Setting/components/SettingHotKey.vue:39` | `isMac` 决定显示 `Command`/`Ctrl` |
| `src/renderer/views/Setting/components/SettingPlay.vue:3,98` | `v-if="isMac"` 的 macOS 专有设置项 |
| `src/main/modules/appMenu.ts:6` | `isMac` 决定是否设置原生应用菜单 |
| `src/main/utils/index.ts:298`、`src/main/modules/tray.ts:139,219`、`M:winMainMain:153` | 其它 `isMac` 分支 |
| **结论** | **交通灯本身没有任何 `isMac` 分支**。它是"所有平台无差别显示 macOS 风格交通灯"，根源是主窗口 `frame: false`（`M:winMainMain:104`）——`src/main/modules/winMain/main.ts:85-92` 的注释明确说明这是"macOS 风格磨砂玻璃（最终方案）"的一部分。因此在 Android 上**不能靠平台分支"绕过"它，必须主动让它不渲染** |
| `src/renderer/index.html:28-30` | 平台 class 来自 URL `?os=`；`src/renderer/assets/styles/reset.less:4-25` 只有 `.windows` / `.linux` 字体分支，**没有 `.mac` 分支**，也没有任何选择器针对交通灯做平台差异 |

### 5.3 Android 上怎么处理（**已实施，阶段 1a**）

**结论：条件不渲染（保留组件本体），平台判定收口到 `src/renderer/platform/`。**

理由（实施时逐条确认成立）：
1. `TrafficLights.vue` 是**桌面版的核心交互**（桌面版 `frame:false`，没有它用户无法关闭/最小化窗口）。整体删除会让桌面版无法操作 → 违反"不影响桌面端"。
2. 组件只有 2 个挂载点，且都包在容器里，条件渲染的改动面极小。
3. 阶段 1 的验收标准里明确要求"移除交通灯（移动端不渲染自绘标题栏）"（`docs/android-port-plan.md:50`）——**是"不渲染"，不是"删组件"**。

**三个方案的最终状态**

| 方案 | 内容 | 状态 |
| --- | --- | --- |
| 方案 1 | 在两个挂载点各写一次 `v-if="isDesktopShell"` + `v-else` 占位 | **未采用**（判定逻辑被方案 2 吸收；避免两处各写一遍平台分支） |
| 方案 2 | 抽出"窗口控制"组件槽位 `WindowControls.vue`，挂载点统一改成 `<WindowControls />` | **已实施（阶段 1a）** |
| 方案 3 | 删除 5 个孤儿窗口控制组件 | **已实施（阶段 1a）**（见 §5.2 表的"已删除"标注与恢复方式） |

**已落地的实现**

| 文件 | 内容 |
| --- | --- |
| `src/renderer/platform/index.ts`（93 行，新增） | 平台判定的**唯一入口**：`shell: 'electron' \| 'capacitor' \| 'unknown'`、`isDesktopShell`、`isMobileShell`、`hasWindowControls`。判定顺序是**原生桥优先** —— `globalThis.Capacitor.isNativePlatform()` → `process.versions.electron` → `unknown`（纯浏览器按"非桌面壳"处理） |
| `src/renderer/platform/WindowControls.vue`（29 行，新增） | 窗口控制槽位：桌面壳渲染 `<TrafficLights v-if="isDesktopShell" />`（不额外包一层 DOM，属性继续透传到 `TrafficLights` 根节点）；移动端渲染 `<div v-else data-mobile-title-bar aria-hidden="true" />` |
| `Aside/index.vue:3`（import 在 `:10`） | `<div :class="$style.windowHeader"><WindowControls /></div>` |
| `PlayDetail/index.vue:5`（import 在 `:48`） | `<WindowControls data-detail-window-controls />` |

`data-mobile-title-bar` 这个占位元素同时是 Android 后续放"返回 / 菜单"入口的唯一位置（原方案 2 的"未来只改一处"）。

**已被验证的关键事实（阶段 1a 实测，回退会打破桌面端）**

| 事实 | 说明 |
| --- | --- |
| **桌面 DOM 未变化** | 桌面壳下 `WindowControls` 的根节点就是 `TrafficLights`：`.windowHeader` 的 `childElementCount` 仍为 1；`[data-detail-window-controls]` 仍落在 `TrafficLights` 的根 `div[role=group]` 上；详情页 header 的网格仍是 `88px 804px 88px`，标题居中偏差 0（数值与复现方法见 §8） |
| **Android 下同高占位生效** | 注入 Capacitor 原生桥后：交通灯 0 个、`[data-mobile-title-bar]` 1 个，`.windowHeader` 仍是 `@height-toolbar`（64px），`brandTop` / `navTop` 与桌面逐项相同 —— 侧边栏不会因为没有交通灯而上下跳动，详情页标题也仍居中（第 1 列继续被占位元素占住） |
| **判定必须是"原生桥优先"** | 这是阶段 1a 验证中实际修掉的 bug：最初的写法是 Electron 优先（`isElectronRenderer()` 直接命中就返回 `electron`，没有 Capacitor 否决），在"注入 Capacitor 桥"的模拟运行里仍判成 `electron`，交通灯照样渲染。现版本只要原生桥在就按移动端处理，详见 §8 |

**必须一起处理的连带项**

| 项 | 位置 | Android 处理 |
| --- | --- | --- |
| 全屏退出入口 | 原 `PlayDetail/ControlBtnsLeftHeader.vue:59-62`、`ControlBtnsRightHeader.vue:67-70`（**已随 §5.2 的孤儿组件一并删除**）、`useEventListener.ts:41-44`（Esc） | Esc 退出全屏在移动端无意义；`isFullscreen` 恒为 `false` 即可（桥接层 `setFullScreen` 返回 `false`） |
| F11 全屏 | `useEventListener.ts:121`（`key_f11_down`） | 键盘事件在 Android 无来源，保留代码无害 |
| 窗口尺寸设置项 | `views/Setting/components/SettingBasic.vue:32`（`common.windowSizeId`）、`R:ipc:396`（`setWindowSize`）、`src/common/config` 的 `windowSizeList` | Android 应隐藏该设置项，桥接层 `setWindowSize` 变为空操作 |
| `window.rain.rootOffset` | `globalData.ts:28`、`store/index.ts:46`、`Popup.vue:65,81`、`useMenuLocation.js:63-64` | Android 恒为 `0`（无窗口边框，8px 偏移会让弹层错位） |
| 透明/圆角配置 | `App.vue:77`、`useEventListener.ts:79-83` | 固定走不透明分支 |

---

## 6. 阶段 1 的实现建议（Capacitor 工程 + 平台抽象层）

### 6.1 适配器层应该长什么样

**现状（重要更正）**：`window.rain` **不是** preload 注入的。它是渲染层自己在 `src/renderer/core/globalData.ts:4-30` 创建的命名空间，里面挂着 `worker`（Comlink）、`apiInitPromise`、`rootOffset`、`isPlayedStop`、`songListInfo` 等**纯渲染层状态**。真正由 preload/IPC 提供能力的是 `src/renderer/utils/ipc.ts` 的 60 多个封装函数（它们走 `src/common/rendererIpc.ts` → `ipcRenderer`）。

这个事实对阶段 1 非常有利：**要替换的边界是 `@renderer/utils/ipc`，而不是 `window.rain`。**

**建议结构**

```
src/renderer/platform/
  index.ts              // 统一出口：export * from './adapter'
  types.ts              // 与 R:ipc 等价的接口契约（由现有 ipc.ts 导出签名自动核对）
  electron.ts           // 现有实现：内部即当前 src/renderer/utils/ipc.ts 的内容
  capacitor.ts          // Android 实现：Capacitor 插件 + 本地服务
  capabilities.ts       // 平台能力开关（isDesktopShell / hasTray / hasGlobalShortcut / hasWindowControls / hasDesktopLyric ...）
```

**迁移路径（保持桌面端零回归）**

1. 把 `src/renderer/utils/ipc.ts` **整体移动**成 `src/renderer/platform/electron.ts`，内容逐字不变（包括那处直连的 `ipcRenderer`，`R:ipc:626-627`，后续再收敛）。
2. `src/renderer/platform/index.ts` 在构建期/运行期二选一：
   ```
   export * from './electron'   // Electron 构建
   // 或
   export * from './capacitor'  // Capacitor 构建
   ```
   推荐用**构建别名**（Vite `resolve.alias` / webpack `resolve.alias`）而不是运行时 `if`：运行时判断会把 `electron` 模块拖进 Android bundle，直接构建失败。现有构建已经有别名机制（`build-config/renderer/webpack.config.base.js:25-31` 的 `@renderer` / `@common`；主进程侧见 `build-config/main/webpack.config.base.js:20-24`），加一条 `@platform` 即可。
3. 把全项目 **40 处** `from '@renderer/utils/ipc'` 改成 `from '@renderer/platform'`（一次性机械替换；`electron.ts` 里那份原 `R:ipc` 自身保持不动）。
4. `window.rain` 保持原样：它是渲染层状态，两端一致，不需要适配。只有 `rootOffset`（`globalData.ts:28`）和 `isProd`（`:27` 用了 `process.env`）需要在 `capacitor.ts` 侧改成平台常量。
5. **事件方向也要抽象**：`R:ipc` 里 15 个 `on*` 订阅函数（`onSettingChanged`、`onThemeChange`、`onDeeplink`、`onKeyDown`、`onFullscreenChanged`、`onUserApiStatus`、`onPlayerAction`、`onFocus`、`onNewDesktopLyricProcess`…）在 Android 侧对应的是"桥接层内部广播"，建议在 `capacitor.ts` 里实现一个极简事件总线（`Map<string, Set<listener>>`）并对齐相同的返回"取消订阅函数"语义。
6. **保留同名通道字符串**：`capacitor.ts` 内部的请求-响应分发直接复用 `src/common/ipcNames.ts` 的常量作为 key（`{'winMain_get_data': fn, ...}`）。这样 §1 的 97 条契约可以直接当验收清单用，且未来加回 Electron 端不会漂移。
7. `capabilities.ts` 供 UI 使用，**避免在组件里散落 `Capacitor.getPlatform()`**：
   ```
   export const hasWindowControls = false          // Android
   export const hasDesktopLyric = false
   export const hasGlobalShortcut = false
   export const hasTray = false
   export const hasNativeMenu = false
   ```
   仅 `TrafficLights` 的 2 个挂载点（`Aside/index.vue:3`、`PlayDetail/index.vue:5`）以及设置页的相关区块读取它。

### 6.2 必须先收敛的文件（按优先级）

| 优先级 | 文件 | 理由 |
| --- | --- | --- |
| **P0** | `src/common/rendererIpc.ts`（45 行） | **全部 IPC 的唯一咽喉**（`R:ipc` 与 `R:listManage`、`R:dislike` 都经过它）。这里换成"可注入的 transport"（`invoke`/`send`/`on` 三个函数），Android 侧就能只换实现。注意 `R:ipc:626` 是一处绕过封装的直连 `ipcRenderer`，必须一起收敛 |
| **P0** | `src/renderer/utils/ipc.ts`（668 行，99 个导出） | 渲染层对主进程能力的**全部**入口，被 **40 个文件** import。它是 §1 表格的渲染侧索引，也是适配层的天然边界 |
| **P0** | `src/renderer/core/globalData.ts`（34 行） | `process.env`（`:27,34`）+ `window.dt`（`:28`）两处 Node/Electron 泄漏；`window.rain` 本身就是最合适的"平台状态容器"改造点 |
| **P1** | `src/renderer/utils/request.js`（298 行） | **最大的单点阻塞**：`needle`（`:1`）+ `zlib`（`:6`）+ `Buffer`/`process.versions.app`（`:267-272`）。所有内置音源（tx/kg/wy）的 HTTP 都走这里，不换掉 Android 连搜索都做不了 |
| **P1** | `src/common/utils/nodejs.ts` | Node 文件/加密/gzip 工具被渲染层 worker 与多个视图 import。需拆成"纯路径与字符串工具"+"IO 接口"，避免 Android bundle 里出现 `node:fs` |
| **P1** | `src/common/utils/index.ts`（`isMac`/`isWin`/`getPlatform`/`getOSVersion`，`:2,5-22`） | 被渲染层 4 处、主进程多处 import。平台判断必须改成可注入，否则 Android 会以 `linux` 兜底（`getPlatform` 的 `default` 分支 `:14`） |
| **P2** | `src/renderer/index.html`（51 行） | `?os=`/`?dark=`/`?dt=`/`?theme=` 四个 query 参数是主进程 loadURL 拼的（`M:winMainMain:139`）。Android 没有这些参数，`:28-33` 会产生垃圾 class，`:42` 的 dark 判定恒为 false |
| **P2** | `src/renderer/store/index.ts`（69 行） | `process.versions.app`（`:6`）+ `window.dt`/`rootOffset`（`:45-47`）+ `window.shouldUseDarkColors`（`:49`），三处平台耦合集中在一个小文件里 |
| **P2** | `src/renderer/core/lyric.ts`（246 行） | Electron `MessagePort` 直连（`:16,109-125`）。桌面歌词在 Android 首版不做，但这段代码 import 了 `R:ipc` 的 `onNewDesktopLyricProcess`，不隔离会阻塞适配层切换 |
| **P3** | `src/renderer/components/layout/Aside/index.vue` / `PlayDetail/index.vue` | 交通灯的 2 个挂载点（见 §5.3）。**已完成（阶段 1a）**：两处都改为 `<WindowControls />`，平台判定集中在 `src/renderer/platform/index.ts`（原生桥优先） |
| **P3** | `src/renderer/worker/utils/index.ts` | `new Worker` + Comlink 的入口；Android 侧 worker 内的 Node 依赖需要在这里决定"拆掉还是重写" |

### 6.3 建议的 Capacitor 插件清单

**官方 / 社区插件（覆盖 §4 的 A + C）**

| 需求 | 通道 / 模块 | 建议插件 | 备注 |
| --- | --- | --- | --- |
| SQLite | `player_list_*`、`dislike_*`、`winMain_get/save_music_url`、`winMain_get/save_lyric_raw`、`winMain_get/save_other_source`、`winMain_download_list_*` | `@capacitor-community/sqlite` | 需把 `src/main/worker/dbService/tables.ts:217`、`migrate.ts:103`、`verifyDB.ts:28`、6 个 `modules/**/statements.ts` 的 SQL 原样迁过来；`PRAGMA journal_mode=WAL` 与 `better-sqlite3` 的同步 API 语义不同，业务层要改成 async |
| 文件读写 / 落盘 | 下载、`saveRainConfigFile`/`readRainConfigFile`、主题图片 | `@capacitor/filesystem` | 下载建议用 `Filesystem.downloadFile`（自带 `progress` 事件）；桌面版的断点续传（`src/common/utils/download/Downloader.ts:32,96,111`）首版可放弃 |
| 网络（音乐 SDK） | `src/renderer/utils/request.js` 全量 | `@capacitor/http`（`CapacitorHttp`） | 关键：能绕开 WebView 的 CORS/混合内容限制。但**它不提供 `deflateRaw`**，`tx` 的签名头仍需 pako |
| 键值存储 | `winMain_get_data` / `winMain_save_data` / 音效预设 | `@capacitor/preferences` | 也可直接落在 SQLite 里，与 §4 C 类保持一致 |
| 文件选择 | `winMain_show_select_dialog` | `@capawesome/capacitor-file-picker` | 返回结构需适配成 `{canceled, filePaths[]}` |
| 文件保存 | `winMain_show_save_dialog` | SAF（`@capawesome/capacitor-file-picker` 的 `saveFile` 或自写插件） | Electron 的 `SaveDialogOptions` 语义（含 `defaultPath`）需要重新映射 |
| 打开外部链接 | `shell.openExternal`、`openUrl` | `@capacitor/app`（`openUrl`）或 `window.open(url,'_system')` | |
| 打开/分享文件 | `winMain_open_dir_in_explorer` | `@capacitor/share` +（可选）`@capawesome-team/capacitor-file-opener` | 无"定位文件夹"，只能降级 |
| 剪贴板 | `src/common/utils/electron.ts:28,36` | `@capacitor/clipboard` | WebView 内也可直接用 `navigator.clipboard` |
| 屏幕常亮 | `winMain_set_power_save_blocker` | `@capacitor-community/keep-awake` | |
| 平台/设备信息 | `getPlatform`、`getOSVersion`、`window.os` | `@capacitor/device` | 配合 `Capacitor.getPlatform()` |
| 应用生命周期 | `app.whenReady` / `before-quit` / `activate` | `@capacitor/app`（`appStateChange`/`pause`/`resume`/`backButton`） | `backButton` 需接入渲染层路由返回 |
| 深链 | `common_deeplink` | `@capacitor/app`（`appUrlOpen`）+ Manifest Intent filter | |
| 状态栏 / 安全区 | 移动端标题栏、`-webkit-app-region` 移除后的布局 | `@capacitor/status-bar` | 阶段 1 可选 |
| 通知（下载完成） | 新增能力 | `@capacitor/local-notifications` | 桌面版是主进程弹窗/托盘提示，Android 用通知 |
| 日志 | `electron-log`（`src/main/utils/logInit.ts`、`src/common/utils/index.ts:1`） | `@capacitor-community/capacitor-logger` 或自写 | 也可先用 `console.log` + `chrome://inspect` |

**没有现成插件、需要自己写原生桥的能力**

| 能力 | 为什么没有插件 | 建议桥接方式 |
| --- | --- | --- |
| **SQLite 的 `better-sqlite3` 兼容语义** | 不是"缺插件"，而是**同步 API → 异步 API** 的语义转换；`db.pragma('journal_mode = WAL')`、`fileMustExist`、原生 `nativeBinding`（`db.ts:22,32`）都无对应 | 在 JS 侧包一层 `dbService` façade（与原 `global.rain.worker.dbService` 同名同形），SQL 原样复用 |
| **`zlib.deflateRaw`（`tx` 签名头）** | Capacitor 无 zlib 桥 | 首选 `pako`（纯 JS）；若性能不满意再写原生桥 |
| **`RSA_NO_PADDING` 公钥加密（`wy` eapi/weapi）** | Android `Cipher` 有 `RSA/ECB/NoPadding`，但 WebCrypto 没有；Capacitor 无插件 | **必须**写原生桥（`@PluginMethod` 里做 `Cipher`）或引入纯 JS 大数库。这是阶段 1 最该提前验证的技术点 |
| **`dns.lookup`（`musicSdk/utils.js:9-30`）** | Android 无 JS 侧 DNS API | 直接删除该优化；若接口必须指定 IP，写原生桥走 `InetAddress` |
| **`node:crypto` 的 MD5** | WebCrypto 不提供 MD5 | 用 JS 实现（`js-md5`），无需原生桥 |
| **音频元数据读写（`src/common/utils/musicMeta/**`）** | 依赖 `fs` 同步读写 + 二进制操作 | 首版**降级**：只写音频文件 + 同名 `.lrc`，不写 ID3/FLAC 元数据。写元数据需要自己写原生桥（`MediaMetadataRetriever` 只能读） |
| **`iconv-lite` 的 GBK 编码（`worker/download/utils.ts:17-31`）** | Android `TextDecoder` 支持 `gbk` 解码，但 `TextEncoder` **不支持** GBK 编码 | 要么写原生桥（`Charset.forName("GBK")`），要么降级为只输出 UTF-8 BOM 的 `.lrc` |
| **自定义源宿主（`lx`/`rain`）** | 需要"执行第三方脚本 + 提供 `lx` API + 网络代理 + 取消请求"的组合能力，没有任何插件覆盖 | 自写原生桥 + 渲染层侧 Web Worker / iframe（须保留全局名 `lx`，见 `docs/custom-source.md`） |
| **通知栏歌词 / 悬浮窗歌词** | 首版不做，但后续需要 | 自写原生桥（`Notification` 的 `MediaStyle` 或 `TYPE_APPLICATION_OVERLAY`） |
| **托盘/任务栏缩略图按钮的替代（媒体通知控件）** | 无直接插件 | 自写原生桥 + `MediaSessionCompat` |
| **「在文件夹中显示」** | Android 设计上不存在 | 不写桥，UI 层改文案/入口 |

---

## 7. 阶段 1 最先动的东西（结论）

1. **`src/common/rendererIpc.ts`** — 45 行，却是全部 IPC 的唯一咽喉。把它改成"可注入 transport"，Android 侧就只换一个实现。
2. **`src/renderer/utils/ipc.ts`** — 668 行 / 99 个导出，被 40 个文件 import，是 §1 契约表的渲染侧收口点；把它搬到 `src/renderer/platform/electron.ts` 并加构建别名，是"一套组件两端跑"的最小代价路径。
3. **`src/renderer/utils/request.js`** — 298 行，`needle`/`zlib`/`Buffer`/`process.versions.app` 四重 Node 依赖集中在一个文件里；它是"能不能搜到歌"的硬门槛，越早换 `fetch`/`CapacitorHttp` 越早暴露 `wy` 的 `RSA_NO_PADDING` 风险。

---

## 8. 附录：阶段 1a 实测结论（交通灯收口）

本节记录 §5.2 / §5.3 落地时**实际量到的数值**，作为"桌面端零回归 + Android 分支生效"的验收证据。
证据来源：桌面数值取自 Electron 主窗口（构建产物 `dist/`）的实测运行；Android 数值取自**注入 Capacitor 原生桥**（`window.Capacitor = { isNativePlatform: () => true }`）后重新加载同一份渲染层 bundle 的模拟运行——不是真机运行，仅用于验证判定分支与布局占位。

### 8.1 桌面版 DOM 未变化的证据

| 断言 | 实测值 | 为什么是这个值 |
| --- | --- | --- |
| `document.querySelector('.windowHeader').childElementCount` | **1** | 桌面壳下 `WindowControls` 的 `v-if` 分支为真，Vue 直接把它渲染成 `TrafficLights` 的 vnode，**不额外包一层 DOM**，`.windowHeader` 里仍然只有一个子元素 |
| `[data-detail-window-controls]` 所在节点 | **`div[role=group]`**（`aria-label="Window controls"`） | `PlayDetail/index.vue:5` 的 `data-detail-window-controls` 是属性透传，最终落在 `TrafficLights.vue:2` 的根 `div[role=group]` 上，与改动前一致 |
| 详情页 header 的网格列 | **`88px 804px 88px`** | `PlayDetail/index.vue:152` 的 `grid-template-columns: 88px minmax(0, 1fr) 88px`；内容宽 980px 时第 1/3 列各 88px、中间 804px |
| header 标题的居中偏差 | **0** | 第 1 列仍由交通灯占住，标题（第 2 列）不会被挤偏 |

现有 UI 测试继续充当这条"桌面 DOM 不许变"的回归网（阶段 1a 未改动它们）：

- `npm run test:responsive-layout` → `tests/ui/responsive-layout.electron.cjs:89` 断言 `document.querySelectorAll('[data-native-window-control]').length===3`；
- `npm run test:song-detail` → `tests/ui/song-detail.electron.cjs:180` 断言 `[data-detail-window-controls]` 内有 3 个可聚焦 `button`（含绿色的 `aria-pressed` 状态）。

### 8.2 Android 分支实测（注入 Capacitor 桥）

| 断言 | 实测值 | 说明 |
| --- | --- | --- |
| 交通灯数量 `[data-native-window-control]` | **0** | `isDesktopShell === false`，`WindowControls` 走 `v-else` 分支 |
| 占位元素数量 `[data-mobile-title-bar]` | **1** | 零尺寸、`aria-hidden="true"`，同时是未来"返回 / 菜单"入口的位置 |
| `.windowHeader` 高度 | **64px**（= `@height-toolbar`，`variables.less:9`） | 外层 `.windowHeader` 自带固定高度（`Aside/index.vue:32-37`），占位元素宽 0，侧边栏不会因少了交通灯而上下跳动 |
| `brandTop` / `navTop` | **与桌面逐项相同** | 侧边栏 `Rain Music` 品牌与导航栏的 y 坐标在两种壳下完全一致 → 同高占位确实生效 |
| 详情页标题居中 | **仍居中** | 占位元素成为 header 的第 1 个 grid item，继续占住左侧 88px 列 |

### 8.3 验证中发现并修掉的 bug（判定顺序）

- **现象**：第一版 `src/renderer/platform/index.ts` 把 Electron 判定放在最前面，等价于 `isElectronRenderer() ? 'electron' : (hasNativeCapacitorBridge() ? 'capacitor' : 'unknown')`。在注入 Capacitor 桥的模拟运行里，因为 `process.versions.electron` 仍然存在（同一个 Electron 宿主），判定结果仍是 `electron` → 交通灯照样渲染，Android 分支等于没生效。
- **修复**：改成**原生桥优先** —— `hasNativeCapacitorBridge() ? 'capacitor' : isElectronRenderer() ? 'electron' : 'unknown'`（`src/renderer/platform/index.ts:78-80`）。只要原生桥在，就按移动端处理；反过来桌面 Electron 里不存在原生桥，判定不受影响。
- **为什么这个顺序必须保留**：Android 侧将来可能出现各种把 `process` 之类的宿主对象"补"进 WebView 的 polyfill/垫片；一旦判定顺序反了，Android 上就会渲染出三个按不动的 macOS 窗口按钮，而这正是本阶段要消除的东西。因此这里宁可"有原生桥就当移动端"。
