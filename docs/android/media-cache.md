# Android 歌曲地址与歌词缓存

`RainMusicMediaCacheChannels.register(plugin)` 接入桌面 `rendererEvent/music.ts` 实际消费的 13 条通道，持久化在现有 SQLite 数据库的 `music_url` / `lyric` 表，不创建第二套缓存。

- `winMain_get_music_url`、`save_music_url`、`remove_music_url`、`clear_music_url`、`get_music_url_count`：按 ID 查询，未命中返回空字符串；保存先删除同 ID 旧行再插入，整个替换操作为事务。
- `winMain_get_lyric_raw`、`save_lyric_raw`、`clear_lyric_raw`、`get_lyric_raw_count`：保存 `lyric/tlyric/rlyric/rainlyric` 中非 null 的字符串，UTF-8 转 base64 后写入。遵循桌面 `insertRawLyric` 的追加语义；重复类型读取时后行覆盖前行，计数为数据库行数。
- `winMain_get_lyric_edited`、`clear_lyric_edited`、`get_lyric_edited_count`：读取与清理旧编辑歌词，保持 raw / edited 隔离。不恢复桌面已经删除的编辑歌词写入通道。
- `winMain_get_palyer_lyric`：保留现有拼写；编辑歌词主文本非空时优先使用编辑版本，否则使用原歌词，并始终附带 `rawlrcInfo`。

所有读写与现有列表数据库操作共用 `RainMusicListWriteLock.LOCK`。参数类型错误、数据库缺表、数据库写入失败向调用方抛出；多行写入失败回滚。按照桌面契约，这些通道不发广播。

## 一行**被破坏**的歌词：这是有意的分歧（2026-10-15 定）

`lyric.text` 是 base64。如果某一行的 base64 **已经被破坏**（手工改库、外部工具写坏、写入路径被绕过），两侧行为**不同**：

| | 行为 |
|---|---|
| 桌面 `Buffer.from(text,'base64')`（`modules/lyric/index.ts:49-54,80-81`） | **宽容**：忽略字母表外的字符、长度不合法也不抛 ⇒ 返回一段（可能乱码的）文本 |
| Android `android.util.Base64.decode(text, DEFAULT)` | **严格**：抛 `IllegalArgumentException("bad base-64")` ⇒ `get_lyric_raw` / `get_palyer_lyric` / `get_lyric_edited` **大声失败** |

**Android 侧保持"抛"，不跟桌面一起宽容。** 理由：这与本项目"**坏数据不能在静默中被降级成空/乱码**"的不变量一致
（同类的既有取舍还有删除保留 id 的拒绝、`position` 的校验）。代价写在这里，别当成 bug 再"修"回去：
调用方拿到的是异常，不是空歌词 —— 而**计数**不经过 base64，所以"有 2 行"这件事仍然看得出，
**空 / 坏**两者仍然是可分辨的。

**测试替身必须与真 API 同严格**：`tests/unit/android-media-cache-channels.test.cjs` 的
`android/util/Base64.java` 替身**曾经用 `java.util.Base64.getMimeDecoder()`** —— MIME 解码器会**忽略**
字母表外的字符，**比真 API 宽松**，于是"坏行会怎样"在本机**永远测不到**。
现在改用 basic decoder（先剥掉 CR/LF，因为真 DEFAULT 容忍换行）。
这属于 handoff §5 那条最深教训的**同类**，只不过差在**行为**而不是**签名**上，所以 **CI 编译抓不到**。
`corrupt` 那条用例的输入特意选成"合法 base64 + 尾部垃圾"：**只有宽松解码器会接受它**，
所以它能真正区分替身的严格度，而不是靠异常文案。

## 验证

`node --test tests/unit/android-media-cache-channels.test.cjs`：**8 项通过、0 失败、0 跳过**
（2026-10-15 复跑；新增 `corrupt` 那条）。测试运行真实 Java handler 与 Node SQLite 引擎，
DDL 来自桌面 `tables.ts`；仅 Android 连接托管、IPC 宿主与 Android Base64 API 由 JVM 替身提供。

**变异验证**（仓库外副本 `%TEMP%\rain-l6-mut-node\`，通过 `getDecoder` → `getMimeDecoder` 一处字符串替换）：
把替身换回宽松的 MIME 解码器 ⇒ `fail 1`，失败的正是
"坏 base64 的歌词行必须大声失败，不能返回乱码或空串"。
这条变异同时说明：**如果替身再变宽松，用例就会变红**（这正是 §5 那条守卫的形状）。

早期 7 个用例的行为变异记录与日志仍在 `%TEMP%/rain-android-media-cache-20261015/`
（`behavior.log`、`native-api.log`、`mutation-results.json`）。另以真实 Android API jar 与 AOSP `org.json`
jar 编译该类、注册表及共享锁，结果通过 —— 这属于 API 签名编译验证，**不等于** Android SDK 构建、
ART 执行或真机播放验证。
