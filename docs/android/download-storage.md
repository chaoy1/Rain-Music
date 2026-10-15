# Android 下载记录持久化

实现类：`com.rainmusic.mobile.ipc.RainMusicDownloadChannels`。插件加载时调用
`RainMusicDownloadChannels.register(this)`，注册以下五条既有通道：

| 通道 | 参数数组 | 成功结果 |
|---|---|---|
| `winMain_download_list_get` | `[]` | `Rain.Download.ListItem[]` |
| `winMain_download_list_add` | `[{list, addMusicLocationType}]` | `null`（桌面的 void） |
| `winMain_download_list_update` | `[ListItem[]]` | `null` |
| `winMain_download_list_remove` | `[string[]]` | `null` |
| `winMain_download_list_clear` | `[]` | `null` |

契约来源为 `src/main/modules/winMain/rendererEvent/download.ts`、
`src/main/worker/dbService/modules/download/{index,dbHelper,statements}.ts` 和
`src/common/types/download_list.d.ts`。保留既有 `isComplate` 拼写。
Capacitor 的 `JSArray.toList()` 保留嵌套的 `JSONObject` / `JSONArray`，handler 直接处理这两种类型。

## SQL 与顺序

通过既有 `RainMusicDatabase.open(context, "download_list")` 打开数据库，沿用
`rain.dataSQLite.db`、原有 schema 与版本；没有新增依赖或自建第二份数据库。

读取与插入均覆盖十三列：`id`、`isComplate`、`status`、`statusText`、
`progress_downloaded`、`progress_total`、`url`、`quality`、`ext`、`fileName`、
`filePath`、`musicInfo`、`position`。查询仅按 `position ASC` 排序。

`top` 按入参顺序从 0 插入，同一事务中按既有查询顺序将旧记录的 position
更新为“新增条数 + 旧索引”。空 top 也会将旧序号压紧。其他位置值走追加分支，
偏移与桌面相同，采用当前记录数，**不使用最大 position + 1**。
因此删除留下序号空洞时，重读顺序可能与删除前的进程内缓存顺序不同；本实现保留桌面的持久化算法。
重复 ID 由原有主键拒绝，不忽略、不替换，整批回滚。

更新 SQL 仅写 `isComplate`、`status`、`statusText`、`progress_downloaded`、
`progress_total`、`url`、`filePath` 七列，保留 `quality`、`ext`、`fileName`、
`musicInfo` 和 `position`；不存在的 ID 不插入。删除不重排。

所有读写共用 `RainMusicListWriteLock.LOCK`。新增、排序、批量更新、批量删除和清空
通过 `beginTransaction` / `setTransactionSuccessful` / `endTransaction` 执行，
异常直接交给 IPC reject；缺表、坏 musicInfo JSON、非法参数与 SQL 写失败不能伪装成功。
没有事件广播，也没有音频文件操作。记录删除或清空不会删除下载文件。

## 恢复结果与边界

`get` 每次直接读取持久化记录；还原完整 musicInfo 对象和 nullable URL，
按桌面算法重算百分比（total 为 0 时为 0），`speed` 复位为 `''`、`writeQueue` 为 0，
不恢复只存在于渲染层的 `metadata.listId`。数值从 Cursor 以 double 读取，保留
SQLite INTEGER affinity 允许保存的小数，避免截断合法的 JS number。

与桌面进程内缓存的差异：桌面 update 后缓存会短暂保留入参的全部字段（含未写入 SQL 的字段），
Android 的后续 get 返回落库字段，因此不会回显那些未持久化字段的改动。
musicInfo 按声明的 `MusicInfoOnline` 对象契约读写；非对象输入直接拒绝。

这只实现下载任务记录。原生网络传输、暂停/取消、断点续传、歌词/标签写入、
完成文件播放映射以及自定义源都需要各自验证，不能由这里的通过结果推断。

## 本机验证

`node --test tests/unit/android-download-channels.test.cjs`：十项测试运行真实 Java handler
和 Node `node:sqlite` 引擎（Android 连接与 IPC 宿主替换为测试适配器）。覆盖恢复字段、
小数进度、13 列插入、top/append、局部更新、记录删除/清空、实际临时音频哨兵保留、
重复主键、各类事务失败、坏输入/坏 JSON/缺表、并发写与无事件。

设置 `RAIN_DOWNLOAD_JSON_JAR` 为本机真实 AOSP org.json jar 路径，可让同一组测试改用
该 JSON 实现；正常测试不需要此 jar，也不会下载依赖。`RAIN_DOWNLOAD_SOURCE` 可指向
仓库外 Java 源码副本，供变异验证使用，不修改共享 checkout。

真实 Android/AOSP API jars 的 javac 探针仅核对 API/受检异常签名；它不是
compileSdk 36 的 Gradle APK 编译。APK 编译、WebView 集成与真机重启恢复仍需另行验收。
