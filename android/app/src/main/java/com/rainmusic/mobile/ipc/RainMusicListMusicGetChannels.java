package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

/**
 * Android 移植 · **P0-2 第七刀-A + 第七刀-B（快照那一半）**：{@code player_list_music_get} 的
 * **默认播放队列去重合并 + 单事务写回（第一步 = 合并前的 {@code db_info} 身份快照）+ 失败冒泡**。
 *
 * <p>第六刀那一版是**纯读**（检出重复只打一条节流警告）。第七刀-A 补上"去重 + 删 + 插"那一半；
 * 第七刀-B 再补**同一个事务的第一步**：在两条 DELETE **之前**、**条件**插入一份"合并前身份快照"
 * （对齐 {@code dbHelper.ts:337-339}）。仍然**不做**的是
 * {@code resolvePlaybackQueueRestoreIndex} / {@code completePlaybackQueueRestore} 这一对收尾函数 ——
 * 它们的消费者在桌面主进程 {@code winMain/rendererEvent/data.ts}，Android 侧还没有对应的那一支；
 * 也就是说这份快照在 Android 侧**目前只写不读**（见「快照」与「与桌面的语义差异」）。
 *
 * <pre>
 * player_list_music_get   invoke, args=[listId]  → Rain.Music.MusicInfo[]   （契约 docs/android/ipc-contract.md:107）
 * </pre>
 *
 * <p>落点、建表、版本、单例一律复用 {@link RainMusicDatabase}；本文件只放这条通道自己的
 * {@code SELECT}、五条写语句（第七刀-B 的快照 INSERT 算一条）、结果映射与两条日志。第五刀那两个只读通道
 * （{@code player_list_music_check_exist} / {@code player_list_music_get_list_ids}）在
 * {@link RainMusicListMusicChannels} 里，<b>那个文件一行都没改</b>；第四刀 / 第一到三刀的文件同样没碰。
 *
 * <h2>调用链（契约 :107 那一行的三个坐标，逐条核对过）</h2>
 * <pre>
 * 渲染层  rendererListManage.ts:70-75   getListMusics(listId)
 *            if (!listId) return []                       ← 渲染层自己就短路了
 *            rendererInvoke&lt;string, Rain.Music.MusicInfo[]&gt;(list_music_get, listId)   ← :73（契约的 R:listManage:73）
 *   → 桥     src/common/platform/ipcBridge/capacitor.js（通道无关，本刀不碰）
 *   → 主进程 rendererEvent.ts:24-26     mainHandle&lt;string, Rain.Music.MusicInfo[]&gt;(list_music_get, async({params: listId}) =&gt; …)
 *                                                                                    ← :24（契约的 M:list:24）
 *   → 业务   modules/list/index.ts:182-207  getListMusics(listId)
 *   → 语句   modules/list/dbHelper.ts:179-182  queryMusicInfoByListId(listId)
 *   → SQL    modules/list/statements.ts:68-78  createMusicInfoQueryStatement()
 * </pre>
 *
 * <h2>本刀做的是桌面那四行里的哪几行</h2>
 * 桌面 {@code getListMusics} 在 {@code listId == LIST_IDS.DEFAULT}（{@code 'default'}）时多做两件事：
 * <pre>
 * :195  if (listId == LIST_IDS.DEFAULT) {
 * :196    const merged = dedupePlaybackQueue(targetList)
 * :197    if (merged.length != targetList.length) {
 * :198      const restoreSnapshot = queueStartupRestorePending ? targetList.map(({ id, name, singer }) =&gt; …) : undefined
 * :199      await overwriteMusicInfo(listId, toDBMusicInfo(merged, listId), restoreSnapshot)   ← **写库**
 * :200    }
 * :201    targetList = merged
 * :202  }
 * </pre>
 * <b>本刀做：:196（去重）/ :197（那一半判断）/ :198（合并前的身份快照，见「快照」）/
 * :199 的"四步写库" / :201（把去重后的列表返回）。</b>
 * <b>本刀不做</b>（逐条）：
 * <ol>
 *   <li>{@code resolvePlaybackQueueRestoreIndex} / {@code completePlaybackQueueRestore} ——
 *       它们的消费者在桌面主进程 {@code winMain/rendererEvent/data.ts}，Android 侧还没有对应的那一支
 *       （没有消费者 ⇒ 快照写进去之后**没人读、也没人清**，见「与桌面的语义差异」第 2 条）；</li>
 *   <li>{@code queueStartupRestorePending} 这个**模块级标志**本身 ——
 *       既有的范围守卫（{@code tests/unit/android-list-music-channels.test.cjs:528}）明令不许照抄它，
 *       本文件自己的用例要求"通道里不许有可变的静态字段"
 *       （{@code tests/unit/android-list-music-get-channels.test.cjs:641-643}）。
 *       本文件用"{@code db_info} 里还没有快照"**推导**同一个语义：理由、边界与差异见「快照」一节。</li>
 * </ol>
 *
 * <h2>触发条件（三条同时成立才写库）</h2>
 * <ol>
 *   <li>{@code listId} **等于** {@code 'default'}（{@link #LIST_ID_DEFAULT}）——
 *       普通歌单 / {@code temp} **永不合并**：非 default 的调用**不进锁、不判重、不写库**，
 *       走的是与第六刀逐字相同的纯读路径；</li>
 *   <li>这一次读**成功**（读失败已经抛出去了，走不到写回）；</li>
 *   <li>{@link RainMusicPlaybackQueueKey#findDuplicates(List)} 判定**至少有一条**重复 ——
 *       也就是"去重真删掉了元素"，与桌面的 {@code merged.length != targetList.length} 同形。
 *       没有重复 ⇒ <b>一条写语句都不发</b>（那正是第六刀的行为，本刀一字不改）。</li>
 * </ol>
 * <p>桌面还有第三条：{@code musicLists} 模块级缓存为空（本进程首次读）。Android 侧**没有**那份缓存
 * （第六刀的取舍，见「与桌面的语义差异」第 1 条）⇒ 这里等价成"每次读都判、脏就修"：
 * 第一次修好之后队列就是干净的，后面的读自然不再写。
 *
 * <h2>合并规则：逐字照抄 {@code playbackQueue.ts:10-22}</h2>
 * 用 {@link RainMusicPlaybackQueueKey#findDuplicates(List)}（它复刻的正是那个 {@code filter}）算出
 * **会被删掉的行**，剩下的就是"保留第一条完整记录"的结果 —— 不跨源合并 {@code meta}、
 * 不挑"质量更高"的那一条、也不重新排序（顺序 = SQL 的 {@code ORDER BY O."order" ASC}）。
 * 返回给渲染层的也是**去重后的**那一份（桌面 {@code :201} 的 {@code targetList = merged}）。
 *
 * <h2>事务形状：桌面那四步，全部在**同一个**事务里</h2>
 * 逐条对齐 {@code dbHelper.ts:337-349}（{@code overwriteMusicInfo} 里 {@code db.transaction} 的函数体），
 * 顺序一字不改：
 * <pre>
 * 桌面 dbHelper.ts                                      本文件                                    语句
 * :337-339 if (startupRestoreSnapshot &amp;&amp;                   if (!hasQueueRestoreSnapshot(db)) {      SQL_INSERT_QUEUE_RESTORE_SNAPSHOT
 *            !await getPlaybackQueueRestoreSnapshot()) {   execSQL(SQL_INSERT_QUEUE_RESTORE_       （条件插入，见「快照」）
 *            INSERT INTO db_info …                            SNAPSHOT, {key, snapshotText}) }
 * :340 musicInfoDeleteByListIdStatement.run(listId)      execSQL(SQL_DELETE_MUSIC_INFO_BY_LIST_ID,  {listId})
 * :341 musicInfoOrderDeleteByListIdStatement.run(listId) execSQL(SQL_DELETE_MUSIC_ORDER_BY_LIST_ID, {listId})
 * :342-349 for (musicInfo of musicInfos) {               for (order = 0…kept.size()-1) {
 *            musicInfoInsertStatement.run(musicInfo)       execSQL(SQL_INSERT_MUSIC_INFO,  row.insertArgs(listId))
 *            musicInfoOrderInsertStatement.run({…})        execSQL(SQL_INSERT_MUSIC_ORDER, {listId, row.id, order})
 *          }                                             }
 * </pre>
 * 事务形状是 {@code beginTransaction()} / {@code setTransactionSuccessful()} / {@code endTransaction()}
 * （与 {@link RainMusicDatabase} 的 {@code onCreate} 同一套）。⚠️ 这四步是**一个**事务：
 * {@code endTransaction()} 未标记成功时，快照那一行与两条 DELETE、{@code INSERT ×2×N} 一起回滚
 * —— 桌面 {@code tests/unit/playback-queue.test.cjs:212-220} 证明的正是"合并失败 ⇒ 行与快照一起回滚、
 * 不留脏快照"。
 *
 * <p><b>写回去的值从哪来</b>（对齐 {@code toDBMusicInfo(merged, listId)}，{@code modules/list/index.ts:39-48}）：
 * 每一条都取自**刚刚读到的那一行**（不重新查库、不跨源拼），{@code order} = 去重后列表里的下标
 * （{@code offset} 默认 0），{@code meta} = 把**解析出来的对象**重新序列化成文本
 * （桌面是 {@code JSON.stringify(info.meta)}，这里是 {@link MusicInfoRow#metaText()}）。
 *
 * <h2>快照（第七刀-B）：同一个事务的第一步，条件是"db_info 里还没有这份快照"</h2>
 * 对齐 {@code dbHelper.ts:337-339}（{@code overwriteMusicInfo} 事务函数体的**头三行**）：
 * <pre>
 * 桌面 dbHelper.ts:337-339                                       本文件
 * if (startupRestoreSnapshot &amp;&amp; !await                            if (!hasQueueRestoreSnapshot(db)) {
 *     getPlaybackQueueRestoreSnapshot()) {                          db.execSQL(SQL_INSERT_QUEUE_RESTORE_SNAPSHOT,
 *   await db.prepare('INSERT INTO db_info (field_name,                new Object[] { QUEUE_RESTORE_SNAPSHOT_KEY,
 *     field_value) VALUES (?, ?)').run(                                  restoreSnapshotText });
 *       QUEUE_RESTORE_SNAPSHOT_KEY,                              }
 *       JSON.stringify(startupRestoreSnapshot))
 * }
 * </pre>
 * 三条硬约束逐条满足：
 * <ol>
 *   <li><b>条件</b>：只有"库里还没有这份快照"时才插。桌面那两个条件是与关系：
 *       {@code queueStartupRestorePending === true} **且** {@code getPlaybackQueueRestoreSnapshot() == null}；
 *       本文件只用后半句 —— 于是"库里还没有"成了这次插入的**唯一**条件（理由见下）；</li>
 *   <li><b>内容</b>：合并**前**的 {@code (id, name, singer)} 列表，顺序 = 这一次 SELECT 的行序。
 *       桌面 {@code :198} 的 {@code targetList} 就是去重**前**读到的全部行 ⇒ 快照里**包含**那些
 *       马上要被删掉的重复行（这不是 bug，正是"身份快照"要的东西：{@code playInfo.index} 指向的是
 *       去重前的行序）。文本 = {@code org.json} 把同形状的对象数组序列化（{@link #toRestoreSnapshotText(List)}）；</li>
 *   <li><b>顺序与事务</b>：这一句在 {@code beginTransaction()} 之后、**两条 DELETE 之前**执行，
 *       所以它和 DELETE / INSERT 是**同一个事务**：{@code endTransaction()} 未标记成功时一起回滚
 *       （与桌面 {@code :337-339} 在 {@code db.transaction} 函数体里、且在 {@code :340} 之前的位置逐条同形）。
 *       ⚠️ 采集（把 {@code rows} 序列化成文本）发生在事务**之外**、锁**之内** —— 桌面同样是先在
 *       {@code index.ts:198} 造数组、再进 {@code overwriteMusicInfo} 的事务；被采的 {@code rows}
 *       就是同一个临界区里刚读到的那一批，不会被同一个进程里的另一次合并换掉。</li>
 * </ol>
 *
 * <h3>为什么可以用"db_info 里有没有快照"代替 {@code queueStartupRestorePending}</h3>
 * 桌面那个标志的**全部**用途只有一个：{@code index.ts:198} 决定这一次要不要顺手把快照带上。
 * 它只在 {@code completePlaybackQueueRestore}（{@code index.ts:218-221}）里被置 false，
 * 而那两行**同时**把快照行删掉（{@code clearPlaybackQueueRestoreSnapshot}）。
 * 于是：
 * <ul>
 *   <li>"进程内标志 ∧ 库里没有快照"在任何时刻都蕴含"库里没有快照"。反过来，
 *       在**没有消费者清快照**的 Android 侧，"库里没有快照"与"本进程还没为这份库记过身份"当前是同一件事
 *       （本文件是全仓库唯一的生产者，清快照的那一半不做）；</li>
 *   <li>快照是**持久**的、标志是**内存**的：worker 重启后标志回到 true 而快照还在 ——
 *       桌面自己也知道这一点，所以 {@code :337} 才会**再查一次库**（{@code !await getPlaybackQueueRestoreSnapshot()}）。
 *       本文件把这个"再查一次"提升为唯一条件，等于**只保留**桌面那个与式里真正持久、
 *       且能跨进程成立的那一半。</li>
 * </ul>
 * <p><b>与桌面的可观察差异（不隐藏）</b>：
 * <ol>
 *   <li>一旦将来有代码实现"清快照"（{@code completePlaybackQueueRestore} 那一半），
 *       桌面的标志在同一个 worker 生命周期里**不会**再回到 true ⇒ 之后即使队列又被弄脏、再合并一次，
 *       桌面也**不写**快照；本文件会重新看见"库里没有快照"并**再写一份**。
 *       差异只在"清过快照之后、同一个进程内又发生一次合并"时可见，表现为 {@code db_info} 里多一行。
 *       在 Android 侧**当前不可观察**：没有任何代码会清它（那两个收尾函数本刀不做、Android 侧也没有别的调用点）。</li>
 *   <li>桌面 {@code getPlaybackQueueRestoreSnapshot()} 会**解析并校验**那一行（坏 JSON / 类型不对 ⇒ 抛错，
 *       整个合并失败）；本文件 {@link #hasQueueRestoreSnapshot} 只判"这一行在不在"（**不解析**）。
 *       于是"行在但内容是坏的"这种库：桌面会让这次合并失败，本文件会跳过插入、照常合并 ——
 *       那一行只可能由本文件按 {@link #QUEUE_RESTORE_SNAPSHOT_KEY} 写入，坏值属于**别人写坏**的库。
 *       选择不解析的理由：那个值在 Android 侧没有任何消费者，为一个没人读的值再加一条校验路径，
 *       会把"读失败 / 写失败"的可分辨性（第六刀到第七刀-A 一直在维护的东西）再搅一次。</li>
 * </ol>
 *
 * <h2>失败语义：写回的 rejection **直接冒泡**（不吞、也不返回去重后的列表）</h2>
 * 桌面的事实（{@code tests/unit/playback-queue.test.cjs:212-220}）：在那个事务的 DELETE 上挂一个
 * {@code RAISE(ABORT)} 触发器之后，{@code await assert.rejects(s.getListMusics('default'), /merge interrupted/)}
 * 成立，并且事务回滚、{@code queryMusicInfoByListId('default')} 仍是原来的 3 行。
 * Android 照抄这条语义：
 * <ul>
 *   <li>写回抛出的任何异常都被包成 {@code IllegalStateException} 从 handler 里抛出去 ⇒
 *       P0-1 回 {@code ok:false, code=IPC_HANDLER_FAILED}（{@code RainMusicIpcPlugin.java:247-273}）；</li>
 *   <li><b>快照那一句失败也算"写回失败"</b>：它在同一个事务里、是**第一条**写语句
 *       （{@code db_info} 的 SELECT/INSERT 抛错都走这条路），所以整次合并失败、一起回滚。
 *       桌面同形（{@code dbHelper.ts:337-339} 在事务函数体里，抛出去就是{@code overwriteMusicInfo} 失败）；</li>
 *   <li>消息**同时点名两半**（见 {@link #writeBackFailureMessage}）：读到 N 行**成功** /
 *       **写回失败** / **已回滚** / **库仍是写回前的 N 行** / 原始异常，并**点名快照那一句在不在回滚集合里**。
 *       第六刀"只读"的主要理由正是"读失败与写失败会压到同一个 ok 上、事后分辨不出" ——
 *       消息把两半分开说，可分辨性就有了，所以这一刀可以做了；</li>
 *   <li>渲染层那一侧也不缓存：{@code rendererListManage.ts:73-74} 是
 *       {@code const list = await rendererInvoke(…)} **之后**才 {@code setMusicList(listId, list)}，
 *       reject 会让 {@code setMusicList} 根本不被调用 ⇒ 下一次 invoke 必然重新查库。
 *       反过来，如果这里吞掉写回错误却返回去重后的列表，渲染层就会缓存一份**库里并不存在**的列表
 *       （库仍是脏的），缓存与库**永久分叉** —— 这是本刀明确禁止的写法。</li>
 * </ul>
 *
 * <h2>并发：一把**只护 default 去重写回**的专用锁（{@link #DEFAULT_QUEUE_MERGE_LOCK}）</h2>
 * <p><b>为什么需要</b>：P0-1 的 handler 跑在 **2 线程池**里（{@code RainMusicIpcPlugin.java:347-361}），
 * 并发的两次 {@code invoke(player_list_music_get, 'default')} 会真的同时跑。桌面靠
 * {@code dbService/index.ts:29-45} 的 {@code serializeCalls} 把**所有** dbService 调用排成一条队列
 * （"同一时刻只跑一个业务调用"），Android 侧没有那个入口。
 *
 * <p><b>要护住的是"读 → 判重 → 删 → 插"这一整段，而不是只护写</b>：并发的两次读可能**都**读到脏队列，
 * 之后各自 DELETE + INSERT。就算每条语句都在事务里，两个事务按 "A 删 → B 删 → A 插 → B 插" 交错时，
 * B 的 DELETE 会把 A 刚插入的行删掉，最终库里只剩 B 那一份，而两个读者都认为自己修好了。
 * 所以临界区从 SELECT **之前**开始：见 {@link #getListMusics}，{@code default} 分支整段在
 * {@code synchronized} 里，非 default **不进锁**（它们没有 read-modify-write，加锁只会白等）。
 *
 * <p><b>为什么不复用别的锁</b>（逐条）：
 * <ul>
 *   <li>{@link RainMusicStoreLock#WRITE_LOCK} 是 **SharedPreferences** 的写锁（"读整份文本 →
 *       改一个键 → 写回整份"的文件级快照语义）。它护的东西与 SQLite 无关，混用只会让两件不相干的事
 *       互相阻塞，还会让人误以为"这条通道也受那把锁保护"；</li>
 *   <li>{@link RainMusicDatabase} 里那个 {@code synchronized} 只护"第一次 new Helper"
 *       （{@code RainMusicDatabase.java:418-424}），SQL 一行都不在它里面跑；</li>
 *   <li>{@link RainMusicLogThrottle} 的锁只护几个计数器（两条日志各自的闸门），不护数据。</li>
 * </ul>
 * <p><b>为什么不新开一个文件放这把锁</b>：它保护的是**本文件里唯一一处**代码（default 分支），
 * 全仓库只有这一个获取点。单独一个文件只会是"一个字段 + 一句注释"，而把锁与它保护的临界区放在同一个
 * 文件里，"谁拿了它、护了哪一段"一眼可见。（这与第三刀的 {@link RainMusicStoreLock} 不同：
 * 那把锁被两个通道文件共用，所以它必须单独成文件。）
 *
 * <p>⚠️ <b>锁的边界（不要当成万能的）</b>：Java 监视器只在本进程、本类加载器里有效，**管不到别的连接**
 * —— 将来的线 A（JS 侧 SQLite 驱动）或别的原生写通道与这里并发时，靠的是 SQLite 自己的文件锁与
 * 事务（这一次写回本身就是一个事务）。这就是"只护自己这一段的 read-modify-write"。
 *
 * <p><b>这把锁也负责"同一次合并里快照只插一次"</b>：快照的"查在不在 → 插"两步与 DELETE / INSERT
 * 同在临界区里（{@link #overwriteDefaultQueue} 被 {@link #readListMusics} 在锁内调用），
 * 所以并发的两次合并会被排成先后两次：先到的写快照、后到的看见快照就跳过
 * （与上一刀建立的并发方案同一把锁、同一个临界区，没有新锁、没有新的可变静态字段）。
 *
 * <p><b>{@code queueStartupRestorePending} 的替代：用"db_info 里还没有快照"推导</b>。桌面那个模块级标志
 * 只有一个用途 —— 决定要不要顺手写一条 {@code db_info} 快照（{@code :198}）；
 * 而它在 {@code completePlaybackQueueRestore} 里被置 false 的同时快照也被清掉
 * （{@code index.ts:218-221}），并且 {@code dbHelper.ts:337} 本来就会再查一次库。
 * 本文件于是**只保留**那个持久的那一半：条件 = {@code !hasQueueRestoreSnapshot(db)}，
 * 不引入任何进程内标志（本文件**没有**可变的静态字段，见「快照」一节的论证与差异）。
 *
 * <h2>日志：第六刀那条"Android 没做合并"的临时 warn 已被**替换**（留着它就会说谎）</h2>
 * <ol>
 *   <li><b>合并成功</b>（{@link #warnQueueMerged}）：{@code Logger.warn}，节流
 *       {@link #QUEUE_MERGED_WARN_WINDOW_MS}（签名 = listId + 行数 + 重复数 + 前几条重复的键）。
 *       它说的是"检出 K 条重复、已去重并写回 N → M 行"，并点名"本次事务的第一步是
 *       {@code db_info} 快照（只在还没有时插一份）"，以及"快照当前没有消费者"；</li>
 *   <li><b>{@code meta} 列是 NULL</b>（{@link #META_NULL_WARN}）：与第六刀逐字相同；</li>
 *   <li><b>写回失败</b>：**不打日志**，直接抛 —— 消息里已经点名两半，失败不该被压成一条与成功
 *       共存的 warn（那会让 logcat 上"成功"与"失败"看起来一样）。</li>
 * </ol>
 * <p>为什么还留着节流：正常路径上队列修好之后就干净了（后面的读不会再进这一支），
 * 但如果**还有别的写者**把队列反复弄脏，这里最多每分钟刷一条。
 * ⚠️ Capacitor 的 {@code Logger} 受 {@code Logger.shouldLog()} 控制（{@code CapConfig.isLoggingEnabled()}，
 * 默认开），关掉日志时这两条也会消失 —— 这是平台属性，本文件不去绕它。
 *
 * <h2>SQL 逐字对齐 {@code statements.ts} / {@code dbHelper.ts}</h2>
 * <ul>
 *   <li>{@link #SQL_MUSIC_BY_LIST_ID} = {@code createMusicInfoQueryStatement()}（:68-78）的逐字副本，
 *       唯一的差异是 **better-sqlite3 的具名参数 {@code @listId} → Android 的位置参数 {@code ?}**
 *       （{@code SQLiteDatabase.rawQuery(String, String[])} 只支持 {@code ?}）。那一句里
 *       {@code @listId} 出现**两次**（{@code ON … O.listId=@listId} 与 {@code WHERE mInfo.listId=@listId}），
 *       所以绑定数组是 {@code new String[] { listId, listId }} —— <b>两次都要绑同一个值</b>。</li>
 *   <li>{@link #SQL_DELETE_MUSIC_INFO_BY_LIST_ID} / {@link #SQL_DELETE_MUSIC_ORDER_BY_LIST_ID} /
 *       {@link #SQL_INSERT_MUSIC_INFO} / {@link #SQL_INSERT_MUSIC_ORDER} 分别是
 *       {@code statements.ts:119} / {@code :192} / {@code statements.ts:84-89} / {@code :170-175}
 *       那四条语句的逐字副本（同样只把具名参数换成 {@code ?}）。<b>列清单与列顺序一字不改</b> ——
 *       位置参数的值是按那个顺序绑的。</li>
 *   <li>{@link #SQL_SELECT_QUEUE_RESTORE_SNAPSHOT} / {@link #SQL_INSERT_QUEUE_RESTORE_SNAPSHOT}
 *       是 {@code dbHelper.ts:28} / {@code :338} 那两句的副本。它们的**列清单逐字对齐
 *       {@code tables.ts:120-127} 的 {@code db_info}**（{@code "field_name"}、{@code "field_value"}，
 *       主键是自增的 {@code "id"}，本文件**不碰**它）；表名与列名带 {@code "main".} 限定符与引号，
 *       与同包里 {@code RainMusicDatabase.SQL_INSERT_SCHEMA_VERSION}（{@code version} 那一行）
 *       的形状**逐字相同** —— SQLite 里 {@code db_info} 与 {@code "main"."db_info"} 是同一张表。</li>
 * </ul>
 * <p>⚠️ {@code SQL_INSERT_MUSIC_INFO} 的列清单里 {@code "listId"} 在 {@code "id"} **之后**、
 * {@code "meta"} 在最后：这不是"随便排的"，它就是 {@code statements.ts:87} 的顺序，
 * 也是 {@link MusicInfoRow#insertArgs(String)} 里绑定数组的顺序。
 *
 * <p>⚠️ 读语句<b>没有</b>加 {@code DISTINCT}、<b>没有</b>加 {@code LIMIT}、<b>也没有</b>加列表通道那种
 * {@code "rowid" ASC} 兜底排序。理由：这条语句的 {@code ORDER BY O."order" ASC} 里，
 * 没有 order 记录的行 {@code O."order"} 是 NULL，SQLite 的 ASC 把 NULL 排在最前 ——
 * 这是**桌面既有的行序语义**（"去重保留第一条"依赖它）。抄一个 rowid 兜底进去会改变"哪一条存活"
 * 与整体行序，属于**改语义**，不是修 bug。
 *
 * <h2>{@code meta} 必须解析成 JSON，不能把 TEXT 原样回传</h2>
 * 桌面 {@code modules/list/index.ts:192} 是 {@code meta: JSON.parse(info.meta)} ——
 * 返回给渲染层的是**对象**，不是字符串。{@link #parseMeta(String, String)} 的处理：
 * <table border="1">
 *   <caption>meta 的四种输入</caption>
 *   <tr><th>库里的 meta</th><th>桌面（{@code JSON.parse}）</th><th>本通道</th></tr>
 *   <tr><td>合法 JSON 对象（唯一正常的形态：写入方是 {@code toDBMusicInfo} 的
 *       {@code JSON.stringify(info.meta)}）</td><td>对象</td>
 *       <td>{@code new JSONObject(text)} ⇒ 同一个对象</td></tr>
 *   <tr><td>{@code NULL} 列（表结构是 {@code TEXT NOT NULL}，只有被人写坏才可能）</td>
 *       <td>{@code JSON.parse(null)} ⇒ {@code null}（JS 会先把参数 {@code ToString} 成 {@code "null"}）</td>
 *       <td>{@code JSONObject.NULL} ⇒ JSON {@code null}（**逐字等价**）</td></tr>
 *   <tr><td>坏 JSON（{@code "{oops"}）</td><td>抛 {@code SyntaxError} ⇒ 整条读失败</td>
 *       <td>抛 {@code IllegalStateException}（带 music id）⇒ 整条读失败（**同形**）</td></tr>
 *   <tr><td>合法但**不是对象**的 JSON（{@code [1,2]} / {@code "abc"} / {@code 123} / {@code null}）</td>
 *       <td>{@code JSON.parse} 收下它 ⇒ 渲染层拿到一个非对象</td>
 *       <td><b>抛错</b>（{@code new JSONObject(…)} 要求顶层是对象）</td></tr>
 * </table>
 * <p>最后一行是**有意**的一处差异，也是**需要人复核**的点：{@code Rain.Music.MusicInfo.meta} 的类型是
 * {@code MusicInfoMetaBase}（对象，{@code src/common/types/music.d.ts:46}），非对象 meta 属于**坏数据**；
 * 桌面那句 {@code JSON.parse} 并不是校验器，它只是**碰巧**能收下标量。这里选择"坏数据大声失败"，
 * 而不是把它当一次成功读推给渲染层（这与本刀「不假装成功」是同一条原则）。
 *
 * <p>⚠️ 解码顺序也与桌面同形：桌面先把**所有**行都 {@code JSON.parse} 成 {@code targetList}，
 * **然后**才去重。所以某一条**将被删掉的**重复行如果 {@code meta} 是坏的，桌面同样会让整条读失败。
 * 本文件照抄这一点：{@link MusicInfoRow} 对每一行都解析 {@code meta}，包括重复行
 * （"只给存活的行解析"是一处看起来优化、实际改语义的写法）。
 *
 * <h2>返回的一行 = {@code Rain.Music.MusicInfo}（6 个键，照桌面那张 map 抄）</h2>
 * 桌面 {@code index.ts:185-194} 构造的对象只有
 * {@code id / name / singer / source / interval / meta} —— <b>没有 {@code listId}、没有 {@code order}</b>
 * （SQL 里根本没选 {@code listId}，{@code order} 只参与排序）。本通道逐字照抄这 6 个键。
 * {@code interval} 与 {@code meta} 按 {@code src/common/types/music.d.ts:45-46} 分别是
 * {@code string | null} 与对象 ⇒ 前者 NULL 时走 {@link #jsonValue(Object)} 写成 JSON {@code null}
 * （{@code org.json} 的 {@code put(name, null)} 会**删键**，必须用 {@code JSONObject.NULL}）。
 *
 * <h2>不假装成功（逐条）</h2>
 * <table border="1">
 *   <caption>空 / 坏 / 表缺失 / 默认列有重复，分别是什么表现</caption>
 *   <tr><th>状态</th><th>本通道</th><th>与桌面的关系</th></tr>
 *   <tr><td><b>这个歌单是空的 / 没有这个歌单</b></td><td>{@code []}</td>
 *       <td>与桌面**同形**：{@code WHERE listId=?} 查不到行 ⇒ 桌面也是 {@code []}</td></tr>
 *   <tr><td><b>{@code listId} 是 {@code null}</b></td><td>不查库，直接 {@code []}</td>
 *       <td>桌面把 null 绑成 SQL NULL，{@code WHERE listId=NULL} 恒不成立 ⇒ 也是 {@code []}
 *           （逐字等价）。渲染层那一侧更早就短路了（{@code rendererListManage.ts:71}）</td></tr>
 *   <tr><td><b>库打不开</b>（文件损坏 / 没权限 / 首次建表失败 / 迁移抛错）</td>
 *       <td>抛错 ⇒ {@code ok:false, IPC_HANDLER_FAILED}，消息里带库的绝对路径</td>
 *       <td>桌面在启动期就建库，这条路上是"进程起不来"；Android 侧只能在这里大声失败</td></tr>
 *   <tr><td><b>表缺失</b>（没有 {@code my_list_music_info}）</td>
 *       <td>抛错，点名表名与 {@code tables.ts} 是期望结构的出处</td>
 *       <td>同上。表由 {@link RainMusicDatabase} 只在库文件不存在时建一次</td></tr>
 *   <tr><td><b>查询失败</b>（列漂移、{@code my_list_music_info_order} 缺失导致 JOIN 失败、游标异常）</td>
 *       <td>抛错，消息里带归一化后的 SQL 与原始异常</td>
 *       <td>桌面也是抛（better-sqlite3 准备/执行时抛）</td></tr>
 *   <tr><td><b>{@code meta} 不是合法 JSON / 不是对象</b></td><td>抛错，消息里点名 music id</td>
 *       <td>见上表（非法 JSON 同形；合法非对象是**有意**差异）</td></tr>
 *   <tr><td><b>默认列检出重复，且写回成功</b></td><td>去重 + 单事务写回（第一步 = **条件**插入
 *       {@code db_info} 合并前快照）+ 返回**去重后的**列表 + 一条节流 {@code Logger.warn}</td>
 *       <td>与桌面 :196-:199 / :201 **同形**；快照的条件少一半（无进程内标志），见「快照」</td></tr>
 *   <tr><td><b>默认列检出重复，但写回失败</b>（含**快照那一句**失败）</td><td><b>抛错</b>（消息点名读到 N 行成功 /
 *       写回失败 / 已回滚 / 库仍是 N 行 / 快照那一句在不在回滚集合里 / 原始异常），**不返回**去重后的列表</td>
 *       <td>与桌面**同形**：{@code assert.rejects} + 事务回滚 + 行数不变，**且不留脏快照**
 *           （{@code tests/unit/playback-queue.test.cjs:212-220}）</td></tr>
 * </table>
 *
 * <h2>与桌面的语义差异（逐条，全部是**有意**的）</h2>
 * <ol>
 *   <li><b>没有 {@code musicLists} 模块级缓存</b>：桌面只在"本进程第一次读这个 listId"时去重
 *       （缓存为空那一条），Android 每次读都判。后果：库被**别的写者**（线 A 的 JS 驱动 / 将来的写通道）
 *       弄脏时，Android 会在下一次读时就修好，桌面（缓存已热）不会。方向是"更早修好"，
 *       不会丢数据；代价是"写库次数可能比桌面多"。这也是第六刀既有的取舍（它的用例明令不许照抄缓存）。</li>
 *   <li><b>快照的条件里没有 {@code queueStartupRestorePending} 这一半</b>：条件退化成
 *       "库里还没有这份 {@code playback_queue_startup_restore} 快照"。桌面的那一支是
 *       {@code 进程内标志 ∧ 库里没有}；两者只在"清过快照之后、同一个进程内又合并一次"时不同
 *       （桌面不写、本文件再写一份）—— 在 Android 侧当前**不可观察**，因为没有任何代码会清快照。
 *       另外本文件**不解析**已存在的那一行（桌面会校验、坏值让合并失败）：论证与边界见「快照」。
 *       <p>还有一处**只写不读**的事实：{@code resolvePlaybackQueueRestoreIndex} /
 *       {@code completePlaybackQueueRestore} 这一对消费者本刀不做，所以这一行写进去之后
 *       Android 侧没有任何读取点 —— 它当前是一份"为将来那一刀预留"的元数据，不影响任何返回值。</li>
 *   <li><b>{@code meta} 写回时的文本由 {@code org.json} 重新序列化</b>（桌面是 {@code JSON.stringify}）。
 *       两边都是"把解析出来的对象紧凑地写回去"，键顺序两边都按插入顺序保留；但**数字**的文本形式
 *       在极端情况下可能不同（例如 {@code 1.0E10} 这种 {@code Double.toString} 形式，JS 会写成
 *       {@code 10000000000}）。值等价、JSON 合法，**文本可能不同** —— 这是**需要人复核**的点。
 *       （只影响被合并过的默认队列里的 {@code meta} 文本。）</li>
 *   <li><b>并发粒度更窄</b>：桌面是"所有 dbService 调用排一条队列"（全局串行化），Android 只是
 *       "default 的去重写回互斥"。非 default 的读完全不受影响 —— 语义上覆盖了真正需要独占的那一段。</li>
 *   <li><b>多一条日志</b>：桌面在这里没有任何日志；Android 有一条节流 warn（logcat 是原生侧唯一的
 *       可观测面）。它**不影响**返回值与库。</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.database.*} 与 {@code org.json}、JDK 的
 * {@code java.util.{ArrayList,Collections,IdentityHashMap,List,Set}}，
 * 以及同包的 {@link RainMusicDatabase} / {@link RainMusicIpcHandlers} /
 * {@link RainMusicPlaybackQueueKey} / {@link RainMusicLogThrottle}。
 * <b>没有新增任何 gradle 依赖</b>，也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着 Android 框架 API + 本机读到的 {@code @capacitor/android@8.5.2} 源码
 * 逐条核对的，只能由 CI（{@code .github/workflows/build-android.yml} 的 {@code gradlew assembleDebug}）证伪。
 * 本机的 {@code javac}（JDK 20）做过三件事：① 用一组**手写替身**把它编过一遍；
 * ② 把 {@link RainMusicPlaybackQueueKey} 与 {@link RainMusicLogThrottle}（不含 Android 类型）
 * **真的跑起来**与 JS 对比；③ 用一组**手写的假 SQLite**（内存里的三张表 + 真事务语义 + 语句记录）
 * 把这一刀的控制流**真的跑起来**（见 {@code tests/unit/android-playback-queue-merge.test.cjs}）。
 * 三件事的替身/假库都是人手写的，与真实框架 API、真实 SQLite 一旦不一致，那些用例不会发现。
 * 真机行为（首装建库后返回 {@code []}、JOIN 的实际行序、{@code execSQL} 的绑定与 NULL、
 * {@code db_info} 的 INSERT/SELECT 是否真的落在同一张表上、事务在真机上的回滚（含快照那一行）、
 * 警告是否真的出现在 logcat）**同样未在真机验证**。
 * <p><b>本刀新增的未验证点（快照那一半）</b>：
 * <ol>
 *   <li>快照文本与桌面 {@code JSON.stringify} 是否**逐字节**相同**未验证**：两边都是
 *       "键按插入顺序、紧凑、控制字符转义"，本文件的假 {@code org.json} 是按 AOSP 的形状手写的，
 *       真机上的 {@code org.json} 一旦在转义上有别的取舍，文本可能不同（**语义相同**，
 *       而 Android 侧目前没有消费者去读它）；</li>
 *   <li>真机上"同一行只插一次"依赖的是本进程那把锁 —— 别的连接（线 A 的 JS 驱动）同时插一行
 *       不会被它挡住（{@code db_info} 的 {@code field_name} 上**没有** UNIQUE 约束，
 *       {@code tables.ts:120-127} 只约束了自增主键 {@code id}）。SQLite 自己的写锁会让两个
 *       INSERT 串行，但不会做"存在就跳过"的判断 —— 这是本刀**已知**的边界（桌面同款：
 *       它的"只插一次"也只是 worker 内的单线程 + 那次 {@code !await getPlaybackQueueRestoreSnapshot()}
 *       检查，跨进程同样靠不住）。</li>
 * </ol>
 */
public final class RainMusicListMusicGetChannels {

    /**
     * {@code player_list_music_get}：键名 {@code list_music_get}
     * （{@code src/common/ipcNames.ts:37} 的 {@code PLAYER_EVENT_NAME.list_music_get}）
     * + 模块前缀 {@code player}（生成规则 {@code ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_MUSIC_GET = "player_list_music_get";

    /**
     * 读某个歌单里的歌曲。逐字抄 {@code src/main/worker/dbService/modules/list/statements.ts:68-78} 的
     * {@code createMusicInfoQueryStatement()}，只把具名参数 {@code @listId} 换成位置参数 {@code ?}
     * （出现**两次**，绑定顺序见 {@link #readListMusics(Context, String, boolean)}）。
     *
     * <p>列清单、表名写法（{@code my_list_music_info mInfo} 无 {@code "main".} 前缀）、
     * {@code LEFT JOIN} 的 {@code ON mInfo.id=O.musicInfoId AND O.listId=?}、
     * {@code WHERE mInfo.listId=?}、以及那句 {@code ORDER BY O."order" ASC} 一字不改。
     * <b>没有</b> {@code DISTINCT} / {@code LIMIT} / rowid 兜底（见类注释「SQL」）。
     */
    static final String SQL_MUSIC_BY_LIST_ID = """
        SELECT mInfo."id", mInfo."name", mInfo."singer", mInfo."source", mInfo."interval", mInfo."meta"
        FROM my_list_music_info mInfo
        LEFT JOIN my_list_music_info_order O
        ON mInfo.id=O.musicInfoId AND O.listId=?
        WHERE mInfo.listId=?
        ORDER BY O."order" ASC
        """;

    /**
     * 写回第 1 步：删掉这个歌单在 {@code my_list_music_info} 里的**全部**行。
     * 逐字抄 {@code statements.ts:117-120} 的 {@code createMusicInfoDeleteByListIdStatement()}
     * （{@code DELETE FROM "main"."my_list_music_info" WHERE "listId"=?}）。
     */
    static final String SQL_DELETE_MUSIC_INFO_BY_LIST_ID = """
        DELETE FROM "main"."my_list_music_info" WHERE "listId"=?
        """;

    /**
     * 写回第 2 步：删掉这个歌单在 {@code my_list_music_info_order} 里的**全部**行。
     * 逐字抄 {@code statements.ts:190-193} 的 {@code createMusicInfoOrderDeleteByListIdStatement()}。
     */
    static final String SQL_DELETE_MUSIC_ORDER_BY_LIST_ID = """
        DELETE FROM "main"."my_list_music_info_order" WHERE "listId"=?
        """;

    /**
     * 写回第 3 步之一：插回**存活**的每一行。逐字抄 {@code statements.ts:84-89} 的
     * {@code createMusicInfoInsertStatement()}，列清单与列顺序（{@code id, listId, name, singer,
     * source, interval, meta}）一字不改 —— 绑定数组必须按这个顺序给。
     */
    static final String SQL_INSERT_MUSIC_INFO = """
        INSERT INTO "main"."my_list_music_info" ("id", "listId", "name", "singer", "source", "interval", "meta")
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """;

    /**
     * 写回第 3 步之二：给每一行插一条顺序记录。逐字抄 {@code statements.ts:170-175} 的
     * {@code createMusicInfoOrderInsertStatement()}（{@code listId, musicInfoId, order}）。
     */
    static final String SQL_INSERT_MUSIC_ORDER = """
        INSERT INTO "main"."my_list_music_info_order" ("listId", "musicInfoId", "order")
        VALUES (?, ?, ?)
        """;

    /**
     * 写回**第 0 步之一**（第七刀-B）：查"这份快照是否已经在 {@code db_info} 里"。
     * 抄 {@code dbHelper.ts:28} 的 {@code getPlaybackQueueRestoreSnapshot} 那一句
     * （{@code SELECT field_value FROM db_info WHERE field_name = ?}），列/表与
     * {@code tables.ts:120-127} 的 {@code db_info} 对齐、与同包的
     * {@code RainMusicDatabase.SQL_INSERT_SCHEMA_VERSION} 用同一套限定符与引号写法。
     *
     * <p>⚠️ 本文件**只判行在不在**，**不**把 {@code field_value} 解析成 JSON ——
     * 理由与差异见类注释「快照」（桌面会解析并校验，坏值让整次合并失败）。
     */
    static final String SQL_SELECT_QUEUE_RESTORE_SNAPSHOT = """
        SELECT "field_value" FROM "main"."db_info" WHERE "field_name"=?
        """;

    /**
     * 写回**第 0 步之二**（第七刀-B）：插入"合并前身份快照"那一行。
     * 抄 {@code dbHelper.ts:338} 的 {@code INSERT INTO db_info (field_name, field_value) VALUES (?, ?)}。
     *
     * <p>列清单（{@code "field_name"}、{@code "field_value"}）与列顺序逐字对齐
     * {@code tables.ts:120-127} 的 {@code db_info}；**不碰**自增主键 {@code "id"}（与桌面一样让库自己填）。
     */
    static final String SQL_INSERT_QUEUE_RESTORE_SNAPSHOT = """
        INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (?, ?)
        """;

    /** {@code player_list_music_get} 的参数名（契约 :107：{@code listId: string}，裸字符串）。 */
    private static final String FIELD_LIST_ID = "listId";

    /**
     * 默认播放队列的 id（{@code src/common/constants.ts} 的 {@code LIST_IDS.DEFAULT === 'default'};
     * 与 {@code RainMusicDataChannels} 的同名常量同一个值）。
     *
     * <p>为什么这条通道需要知道它：桌面**只**在 {@code default} 上去重（含写回），
     * 所以"合并 + 写库"这件事只可能发生在它身上。
     */
    private static final String LIST_ID_DEFAULT = "default";

    /** {@code my_list_music_info} 的列名（{@code tables.ts:139-150}），与 SQL 的列清单一一对应。 */
    private static final String COLUMN_ID = "id";
    private static final String COLUMN_NAME = "name";
    private static final String COLUMN_SINGER = "singer";
    private static final String COLUMN_SOURCE = "source";
    private static final String COLUMN_INTERVAL = "interval";
    private static final String COLUMN_META = "meta";

    /**
     * {@code my_list_music_info_order}（{@code tables.ts:157-163}）—— 本通道只用在
     * 写回语句、{@code LEFT JOIN} 与日志消息里。
     *
     * <p>它**故意**是本地常量：{@link RainMusicDatabase} 里没有这张表的公开常量，而本仓库的规矩是
     * **老文件冻结**（第四 / 第五 / 第六刀的文件各管各的）。{@code RainMusicDatabase} 里那张表的 DDL
     * （{@code DDL_MY_LIST_MUSIC_INFO_ORDER}）才是结构的唯一出处，这里只放名字。
     */
    private static final String TABLE_MY_LIST_MUSIC_INFO_ORDER = "my_list_music_info_order";

    /**
     * 合并前身份快照在 {@code db_info} 里的 {@code field_name}。**逐字**抄
     * {@code dbHelper.ts:24} 的 {@code QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'}
     * —— 键名对不上就等于"没有快照"，而这是一份**跨 worker** 的持久数据。
     *
     * <p>它不引用 {@link RainMusicDatabase} 的常量：那个类里没有这个键（只有 {@code version}）。
     */
    private static final String QUEUE_RESTORE_SNAPSHOT_KEY = "playback_queue_startup_restore";

    /**
     * {@code db_info} 的两个列名（{@code tables.ts:120-127}）**只出现在上面那句 SQL 的文本里**，
     * 刻意不做成常量：{@link RainMusicDatabase} 里已有一份（{@code COLUMN_FIELD_NAME} /
     * {@code COLUMN_FIELD_VALUE}，同一个值），而"工具常量拼出来的 SQL"会让本机用例没法直接比对这一句
     * （同库 {@code SQL_INSERT_SCHEMA_VERSION} 的注释里写着同一条理由）。
     */

    /**
     * {@code default} 去重写回的**专用锁**（理由见类注释「并发」）。
     *
     * <p>它保护的是 {@link #getListMusics} 里 {@code default} 分支的**整段**
     * "SELECT → 判重 → DELETE ×2 → INSERT ×2N → setTransactionSuccessful"，
     * 不保护非 default 的读（那些没有 read-modify-write）。
     * ⚠️ 它与 {@link RainMusicStoreLock#WRITE_LOCK}（SharedPreferences）**没有**任何关系。
     */
    private static final Object DEFAULT_QUEUE_MERGE_LOCK = new Object();

    /**
     * 合并成功那条警告的节流窗口（毫秒）。取 60 秒：队列修好之后就不会再进这一支
     * （下一次读没有重复），这个窗口只在"还有别的写者反复把队列弄脏"时起作用。
     */
    private static final long QUEUE_MERGED_WARN_WINDOW_MS = 60_000L;

    /**
     * "已去重并写回"那条警告的节流闸门（{@link RainMusicLogThrottle} 是线程安全的）。
     *
     * <p>签名 = {@code listId | 行数 | 重复数 | 前几条重复的键}（见 {@link #queueMergedSignature}）。
     */
    private static final RainMusicLogThrottle QUEUE_MERGED_WARN =
        new RainMusicLogThrottle(QUEUE_MERGED_WARN_WINDOW_MS);

    /**
     * "meta 列是 NULL"那条警告的节流闸门 —— 与上面那条**分开**计数：两件事互不相干，
     * 共用一个闸门会让后发生的那件事被前一件的窗口吃掉。
     *
     * <p>为什么要节流：{@code meta} 是 {@code TEXT NOT NULL}，出现 NULL 说明那一行被写坏了；
     * 坏行**每次读都会命中**，不节流就是每次读都刷一条。
     */
    private static final RainMusicLogThrottle META_NULL_WARN =
        new RainMusicLogThrottle(QUEUE_MERGED_WARN_WINDOW_MS);

    /** 警告里最多列几条重复样例（再多就把 logcat 淹了）。 */
    private static final int QUEUE_MERGED_WARN_EXAMPLES = 3;
    /** 警告里每个字段最长打多少字符（人名/曲名可能极长，logcat 一条有上限）。 */
    private static final int QUEUE_MERGED_WARN_FIELD_LIMIT = 40;

    private static final String TAG = "RainMusicListMusicGet";

    private RainMusicListMusicGetChannels() {}

    /**
     * 注册这一条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 {@code setEmitter}、
     * 第一刀到第六刀的 {@code register} 同一处、同一时序理由：必须在渲染层第一次 invoke 之前完成，
     * 否则真机上就是 {@code IPC_CHANNEL_UNSUPPORTED}）。
     *
     * <p>与前面几刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicListMusicGetChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_MUSIC_GET, (args, ctx) -> getListMusics(requireContext(plugin), args));
        // ⚠️ 这里**只打表名**、不调 getDatabasePath()：load() 阶段 Context 可能还没有
        // （所以 Context 一律留到 handler 调用时再取）。绝对路径由 open() 在真机上打进错误信息。
        Logger.info(
            TAG,
            "P0-2 第七刀-A + 第七刀-B（快照）：已注册 " + CHANNEL_MUSIC_GET + "（落点 " + RainMusicDatabase.DATABASE_NAME +
            " 的 \"" + RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + "\" 表 LEFT JOIN \"" +
            TABLE_MY_LIST_MUSIC_INFO_ORDER + "\" 表，schema 版本 " +
            RainMusicDatabase.SCHEMA_VERSION_TEXT + "；\"" + LIST_ID_DEFAULT +
            "\" 检出重复时会在**同一个事务**里去重写回（第一步 = 条件插入 \"" + QUEUE_RESTORE_SNAPSHOT_KEY +
            "\" 合并前身份快照，然后 DELETE ×2 + INSERT ×2N），其它 listId 一律纯读；" +
            "resolvePlaybackQueueRestoreIndex / completePlaybackQueueRestore 仍不做，快照当前没有消费者）"
        );
    }

    // ------------------------------------------------------------------ 通道实现

    /**
     * {@code player_list_music_get}：读某个歌单里的歌曲（含 {@code meta} 的对象化），
     * 并在 {@code default} 上做去重合并 + 单事务写回。
     *
     * @param args {@code args[0]} = {@code listId}（裸字符串，**不是** {@code {listId}}，契约 :107）
     * @return 一个 {@link JSONArray}，元素形状 = {@code Rain.Music.MusicInfo}
     *         （{@code id/name/singer/source/interval/meta} 六个键，{@code meta} 是**对象**）；
     *         这个歌单是空的（或没有这个歌单）时是**空数组**（那才是"空"的正确取值）；
     *         {@code default} 上有重复并写回成功时，是**去重后的**那一份（与桌面 :201 同形）
     * @throws IllegalArgumentException 参数不是字符串 / 缺参数
     * @throws IllegalStateException    库打不开 / 表缺失 / 查询失败 / meta 坏 / **写回失败**
     *                                  （全都不返回"看起来成功"的东西）
     */
    private static Object getListMusics(Context context, List<Object> args) {
        String listId = readBareString(args, CHANNEL_MUSIC_GET);

        if (listId == null) {
            // 桌面把 null 绑成 SQL NULL ⇒ `WHERE mInfo.listId=NULL` 恒不成立 ⇒ []。
            // 这里直接给同一个值，不去绑 NULL（Android 的 String[] 绑定不接受 null 元素，
            // 理由与第五刀 RainMusicListMusicChannels 的 readBareString 注释同款）。
            Logger.debug(
                TAG,
                CHANNEL_MUSIC_GET + "：listId 是 null ⇒ 直接返回 []" +
                "（与桌面把 null 绑成 SQL NULL 的结果逐字等价；本通道不把 null 当参数错误）"
            );
            return new JSONArray();
        }

        if (!LIST_ID_DEFAULT.equals(listId)) {
            // 普通歌单 / temp：与第六刀**逐字相同**的纯读路径 —— 不进锁、不判重、一条写语句都不发。
            return readListMusics(context, listId, false);
        }

        // default：整段 read-modify-write 在这把专用锁里（见类注释「并发」）。
        // 临界区必须从 SELECT 之前开始，否则两次并发读会各自读到脏队列、各自写一遍。
        synchronized (DEFAULT_QUEUE_MERGE_LOCK) {
            return readListMusics(context, listId, true);
        }
    }

    /**
     * 读一个歌单的全部行，并按需在 {@code default} 上做去重写回。
     *
     * @param mergeDefaultQueue {@code true} ⇒ 读完之后判重、必要时在**同一个事务**里写回
     *                          （第一步 = 条件插入合并前快照），并返回去重后的列表；
     *                          {@code false} ⇒ 纯读（第六刀的行为）
     */
    private static Object readListMusics(Context context, String listId, boolean mergeDefaultQueue) {
        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO);
        List<MusicInfoRow> rows = new ArrayList<>();
        JSONArray musics;
        JSONArray merged = null;
        Set<RainMusicPlaybackQueueKey.MusicRow> dropped = null;
        String restoreSnapshotText = null;
        int duplicateCount = 0;
        Cursor cursor = null;
        try {
            // 绑定顺序 = SQL 里 ? 出现的顺序：先 `ON … O.listId=?`，后 `WHERE mInfo.listId=?`。
            // 两处是**同一个值**（桌面那句 SQL 两处都是 @listId）。
            cursor = db.rawQuery(SQL_MUSIC_BY_LIST_ID, new String[] { listId, listId });

            int idIndex = cursor.getColumnIndexOrThrow(COLUMN_ID);
            int nameIndex = cursor.getColumnIndexOrThrow(COLUMN_NAME);
            int singerIndex = cursor.getColumnIndexOrThrow(COLUMN_SINGER);
            int sourceIndex = cursor.getColumnIndexOrThrow(COLUMN_SOURCE);
            int intervalIndex = cursor.getColumnIndexOrThrow(COLUMN_INTERVAL);
            int metaIndex = cursor.getColumnIndexOrThrow(COLUMN_META);

            while (cursor.moveToNext()) {
                String id = cursor.getString(idIndex);
                rows.add(new MusicInfoRow(
                    id,
                    cursor.getString(nameIndex),
                    cursor.getString(singerIndex),
                    cursor.getString(sourceIndex),
                    // interval 是 string | null（src/common/types/music.d.ts:45）：NULL 要原样留着，
                    // 组装 JSON 时写成 JSON null、写回时绑成 SQL NULL。
                    cursor.getString(intervalIndex),
                    // ⚠️ 每一行都解析（含即将被删掉的重复行）：桌面的 JSON.parse 也是先对**所有**行
                    // 做完 map 才去重的，见类注释「meta」最后一段。
                    parseMeta(id, cursor.getString(metaIndex))
                ));
            }

            musics = toJsonArray(rows, null);

            if (mergeDefaultQueue) {
                List<RainMusicPlaybackQueueKey.MusicRow> keyRows = new ArrayList<>(rows.size());
                for (MusicInfoRow row : rows) keyRows.add(row.keyRow);
                List<RainMusicPlaybackQueueKey.MusicRow> duplicates =
                    RainMusicPlaybackQueueKey.findDuplicates(keyRows);
                if (!duplicates.isEmpty()) {
                    // findDuplicates 返回的是 rows 里**同一个引用** ⇒ 用身份集合筛掉被删的行
                    // （MusicRow 没有 equals，也不该为这件事去改那个类）。
                    dropped = Collections.newSetFromMap(
                        new IdentityHashMap<RainMusicPlaybackQueueKey.MusicRow, Boolean>()
                    );
                    dropped.addAll(duplicates);
                    duplicateCount = duplicates.size();
                    // 合并**前**的身份快照：桌面 index.ts:198 的 targetList.map(({id,name,singer}) => …)
                    // —— targetList 就是刚刚读到的**全部**行（含马上要被删掉的重复行）。
                    // 采集在这里、**插入**在事务里（见 overwriteDefaultQueue）：与桌面
                    // "先造数组、再进 overwriteMusicInfo 的事务"同形。
                    // ⚠️ 组装失败算**读**失败（它就在这个 try 里）：桌面那句 map/JSON.stringify 也在
                    // getListMusics 里、抛出去同样是"这一次读失败"，两边同形。
                    restoreSnapshotText = toRestoreSnapshotText(rows);
                    // 去重后的那一份也在这里组装（仍在"读"这一段的 try 里）：
                    // 组装失败算读失败，而**写回**的失败绝不能落到这个 catch 里
                    // （那会把"写回失败"误报成"读失败"，见 writeBackFailureMessage）。
                    merged = toJsonArray(rows, dropped);
                }
            }
        } catch (IllegalStateException ex) {
            // 目前这一支只可能来自 parseMeta（消息里已经点名是哪首歌、meta 长什么样），
            // 再包一层"读 my_list_music_info 失败"只会把真正的原因埋掉。
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException(
                readFailureMessage(SQL_MUSIC_BY_LIST_ID, ex) +
                "本通道**不会**返回空数组假装「这个歌单是空的」。",
                ex
            );
        } finally {
            if (cursor != null) cursor.close();
        }

        if (dropped == null) {
            // 没有重复（或非 default）⇒ 一条写语句都不发。这正是第六刀的行为。
            return musics;
        }

        // 写回。它**不在**上面那个 try 里：失败必须以"写回失败"的面目抛出去，而不是被
        // readFailureMessage 包成"读失败"。
        List<MusicInfoRow> kept = new ArrayList<>(rows.size() - duplicateCount);
        for (MusicInfoRow row : rows) {
            if (!dropped.contains(row.keyRow)) kept.add(row);
        }
        overwriteDefaultQueue(db, listId, kept, rows.size(), duplicateCount, restoreSnapshotText);

        // 写回**成功之后**才说话（失败会抛出去，由那条异常点名两半）。
        warnQueueMerged(listId, rows.size(), kept.size(), dropped);

        // 返回去重后的那一份（桌面 :201 的 targetList = merged）。
        return merged;
    }

    // ------------------------------------------------------------------ 写回（第七刀-A + 第七刀-B 的快照）

    /**
     * 把去重后的列表写回库：桌面 {@code dbHelper.ts:337-349} 的**四步**，全部在同一个事务里。
     *
     * <pre>
     * beginTransaction()
     *   if (!hasQueueRestoreSnapshot(db))                                     ← 条件（:337 的后半句）
     *     INSERT INTO db_info (field_name, field_value)                       ← :338
     *       VALUES ('playback_queue_startup_restore', 合并前的 (id,name,singer) 列表)
     *   DELETE FROM "main"."my_list_music_info"       WHERE "listId"=?         ← :340
     *   DELETE FROM "main"."my_list_music_info_ORDER" WHERE "listId"=?         ← :341
     *   for (order = 0 …) { INSERT info; INSERT order }                        ← :342-349
     * setTransactionSuccessful()
     * endTransaction()          ← 未标记成功 ⇒ 整体回滚（快照那一行也一起回滚）
     * </pre>
     *
     * <p>快照那一步在两条 DELETE **之前**：它记的是**合并前**的状态
     * （内容由 {@link #toRestoreSnapshotText(List)} 在进事务之前从刚读到的 {@code rows} 采集）。
     * 条件只有"{@code db_info} 里还没有这份快照"—— {@code queueStartupRestorePending} 的替代方案
     * 与差异见类注释「快照」。
     *
     * @param restoreSnapshotText 合并前的 {@code (id, name, singer)} 列表的 JSON 文本；
     *                            调用方在 {@code duplicates} 非空时必定给出（非 null）
     * @throws IllegalStateException 任何一步失败（含快照那一句、含 {@code endTransaction()} 的提交失败）。
     *                               消息由 {@link #writeBackFailureMessage} 组装，同时点名两半
     */
    private static void overwriteDefaultQueue(
        SQLiteDatabase db,
        String listId,
        List<MusicInfoRow> kept,
        int readCount,
        int duplicateCount,
        String restoreSnapshotText
    ) {
        // 记"事务是否已经标记成功"：用于区分"回滚"（未标记成功时 endTransaction 一定回滚）
        // 与"提交阶段失败"（已标记成功之后 endTransaction 才抛）—— 后者本通道**不能**声称库还是 N 行。
        boolean commitStarted = false;
        // 快照那一行是否**已经写进事务**（用于让失败消息如实点名"回滚集合里有没有它"）。
        // ⚠️ 只在 execSQL 返回之后才置 true：它抛错时那一行并没有落进事务。
        boolean snapshotInserted = false;
        try {
            db.beginTransaction();
            try {
                // 第 0 步（第七刀-B）：条件插入"合并前身份快照"。
                // 必须在两条 DELETE **之前** —— 快照记的是合并前的行序与身份
                // （内容已经在锁内、进事务之前从刚读到的 rows 采集好，见 restoreSnapshotText）。
                if (!hasQueueRestoreSnapshot(db)) {
                    db.execSQL(
                        SQL_INSERT_QUEUE_RESTORE_SNAPSHOT,
                        new Object[] { QUEUE_RESTORE_SNAPSHOT_KEY, restoreSnapshotText }
                    );
                    snapshotInserted = true;
                }
                db.execSQL(SQL_DELETE_MUSIC_INFO_BY_LIST_ID, new Object[] { listId });
                db.execSQL(SQL_DELETE_MUSIC_ORDER_BY_LIST_ID, new Object[] { listId });
                for (int order = 0; order < kept.size(); order++) {
                    MusicInfoRow row = kept.get(order);
                    db.execSQL(SQL_INSERT_MUSIC_INFO, row.insertArgs(listId));
                    // order = 去重后列表里的下标（桌面 toDBMusicInfo 的 `order: offset + index`，offset 默认 0）。
                    db.execSQL(SQL_INSERT_MUSIC_ORDER, new Object[] { listId, row.id, order });
                }
                db.setTransactionSuccessful();
                commitStarted = true;
            } finally {
                // 无论上面怎么退出：未 setTransactionSuccessful ⇒ 回滚；已标记 ⇒ 提交。
                db.endTransaction();
            }
        } catch (Exception ex) {
            throw new IllegalStateException(
                writeBackFailureMessage(
                    listId, readCount, kept.size(), duplicateCount, snapshotInserted, commitStarted, ex
                ),
                ex
            );
        }
    }

    /**
     * {@code db_info} 里是否**已经**有这份播放队列恢复快照（桌面 {@code dbHelper.ts:337} 的
     * {@code !await getPlaybackQueueRestoreSnapshot()} 那一半，也是
     * {@code queueStartupRestorePending} 的替代 —— 见类注释「快照」）。
     *
     * <p>只判"这一行在不在"：{@code moveToFirst()} 为真即可，**不读值、不解析**
     * （差异见类注释「快照」第 2 条）。游标在 {@code finally} 里关（与读歌单那条路径同一形状）。
     *
     * <p>它在**事务里**被调用（{@code overwriteDefaultQueue}）：桌面那一句也在
     * {@code db.transaction} 的函数体里。这样"查在不在 → 插"与 DELETE / INSERT 是同一个原子段，
     * 同一个进程里的并发合并被 {@link #DEFAULT_QUEUE_MERGE_LOCK} 排成先后两次 ⇒ 快照只插一次。
     *
     * @throws RuntimeException 查询本身失败（列漂移 / 表缺失 / 游标异常）——
     *                          与桌面一样**不吞**：它会让整次合并失败并一起回滚
     */
    private static boolean hasQueueRestoreSnapshot(SQLiteDatabase db) {
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(
                SQL_SELECT_QUEUE_RESTORE_SNAPSHOT,
                new String[] { QUEUE_RESTORE_SNAPSHOT_KEY }
            );
            return cursor.moveToFirst();
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /**
     * 把**合并前**读到的那些行采集成本次事务要写进 {@code db_info} 的快照文本。
     *
     * <p>形状逐字对齐桌面 {@code index.ts:198}：
     * {@code targetList.map(({ id, name, singer }) => ({ id, name, singer }))} ——
     * 一个**数组**，每个元素**只有这三个键**（不含 {@code source / interval / meta}），
     * 顺序 = 读到的行序，{@code id/name/singer} 都是字符串。桌面把它交给
     * {@code dbHelper.ts:338} 的 {@code JSON.stringify(...)}；这里用 {@code org.json} 的
     * {@link JSONArray#toString()} 得到同形状的文本。
     *
     * @param rows 这一次读到的**全部**行（含马上要被删掉的重复行）
     */
    private static String toRestoreSnapshotText(List<MusicInfoRow> rows) throws JSONException {
        JSONArray snapshot = new JSONArray();
        for (MusicInfoRow row : rows) snapshot.put(row.toSnapshotJson());
        return snapshot.toString();
    }

    /**
     * 写回失败的消息：把"读"和"写"两半分开点名（这是本刀敢做写回的前提，见类注释「失败语义」）。
     *
     * <p>它说的是六件事：读到 N 行**成功** / 写回**失败** / 已回滚 / 库仍是写回前的 N 行 /
     * **快照那一句在不在回滚集合里** / 原始异常。
     *
     * @param snapshotInserted 快照那一行是否真的发出去过（{@code true} ⇒ 它也在这次事务的回滚集合里）
     * @param commitStarted {@code true} ⇒ 失败发生在 {@code setTransactionSuccessful()} 之后的
     *                      {@code endTransaction()} 提交阶段：那时**不能**断言"库仍是 N 行"
     *                      （SQLite 提交失败时通常会回滚，但本通道不在错误路径上再发一次查询去"证明"它
     *                      —— 那会在报告错误时再抛一次）
     */
    private static String writeBackFailureMessage(
        String listId,
        int readCount,
        int keptCount,
        int duplicateCount,
        boolean snapshotInserted,
        boolean commitStarted,
        Exception ex
    ) {
        StringBuilder message = new StringBuilder();
        message.append(CHANNEL_MUSIC_GET).append("：默认播放队列的去重写回失败（\"")
            .append(FIELD_LIST_ID).append("\"=\"").append(listId).append("\"，落点 ")
            .append(RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO).append(" / ")
            .append(TABLE_MY_LIST_MUSIC_INFO_ORDER).append(" / ")
            .append(RainMusicDatabase.TABLE_DB_INFO).append("）。");
        message.append("**读到 ").append(readCount).append(" 行成功**（这一步没有出错；若读失败，")
            .append("走的是另一条消息、根本到不了这里），去重要删掉 ").append(duplicateCount)
            .append(" 条重复、留下 ").append(keptCount).append(" 条，但**写回失败**：")
            .append(describeException(ex)).append("。");
        if (commitStarted) {
            message.append("失败发生在 setTransactionSuccessful() 之后的 endTransaction() 提交阶段：")
                .append("事务**已标记成功**，本通道无法在不追加一次查询的前提下证明库的最终行数")
                .append("（SQLite 提交失败时通常会回滚，但这里不猜）。");
        } else {
            message.append("**已回滚**（未标记成功 ⇒ endTransaction 回滚）。这个事务里的写是：")
                .append(snapshotInserted
                    ? "db_info 的快照 INSERT（\"" + QUEUE_RESTORE_SNAPSHOT_KEY + "\"，在两条 DELETE 之前） + "
                    : "（本次**没有**发出快照 INSERT —— 要么 db_info 里已经有那份快照，要么失败发生在它之前）+ ")
                .append("DELETE ").append(RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO).append(" / DELETE ")
                .append(TABLE_MY_LIST_MUSIC_INFO_ORDER).append(" / INSERT ×2×").append(keptCount)
                .append("，**全部撤销** ⇒ **库仍是写回前的 ").append(readCount).append(" 行**，")
                .append("db_info 里也不会留下半份快照（桌面 tests/unit/playback-queue.test.cjs:212-220 证明同一条）。");
        }
        message.append("本通道**不会**吞掉写回错误、把「读到了但没修好」伪装成一次成功的读：")
            .append("整条调用以 ok:false 结束（IPC_HANDLER_FAILED），渲染层那条 invoke 直接 reject ⇒ ")
            .append("setMusicList 不被调用、不会缓存这份列表（桌面 src/renderer/store/list/listManage/")
            .append("rendererListManage.ts:73-74），下一次读会重新看到同样的重复。")
            .append("吞掉它会让渲染层缓存一份库里并不存在的列表，缓存与库**永久分叉**。");
        return message.toString();
    }

    // ------------------------------------------------------------------ meta

    /**
     * 把 {@code my_list_music_info."meta"}（TEXT）解析成 JSON —— 桌面那一句是
     * {@code meta: JSON.parse(info.meta)}（{@code modules/list/index.ts:192}）。
     *
     * @param musicId 只用于错误消息（点名是哪首歌的 meta 坏了）
     * @param text    库里的文本；{@code null}（列被写坏）⇒ JSON {@code null}
     *                （与 {@code JSON.parse(null)} 等价，见类注释的表）
     * @return 解析出来的 JSON 对象；列是 {@code NULL} 时返回 {@link JSONObject#NULL}
     * @throws IllegalStateException 不是合法 JSON，或者顶层不是对象（**不返回 null 蒙过去**）
     */
    private static Object parseMeta(String musicId, String text) {
        if (text == null) {
            // 与合并警告一样要节流：坏行每次读都会命中（见 META_NULL_WARN 的注释）。
            if (META_NULL_WARN.shouldLog(COLUMN_META + "-null|" + textOrNull(musicId), System.currentTimeMillis())) {
                Logger.warn(
                    TAG,
                    CHANNEL_MUSIC_GET + "：music id=\"" + textOrNull(musicId) + "\" 的 \"" + COLUMN_META +
                    "\" 列是 NULL（表结构是 TEXT NOT NULL，只可能是被人写坏的）。" +
                    "桌面此时是 JSON.parse(null) ⇒ null，本通道同样给 JSON null（不抛错，两边逐字等价）；" +
                    "写回时它会被序列化成 \"null\"（与桌面的 JSON.stringify(null) 一致）。" +
                    "本条警告节流 " + (QUEUE_MERGED_WARN.windowMs() / 1000) + " 秒一次。"
                );
            }
            return JSONObject.NULL;
        }
        try {
            return new JSONObject(text);
        } catch (JSONException ex) {
            throw new IllegalStateException(
                CHANNEL_MUSIC_GET + "：music id=\"" + textOrNull(musicId) + "\" 的 \"" + COLUMN_META +
                "\" 列不是合法的 JSON 对象（长度 " + text.length() + "，前 80 字符=" + preview(text) + "）：" +
                ex.getMessage() +
                "。桌面那一句是 JSON.parse(info.meta)，坏 meta 同样会让**整条读**失败 ⇒ 本通道照抛，" +
                "不会跳过这一行、也不会把它当成一次成功的读（跳过会让「歌单少了几首」看起来像正常结果）。",
                ex
            );
        }
    }

    // ------------------------------------------------------------------ 合并日志

    /**
     * 去重写回**成功之后**打一条点名警告（节流）。
     *
     * <p>第六刀那条"Android 本刀只读、不写回"的警告在这里被**替换**掉了：它现在会说谎
     * （库里已经不是脏的了）。这一条只陈述**已经发生的事**：检出 K 条重复、已去重并写回 N → M 行，
     * 并点名"本刀不含 db_info 快照"（那是唯一还没做的那半）。
     *
     * @param listId  调用方已经确认等于 {@code 'default'}（这里再判一次，防止将来被别处复用）
     * @param readCount  这一次读出来的行数
     * @param keptCount  去重后剩下的行数（= 写回后的行数）
     * @param dropped    会被删掉的那些行（`findDuplicates` 的结果，**同一个引用集合**）
     */
    private static void warnQueueMerged(
        String listId,
        int readCount,
        int keptCount,
        Set<RainMusicPlaybackQueueKey.MusicRow> dropped
    ) {
        if (!LIST_ID_DEFAULT.equals(listId)) return;
        if (dropped == null || dropped.isEmpty()) return;

        // 集合是无序的（IdentityHashMap）⇒ 按**读到的顺序**取样例本来更自然，但这里只需要一个稳定指纹：
        // 排序后取前几条即可（桶顺序对同一个输入稳定，但不同 JVM 不保证，所以显式排序）。
        List<RainMusicPlaybackQueueKey.MusicRow> duplicates = new ArrayList<>(dropped);
        duplicates.sort((left, right) -> left.key().compareTo(right.key()));

        String signature = queueMergedSignature(listId, readCount, duplicates);
        if (!QUEUE_MERGED_WARN.shouldLog(signature, System.currentTimeMillis())) return;

        Logger.warn(
            TAG,
            CHANNEL_MUSIC_GET + "：默认播放队列（\"" + FIELD_LIST_ID + "\"=\"" + LIST_ID_DEFAULT + "\"）里有 " +
            duplicates.size() + " 条重复（共 " + readCount + " 行）：" + describeDuplicates(duplicates) +
            "。已按桌面的规则去重（src/common/utils/playbackQueue.ts:10-22，保留第一条完整记录、不跨源合并 meta）" +
            "并在**同一个事务**里写回：" + readCount + " → " + keptCount + " 行" +
            "（四步对齐 src/main/worker/dbService/modules/list/dbHelper.ts:337-349：第一步 = **条件**插入" +
            " \"" + QUEUE_RESTORE_SNAPSHOT_KEY + "\" 快照（内容 = 合并前的 (id,name,singer) 列表，" +
            "只在 db_info 里还没有它时插一份），然后 DELETE " +
            RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + " / DELETE " + TABLE_MY_LIST_MUSIC_INFO_ORDER +
            " / INSERT ×2×" + keptCount + "）。⚠️ 与桌面的差别：本刀**没有** queueStartupRestorePending" +
            " 那个进程内标志，条件退化成\"db_info 里还没有快照\"（理由与差异见类注释「快照」）；" +
            "resolvePlaybackQueueRestoreIndex / completePlaybackQueueRestore **不做**，所以这份快照目前**只写不读**。" +
            "本条警告节流 " + (QUEUE_MERGED_WARN.windowMs() / 1000) + " 秒一次，队列内容变了会立刻再报一条" +
            "（判定用的键与 JS 的 getPlaybackQueueMusicKey 逐字节相同，见 RainMusicPlaybackQueueKey 的注释）。"
        );
    }

    /**
     * 警告的指纹：{@code listId | 行数 | 重复数 | 前 N 条重复的键}。
     *
     * <p>为什么这么取：同一个脏状态被反复命中时签名不变 ⇒ 被节流器挡住；
     * 行数变了、重复数变了、或者换了一批重复的歌 ⇒ 签名变化 ⇒ 立刻再报一条
     * （新的脏状态是新消息，不该被上一个窗口吃掉）。
     */
    private static String queueMergedSignature(
        String listId,
        int total,
        List<RainMusicPlaybackQueueKey.MusicRow> duplicates
    ) {
        StringBuilder builder = new StringBuilder();
        builder.append(listId).append('|').append(total).append('|').append(duplicates.size());
        int examples = Math.min(QUEUE_MERGED_WARN_EXAMPLES, duplicates.size());
        for (int i = 0; i < examples; i++) {
            builder.append('|').append(duplicates.get(i).key());
        }
        return builder.toString();
    }

    /** 最多列 {@link #QUEUE_MERGED_WARN_EXAMPLES} 条重复样例（每条只打 id / name / singer）。 */
    private static String describeDuplicates(List<RainMusicPlaybackQueueKey.MusicRow> duplicates) {
        StringBuilder builder = new StringBuilder();
        int examples = Math.min(QUEUE_MERGED_WARN_EXAMPLES, duplicates.size());
        for (int i = 0; i < examples; i++) {
            if (i > 0) builder.append("；");
            RainMusicPlaybackQueueKey.MusicRow row = duplicates.get(i);
            builder.append("id=").append(quote(row.id))
                .append(" name=").append(quote(row.name))
                .append(" singer=").append(quote(row.singer));
        }
        if (duplicates.size() > examples) {
            builder.append("；…还有 ").append(duplicates.size() - examples).append(" 条");
        }
        return builder.toString();
    }

    /** 日志里的一个字符串字段：{@code null} 打成 {@code null}，过长则截断（logcat 一条有上限）。 */
    private static String quote(String value) {
        if (value == null) return "null";
        return "\"" + (value.length() > QUEUE_MERGED_WARN_FIELD_LIMIT
            ? value.substring(0, QUEUE_MERGED_WARN_FIELD_LIMIT) + "…"
            : value) + "\"";
    }

    private static String textOrNull(String value) {
        return value == null ? "null" : value;
    }

    /** 只用于错误消息的极短预览，且把换行压平（否则 logcat 里一条错误会散成好几行）。 */
    private static String preview(String text) {
        String flat = text.replaceAll("\\s+", " ");
        String quoted = "\"" + (flat.length() > 80 ? flat.substring(0, 80) + "…" : flat) + "\"";
        return quoted;
    }

    /** 原始异常的名字 + 消息（消息可能是 {@code null}）—— 写回失败的消息里必须带上它。 */
    private static String describeException(Exception ex) {
        String message = ex.getMessage();
        return message == null ? ex.getClass().getName() : ex.getClass().getName() + "：" + message;
    }

    // ------------------------------------------------------------------ 一行的模型

    /**
     * 这一次读出来的**一行**：既给它算去重键（{@link #keyRow}），也给它组装 JSON 与写回的值。
     *
     * <p>为什么不用 {@link RainMusicPlaybackQueueKey.MusicRow} 直接当行模型：那个类只装
     * {@code id / name / singer}（去重键需要的三列），而写回需要**整条记录**
     * （{@code source / interval / meta}）—— 桌面的 {@code toDBMusicInfo(merged, listId)} 也是整条写回。
     * 这里组合而不是继承：{@code MusicRow} 是 {@code final}，而且改它就要动
     * {@link RainMusicPlaybackQueueKey}（那个类有真 JVM 的差分用例守着，本刀不动它）。
     */
    private static final class MusicInfoRow {

        final String id;
        final String name;
        final String singer;
        final String source;
        /** {@code interval} 列（{@code string | null}）；写回时 {@code null} ⇒ SQL NULL。 */
        final String interval;
        /** 解析后的 {@code meta}（{@link JSONObject} 或 {@link JSONObject#NULL}；**绝不**是 Java null）。 */
        final Object meta;
        /** 去重键用的三列（与 {@code findDuplicates} 的入参是同一批对象，身份判定依赖这一点）。 */
        final RainMusicPlaybackQueueKey.MusicRow keyRow;

        MusicInfoRow(String id, String name, String singer, String source, String interval, Object meta) {
            this.id = id;
            this.name = name;
            this.singer = singer;
            this.source = source;
            this.interval = interval;
            this.meta = meta;
            this.keyRow = new RainMusicPlaybackQueueKey.MusicRow(id, name, singer);
        }

        /** 桌面的 {@code index.ts:185-194} 那张 map：六个键，**没有** listId / order。 */
        JSONObject toJson() throws JSONException {
            JSONObject item = new JSONObject();
            item.put(COLUMN_ID, jsonValue(id));
            item.put(COLUMN_NAME, jsonValue(name));
            item.put(COLUMN_SINGER, jsonValue(singer));
            item.put(COLUMN_SOURCE, jsonValue(source));
            // interval 是 string | null（src/common/types/music.d.ts:45）：NULL 必须写成 JSON null。
            item.put(COLUMN_INTERVAL, jsonValue(interval));
            // meta 必须是**对象**（桌面那一句是 JSON.parse，见类注释「meta」）。
            item.put(COLUMN_META, meta);
            return item;
        }

        /**
         * 快照里的一个元素：桌面 {@code index.ts:198} 的 {@code ({ id, name, singer }) => ({ id, name, singer })}。
         *
         * <p><b>只有这三个键</b>（与 {@link #toJson()} 的六个键**不同**：{@code source / interval / meta}
         * 不进快照 —— 桌面那个 map 就是只挑三列），顺序也是 {@code id, name, singer}。
         */
        JSONObject toSnapshotJson() throws JSONException {
            JSONObject item = new JSONObject();
            item.put(COLUMN_ID, jsonValue(id));
            item.put(COLUMN_NAME, jsonValue(name));
            item.put(COLUMN_SINGER, jsonValue(singer));
            return item;
        }

        /**
         * 写回时用的 {@code meta} 文本 = 桌面 {@code toDBMusicInfo} 的 {@code JSON.stringify(info.meta)}。
         *
         * <p>{@code String.valueOf} 在两种形态上的行为正是要的：
         * {@link JSONObject} ⇒ 紧凑 JSON 文本；{@link JSONObject#NULL} ⇒ {@code "null"}
         * （与 JS 的 {@code JSON.stringify(null)} 一致）。⚠️ 与 JS 的差别见类注释「语义差异」第 3 条。
         */
        String metaText() {
            return String.valueOf(meta);
        }

        /**
         * {@code SQL_INSERT_MUSIC_INFO} 的绑定数组 —— 顺序必须与那句 SQL 的列清单一致：
         * {@code id, listId, name, singer, source, interval, meta}（{@code statements.ts:87-88}）。
         */
        Object[] insertArgs(String listId) {
            return new Object[] { id, listId, name, singer, source, interval, metaText() };
        }
    }

    /**
     * 把行组装成 JSON 数组；{@code dropped} 非空时跳过（身份判定）那些被去重删掉的行。
     *
     * @param dropped {@code null} ⇒ 全部保留（纯读）；否则只保留不在这个**身份**集合里的行
     */
    private static JSONArray toJsonArray(
        List<MusicInfoRow> rows,
        Set<RainMusicPlaybackQueueKey.MusicRow> dropped
    ) throws JSONException {
        JSONArray array = new JSONArray();
        for (MusicInfoRow row : rows) {
            if (dropped != null && dropped.contains(row.keyRow)) continue;
            array.put(row.toJson());
        }
        return array;
    }

    // ------------------------------------------------------------------ 参数

    /**
     * 取 {@code args[0]} 作为**裸字符串**（本通道的参数形状与第五刀的
     * {@code player_list_music_get_list_ids} 同款：桌面是 {@code async({ params: listId })}）。
     *
     * <p>缺参数 / 类型不对 ⇒ 抛错；{@code null} ⇒ 返回 {@code null}（由调用方短路成"空列表"）。
     * 与 {@link RainMusicListMusicChannels} 的同名方法逐句同形（每一刀一个文件，各自带一份，
     * 这是本仓库既有的做法：{@code requireContext} / {@code jsonValue} 也是这样重复的）。
     */
    private static String readBareString(List<Object> args, String channel) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                channel + " 需要一个字符串参数 listId，收到 " + describeArgs(args) +
                "（渲染层的调用形状见 src/renderer/store/list/listManage/rendererListManage.ts:73 的 " +
                "rendererInvoke(channel, listId) ⇒ 信封里 args=[listId]；契约 docs/android/ipc-contract.md:107）"
            );
        }
        Object first = args.get(0);
        if (first == JSONObject.NULL) return null;
        if (!(first instanceof String)) {
            throw new IllegalArgumentException(
                channel + " 的参数必须是字符串，收到 " + first.getClass().getName() + "：" + describeArgs(args) +
                "（桌面在缺键时抛 TypeError「不能绑定 undefined」，本通道把「不是字符串」也当成失败：" +
                "静默返回 [] 会让界面显示「这个歌单是空的」这种确定的错答案）"
            );
        }
        if (args.size() > 1) {
            // 桌面 {@code async({ params: listId })} 只读第一个参数；多传的忽略（不失败），与前面几刀同一取舍。
            Logger.debug(TAG, channel + "：收到 " + args.size() + " 个参数，只读 args[0]（桌面同样只读 params）");
        }
        return (String) first;
    }

    // ------------------------------------------------------------------ 工具

    /** 查询失败的统一消息（SQL 压成一行，方便在 logcat 里一眼看到是哪条语句）。 */
    private static String readFailureMessage(String sql, Exception ex) {
        return "读 \"" + RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + "\" 失败（" +
            sql.trim().replaceAll("\\s+", " ") + "）：" + ex.getMessage() + "。";
    }

    /**
     * Java {@code null} → {@code JSONObject.NULL}。
     *
     * <p>为什么必要（与第一 / 三 / 四 / 五 / 六刀是同一件事）：{@code org.json} 的 {@code put(name, null)}
     * 会**删掉这个键**；而桌面 {@code index.ts:185-194} 构造的那个对象里，{@code interval} 是
     * {@code string | null}（{@code music.d.ts:45}），NULL 列必须原样写成 JSON {@code null}。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    /** 只打参数**类型**，不打内容（与第三 / 五 / 六刀 {@code describeArgs} 同款）。 */
    private static String describeArgs(List<Object> args) {
        if (args == null) return "null";
        StringBuilder builder = new StringBuilder("[");
        for (int i = 0; i < args.size(); i++) {
            if (i > 0) builder.append(", ");
            Object value = args.get(i);
            builder.append(value == null ? "null" : value.getClass().getSimpleName());
        }
        return builder.append("]").toString();
    }

    private static Context requireContext(RainMusicIpcPlugin plugin) {
        Context context = plugin.getContext();
        if (context == null) {
            throw new IllegalStateException(
                "拿不到 Context（插件还没挂上 Bridge/Activity）：无法打开 " + RainMusicDatabase.DATABASE_NAME
            );
        }
        Context appContext = context.getApplicationContext();
        return appContext == null ? context : appContext;
    }
}
