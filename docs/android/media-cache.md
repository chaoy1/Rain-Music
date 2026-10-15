# Android 歌曲地址与歌词缓存

`RainMusicMediaCacheChannels.register(plugin)` 接入桌面 `rendererEvent/music.ts` 实际消费的 13 条通道，持久化在现有 SQLite 数据库的 `music_url` / `lyric` 表，不创建第二套缓存。

- `winMain_get_music_url`、`save_music_url`、`remove_music_url`、`clear_music_url`、`get_music_url_count`：按 ID 查询，未命中返回空字符串；保存先删除同 ID 旧行再插入，整个替换操作为事务。
- `winMain_get_lyric_raw`、`save_lyric_raw`、`clear_lyric_raw`、`get_lyric_raw_count`：保存 `lyric/tlyric/rlyric/rainlyric` 中非 null 的字符串，UTF-8 转 base64 后写入。遵循桌面 `insertRawLyric` 的追加语义；重复类型读取时后行覆盖前行，计数为数据库行数。
- `winMain_get_lyric_edited`、`clear_lyric_edited`、`get_lyric_edited_count`：读取与清理旧编辑歌词，保持 raw / edited 隔离。不恢复桌面已经删除的编辑歌词写入通道。
- `winMain_get_palyer_lyric`：保留现有拼写；编辑歌词主文本非空时优先使用编辑版本，否则使用原歌词，并始终附带 `rawlrcInfo`。

所有读写与现有列表数据库操作共用 `RainMusicListWriteLock.LOCK`。参数类型错误、数据库缺表、数据库写入失败向调用方抛出；多行写入失败回滚。按照桌面契约，这些通道不发广播。

验证：`node --test tests/unit/android-media-cache-channels.test.cjs`，7 项通过、0 失败、0 跳过。测试运行真实 Java handler 和 Node SQLite 引擎，DDL 来自桌面 `tables.ts`；仅 Android 连接托管、IPC 宿主与 Android Base64 API 由 JVM 替身提供。7 个用例分别在 TEMP 源码副本中做行为变异，均捕获预期错误；未修改共享源码做变异。

另以真实 Android API jar 与 AOSP `org.json` jar 编译该类、注册表及共享锁，结果通过。这属于 API 签名编译验证，不等于 Android SDK 构建、ART 执行或真机播放验证。此次日志在 `%TEMP%/rain-android-media-cache-20261015/`：`behavior.log`、`native-api.log`、`mutation-results.json` 及各变异 `result.log`。
