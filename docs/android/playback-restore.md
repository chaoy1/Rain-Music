# Android 默认播放队列恢复

`winMain_get_data('playInfo')` 现在通过 `RainMusicPlaybackQueueRestore` 消费默认队列去重时保留的 SQLite 身份快照，遵循桌面 `rendererEvent/data.ts` 的身份匹配规则。

- 优先用保存的 `musicId` 查找原始歌曲，再按 ID、规范化曲名/歌手匹配当前队列。只有旧索引时先从快照定位原始歌曲；没有快照时读取数据库原始顺序。
- 成功恢复保留播放时间、音量等字段，更新 `index/musicId/musicName/musicSinger`。找不到目标返回 `null`，不覆盖 `playInfo`，不确认快照。
- 完整 store 和快照均校验 JSON 语法；拒绝尾随内容、非 JSON 扩展、坏快照记录和非整数索引。数据库缺表/读写失败均抛出。
- 统一按列表锁、Preferences 写锁的顺序取得锁。成功 `SharedPreferences.commit()` 后才删除快照；提交失败保留快照，删除失败同样抛出。保存的稳定 ID 使删除失败后的重试安全。
- 非默认列表、负索引或空播放记录读取时，先确认当前 store 持久保存，再结束恢复。保存默认列表但没有稳定 ID 时继续保留快照。
- 完成恢复后，本进程不再生成启动快照，即使插件重新注册；默认队列后续出现重复仍执行事务修复。应用进程重新启动时初始化为 pending。
- 这些通道不发布成功广播。`save_data` 延续既有单向 send 契约，原生错误由桥的错误路径报告。

## 验证

新增 `tests/unit/android-playback-restore.test.cjs` 的 8 项测试执行真实生产 Java、Node SQLite 事务及持久/内存分离的 Preferences 替身，覆盖恢复、失败和重试。默认 JSON 替身保留受检异常签名，不依赖测试机临时 jar；可用环境变量 `RAIN_RESTORE_JSON_JAR` 指向真实 AOSP JSON jar，执行相同测试。

本机两种 JSON 实现均 8/8 通过。每项测试都有一个在仓库外副本注入的变异，被断言拒绝；包括关闭身份回退、提前确认、忽略提交失败、跳过严格 JSON 校验和完成后重新创建快照。证据在 `%TEMP%/rain-android-restore-20261015/`。

相关 Java 类还以真实 Android 4.1.1.4/AOSP JSON API 和最小 Capacitor 宿主替身通过 javac。它证明 API 签名编译及 JVM/SQLite 行为，不代表 ART、WebView 或真机播放恢复已验收；完整 targetSdk 36 构建由项目 CI 验证。
