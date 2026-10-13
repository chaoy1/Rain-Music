package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Android 移植 · 歌单写通道（**P0-2 第八刀**起，本文件逐刀加通道）。
 *
 * <pre>
 * 第八刀  player_list_update   invoke,  args=[listInfos[]]      → void   （契约 docs/android/ipc-contract.md:104）
 *         player_list_update   event,   args=[listInfos[]]               （主进程 → 渲染层，裸数组；契约同一条，
 *                                                                          第八刀把它从"单向"改成"双向"）
 * 第九刀-a player_list_add     invoke,  args=[{position,listInfos}] → void （契约 :102）
 *         player_list_add      event,   args=[{position,listInfos}]       （主进程 → 渲染层，**对象**载荷；
 *                                                                          与 update / remove 的裸数组不同形）
 * 第十刀-a player_list_remove  invoke,  args=[ids[]]              → void （契约 :103）
 *         player_list_remove   event,   args=[ids[]]                      （主进程 → 渲染层，**裸数组**，
 *                                                                          与 update 同形、与 add 不同形）
 * </pre>
 *
 * <p>这一族（{@code player_list_*}）的写侧一共 5 条：{@code player_list_update}（第八刀）、
 * {@code player_list_add}（第九刀-a）与 {@code player_list_remove}（第十刀-a）已做；
 * {@code player_list_update_position} 与 {@code player_list_data_overwire} 各有各的形状
 * （前者是"一批 id 的 position 重排"、后者是整表覆盖），都不在本文件当前范围内。
 * 三条写通道（add / update / remove）**共用本文件**：这是刻意的 —— 见「{@code LIST_WRITE_LOCK}」。
 *
 * <p>⚠️ <b>现在有**三个** {@code synchronized (LIST_WRITE_LOCK)} 临界区</b>（改名一个、新建一个、
 * 删除一个），三处都在 {@code beginTransaction} 之前进入、在 {@code endTransaction} 之后退出；
 * 三次 {@code emitTo} 都在各自临界区**之外**、提交**之后**。
 *
 * <h2>形状（抄契约与桌面链，没有自己发明）</h2>
 *
 * <ol>
 *   <li><b>通道名</b>：{@code player}（模块前缀）+ {@code list_update}
 *       （{@code src/common/ipcNames.ts:26} 的 {@code PLAYER_EVENT_NAME.list_update}，
 *       拼名规则 {@code ipcNames.ts:171-176}）。</li>
 *   <li><b>渲染层 → 主进程（invoke）</b>：
 *       {@code updateUserList} {@code R:listManage:53-56} =
 *       {@code src/renderer/store/list/listManage/rendererListManage.ts:53-56}
 *       （{@code rendererInvoke<Rain.List.ListActionUpdate>(PLAYER_EVENT_NAME.list_update, data)}，
 *       {@code data} 先过一遍 {@code toRaw}）→
 *       主进程 {@code M:list:18-20} = {@code src/main/modules/commonRenderers/list/rendererEvent.ts:18-20}
 *       （{@code mainHandle<…>(PLAYER_EVENT_NAME.list_update, async({params: listInfos}) => …)}，
 *       {@code mainHandle} ⇒ 渲染层是 {@code rendererInvoke}，**请求 / 应答**）→
 *       {@code ListEvent.list_update}（{@code src/main/event/ListEvent.ts:71-75}）
 *       → {@code dbService.updateUserLists(lists)}。</li>
 *   <li><b>主进程 → 渲染层（广播，本刀必须做的那一半）</b>：
 *       {@code ListEvent.ts:73} 的 {@code this.emit('list_update', lists)}
 *       → {@code src/main/modules/commonRenderers/list/winRendererEvent.ts:15-17}
 *       （{@code sendEvent<Rain.List.ListActionUpdate>(PLAYER_EVENT_NAME.list_update, lists)}
 *       —— <b>裸数组</b>，不是 {@code {listInfos}}）
 *       → 渲染层 {@code rendererListManage.ts:189-191} 的
 *       {@code list_update = ({params: listInfos}) => userListsUpdate(listInfos)}，
 *       订阅在 {@code rendererListManage.ts:231}。</li>
 *   <li><b>参数 → 返回值</b>：{@code listInfos[]} → {@code void}（契约那一格）。
 *       两类调用方都只传一个数组：{@code useEditList.ts:32} 的改名
 *       {@code updateUserList([{...targetList, name}])}、
 *       {@code useShare.ts:78-86} 的导入改名。</li>
 * </ol>
 *
 * <h2>SQL 落点（逐字对齐阶段 2a）</h2>
 *
 * {@link #SQL_LIST_UPDATE} 抄 {@code src/main/worker/dbService/modules/list/statements.ts:56-62}
 * 的 {@code createListUpdateStatement()}：
 * <ul>
 *   <li><b>1 张表</b>：{@code "main"."my_list"}（{@code "main".} 前缀保留）；</li>
 *   <li><b>4 列</b>：{@code name} / {@code source} / {@code sourceListId} / {@code locationUpdateTime}
 *       —— 一个不多、一个不少。⚠️ <b>{@code SET} 里没有 {@code position}</b>：
 *       桌面的这一句原文里就没有它（位置由 {@code updateUserListsPosition} 那条通道单独管），
 *       而且 {@code my_list.position} 是 {@code INTEGER NOT NULL}（{@code tables.ts:134}、
 *       {@code RainMusicDatabase.DDL_MY_LIST}）—— 把"载荷里没有的列"顺手写成 {@code NULL}
 *       会在这一列上直接抛约束错误，所以"照抄 4 列"不是审美问题，是正确性问题；</li>
 *   <li>{@code WHERE "id"=@id} → {@code WHERE "id"=?}（better-sqlite3 的具名参数 → Android 的位置参数），
 *       绑定顺序就是它在 SQL 里出现的顺序（1…5）；</li>
 *   <li>表 / 列名与 {@code tables.ts:128-138} 的 {@code my_list} 一致；
 *       {@code tables.set('my_list', …)} 与 {@code RainMusicDatabase.DDL_MY_LIST} 逐字一致。</li>
 * </ul>
 *
 * <p><b>载荷里没带的列写 {@code NULL}</b>（{@code name} 除外，见下）：桌面的
 * {@code listUpdateStatement.run(list)} 是把整个 {@code list} 对象交给 better-sqlite3 去取
 * {@code @name} / {@code @source} / …；{@code source} / {@code sourceListId} /
 * {@code locationUpdateTime} 三列在 {@code tables.ts:132,133,135} 都是可空的，缺字段 ⇒ NULL 是
 * 这一列的正常取值。{@code name} 在 {@code tables.ts:131} 是 {@code TEXT NOT NULL}：
 * 缺 {@code name} 时本通道同样绑 NULL，于是 SQLite 的约束会**大声**抛错（回滚 + {@code ok:false}），
 * 而不是把歌单静默改成一个没有名字的东西 —— 这正是想要的形状。
 *
 * <p><b>事务</b>：抄 {@code dbHelper.ts:99-105} 的 {@code updateUserLists} —— 整批改名在
 * <b>一个</b>事务里（{@code beginTransaction} / {@code setTransactionSuccessful} /
 * {@code endTransaction}）。半批成功、半批失败是不允许的：渲染层的
 * {@code for (const info of listInfos)} 会按广播把整批都当成已生效。
 *
 * <h2>0 行命中 = 成功（幂等），不是错误</h2>
 *
 * {@code UPDATE … WHERE "id"=?} 命中 0 行时 SQLite **不报错**，{@code executeUpdateDelete()} 返回 0
 * —— 桌面 better-sqlite3 的 {@code .run()} 同样返回 {@code {changes: 0}} 且不抛错，桌面
 * {@code ListEvent.list_update} 也照样往渲染层发那条广播。所以：
 * <ul>
 *   <li>id 不在 {@code my_list} 里（别的窗口刚删掉、或从备份导入的旧 id）⇒ <b>成功</b>，
 *       并且**照样广播**（渲染层 {@code action.ts:83-84} 找不到这个 id 就静默返回，
 *       与桌面看到的行为一致）；</li>
 *   <li>本通道**不看** {@code executeUpdateDelete()} 的返回值，也不把它变成错误 ——
 *       把"0 行"当失败是加了一条桌面没有的语义，会让一次幂等的改名在界面上弹一个错。</li>
 * </ul>
 *
 * <p><b>空数组</b>（{@code listInfos = []}）同理 = 合法：0 条语句、提交成功、广播一个空数组。
 * 桌面也是这个形状（{@code db.transaction(...)([]) } 什么都不做，随后照样 emit）。
 *
 * <h2>失败语义三态（与第四刀同款：空 / 坏 必须可分辨）</h2>
 *
 * <table border="1">
 *   <caption>参数非法 / 库坏 / 表缺失 / 语句失败</caption>
 *   <tr><th>状态</th><th>本通道</th><th>理由</th></tr>
 *   <tr><td><b>参数非法</b>（缺 {@code listInfos}、不是数组、元素不是对象、{@code id} 不是
 *       非空字符串、可空列给了错的类型）</td>
 *       <td>{@code IllegalArgumentException}，消息里**点名**第几个元素与哪个字段</td>
 *       <td>这是"调用方写错了"，不是"库坏了"；渲染层会把 {@code ok:false} 的 message 打进
 *           {@code console.error}（{@code platform/ipcFallback/subscribe.ts:72-76,89-101}），
 *           所以在消息里点名是唯一能在真机上定位的东西（风格照
 *           {@code RainMusicDataChannels.java:523-586}）</td></tr>
 *   <tr><td><b>库打不开</b>（文件损坏 / 不是 SQLite 库 / 没有权限 / 首建失败 / 迁移抛错）</td>
 *       <td>reject（{@code ok:false, code=IPC_HANDLER_FAILED}），消息里带库的绝对路径与原始原因；
 *           **不广播**</td>
 *       <td>"坏了"不能伪装成"改成功了"（复用 {@link RainMusicDatabase#open(Context, String...)}）</td></tr>
 *   <tr><td><b>表缺失</b>（库在、但没有 {@code my_list}）</td>
 *       <td>reject，消息里点名"表缺失"；**不广播**</td>
 *       <td>同上；由 {@code open(context, TABLE_MY_LIST)} 的 {@code requireTable} 负责</td></tr>
 *   <tr><td><b>语句失败</b>（结构漂移、约束不满足 —— 例如缺 {@code name}）</td>
 *       <td>reject，异常冒泡出 handler；事务回滚；**不广播**</td>
 *       <td>绝不 {@code catch} 之后返回"成功"：那会让渲染层的列表与库里的数据长期分叉</td></tr>
 * </table>
 *
 * <p><b>广播必须晚于提交、且失败时不许发</b>：渲染层收到 {@code list_update} 会**就地**改它那份
 * {@code userLists}（{@code action.ts:177-181} → {@code updateList}），而它**不会**回读库。
 * 先广播后提交，或失败也广播，都会让界面上显示一个库里并不存在的改名 —— 那比"少一次广播"难查得多。
 *
 * <h2>{@code LIST_WRITE_LOCK}：它护什么、护不到什么</h2>
 *
 * <p>{@link #LIST_WRITE_LOCK} 是 <b>{@code static final} 的文件私有锁</b>，三条写通道
 * （第八刀的 {@code player_list_update}，第九刀-a 的 {@code player_list_add}，第十刀-a 的
 * {@code player_list_remove}）**共用**它。临界区 = {@code [beginTransaction … commit]} 那一段，
 * 也就是"[改 {@code my_list} 的那条（那几条）SQL]"，**不是**整个 handler。
 *
 * <p><b>为什么需要它</b>：handler 跑在 {@link RainMusicIpcPlugin} 的**固定 2 线程池**里
 * （{@code RainMusicIpcPlugin.java:355-370}，{@code Executors.newFixedThreadPool(2, …)}），
 * 所以两个写请求**真的可能同时在飞**。桌面没有这个问题：那边 {@code dbService} 走自己的
 * 串行队列、better-sqlite3 又是同步 API，一个 handler 的读改写不可能插进另一个 handler 中间。
 * Android 侧这个池把这个保证拆掉了，于是本文件用这把锁把它**只在本进程内**补回来：
 * 同一个写 handler 的 {@code [begin … commit]} 不会与另一个写 handler 的交错 —— 这既是
 * "add 需要先读 {@code MAX(position)} 再写"（第九刀）的前提，也让事务边界不可分。
 *
 * <p><b>它护不到什么（写在这里，避免下一刀误以为它是万能的）</b>：
 * <ol>
 *   <li><b>别的连接</b>。锁是 Java 对象锁，只对本 JVM 里拿了**同一个对象**的线程有效。
 *       线 A 的 {@code @capacitor-community/sqlite} 插件、以及任何别的进程 / 别的
 *       {@code SQLiteDatabase} 句柄，都在这把锁之外 —— 跨连接的串行化只能靠 SQLite 自己
 *       （文件锁 + busy 处理）。本通道不假装它能管住那些写入方。</li>
 *   <li><b>{@link RainMusicStoreLock}</b>（第一 / 二 / 三刀那把）：那把锁护的是
 *       {@code SharedPreferences} 里**整份 store 快照**的"读整份 → 改一个键 → 写回整份"，
 *       与 {@code my_list} 的 SQL 是两个完全不同的资源、不同的失败模式。
 *       <b>不要把两者合并、也不要互相嵌套</b>：它们没有共同的顺序问题，混用只会制造
 *       一把更宽的锁与一处新的死锁风险。</li>
 *   <li><b>广播</b>。见下：emit 刻意在锁外。</li>
 * </ol>
 *
 * <h2>emit 的位置：提交成功之后、锁外</h2>
 *
 * {@code ctx.emitTo(CHANNEL_LIST_UPDATE, listInfos)} 写在 {@code applyListUpdates(...)} 返回之后，
 * 也就是 {@code synchronized (LIST_WRITE_LOCK)} 块**外面**。两条理由：
 * <ol>
 *   <li><b>失败不许改本地状态</b>：语句抛错 ⇒ 事务回滚 ⇒ 异常冒泡 ⇒ 根本走不到 emit，
 *       渲染层那份 {@code userLists} 不会被改成一个库里没有的状态（见上一节）；</li>
 *   <li><b>不让"会回到渲染层"的调用发生在锁内</b>：{@code emitTo} 一路走到
 *       {@code notifyListeners} → WebView。渲染层的 {@code list_update} 监听器（
 *       {@code rendererListManage.ts:189-191}）是**同步**被调的，它（或它顺带触发的别的逻辑）
 *       完全可以再 invoke 一条同族写通道；那次调用会落到池里的**第二个**线程上，并卡在
 *       这把锁上等第一个 handler 出来。池只有 2 个线程 ⇒ 把锁的持有时间扩大到"整趟 JS 往返"，
 *       就是在拿池的吞吐换一点代码整齐。临界区收窄到 SQL，这种形状就不可能出现。</li>
 * </ol>
 *
 * <h2>广播的形状：**裸数组**（这一条写错，界面完全不动）</h2>
 *
 * 广播的 {@code args} 恰好是**一个** {@code JSONArray}（就是调用方传来的那个 {@code listInfos}），
 * 与 {@code winRendererEvent.ts:15-17} 的 {@code sendEvent(channel, lists)} 逐字同形：
 * <pre>
 * 原生   ctx.emitTo("player_list_update", listInfos)        → args = [ [ {id,name,…}, … ] ]
 * 桥     dispatchChannelEvent → listener({ event, params: args[0] })   （capacitor.js:434-470）
 * 渲染层 list_update = ({ params: listInfos }) => userListsUpdate(listInfos)
 *                    → for (const info of listInfos) …      （action.ts:177-181）
 * </pre>
 * 所以载荷**不能**包成 {@code {listInfos: […]}}：那样 {@code args[0]} 是个对象，
 * {@code for…of} 立刻 {@code TypeError: listInfos is not iterable}，而那个异常会被桥自己
 * {@code catch} 掉、只留一条 {@code console.error}（{@code capacitor.js:464-467}）——
 * 界面看起来就是"改名没生效"，且**没有**任何 reject 回到调用方。本文件的类注释与用例都把
 * 这条形状单独钉住。
 *
 * <h2>第九刀-a：{@code player_list_add}（新建歌单）</h2>
 *
 * <pre>
 * player_list_add   invoke, args=[{position, listInfos}] → void   （契约 ipc-contract.md:102）
 * player_list_add   event,  args=[{position, listInfos}]          （对象载荷，见下）
 * </pre>
 *
 * <p><b>链</b>（逐段与桌面对齐，行号是桌面源码的）：
 * <ol>
 *   <li><b>invoke</b>：渲染层 {@code createUserList} {@code R:listManage:36-39}
 *       （{@code rendererInvoke<Rain.List.ListActionAdd>(PLAYER_EVENT_NAME.list_add, data)}，
 *       {@code data = {position, listInfos}}）→ 主进程 {@code M:list:12-14}
 *       （{@code mainHandle<Rain.List.ListActionAdd>(list_add, async({params: {position, listInfos}}) => …)}，
 *       {@code mainHandle} ⇒ **请求 / 应答**）→ {@code ListEvent.list_create}
 *       （{@code src/main/event/ListEvent.ts:50-55}）→ {@code dbService.createUserLists(position, lists)}。</li>
 *   <li><b>广播</b>：{@code ListEvent.ts:53} 的 {@code this.emit('list_create', position, lists)}
 *       → {@code winRendererEvent.ts:9-11} 的
 *       {@code sendEvent<Rain.List.ListActionAdd>(PLAYER_EVENT_NAME.list_add, { position, listInfos })}
 *       → 渲染层 {@code rendererListManage.ts:180-184} 的
 *       {@code list_create = ({params: {position, listInfos}}) => …}，订阅在 {@code :229}。</li>
 *   <li><b>参数 → 返回值</b>：{@code {position, listInfos}} → {@code void}（这一刀不返回新 id）。</li>
 * </ol>
 *
 * <h3>广播的形状是**对象**（与 update / remove 不同形）</h3>
 * 载荷逐字是 {@code {position, listInfos}} —— 桌面 {@code winRendererEvent.ts:10} 发的就是它，
 * 渲染层 {@code rendererListManage.ts:180} 也是按这两个键解构的。所以这里**不能**照 update
 * 那条形状发裸数组：{@code rendererListManage.ts:228-231} 的三个监听器虽然挂在同一条
 * {@code registerListAction} 里，但形状各不同形（{@link #CHANNEL_LIST_UPDATE} 的类注释
 * 「广播的形状」记录的是**那一条**的裸数组）。契约 {@code ipc-contract.md:120} 的注把三条
 * 一起写了：{@code player_list_add} 必须是对象，另两条必须是裸数组。
 *
 * <p>⚠️ 广播里的 {@code position} 就是**调用方传来的那个值**（可能是负数，见下），
 * 不做任何"折算成真实落库位置"的加工：桌面 {@code ListEvent.ts:53} 也是把**同一个**
 * {@code position} 参数往后传；渲染层 {@code action.ts:48} 自己判
 * {@code position < 0 || position >= userLists.length} 决定 push 还是 splice。
 * 折算反而会让渲染层把"追加"当成"插到第 0 位"。
 *
 * <h3>两个分支（桌面 {@code modules/list/index.ts:70-98}），同一个事务</h3>
 * <table border="1">
 *   <caption>{@code position} 落到哪一支</caption>
 *   <tr><th>条件</th><th>SQL（本文件）</th><th>桌面出处</th></tr>
 *   <tr><td><b>追加</b>：{@code position < 0 || position >= COUNT(*)}</td>
 *       <td>只 {@code INSERT} 这 M 行（6 列），**不删**</td>
 *       <td>{@code index.ts:72-85} + {@code dbHelper.ts:58-75} 的 {@code isClear=false}</td></tr>
 *   <tr><td><b>插队</b>：否则</td>
 *       <td>{@code DELETE FROM "main"."my_list"} + 全量 {@code INSERT}（N+M 行，position 重编号 0..n-1）</td>
 *       <td>{@code index.ts:86-97} + {@code dbHelper.ts:58-75} 的 {@code isClear=true}</td></tr>
 * </table>
 * <p><b>新位置怎么算（追加分支）</b>：{@code order = MAX(position) + 1}，
 * 空表 ⇒ {@code 0}。桌面 {@code index.ts:75} 是
 * {@code userLists.length ? (rawPoss.get(userLists.at(-1)!.id) ?? userLists.length) + 1 : 0}
 * —— 取的是**最后一行**的原始 position；表按 position 排序 ⇒ 那一行就是 {@code MAX(position)}。
 * 它明写"因为原始 pos 可能比 userLists.length 大，所以不能直接用 userLists.length 作为新列表的
 * 原始位置"（{@code index.ts:74}）⇒ 本通道**允许空洞**：库里是 {@code 0,1,5} 时下一个是 {@code 6}，
 * 不是 {@code 3}。多行一次传入时依次 {@code order + index}（{@code index.ts:76-78}）。
 *
 * <p><b>插队分支的重编号</b>：整表清空重写，{@code position} 被重写成 {@code 0..n-1}
 * （{@code index.ts:90-92} 的 {@code forEach((list, index) => list.position = index)}）。
 * 顺序取"读出来的行序" = {@code statements.ts:19} 的 {@code ORDER BY "position" ASC, "rowid" ASC}
 * （{@code queryAllUserList()} 的语句就是这个排序），再把 M 条新行 {@code splice(position, …)}
 * 进去（{@code index.ts:89}）。⚠️ 这里**必须**按那个排序读，不能按 SQLite 的存储序 ——
 * 否则"库里本来有空洞 / 顺序与 rowid 不一致"时插队的位置会与桌面不同。
 *
 * <p>两个分支都**不碰** {@code my_list_music_info} / {@code my_list_music_info_order}：
 * 歌单的 {@code id} 没有变（插队分支删了又按同一个 id 插回），歌单内的歌曲是按
 * {@code listId} 关联的，所以无需搬动（桌面同样一行都不碰，{@code index.ts:84/93} 只调
 * {@code insertUserLists}）。
 *
 * <p><b>可空列怎么绑（{@code NULL} 的一格）</b>：{@code source} / {@code sourceListId} /
 * {@code locationUpdateTime} 缺字段或给 JSON {@code null} 时，绑的是 {@code org.json} 的
 * {@code JSONObject.NULL} 哨兵，**不是** Java {@code null}（理由：Android 的
 * {@code execSQL(String, Object[])} 对 {@code null} 元素的行为在本机无法验证，而哨兵在
 * 所有 {@code SQLiteProgram.bind*} 路径上都是明确的 SQL NULL）。{@code name} 缺失 /
 * 为 null 则**直接抛 {@code IllegalArgumentException}**（点名字段），不靠 NOT NULL 约束兜底 ——
 * 约束那一条路只在真机上才知道是什么异常类型，而参数错误本来就该在打开库之前失败。
 * {@code name} 在、但是数字 / 布尔时按桌面 {@code better-sqlite3} 的绑定语义原样传下去
 * （SQLite 的 TEXT 列会接受它，见类注释「依赖」里"不自己发明校验"这一条）。
 *
 * <h3>{@code position} 的校验形状：整数，**负数合法**</h3>
 * 只拒绝"缺失 / 非数值 / 非整数"三种，**不拒绝负数**。三条依据：
 * <ol>
 *   <li>桌面 {@code index.ts:72} 的条件就是 {@code position < 0 || position >= userLists.length}
 *       ⇒ 负数属于**追加**分支，是被支持的输入，不是坏输入；</li>
 *   <li>渲染层**确实**用 {@code -1} 表示"没指定位置"：{@code store/list/action.ts:56,62} 的
 *       参数默认值 {@code position = -1}，{@code :65} 把它折算成 {@code userLists.length} 之后
 *       才发出去。也就是说 {@code -1} 在这条链上是**正常的"未指定"**；</li>
 *   <li>于是"拒绝负数"会打断渲染层那条正常路径 —— 真机上的表现就是"新建歌单失败"
 *       （{@code ok:false} + 一条 {@code IllegalArgumentException}），而库里什么都没有坏。
 *       那是本通道**自己发明**的一条桌面没有的限制。</li>
 * </ol>
 *
 * <h3>{@code id} 冲突 / 同名：一个大声失败，一个允许</h3>
 * <ul>
 *   <li><b>id 冲突 ⇒ 大声失败</b>：{@code my_list} 的主键是 {@code id}（{@code tables.ts:136}，
 *       与 {@code RainMusicDatabase.DDL_MY_LIST} 逐字一致），重复 id 的 {@code INSERT} 会抛
 *       {@code SQLiteConstraintException} ⇒ 不标记事务成功 ⇒ 回滚 ⇒ 异常冒泡成 {@code ok:false}。
 *       本通道**不吞、不换一个 id、不返回假 id**（返回类型本来就是 {@code void}）。</li>
 *   <li><b>同名 ⇒ 允许</b>：{@code my_list} 上**没有** name 的 UNIQUE（{@code tables.ts:128-138}
 *       只有 {@code PRIMARY KEY("id")}）⇒ 本通道**不加判重**。桌面也不加：判重在 UI 侧
 *       （渲染层自己的列表里查重名），库这一层从来不管。</li>
 * </ul>
 *
 * <h3>成功与失败的形状（沿用第八刀的三态）</h3>
 * <table border="1">
 *   <caption>第九刀-a 的失败矩阵</caption>
 *   <tr><th>状态</th><th>本通道</th><th>理由</th></tr>
 *   <tr><td><b>参数非法</b>（缺参数 / 不是对象 / 缺 {@code position} 或它不是整数 /
 *       {@code listInfos} 不是数组 / 元素不是对象 / {@code id} 不是非空字符串 / 可空列类型不对）</td>
 *       <td>{@code IllegalArgumentException}，消息点名第几个元素与哪个字段</td>
 *       <td>与第八刀同一风格（{@link #listUpdate} 的参数校验、{@code RainMusicDataChannels} 的消息风格）</td></tr>
 *   <tr><td><b>{@code listInfos} 是空数组</b></td><td>成功：0 条 INSERT、提交、广播
 *       {@code {position, listInfos: []}}</td>
 *       <td>桌面 {@code db.transaction(…)([])} 同样什么都不写、随后照样 emit</td></tr>
 *   <tr><td><b>库打不开 / 表缺失</b></td><td>reject，不广播</td>
 *       <td>复用 {@link RainMusicDatabase#open(Context, String...)}（与第八刀同一入口）</td></tr>
 *   <tr><td><b>语句失败</b>（结构漂移 / {@code name} 为 NULL / id 冲突 / 约束不满足）</td>
 *       <td>reject，事务回滚，**不广播**</td>
 *       <td>绝不 catch 之后返回"成功"（见「emit 的位置」）</td></tr>
 * </table>
 *
 * <h2>第十刀-a：{@code player_list_remove}（删除歌单）</h2>
 *
 * <pre>
 * player_list_remove   invoke, args=[ids[]] → void   （契约 ipc-contract.md:103）
 * player_list_remove   event,  args=[ids[]]          （**裸数组**，与 update 同形、与 add 不同形）
 * </pre>
 *
 * <p><b>链</b>（行号是桌面源码的）：
 * <ol>
 *   <li><b>invoke</b>：渲染层 {@code removeUserList} {@code R:listManage:45-47}
 *       （{@code rendererInvoke<Rain.List.ListActionRemove>(PLAYER_EVENT_NAME.list_remove, data)}，
 *       {@code data} 就是 {@code ids}）→ 主进程 {@code M:list:15-17}
 *       （{@code mainHandle<Rain.List.ListActionRemove>(list_remove, async({params: ids}) => …)}，
 *       {@code mainHandle} ⇒ 请求 / 应答）→ {@code ListEvent.list_remove}
 *       （{@code src/main/event/ListEvent.ts:61-65}）→ {@code dbService.removeUserLists(ids)}
 *       （{@code modules/list/index.ts:119-123}）。</li>
 *   <li><b>广播</b>：{@code ListEvent.ts:63} 的 {@code this.emit('list_remove', ids)}
 *       → {@code winRendererEvent.ts:12-14} 的
 *       {@code sendEvent<Rain.List.ListActionRemove>(PLAYER_EVENT_NAME.list_remove, ids)}
 *       —— <b>裸数组</b>（不是 {@code {ids}}）→ 渲染层 {@code rendererListManage.ts:185-188} 的
 *       {@code list_remove = ({params: ids}) => { const updatedListIds = userListsRemove(ids); … }}，
 *       订阅在 {@code :230}。</li>
 *   <li><b>参数 → 返回值</b>：{@code ids: string[]} → {@code void}。</li>
 * </ol>
 *
 * <h3>三句 DELETE、三张表、每个 id 三句（同一个事务）</h3>
 *
 * 桌面 {@code modules/list/index.ts:119-123} 的 {@code removeUserLists} 调
 * {@code dbHelper.ts:81-93} 的 {@code deleteUserLists}，后者在**一个** {@code db.transaction} 里
 * 对每个 id **连着**跑三句（{@code :86-90}）：
 * <table border="1">
 *   <caption>本通道的三句（{@link #applyListRemoves}），逐句对齐 statements.ts</caption>
 *   <tr><th>#</th><th>Java 常量</th><th>桌面出处</th><th>漏掉它的后果</th></tr>
 *   <tr><td>1</td><td>{@link #SQL_LIST_DELETE}</td><td>{@code statements.ts:47-50}</td>
 *       <td>歌单那一行还在（删除没生效）</td></tr>
 *   <tr><td>2</td><td>{@link #SQL_MUSIC_INFO_DELETE_BY_LIST_ID}</td><td>{@code statements.ts:117-120}</td>
 *       <td><b>孤儿歌曲</b>：歌单没了、歌还在</td></tr>
 *   <tr><td>3</td><td>{@link #SQL_MUSIC_INFO_ORDER_DELETE_BY_LIST_ID}</td><td>{@code statements.ts:190-193}</td>
 *       <td><b>行序漂移</b>：残留的 {@code order} 行以后会插进同 id 歌单的排序</td></tr>
 * </table>
 *
 * <p><b>没有任何东西替这三句兜底</b>：{@code tables.ts} 里两张子表**没有**外键、没有触发器，
 * 而且 {@code db.ts} 连 {@code PRAGMA foreign_keys=ON} 都没开（SQLite 默认 OFF）——
 * 所以"删歌单顺手删干净它的歌与行序"完全靠这三句代码，一句都不能少。桌面同样如此。
 *
 * <p><b>不做的事</b>（与桌面逐条对齐）：不重排 {@code my_list.position}、不重编号、**不检查
 * {@code changes}**。删一个不存在的 id ⇒ 0 行命中 ⇒ <b>成功</b>（幂等），并且**照样广播**
 * （渲染层 {@code action.ts:165-172} 找不到这个 id 就跳过，与桌面看到的行为一致）。
 * 空数组 ⇒ 0 条 SQL、事务照样提交、广播一个空数组。
 *
 * <h3>⚠️ 必须拒绝保留 id（{@code default} / {@code temp}）—— 有意的、可见的语义偏离</h3>
 *
 * <p>{@link #requireRemoveId} 对 {@code src/common/constants.ts:25-30} 的
 * {@code LIST_IDS.DEFAULT}（{@code 'default'}）与 {@code LIST_IDS.TEMP}（{@code 'temp'}）
 * <b>直接抛 {@code IllegalArgumentException}</b>，一个连接、一条 SQL 都不发。
 *
 * <p><b>为什么这不是"过度校验"，而是必须的一条</b>：这两个保留列表在本应用的代码路径上
 * <b>从不写进 {@code my_list}</b>，它们只以 {@code listId} 的形式存在于
 * {@code my_list_music_info} / {@code my_list_music_info_order} 里（试听列表 / 默认列表的歌曲）。
 * 于是逐字照抄桌面的 {@code remove(['default'])} 会这样收场：
 * <pre>
 *   1) DELETE FROM "main"."my_list"                WHERE "id"='default'     → 删 0 行（【看起来成功】）
 *   2) DELETE FROM "main"."my_list_music_info"     WHERE "listId"='default'  → 【真的删光试听列表的歌】
 *   3) DELETE FROM "main"."my_list_music_info_order" WHERE "listId"='default'→ 【同样删光】
 * </pre>
 * 而 {@code my_list} 里根本没有 {@code default} 行 ⇒ 第 1 句"成功"，第 2/3 句是**真实的数据丢失**。
 * 数据库层没有任何保护（见上一节：无外键、无触发器），**桌面在这一层同样没有保护** ——
 * 它唯一的防线在界面菜单（{@code src/renderer/views/List/MyList/useMenu.js:102-104} 的
 * {@code case -2} 把"重命名 / 删除 / 同步"三项关掉）。
 *
 * <p>ⓘ <b>这是本刀<b>有意</b>引入的一处语义偏离，且是可见的</b>：调用方拿到
 * {@code ok:false} + 一条点名到 id、并把理由写全的 message（"保留列表按本应用的代码路径从不写进
 * {@code my_list}，删除只会清空它的歌曲"），而不是一个静默的"成功"外加用户试听列表全空。
 * 换句话说：**宁可让一次（本来就该被界面拦住的）删除失败，也不做一次无法回滚的清空**。
 * 这一条偏离只影响 {@code default} / {@code temp} 两个 id；普通歌单的删除语义与桌面逐条一致。
 *
 * <h3>参数校验 / 锁 / emit（与第八、九刀同款，逐条复用）</h3>
 * <ul>
 *   <li><b>校验分层</b>：{@code ids} 必须是数组、元素必须是非空字符串、且不是保留 id ——
 *       全部在 {@code RainMusicDatabase.open(...)} <b>之前</b>做完（{@link #readRemoveIds}），
 *       坏载荷 ⇒ <b>一条 SQL、一个连接都没有</b>；</li>
 *   <li><b>锁</b>：与 add / update 共用 {@link #LIST_WRITE_LOCK}；临界区 =
 *       {@code [beginTransaction … commit]}（{@link #applyListRemoves}），
 *       {@code beginTransaction} 之前进入、{@code endTransaction} 之后退出；</li>
 *   <li><b>emit</b>：{@code ctx.emitTo(CHANNEL_LIST_REMOVE, ids)} 写在 {@link #applyListRemoves}
 *       返回之后（提交成功）且<b>锁外</b> —— 失败路径走不到它，"非法参数 / 库坏 / 语句失败"一律
 *       <b>不广播</b>；</li>
 *   <li><b>返回 void</b>：固定 {@code return null}。</li>
 * </ul>
 *
 * <h3>广播的形状：<b>裸数组</b>（与 update 同形，与 add 不同形）</h3>
 * <pre>
 * 原生   ctx.emitTo("player_list_remove", ids)          → args = [ ["l-1","l-2"] ]
 * 桥     dispatchChannelEvent → listener({ event, params: args[0] })   （capacitor.js:434-470）
 * 渲染层 list_remove = ({ params: ids }) => userListsRemove(ids)
 *                    → for (const id of ids) …            （action.ts:163-175）
 * </pre>
 * 所以载荷**不能**包成 {@code {ids: […]}}：那样 {@code args[0]} 是个对象，
 * {@code for…of} 立刻 {@code TypeError: ids is not iterable}，异常被桥自己吞成一条
 * {@code console.error}（{@code capacitor.js:464-467}）—— 界面看起来就是"删除没生效"，
 * 且**没有**任何 reject 回到调用方。契约 {@code :120} 的那条注把这三条通道一起钉住了
 * （add 必须是对象；remove / update 必须是裸数组）。
 *
 * <h3>第十刀-a 的三态失败矩阵</h3>
 * <table border="1">
 *   <caption>参数非法 / 保留 id / 空数组 / 库坏 / 语句失败</caption>
 *   <tr><th>状态</th><th>本通道</th><th>理由</th></tr>
 *   <tr><td><b>参数非法</b>（缺参数 / 不是数组 / 元素不是字符串 / 空串）</td>
 *       <td>{@code IllegalArgumentException}，点名第几个元素</td>
 *       <td>调用方写错了；且**在打开库之前**失败（0 条 SQL、0 个连接）</td></tr>
 *   <tr><td><b>保留 id</b>（{@code default} / {@code temp}）</td>
 *       <td>{@code IllegalArgumentException}，消息写全理由</td>
 *       <td><b>有意偏离桌面</b>（见上一节）：照抄会清空试听列表的歌，而 DB 层没有保护</td></tr>
 *   <tr><td><b>{@code ids} 是空数组</b></td><td>成功：0 条 SQL、提交、广播空数组</td>
 *       <td>桌面 {@code db.transaction(…)([])} 同样什么都不做、随后照样 emit</td></tr>
 *   <tr><td><b>id 不在库里</b>（含刚被别的窗口删掉）</td><td><b>成功</b>（0 行命中）+ 照样广播</td>
 *       <td>幂等；把"0 行"当失败是桌面没有的语义（见「不做的事」）</td></tr>
 *   <tr><td><b>库打不开 / 三张表缺任何一张</b></td><td>reject，消息点名库路径与表名，**不广播**</td>
 *       <td>复用 {@link RainMusicDatabase#open(Context, String...)}；"坏了"不许伪装成"删掉了"</td></tr>
 *   <tr><td><b>语句失败</b>（结构漂移 / 连接被外部关掉等）</td><td>reject，事务回滚，**不广播**</td>
 *       <td>绝不 catch 之后返回"成功"；半批成功不允许</td></tr>
 * </table>
 *
 * <h3>第十刀-a 新增的未验证点（别当成已验证）</h3>
 * <ol>
 *   <li>{@code SQLiteStatement} 上 {@code clearBindings()} / {@code bindString(int, String)} /
 *       {@code executeUpdateDelete()} 对 {@code DELETE} 的行为与返回值，是照 AOSP 签名写的，
 *       本机没有 android.jar 可以对着编 / 跑，只能由 CI 的 {@code gradlew assembleDebug} 证伪；</li>
 *   <li>{@code RainMusicDatabase.open(context, A, B, C)} 三张表的 {@code requireTable} 只由源码
 *       对齐覆盖（{@code android-list-channels.test.cjs} 那一组），真机上"三张表都在"这件事
 *       **未验证**；本文件的 JVM 探针用的假 {@code RainMusicDatabase} 只声明了
 *       {@code TABLE_MY_LIST} 一个常量（所以本文件刻意用**文件私有**的两个表名常量，
 *       见 {@link #TABLE_MY_LIST_MUSIC_INFO} 的注释）；</li>
 *   <li>"删除三张表的同一个事务在真机上真的原子"以及"与线 A 的 SQLite 是不是同一个连接"
 *       **同样未在真机验证**（{@code LIST_WRITE_LOCK} 只护本 JVM 内拿了同一把锁的线程，
 *       管不到别的连接 —— 见「{@code LIST_WRITE_LOCK}」一节）；</li>
 *   <li>保留 id 的**取值来源**是 {@code src/common/constants.ts:25-30} 的 {@code LIST_IDS}，
 *       而不是某种数据库里的约定（{@code my_list} 里确实没有这两行）—— 这一点由本仓源码读出，
 *       真机上"这两个 id 的歌单行确实不存在"未在真机复核；</li>
 *   <li>本刀**没有**渲染层 E2E（真机上点"删除歌单"）证据：广播形状只由用例与桌面链对齐钉住。</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.database.*} 与 {@code org.json}、JDK 的 {@code java.util.{ArrayList,List}}，
 * 以及同包的 {@link RainMusicDatabase} / {@link RainMusicIpcHandlers}。
 * <b>没有新增任何 gradle 依赖</b>，也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着 Android 框架 API + 本机读到的 {@code @capacitor/android@8.5.2} 源码
 * 逐条核对的，只能由 CI（{@code .github/workflows/build-android.yml} 的
 * {@code gradlew assembleDebug}）证伪。
 *
 * <p>本机的行为证据来自 {@code tests/unit/android-list-write-channels.test.cjs} 里那一组
 * "真 {@code javac} + 真 {@code java} + 手写假 {@code SQLiteDatabase} / 假 {@code org.json}"
 * 跑出来的控制流（锁、事务、emit 时机、载荷形状、三态失败、0 行命中）；那些替身是人手写的，
 * **不是** Android 框架本身，所以那组证据只覆盖**本文件的代码路径**，
 * 不覆盖任何框架行为。真机行为（并发写、{@code beginTransaction} 的实际隔离、
 * 与线 A 的 SQLite 是否同一个连接、{@code notifyListeners} 的时机与序列化）
 * **同样未在真机验证**。
 *
 * <p>⚠️ <b>第十刀-a 的 {@code player_list_remove} 现在**没有**任何 JVM 探针场景</b>：
 * {@code android-list-write-channels.test.cjs} 的 {@code WriteProbe} 只调用了
 * {@code player_list_update} 与 {@code player_list_add}（那是第八 / 九刀留下的），
 * 第十刀-a 这一半的行为证据目前**只有源码级**的（SQL 逐字对齐、绑定顺序、锁块形状、
 * emit 位置、保留 id 的消息文本），**没有**任何"真 {@code javac} + 真 {@code java}"跑出来的
 * 控制流证据 —— 那一组用例属于第十刀-b。在那之前，不要把这四条（三句 DELETE 的执行序、
 * 多 id 回滚、空数组、保留 id 一条 SQL 都不发）当成"本机已验证"。
 *
 * <p><b>第九刀-a 新增的未验证点（逐条列出来，别当成已验证）</b>：
 * <ol>
 *   <li>{@code SQLiteDatabase.rawQuery(String, String[])} / {@code Cursor} 的那几个方法
 *       （{@code moveToFirst / moveToNext / isNull / getLong / getColumnIndexOrThrow / close}）
 *       是按 AOSP 的签名写的，本机**没有 android.jar 可以对着编**（{@code $ANDROID_HOME} 与
 *       {@code platforms/} 都不在），只能由 CI 的 {@code gradlew assembleDebug} 证伪；</li>
 *   <li>{@code MAX("position")} 在**空表**上返回一行一列的 NULL 这一点（真 SQLite 的聚合语义）
 *       同样只由真机 / CI 证伪；本机用内存假库按同一语义复现；</li>
 *   <li>{@code execSQL(String, Object[])} 对 {@code JSONObject.NULL} 哨兵绑成 SQL NULL
 *       这一点未验证（因此刻意不用 Java {@code null}，见「可空列怎么绑」）；</li>
 *   <li>{@code executeUpdateDelete()} / {@code executeInsert()} 的差异、以及
 *       {@code INSERT} 在 id 冲突时抛的**具体异常类型**（{@code SQLiteConstraintException}
 *       的子类）未在真机确认 —— 本通道只用"它抛出来 ⇒ 回滚 ⇒ ok:false"这一条**不依赖具体类型**
 *       的性质，所以类型不确定不影响这一刀的正确性；</li>
 *   <li>插队分支是"整表清空重写"（N+M 行、每行一条 INSERT），歌单很多时的事务时长
 *       **没有测量**；桌面 {@code better-sqlite3} 是同步 API、同样一句一句写，但真机上的
 *       时长与是否会触发 ANR 属于**未知**（本通道不碰 UI 线程，handler 在后台 2 线程池里）。</li>
 * </ol>
 */
public final class RainMusicListWriteChannels {

    /**
     * {@code player_list_update}：键名 {@code list_update}
     * （{@code src/common/ipcNames.ts:26} 的 {@code PLAYER_EVENT_NAME.list_update}）
     * + 模块前缀 {@code player}（生成规则 {@code ipcNames.ts:171-176}）。
     *
     * <p>同一个字符串既是 invoke 的通道名，也是广播的通道名：桌面上这两半就是**同一条**通道
     * （{@code rendererEvent.ts:18-20} 收、{@code winRendererEvent.ts:15-17} 发），
     * 契约 {@code ipc-contract.md:104} 那一行本刀改成"双向"记法。
     */
    public static final String CHANNEL_LIST_UPDATE = "player_list_update";

    /**
     * {@code player_list_add}：键名 {@code list_add}（{@code src/common/ipcNames.ts:25}
     * 的 {@code PLAYER_EVENT_NAME.list_add}）+ 模块前缀 {@code player}（{@code ipcNames.ts:171-176}）。
     *
     * <p>与 {@link #CHANNEL_LIST_UPDATE} 一样，同一个字符串既是 invoke 的通道名、也是广播的通道名
     * （{@code rendererEvent.ts:12} 收、{@code winRendererEvent.ts:10} 发），契约 {@code :102}
     * 记成"双向"。<b>但广播的形状不同</b>：本通道发的是对象 {@code {position, listInfos}}。
     */
    public static final String CHANNEL_LIST_ADD = "player_list_add";

    /**
     * {@code player_list_remove}：键名 {@code list_remove}（{@code src/common/ipcNames.ts:25}
     * 的 {@code PLAYER_EVENT_NAME.list_remove}）+ 模块前缀 {@code player}（{@code ipcNames.ts:171-176}）。
     *
     * <p>与前两条写通道一样：同一个字符串既是 invoke 的通道名、也是广播的通道名
     * （{@code rendererEvent.ts:15} 收、{@code winRendererEvent.ts:13} 发），契约 {@code :103}
     * 记成"双向"。<b>广播的载荷是裸数组</b>（与 {@code player_list_update} 同形、
     * 与 {@code player_list_add} 的对象不同形）—— 见类注释「第十刀-a」那一节的「广播的形状」。
     */
    public static final String CHANNEL_LIST_REMOVE = "player_list_remove";

    /**
     * 三条歌单写通道（{@code player_list_add} / {@code player_list_update} /
     * {@code player_list_remove}）**共用**的串行化锁。
     *
     * <p>{@code static final} ⇒ 进程内唯一；{@code private} ⇒ 只有本文件的 handler 能拿它，
     * 名符其实地"文件私有"。它**不是** {@link RainMusicStoreLock}（那把锁护
     * {@code SharedPreferences} 的整份快照），**也管不到别的 SQLite 连接**（线 A / 插件）——
     * 逐条理由见类注释「{@code LIST_WRITE_LOCK}：它护什么、护不到什么」。
     */
    private static final Object LIST_WRITE_LOCK = new Object();

    /**
     * 改一行歌单。逐字抄 {@code src/main/worker/dbService/modules/list/statements.ts:56-62}
     * 的 {@code createListUpdateStatement()}，唯一的差异是 {@code @name} / {@code @source} /
     * {@code @sourceListId} / {@code @locationUpdateTime} / {@code @id} → {@code ?}
     * （位置参数按出现顺序绑定，见 {@link #applyListUpdates}）。
     *
     * <p>⚠️ <b>四列，没有 {@code position}</b>。理由写在类注释「SQL 落点」。
     * 文本块里的换行 / 缩进与桌面那句一致（用例按 {@code normalizeSql} 归一化后逐字比对）。
     */
    static final String SQL_LIST_UPDATE = """
        UPDATE "main"."my_list"
        SET "name"=?, "source"=?, "sourceListId"=?, "locationUpdateTime"=?
        WHERE "id"=?
        """;

    /**
     * 插入一行歌单（第九刀-a）。逐字抄 {@code statements.ts:27-32} 的
     * {@code createListInsertStatement()}：<b>6 列</b>、列清单顺序
     * {@code id, name, source, sourceListId, position, locationUpdateTime}
     * （就是 {@code tables.ts:128-138} 的列序，也是 {@code dbHelper.ts:65-72} 的绑定顺序）。
     *
     * <p>它被两个分支共用：追加分支插 M 行；插队分支先 {@link #SQL_LIST_CLEAR} 再插 N+M 行。
     * 唯一的差异是 {@code @id} … {@code @locationUpdateTime} → {@code ?}（按出现顺序绑定，
     * 见 {@link #bindListRow}）。
     */
    static final String SQL_LIST_INSERT = """
        INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime")
        VALUES (?, ?, ?, ?, ?, ?)
        """;

    /**
     * 清空整张 {@code my_list}（第九刀-a 的插队分支第一步）。逐字抄
     * {@code statements.ts:38-41} 的 {@code createListClearStatement()}：
     * {@code DELETE FROM "main"."my_list"} —— <b>没有 WHERE</b>，这是刻意的
     * （插队 = 整表清空重写，{@code dbHelper.ts:63} 的 {@code isClear=true} 那一支）。
     */
    static final String SQL_LIST_CLEAR = """
        DELETE FROM "main"."my_list"
        """;

    /**
     * 取"现有第一行"的 position（追加分支的计算依据）。桌面取的是
     * {@code queryAllUserList()} 的**最后一行**（{@code index.ts:75} 的 {@code userLists.at(-1)}），
     * 而那句 SQL 是 {@code ORDER BY "position" ASC, "rowid" ASC} ⇒ 最后一行就是 position 最大的一行。
     * 这里直接取 {@code MAX("position")}（同值、少一次排序）。
     *
     * <p>⚠️ {@code MAX} 在**空表**上返回 {@code NULL} —— 调用方按 {@code 0} 处理
     * （桌面 {@code index.ts:75} 的三元表达式 {@code userLists.length ? … : 0} 是同一个意思）。
     */
    static final String SQL_MAX_POSITION = """
        SELECT MAX("position") FROM "main"."my_list"
        """;

    /**
     * 数现有几行（插队分支判 {@code position >= userLists.length} 用的就是它）。
     * 桌面的 {@code userLists.length} 来自 {@code queryAllUserList()} 的长度。
     */
    static final String SQL_COUNT_LISTS = """
        SELECT COUNT(*) FROM "main"."my_list"
        """;

    /**
     * 插队分支：按桌面 {@code statements.ts:16-20} 的排序把现有 N 行读出来
     * （{@code ORDER BY "position" ASC, "rowid" ASC} —— 与 {@code queryAllUserList()} 同序）。
     *
     * <p>只选本通道要写回的 6 列。⚠️ {@code position} 一定读：重编号时不用它的**值**，
     * 但要用它的**序**（{@code ORDER BY} 就是靠它；见类注释「插队分支的重编号」）。
     */
    static final String SQL_LIST_ORDERED = """
        SELECT "id", "name", "source", "sourceListId", "position", "locationUpdateTime"
        FROM "main"."my_list"
        ORDER BY "position" ASC, "rowid" ASC
        """;

    /**
     * 删一行歌单（第十刀-a 的第一句）。逐字抄 {@code statements.ts:49} 的
     * {@code createListDeleteStatement()}：{@code DELETE FROM "main"."my_list" WHERE "id"=?}
     * —— 桌面这一句**本来就是位置参数**，所以这里一个字都没改（没有 {@code @x → ?} 的替换）。
     *
     * <p>⚠️ 它删除的是"用户自建歌单"那一行。保留列表（{@code default} / {@code temp}）根本不在
     * {@code my_list} 里，所以这一句对它们是"命中 0 行"——这正是本通道**拒绝**保留 id 的原因
     * （见类注释「必须拒绝保留 id」）。
     */
    static final String SQL_LIST_DELETE = """
        DELETE FROM "main"."my_list" WHERE "id"=?
        """;

    /**
     * 删一个歌单里的**全部歌曲行**（第十刀-a 的第二句）。逐字抄 {@code statements.ts:119} 的
     * {@code createMusicInfoDeleteByListIdStatement()}。
     *
     * <p>⚠️ 这一句不能省：漏掉它 ⇒ 歌单没了、歌还在（孤儿行），下次导入同名歌单时会看到
     * 不属于它的歌。数据库层**没有**外键 / 触发器兜底（{@code db.ts} 连
     * {@code PRAGMA foreign_keys=ON} 都没开，SQLite 默认 OFF），所以删除全靠这三句代码。
     */
    static final String SQL_MUSIC_INFO_DELETE_BY_LIST_ID = """
        DELETE FROM "main"."my_list_music_info" WHERE "listId"=?
        """;

    /**
     * 删一个歌单的**全部行序**（第十刀-a 的第三句）。逐字抄 {@code statements.ts:192} 的
     * {@code createMusicInfoOrderDeleteByListIdStatement()}。
     *
     * <p>⚠️ 这一句同样不能省：{@code my_list_music_info_order."order"} 就是歌单内的行序
     * （{@code statements.ts:190-193} 是桌面唯一的清理点，{@code dbHelper.ts:89}）。漏掉它 ⇒
     * 歌单删了、order 行留着；同一个 {@code listId} 以后被重新建出来时行序会漂移
     * （残留的老 order 会插进新列表的排序里）。
     */
    static final String SQL_MUSIC_INFO_ORDER_DELETE_BY_LIST_ID = """
        DELETE FROM "main"."my_list_music_info_order" WHERE "listId"=?
        """;

    /**
     * 第十刀-a 要写的另外两张表的名字（{@code tables.ts:139-169}）。
     *
     * <p>⚠️ 刻意**不**引 {@code RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO}（那个常量确实存在），
     * 也不在 {@link RainMusicDatabase} 里补一句 {@code TABLE_MY_LIST_MUSIC_INFO_ORDER}：本文件的
     * JVM 探针是用**手写替身**编译生产代码的（{@code tests/unit/android-list-write-channels.test.cjs}
     * 的 {@code STUB_DATABASE}），那个替身只声明了 {@code TABLE_MY_LIST} 一个表常量 ——
     * 引真文件里/新加的常量会让**整组**探针用例在"javac 编不过"这一步红掉（而不是只红范围守卫），
     * 而这两个表名在本刀里没有第二个使用方。库名与 {@code my_list} 仍然一律走
     * {@link RainMusicDatabase}（单一出处没有破）。
     */
    private static final String TABLE_MY_LIST_MUSIC_INFO = "my_list_music_info";
    private static final String TABLE_MY_LIST_MUSIC_INFO_ORDER = "my_list_music_info_order";

    /** {@code my_list} 的列名（{@code tables.ts:129-137}），只在本文件里用。 */
    private static final String COLUMN_NAME = "name";
    private static final String COLUMN_SOURCE = "source";
    private static final String COLUMN_SOURCE_LIST_ID = "sourceListId";
    private static final String COLUMN_LOCATION_UPDATE_TIME = "locationUpdateTime";
    private static final String COLUMN_ID = "id";
    private static final String COLUMN_POSITION = "position";

    /**
     * 契约那一格写的参数名 {@code listInfos}（{@code ipc-contract.md:104}）。
     * 只出现在**错误信息**里：桌面 {@code rendererEvent.ts:18} 是靠
     * {@code ({params: listInfos})` 的**解构名**取的，wire 上根本没有这个键 ——
     * 参数就是那个数组本身。错误信息里点名它，是为了让写错的人一眼看见自己该传什么。
     */
    private static final String FIELD_LIST_INFOS = "listInfos";

    /**
     * 契约那一格写的参数名 {@code position}（{@code ipc-contract.md:102}），与
     * {@link #FIELD_LIST_INFOS} 同款：只出现在**错误信息**里。wire 上它就是参数对象的一个键
     * （{@code rendererEvent.ts:12} 的 {@code {params: {position, listInfos}}}）。
     */
    private static final String FIELD_POSITION = "position";

    /**
     * 契约那一格写的参数名 {@code ids}（{@code ipc-contract.md:103}），与
     * {@link #FIELD_LIST_INFOS} 同款：只出现在**错误信息**里 —— wire 上参数就是那个数组本身
     * （{@code rendererEvent.ts:15} 靠解构名 {@code {params: ids}} 取它）。
     */
    private static final String FIELD_IDS = "ids";

    /**
     * **保留列表**的 id：{@code src/common/constants.ts:25-30} 的 {@code LIST_IDS.DEFAULT} /
     * {@code LIST_IDS.TEMP}。
     *
     * <p>⚠️ 本通道**拒绝**删除它们（{@code IllegalArgumentException}），这是**有意的、可见的语义偏离**
     * —— 桌面在数据层没有任何保护。逐条理由与完整消息见类注释「必须拒绝保留 id」那一节。
     */
    private static final String RESERVED_LIST_ID_DEFAULT = "default";
    private static final String RESERVED_LIST_ID_TEMP = "temp";

    private static final String TAG = "RainMusicListWrite";

    private RainMusicListWriteChannels() {}

    /**
     * 注册本文件的两条通道（第八刀的 {@code player_list_update} + 第九刀-a 的
     * {@code player_list_add}）。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的
     * {@code setEmitter}、前七刀的 {@code register} 同一处、同一时序理由：必须在渲染层第一次
     * invoke 之前完成，否则真机上就是 {@code IPC_CHANNEL_UNSUPPORTED}）。
     *
     * <p>与前几刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicListWriteChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(
            CHANNEL_LIST_UPDATE,
            (args, ctx) -> listUpdate(requireContext(plugin), ctx, args)
        );
        RainMusicIpcHandlers.register(
            CHANNEL_LIST_ADD,
            (args, ctx) -> listAdd(requireContext(plugin), ctx, args)
        );
        RainMusicIpcHandlers.register(
            CHANNEL_LIST_REMOVE,
            (args, ctx) -> listRemove(requireContext(plugin), ctx, args)
        );
        // ⚠️ 这里**只打文件名**、不调 getDatabasePath()：load() 阶段 Context 可能还没有
        // （所以 Context 一律留到 handler 调用时再取）。绝对路径由 open() 在真机上打进错误信息。
        Logger.info(
            TAG,
            "P0-2 第八刀 + 第九刀-a + 第十刀-a：已注册 " + CHANNEL_LIST_UPDATE + " / " +
            CHANNEL_LIST_ADD + " / " + CHANNEL_LIST_REMOVE +
            "（写 + 同名广播；invoke 落点 " + RainMusicDatabase.DATABASE_NAME +
            " 的 \"" + RainMusicDatabase.TABLE_MY_LIST + "\" 表，schema 版本 " +
            RainMusicDatabase.SCHEMA_VERSION_TEXT + "；三条写通道共用 LIST_WRITE_LOCK）"
        );
    }

    // ------------------------------------------------------------------ 通道实现

    /**
     * {@code player_list_update}：批量改歌单（本刀只有"改名"这一个调用方，但 SQL 与桌面一样
     * 是整行 4 列，所以它对 {@code source} / {@code sourceListId} / {@code locationUpdateTime}
     * 也是同一个语义）。
     *
     * @param args {@code args[0]} = {@code listInfos} 数组；元素是
     *             {@code {id, name, source?, sourceListId?, locationUpdateTime?}}
     * @return 固定 {@code null}（契约是 {@code void}；两个调用方都不看返回值）
     * @throws IllegalArgumentException 参数非法（缺 / 不是数组 / 元素不是对象 /
     *                                  {@code id} 不是非空字符串 / 可空列给了错的类型）
     * @throws IllegalStateException    库打不开 / 表缺失 / 语句失败（**并且不会广播**）
     */
    private static Object listUpdate(Context context, RainMusicIpcHandlers.RequestContext ctx, List<Object> args) {
        JSONArray listInfos = readListInfos(
            args, CHANNEL_LIST_UPDATE, "docs/android/ipc-contract.md:104", "`listInfos[]`"
        );

        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST);
        applyListUpdates(db, listInfos);

        // 只有走到这里才广播：SQL 已经提交（applyListUpdates 正常返回 ⇒ 事务成功），
        // 且**在锁外**（见类注释「emit 的位置」）。载荷 = 调用方传来的那个数组本身，
        // 与桌面 ListEvent.ts:73 把**同一个 lists 对象**往后传是同一件事
        // （桌面也从不回读库来拼广播的载荷）。
        ctx.emitTo(CHANNEL_LIST_UPDATE, listInfos);

        Logger.info(
            TAG,
            CHANNEL_LIST_UPDATE + "：已提交并广播 " + listInfos.length() +
            " 条歌单改动（裸数组载荷，形状对齐 winRendererEvent.ts:15-17）"
        );
        return null;
    }

    /**
     * 把整批改名在**一个事务**里做掉（抄 {@code dbHelper.ts:99-105} 的 {@code updateUserLists}），
     * 整段在 {@link #LIST_WRITE_LOCK} 内。
     *
     * <p>任何一步抛错 ⇒ 不调 {@code setTransactionSuccessful()} ⇒ {@code endTransaction()} 回滚，
     * 异常继续往上冒（handler 会把它变成 {@code ok:false} 的应答，且**不会有广播**）。
     *
     * <p>{@code executeUpdateDelete()} 的返回值**刻意丢掉**：0 行命中 = 成功，理由见类注释
     * 「0 行命中 = 成功」。
     */
    private static void applyListUpdates(SQLiteDatabase db, JSONArray listInfos) {
        SQLiteStatement statement = null;
        synchronized (LIST_WRITE_LOCK) {
            db.beginTransaction();
            try {
                statement = db.compileStatement(SQL_LIST_UPDATE);
                for (int i = 0; i < listInfos.length(); i++) {
                    JSONObject info = requireInfoObject(listInfos, i);
                    statement.clearBindings();
                    // 绑定顺序 == SQL 里 ? 的出现顺序（1…5）。
                    bindNullableText(statement, 1, info, COLUMN_NAME, i);
                    bindNullableText(statement, 2, info, COLUMN_SOURCE, i);
                    bindNullableText(statement, 3, info, COLUMN_SOURCE_LIST_ID, i);
                    bindNullableTimestamp(statement, 4, info, i);
                    statement.bindString(5, requireId(info, i));
                    statement.executeUpdateDelete();
                }
                db.setTransactionSuccessful();
            } finally {
                if (statement != null) statement.close();
                db.endTransaction();
            }
        }
    }

    // ------------------------------------------------------------------ 第九刀-a：player_list_add

    /**
     * {@code player_list_add}：新建歌单（**invoke + 同名广播两半**，契约 {@code :102}）。
     *
     * @param args {@code args[0]} = {@code {position, listInfos}}：{@code position} 是整数
     *             （**负数合法** = 追加，见类注释「{@code position} 的校验形状」），
     *             {@code listInfos} 是 {@code {id, name, source?, sourceListId?, locationUpdateTime?}} 的数组
     * @return 固定 {@code null}（契约是 {@code void} —— **不返回新 id**，理由见类注释）
     * @throws IllegalArgumentException 参数非法（缺 / 不是对象 / {@code position} 缺失或不是整数 /
     *                                  {@code listInfos} 不是数组 / 元素不是对象 /
     *                                  {@code id} 不是非空字符串 / 可空列给了错的类型）
     * @throws IllegalStateException    库打不开 / 表缺失 / 语句失败（含 **id 冲突**）—— **不广播**
     */
    private static Object listAdd(Context context, RainMusicIpcHandlers.RequestContext ctx, List<Object> args) {
        JSONObject params = readAddParams(args);
        long position = requirePosition(params);
        JSONArray listInfos = requireAddListInfos(params);
        // 元素级参数校验在这里**一次做完**（而不是等到写库循环里）：坏载荷在打开库、开事务之前
        // 就大声失败，失败路径上一条 SQL、一个连接都没有（见「失败语义三态」那一节的参数非法行）。
        List<ListRow> additions = buildPayloadRows(listInfos);

        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST);
        applyListAdds(db, position, additions);

        // 只有走到这里才广播：事务**已提交**（applyListAdds 正常返回）且**在锁外**。
        // 载荷是**对象** {position, listInfos}，逐字对齐 winRendererEvent.ts:10 的
        // sendEvent(channel, { position, listInfos }) —— 渲染层 rendererListManage.ts:180
        // 是按这两个键解构的，发成裸数组会在那里立刻炸（见类注释「广播的形状是对象」）。
        // position 用**调用方传来的那个值**，不折算（理由见类注释同一节）。
        JSONObject payload = new JSONObject();
        payload.put(FIELD_POSITION, position);
        payload.put(FIELD_LIST_INFOS, listInfos);
        ctx.emitTo(CHANNEL_LIST_ADD, payload);

        Logger.info(
            TAG,
            CHANNEL_LIST_ADD + "：已提交并广播 " + listInfos.length() +
            " 个新歌单（对象载荷 {position, listInfos}，形状对齐 winRendererEvent.ts:9-11）"
        );
        return null;
    }

    /**
     * 新建歌单的写库部分：<b>一个事务</b>（对齐桌面 {@code dbHelper.ts:58-75} 的
     * {@code insertUserLists}），整段在 {@link #LIST_WRITE_LOCK} 内。
     *
     * <p><b>两个分支</b>（判定抄桌面 {@code modules/list/index.ts:72}）：
     * <ol>
     *   <li><b>追加</b>（{@code position < 0 || position >= COUNT(*)}）：只 INSERT 这 M 行。
     *       {@code position} 从 {@code MAX(position)+1} 起递增 ⇒ **允许空洞**
     *       （桌面 {@code index.ts:73-74} 明写"不能直接用 length"）；</li>
     *   <li><b>插队</b>（否则）：先 {@code DELETE FROM "main"."my_list"}，再把 N+M 行按新顺序
     *       全量 INSERT，{@code position} 重编号 {@code 0..n-1}（桌面 {@code index.ts:89-92}）。</li>
     * </ol>
     * 两个分支都不碰 {@code my_list_music_info} / {@code my_list_music_info_order}。
     *
     * <p>⚠️ <b>读 {@code COUNT(*) / MAX(position)} 与读现有行都在锁内</b>（且插队分支的读在
     * 事务内）：这里是"先读后写"的复合操作，锁外读会让两个并发的 add 读到同一个基数。
     * 与第八刀"临界区只有 SQL"的形状不同 —— 那一刀没有读，这一刀**必须**把读包进来。
     *
     * <p>任何一步抛错（含 id 冲突 / {@code name} 为 NULL）⇒ 不标记事务成功 ⇒
     * {@code endTransaction()} 回滚 ⇒ 异常冒泡（**不会有广播**）。
     */
    private static void applyListAdds(SQLiteDatabase db, long position, List<ListRow> additions) {
        synchronized (LIST_WRITE_LOCK) {
            db.beginTransaction();
            try {
                boolean append = isAppendPosition(db, position);
                List<Object[]> rows = append
                    ? buildAppendRows(db, additions)
                    : buildRenumberedRows(db, position, additions);
                // isClear 那一半（桌面 dbHelper.ts:63）：**只有插队分支**清表。
                if (!append) db.execSQL(SQL_LIST_CLEAR);
                writeListRows(db, rows);
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
    }

    /**
     * 桌面 {@code index.ts:72} 的那半边条件：{@code position < 0 || position >= userLists.length}。
     * {@code userLists.length} = {@code COUNT(*)}（桌面那个数组就是 {@code queryAllUserList()} 读出来的）。
     *
     * <p><b>负数落在这里</b>（返回 {@code true} = 追加），不报错 —— 理由见类注释
     * 「{@code position} 的校验形状」。
     */
    private static boolean isAppendPosition(SQLiteDatabase db, long position) {
        Cursor cursor = db.rawQuery(SQL_COUNT_LISTS, null);
        try {
            return !cursor.moveToFirst() || position < 0 || position >= cursor.getLong(0);
        } finally {
            cursor.close();
        }
    }

    /**
     * 追加分支：新行的 position 从 {@code MAX(position)+1} 起依次递增
     * （桌面 {@code index.ts:75} 的 {@code order} + {@code :77} 的 {@code order + index}）。
     *
     * <p>空表 ⇒ {@code MAX} 是 NULL ⇒ 起点 {@code 0}（桌面那个三元表达式的 {@code : 0}）。
     * <b>允许空洞</b>：库里是 {@code 0,1,5} ⇒ 下一个是 {@code 6}。
     */
    private static List<Object[]> buildAppendRows(SQLiteDatabase db, List<ListRow> additions) {
        long order = readNextPosition(db);
        List<Object[]> rows = new ArrayList<>(additions.size());
        for (int i = 0; i < additions.size(); i++) {
            rows.add(additions.get(i).toArgs(order + i));
        }
        return rows;
    }

    /**
     * 插队分支：读出现有 N 行（按 {@code position ASC, rowid ASC}），把 M 条新行
     * {@code splice} 进 {@code position} 处（桌面 {@code index.ts:87-89}），然后把整个列表的
     * position 重编号成 {@code 0..n-1}（桌面 {@code :90-92}）。
     *
     * <p>返回的行序 = 它们将被 INSERT 的顺序 = 新的物理书写顺序（对 {@code ORDER BY position}
     * 的读没有影响，但让日志/调试和桌面一致）。
     */
    private static List<Object[]> buildRenumberedRows(SQLiteDatabase db, long position, List<ListRow> additions) {
        List<ListRow> merged = readOrderedRows(db);
        int at = (int) position;
        // 走到这里 position 一定在 [0, COUNT) 里（isAppendPosition 已经排除负数与越界）⇒ splice 安全。
        merged.addAll(at, additions);

        List<Object[]> rows = new ArrayList<>(merged.size());
        for (int i = 0; i < merged.size(); i++) {
            rows.add(merged.get(i).toArgs(i));
        }
        return rows;
    }

    /** 逐行 INSERT（{@code execSQL} 的形状与 {@code dbHelper.ts:65-72} 的逐条 {@code run} 一致）。 */
    private static void writeListRows(SQLiteDatabase db, List<Object[]> rows) {
        for (Object[] row : rows) db.execSQL(SQL_LIST_INSERT, row);
    }

    /**
     * 追加分支的起点：{@code MAX(position) + 1}，空表 ⇒ {@code 0}。
     *
     * <p>{@code MAX} 在空表上返回一行一列的 NULL（{@code moveToFirst()} 为真、{@code isNull(0)} 为真），
     * 所以两种情况都要判，不能只看 {@code moveToFirst()}。
     */
    private static long readNextPosition(SQLiteDatabase db) {
        Cursor cursor = db.rawQuery(SQL_MAX_POSITION, null);
        try {
            if (!cursor.moveToFirst() || cursor.isNull(0)) return 0L;
            return cursor.getLong(0) + 1L;
        } finally {
            cursor.close();
        }
    }

    /** 插队分支的数据来源：现有全部行，序 = {@code statements.ts:19} 的 {@code ORDER BY "position" ASC, "rowid" ASC}。 */
    private static List<ListRow> readOrderedRows(SQLiteDatabase db) {
        List<ListRow> rows = new ArrayList<>();
        Cursor cursor = db.rawQuery(SQL_LIST_ORDERED, null);
        try {
            int idIndex = cursor.getColumnIndexOrThrow(COLUMN_ID);
            int nameIndex = cursor.getColumnIndexOrThrow(COLUMN_NAME);
            int sourceIndex = cursor.getColumnIndexOrThrow(COLUMN_SOURCE);
            int sourceListIdIndex = cursor.getColumnIndexOrThrow(COLUMN_SOURCE_LIST_ID);
            int timeIndex = cursor.getColumnIndexOrThrow(COLUMN_LOCATION_UPDATE_TIME);
            while (cursor.moveToNext()) {
                // id / name 在 tables.ts:129-130 是 NOT NULL：读出来是 NULL 说明这份库的结构或数据
                // 已经被弄坏了。这里**大声抛错**（而不是把它当 NULL 再 INSERT 回去 —— 那会让这一刀
                // 既报不出真正的原因，又把坏数据原样重写一遍）。
                rows.add(new ListRow(
                    requireNotNullColumn(cursor.getString(idIndex), COLUMN_ID, rows.size()),
                    requireNotNullColumn(cursor.getString(nameIndex), COLUMN_NAME, rows.size()),
                    // source / sourceListId 可空：SQL NULL ⇒ JSON null 哨兵（绑定见 ListRow#toArgs）。
                    jsonNullIfNull(cursor.getString(sourceIndex)),
                    // ⚠️ 第十刀-b：sourceListId 读出来**必须**接上和读通道 / 桌面同一条的 `.0` 归一化。
                    // 少了它，老库里的 "123.0" 在插队整表重写之后仍是 "123.0"，而渲染层走读通道
                    // （RainMusicListChannels.java:283 会去掉）看到的是 123 ⇒ 两侧视图不一致。
                    jsonNullIfNull(stripLegacyNumericIdSuffix(cursor.getString(sourceListIdIndex))),
                    // locationUpdateTime 在 tables.ts:135 是 INTEGER 且可空 ⇒ isNull 要原样保留。
                    cursor.isNull(timeIndex) ? JSONObject.NULL : Long.valueOf(cursor.getLong(timeIndex))
                ));
            }
        } finally {
            cursor.close();
        }
        return rows;
    }

    /**
     * 一行歌单（{@link #SQL_LIST_INSERT} 的 6 列）。
     *
     * <p>存在的理由：插队分支要在**写之前**把"N+M 行、每行的新 position"完整算出来
     * （重编号是整表动作，不能一边读一边写），所以需要一个不依赖 {@code Cursor} 的行表示。
     */
    private static final class ListRow {

        private final String id;
        private final String name;
        /** {@code source} / {@code sourceListId}：可能是 {@code String} 或 JSON null 哨兵（见 {@link #toArgs}）。 */
        private final Object source;
        private final Object sourceListId;
        /** {@code locationUpdateTime}：可能是 {@code Long} 或 JSON null 哨兵。 */
        private final Object locationUpdateTime;

        private ListRow(String id, String name, Object source, Object sourceListId, Object locationUpdateTime) {
            this.id = id;
            this.name = name;
            this.source = source;
            this.sourceListId = sourceListId;
            this.locationUpdateTime = locationUpdateTime;
        }

        /** 从调用方载荷里来的一行（{@code id} 必须是非空字符串；{@code name} 必填）。 */
        static ListRow fromPayload(JSONObject info, int index) {
            Object rawTime = info.opt(COLUMN_LOCATION_UPDATE_TIME);
            Object time = (rawTime == null || rawTime == JSONObject.NULL)
                ? JSONObject.NULL
                : Long.valueOf(requireIntegerMillis(rawTime, index));
            return new ListRow(
                requireAddId(info, index),
                requireText(info, COLUMN_NAME, index),
                optionalColumn(info, COLUMN_SOURCE, index),
                optionalColumn(info, COLUMN_SOURCE_LIST_ID, index),
                time
            );
        }

        /**
         * 绑定参数，顺序 == {@link #SQL_LIST_INSERT} 里 {@code ?} 的出现顺序
         * （id, name, source, sourceListId, position, locationUpdateTime）。
         *
         * <p>{@code position} 一律换成"重编号后的下标"，**不写** {@code MAX(position)+1} ——
         * 追加分支由调用方传入正确的 {@code order + index}，插队分支就是 {@code 0..n-1}。
         *
         * <p>⚠️ <b>可空列绑的是 {@code JSONObject.NULL} 哨兵，不是 Java {@code null}</b>：
         * Android 的 {@code SQLiteDatabase.execSQL(String, Object[])} 对 {@code null} 元素的处理
         * 是本文件**在本机无法验证**的一格（没有 android.jar ⇒ 只能由 CI / 真机证伪）。
         * {@code org.json} 的哨兵在所有 {@code SQLiteProgram.bind*} 路径上都被明确处理成
         * SQL NULL（{@code JSONObject.NULL.toString() == "null"} 也有定义），所以本通道把
         * NATIVE_NULL 的输入统一换成它，把"能不能绑 null"这个问题从**运行期**移走。
         */
        Object[] toArgs(long position) {
            return new Object[] { id, name, source, sourceListId, Long.valueOf(position), locationUpdateTime };
        }
    }

    /** 全部载荷行：逐个校验并转成 {@link ListRow}（下标只用于点名第几个元素）。 */
    private static List<ListRow> buildPayloadRows(JSONArray listInfos) {
        List<ListRow> rows = new ArrayList<>(listInfos.length());
        for (int i = 0; i < listInfos.length(); i++) {
            rows.add(ListRow.fromPayload(requireAddInfoObject(listInfos, i), i));
        }
        return rows;
    }

    // ------------------------------------------------------------------ 参数校验（第九刀-a）

    /**
     * 取 {@code args[0]} 作为参数对象 {@code {position, listInfos}}（契约 {@code :102}）。
     *
     * <p>形状与第八刀的 {@code listInfos[]} 不同：那一条的参数**就是**那个数组，这一条是**一个对象**。
     * 所以"直接给数组"（照第八刀的形状抄）在这里是**参数错误**，不是"没指定 position" ——
     * 后者在链上写作 {@code position: -1}（{@code store/list/action.ts:56}），仍然是一个对象。
     */
    private static JSONObject readAddParams(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 需要一个 `{position, " + FIELD_LIST_INFOS + "}` 参数" +
                "（契约 docs/android/ipc-contract.md:102：`{position, listInfos}` → `void`），收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (first instanceof JSONObject) return (JSONObject) first;
        throw new IllegalArgumentException(
            CHANNEL_LIST_ADD + " 的参数必须是对象（`{position, " + FIELD_LIST_INFOS + "}`），收到 " +
            first.getClass().getName() + "：" + describeArgs(args) +
            "（契约是 args=[{position, " + FIELD_LIST_INFOS + "}]，**不是** args=[[" +
            FIELD_LIST_INFOS + "]] —— 裸数组形状属于 player_list_update/remove）"
        );
    }

    /**
     * {@code position}：必须**存在**、是**数值**、且是**整数**（{@code 1.5} ⇒ 点名报错）。
     *
     * <p>⚠️ <b>不校验范围、不拒绝负数</b>：{@code < 0} 是合法的"追加"输入
     * （桌面 {@code index.ts:72}、渲染层 {@code store/list/action.ts:56,65} 的 {@code -1}）。
     * 逐条理由见类注释「{@code position} 的校验形状」。
     */
    private static long requirePosition(JSONObject params) {
        Object raw = params.opt(FIELD_POSITION);
        if (raw == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 缺少 `" + FIELD_POSITION + "` 字段（收到的顶层键=" +
                String.valueOf(params.names()) + "）。契约 :102 的参数是 `{position, " +
                FIELD_LIST_INFOS + "}`；**没有** position 时请显式传 -1（追加）"
            );
        }
        if (!(raw instanceof Number)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_POSITION + "` 必须是数字（整数；负数 = 追加），收到 " +
                raw.getClass().getName()
            );
        }
        Number number = (Number) raw;
        long value = number.longValue();
        if (number.doubleValue() != (double) value) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_POSITION + "` 必须是整数，收到 " + number +
                "（歌单位置是整数下标；本通道不截断）"
            );
        }
        return value;
    }

    /** {@code listInfos}：必须是数组（元素形状由 {@link #requireAddInfoObject} 逐个判）。 */
    private static JSONArray requireAddListInfos(JSONObject params) {
        Object raw = params.opt(FIELD_LIST_INFOS);
        if (raw == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 缺少 `" + FIELD_LIST_INFOS + "` 字段（收到的顶层键=" +
                String.valueOf(params.names()) + "）；契约 :102 的参数是 `{position, " +
                FIELD_LIST_INFOS + "}`"
            );
        }
        if (raw instanceof JSONArray) return (JSONArray) raw;
        throw new IllegalArgumentException(
            CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 必须是数组，收到 " +
            raw.getClass().getName()
        );
    }

    /** 第 {@code index} 个元素必须是一个对象（{@code {id, name, …}}）。 */
    private static JSONObject requireAddInfoObject(JSONArray listInfos, int index) {
        Object raw = listInfos.opt(index);
        if (raw instanceof JSONObject) return (JSONObject) raw;
        throw new IllegalArgumentException(
            CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素必须是对象" +
            "（{id, name, source?, sourceListId?, locationUpdateTime?}），收到 " +
            (raw == null ? "null" : raw.getClass().getName())
        );
    }

    /**
     * 元素的 {@code id}：必须**存在**、是**字符串**、且**非空**（{@code my_list} 的主键，
     * {@code tables.ts:136}）。三种坏形状各一条点名的消息（形状照 {@link #requireId}）。
     */
    private static String requireAddId(JSONObject info, int index) {
        Object raw = info.opt(COLUMN_ID);
        if (raw == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素缺少 `" +
                COLUMN_ID + "` 字段（收到的顶层键=" + String.valueOf(info.names()) + "）"
            );
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素的 `" +
                COLUMN_ID + "` 必须是字符串，收到 " + raw.getClass().getName()
            );
        }
        String id = (String) raw;
        if (id.length() == 0) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素的 `" +
                COLUMN_ID + "` 不能是空字符串（`my_list` 的主键不允许空串）"
            );
        }
        return id;
    }

    /** 必填文本列（{@code name}，{@code tables.ts:131} 是 {@code TEXT NOT NULL}）：缺失 / NULL ⇒ 点名报错。 */
    private static String requireText(JSONObject info, String field, int index) {
        Object raw = info.opt(field);
        if (raw == null || raw == JSONObject.NULL) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素缺少 `" + field +
                "`（`my_list` 的这一列是 NOT NULL；本通道**不**替调用方编一个默认名）"
            );
        }
        return String.valueOf(raw);
    }

    /**
     * 可空列（{@code source} / {@code sourceListId}）：缺失或 JSON null ⇒
     * {@code JSONObject.NULL} 哨兵（绑成 SQL NULL，见 {@link ListRow#toArgs}）；在、但不是标量 ⇒ 点名报错。
     */
    private static Object optionalColumn(JSONObject info, String field, int index) {
        Object raw = info.opt(field);
        if (raw == null || raw == JSONObject.NULL) return JSONObject.NULL;
        if (raw instanceof String || raw instanceof Number || raw instanceof Boolean) return raw;
        throw new IllegalArgumentException(
            CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素的 `" + field +
            "` 必须是字符串（或数字 / 布尔 / null），收到 " + raw.getClass().getName()
        );
    }

    /** 读出来的可空文本：SQL NULL ⇒ JSON null 哨兵，否则原值。 */
    private static Object jsonNullIfNull(String value) {
        return value == null ? JSONObject.NULL : value;
    }

    /**
     * {@code /.0$/} 的等价实现：**只**去掉末尾的 {@code .0}（桌面 {@code dbHelper.ts:44-49} 的
     * {@code idFixRxp = /\.0$/}，注释写明是"兼容 v2.3.0 之前版本插入数字类型的 ID"）。
     * {@code null} 原样返回（该列可空）。
     *
     * <p>⚠️ 与读通道 {@code RainMusicListChannels.java:314-317} 的同名方法**逐字同形**
     * （那一份是第四刀写的、{@code private}）。这里刻意再写一份而不是把那一份改成包内可见：
     * 第十刀-b 的范围只允许动本文件（动读通道要先汇报）。两份实现由用例逐字对齐钉住 ——
     * 改一份必须同时改另一份，否则读 / 写两条通道对同一个 {@code "123.0"} 会给出两个答案。
     */
    private static String stripLegacyNumericIdSuffix(String sourceListId) {
        if (sourceListId == null) return null;
        return sourceListId.endsWith(".0") ? sourceListId.substring(0, sourceListId.length() - 2) : sourceListId;
    }

    /** {@code locationUpdateTime}（{@code tables.ts:135}：{@code INTEGER}，可空）⇒ 整数毫秒，不截断。 */
    private static long requireIntegerMillis(Object raw, int index) {
        if (!(raw instanceof Number)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素的 `" +
                COLUMN_LOCATION_UPDATE_TIME + "` 必须是数字或 null（云端歌单的更新时间戳，毫秒），收到 " +
                raw.getClass().getName()
            );
        }
        Number number = (Number) raw;
        long millis = number.longValue();
        if (number.doubleValue() != (double) millis) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_ADD + " 的 `" + FIELD_LIST_INFOS + "` 第 " + index + " 个元素的 `" +
                COLUMN_LOCATION_UPDATE_TIME + "` 必须是整数毫秒，收到 " + number + "（列是 INTEGER，本通道不截断）"
            );
        }
        return millis;
    }

    /**
     * 插队分支读出来的一列必须是 NOT NULL（{@code id} / {@code name}）。
     * {@code null} ⇒ 抛错点名列与行号：见 {@link #readOrderedRows} 的理由。
     */
    private static String requireNotNullColumn(String value, String column, int rowIndex) {
        if (value != null) return value;
        throw new IllegalStateException(
            CHANNEL_LIST_ADD + "：读第 " + rowIndex + " 行时 `my_list`.`" + column + "` 是 NULL，" +
            "但那一列在 tables.ts 里是 NOT NULL ⇒ 这份库的数据或结构已经坏了。" +
            "本通道**不会**把 NULL 原样当成一次成功的新建重写回去（那只会把坏数据固化）"
        );
    }

    // ------------------------------------------------------------------ 第十刀-a：player_list_remove

    /**
     * {@code player_list_remove}：批量删除歌单（**invoke + 同名广播两半**，契约 {@code :103}）。
     *
     * @param args {@code args[0]} = {@code ids} 数组，元素必须是**非空字符串**、且**不是保留 id**
     *             （{@code default} / {@code temp}，见类注释「必须拒绝保留 id」）
     * @return 固定 {@code null}（契约是 {@code void}；桌面 {@code ListEvent.list_remove} 也不返回东西）
     * @throws IllegalArgumentException 参数非法（缺参数 / 不是数组 / 元素不是字符串 / 空串 /
     *                                  **保留 id**）—— 全部在打开库之前抛出，失败路径上一条 SQL、
     *                                  一个连接都没有
     * @throws IllegalStateException    库打不开 / 三张表里缺任何一张 / 语句失败 —— **不广播**
     */
    private static Object listRemove(Context context, RainMusicIpcHandlers.RequestContext ctx, List<Object> args) {
        JSONArray ids = readRemoveIds(args);

        // 三张表都在 requiredTables 里点名：本通道真的要写这三张（逐句对应 statements.ts:49 / :119 / :192）。
        // open() 的 requireTable 会在**开事务之前**把"表缺失"变成一条点名到表的 reject —— 比让
        // 第 2/3 句 DELETE 在事务里抛 "no such table" 更早、也更清楚（表缺失 = 库坏了，不是"没删到"）。
        SQLiteDatabase db = RainMusicDatabase.open(
            context,
            RainMusicDatabase.TABLE_MY_LIST,
            TABLE_MY_LIST_MUSIC_INFO,
            TABLE_MY_LIST_MUSIC_INFO_ORDER
        );
        applyListRemoves(db, ids);

        // 只有走到这里才广播：事务**已提交**（applyListRemoves 正常返回）且**在锁外**。
        // 载荷 = 调用方传来的那个数组本身（与桌面 ListEvent.ts:63 把**同一个 ids** 往后传一致），
        // 形状是**裸数组** —— 逐字对齐 winRendererEvent.ts:12-14 的 sendEvent(channel, ids)，
        // 渲染层 rendererListManage.ts:185-188 的 `list_remove = ({params: ids}) => …` 是按数组解的。
        // 包成 `{ids: […]}` 会让 action.ts:163 的 `for (const id of ids)` 立刻 TypeError，而那个异常
        // 会被桥吞成一条 console.error（capacitor.js:464-467）⇒ 界面完全不动、调用方也拿不到 reject。
        ctx.emitTo(CHANNEL_LIST_REMOVE, ids);

        Logger.info(
            TAG,
            CHANNEL_LIST_REMOVE + "：已提交并广播 " + ids.length() +
            " 个歌单 id 的删除（裸数组载荷，形状对齐 winRendererEvent.ts:12-14）"
        );
        return null;
    }

    /**
     * 删除的写库部分：**一个事务、每个 id 三句 DELETE**（抄桌面 {@code dbHelper.ts:85-91} 的
     * {@code deleteUserLists}，逐句对应 {@code statements.ts:49 / :119 / :192}），整段在
     * {@link #LIST_WRITE_LOCK} 内。
     *
     * <p><b>循环形状是"每个 id 三句连着发"，不是"先删完所有 my_list 再删子表"</b>
     * （桌面 {@code dbHelper.ts:86-90} 就是前者）。两者在语义上等价，但顺序在探针里是可观察的
     * （假库按执行序记 SQL），也决定了出错时"哪几句已经发出去过"。
     *
     * <p>三句的 {@code executeUpdateDelete()} 返回值**一律丢掉**：0 行命中 = 成功（幂等）。
     * 桌面 {@code better-sqlite3} 的 {@code .run()} 对不存在的 id 同样返回 {@code {changes: 0}}
     * 且不抛错；把它当失败是加一条桌面没有的语义，会让一次幂等的删除在界面上弹一个错。
     * 也**不做**重排 / 重编号（{@code my_list} 的 {@code position} 允许空洞，桌面删除时同样不重排）。
     *
     * <p>任何一步抛错 ⇒ 不调 {@code setTransactionSuccessful()} ⇒ {@code endTransaction()} 回滚
     * ⇒ 异常继续往上冒（handler 变成 {@code ok:false}，且**不会有广播**）。"删了一半"是不允许的：
     * 渲染层收到广播会就地改它那份列表，半批成功在界面上无法与全批区分。
     *
     * <p>空数组 ⇒ 循环一次都不进、事务照样 begin/commit ⇒ 0 条 SQL、成功、广播一个空数组
     * （桌面 {@code db.transaction(…)([])} 同形）。
     */
    private static void applyListRemoves(SQLiteDatabase db, JSONArray ids) {
        SQLiteStatement listDelete = null;
        SQLiteStatement musicInfoDelete = null;
        SQLiteStatement orderDelete = null;
        synchronized (LIST_WRITE_LOCK) {
            db.beginTransaction();
            try {
                // ⚠️ **空数组连 prepare 都不做**（"0 条 SQL"要在任何读法下都字面成立）：桌面
                // dbHelper.ts:82-84 是在事务之前无条件 prepare 三条语句的，但那个差异除了"空批次的
                // prepare 次数"之外**不可观察** —— 三张表的存在性已经由 open() 的 requireTable 保证，
                // 非空批次这边仍然只 prepare 一次（不是每个 id 重新 prepare）。
                if (ids.length() > 0) {
                    listDelete = db.compileStatement(SQL_LIST_DELETE);
                    musicInfoDelete = db.compileStatement(SQL_MUSIC_INFO_DELETE_BY_LIST_ID);
                    orderDelete = db.compileStatement(SQL_MUSIC_INFO_ORDER_DELETE_BY_LIST_ID);
                }
                for (int i = 0; i < ids.length(); i++) {
                    // readRemoveIds() 已经逐条证明过"每个元素都是非空字符串、且不是保留 id"，
                    // 这里只把它取出来（校验**不**在锁里、也不在事务里做）。
                    String id = (String) ids.opt(i);
                    // 1) my_list 那一行（statements.ts:49）
                    listDelete.clearBindings();
                    listDelete.bindString(1, id);
                    listDelete.executeUpdateDelete();
                    // 2) 歌单里的歌曲行（statements.ts:119）—— 漏掉它 = 孤儿歌曲
                    musicInfoDelete.clearBindings();
                    musicInfoDelete.bindString(1, id);
                    musicInfoDelete.executeUpdateDelete();
                    // 3) 歌单的行序（statements.ts:192）—— 漏掉它 = 行序漂移
                    orderDelete.clearBindings();
                    orderDelete.bindString(1, id);
                    orderDelete.executeUpdateDelete();
                }
                db.setTransactionSuccessful();
            } finally {
                if (listDelete != null) listDelete.close();
                if (musicInfoDelete != null) musicInfoDelete.close();
                if (orderDelete != null) orderDelete.close();
                db.endTransaction();
            }
        }
    }

    // ------------------------------------------------------------------ 参数校验（第十刀-a）

    /**
     * 取 {@code args[0]} 作为 {@code ids} 数组，并把**每一个元素都校验完**：必须是字符串、非空、
     * 且**不是保留 id**。
     *
     * <p>校验写在这里（而不是像 update 那样在写库循环里）：本通道的载荷里**没有任何"对象字段"**
     * 要读，整份载荷在进锁 / 打开库之前就能校验干净 ⇒ 坏载荷在失败路径上一条 SQL、一个连接都没有
     * （"保留 id"这条尤其必须在 open 之前：它是数据丢失防护，不是"库坏了"）。
     *
     * <p>返回的是**调用方传来的那个数组本身**（不是新拼的）：广播要发的就是它，
     * 与桌面把同一个 {@code ids} 从 {@code rendererEvent} 一路传到 {@code ListEvent.emit} 一致。
     */
    private static JSONArray readRemoveIds(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_REMOVE + " 需要一个 `" + FIELD_IDS + "` 数组参数" +
                "（契约 docs/android/ipc-contract.md:103：`ids: string[]` → `void`），收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (!(first instanceof JSONArray)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_REMOVE + " 的参数必须是数组（`" + FIELD_IDS + "`），收到 " +
                first.getClass().getName() + "：" + describeArgs(args) +
                "（契约是 args=[[" + FIELD_IDS + "]]，**不是** args=[{" + FIELD_IDS + ": […]}]）"
            );
        }
        JSONArray ids = (JSONArray) first;
        // 逐条校验：空数组 ⇒ 这个循环一次都不进（空数组是合法的：0 条 SQL、成功）。
        for (int i = 0; i < ids.length(); i++) requireRemoveId(ids, i);
        return ids;
    }

    /**
     * 第 {@code index} 个元素：必须存在、是字符串、非空，且**不是保留 id**。
     *
     * <p>四种坏形状各给一条**点名**的消息（前三种照 {@link #requireAddId} 的形状）。
     * 第四种（保留 id）是本通道特有的、**有意**加的一条限制，理由与措辞见类注释
     * 「必须拒绝保留 id」——消息里必须把"为什么"写全，因为渲染层只会把这条 message 打进
     * {@code console.error}，那是真机上唯一的线索。
     */
    private static String requireRemoveId(JSONArray ids, int index) {
        Object raw = ids.opt(index);
        if (raw == null || raw == JSONObject.NULL) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_REMOVE + " 的 `" + FIELD_IDS + "` 第 " + index + " 个元素是 null" +
                "（契约 docs/android/ipc-contract.md:103 是 `ids: string[]`：每个元素都必须是非空字符串；" +
                "本通道**不**替调用方跳过 null —— 静默跳过会让「删 3 个」变成「删 2 个」却回 ok）"
            );
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_REMOVE + " 的 `" + FIELD_IDS + "` 第 " + index + " 个元素必须是字符串，收到 " +
                raw.getClass().getName()
            );
        }
        String id = (String) raw;
        if (id.length() == 0) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_REMOVE + " 的 `" + FIELD_IDS + "` 第 " + index + " 个元素不能是空字符串" +
                "（`WHERE \"id\"=?` 拿一个空串去匹配只会静默命中 0 行；空串也不可能是歌单的 id）"
            );
        }
        if (RESERVED_LIST_ID_DEFAULT.equals(id) || RESERVED_LIST_ID_TEMP.equals(id) || "love".equals(id)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_REMOVE + " 拒绝删除保留列表 `" + id + "`（`" + FIELD_IDS + "` 第 " + index +
                " 个元素）：保留列表（`" + RESERVED_LIST_ID_DEFAULT + "` / `" + RESERVED_LIST_ID_TEMP +
                "`，见 src/common/constants.ts 的 LIST_IDS）按本应用的代码路径**从不写进** `my_list`，" +
                "它只以 `listId` 的形式存在于 `my_list_music_info` / `my_list_music_info_order` 里。" +
                "所以照抄桌面的三句 DELETE 对它的结果是：`my_list` 删 0 行（**看起来成功**）、" +
                "而两张子表真的被删光 —— 删除一个保留列表只会清空它的歌曲（试听列表的歌会全没），" +
                "却删不掉列表本身；数据库层没有任何外键 / 触发器会挡住这件事。" +
                "**本通道有意在这里偏离桌面语义**：桌面这一层没有任何保护（唯一的防线是界面菜单 " +
                "src/renderer/views/List/MyList/useMenu.js:102-104 的 `case -2` 那一支），" +
                "Android 侧选择大声拒绝，而不是静默清空用户的试听列表。"
            );
        }
        return id;
    }

    // ------------------------------------------------------------------ 参数校验

    /**
     * 取 {@code args[0]} 作为 {@code listInfos} 数组（{@link #CHANNEL_LIST_UPDATE} 的参数形状）。
     *
     * <p>契约的形状是 {@code args = [ [{id,name,…}, …] ]}（一个数组包着若干对象），
     * 渲染层也是这么发的（{@code rendererInvoke(channel, data)} 的 {@code data} 就是数组 ⇒
     * 信封里 {@code args = [data]}）。
     * 所以"对象"（例如误包成 {@code {listInfos: […]}}）是**参数错误**，不是"空列表"。
     *
     * <p>{@code channel} / {@code contract} / {@code shape} 三个参数是**给消息用的**（第九刀-a 把它
     * 参数化，好让两条通道各自在错误信息里点名自己那一行契约）：本方法只被
     * {@link #listUpdate} 调用一次，所以它们在真机上恒为
     * {@code CHANNEL_LIST_UPDATE / docs/android/ipc-contract.md:104 / `listInfos[]`}。
     * 第九刀-a 的 add 参数是**另一个形状**（对象包着这个数组），所以那一条**没有**复用本方法，
     * 而是自己写了 {@link #requireAddListInfos} —— 复用会让"传成裸数组"这种写错法在两边的
     * 消息里长得一样，从而没法区分。
     *
     * <p>只接受 {@code org.json.JSONArray}：Capacitor 的 {@code JSArray} 是它的子类
     * （{@code @capacitor/android} 的 {@code JSArray extends JSONArray}），而
     * {@code MessageHandler.java:54} 是从 JSON 字符串解析出调用参数的 ⇒ 嵌套数组到这一层
     * 就是 {@code JSONArray}。多一层 {@code List} 兜底在这里没有意义，反而会让"传错了"
     * 变成"能跑"，所以不加。
     */
    private static JSONArray readListInfos(List<Object> args, String channel, String contract, String shape) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                channel + " 需要一个 `" + FIELD_LIST_INFOS + "` 数组参数" +
                "（契约 " + contract + "：`" + shape + "` → `void`），收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (first instanceof JSONArray) return (JSONArray) first;
        throw new IllegalArgumentException(
            channel + " 的参数必须是数组（`" + FIELD_LIST_INFOS + "`），收到 " +
            first.getClass().getName() + "：" + describeArgs(args) +
            "（契约是 args=[[{id,name,…}, …]]，**不是** args=[{" + FIELD_LIST_INFOS + ": […]}]）"
        );
    }

    /** 第 {@code index} 个元素必须是一个对象（{@code {id, name, …}}）。 */
    private static JSONObject requireInfoObject(JSONArray listInfos, int index) {
        Object raw = listInfos.opt(index);
        if (raw instanceof JSONObject) return (JSONObject) raw;
        throw new IllegalArgumentException(
            CHANNEL_LIST_UPDATE + " 的第 " + index + " 个元素必须是对象" +
            "（{id, name, source?, sourceListId?, locationUpdateTime?}），收到 " +
            (raw == null ? "null" : raw.getClass().getName())
        );
    }

    /**
     * 元素的 {@code id}：必须**存在**、是**字符串**、且**非空**。
     *
     * <p>这是本通道唯一不能含糊的字段 —— 没有它，{@code WHERE "id"=?} 就无从下手；
     * 猜一个（例如按 name 匹配）会改错歌单。所以三种坏形状各给一条**点名**的消息。
     */
    private static String requireId(JSONObject info, int index) {
        Object raw = info.opt(COLUMN_ID);
        if (raw == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 的第 " + index + " 个元素缺少 `" + COLUMN_ID + "` 字段" +
                "（收到的顶层键=" + String.valueOf(info.names()) + "）"
            );
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 的第 " + index + " 个元素的 `" + COLUMN_ID + "` 必须是字符串，收到 " +
                raw.getClass().getName()
            );
        }
        String id = (String) raw;
        if (id.length() == 0) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 的第 " + index + " 个元素的 `" + COLUMN_ID + "` 不能是空字符串" +
                "（`WHERE \"id\"=?` 拿一个空串去匹配，只会静默命中 0 行）"
            );
        }
        return id;
    }

    /**
     * 绑一列可空文本。**字段缺失或为 JSON null ⇒ 绑 NULL**（{@code source} /
     * {@code sourceListId} / {@code name} 三列都走这里；{@code name} 的 NOT NULL 约束由 SQLite
     * 在语句执行时报出来，见类注释「载荷里没带的列写 NULL」）。
     *
     * <p>字段在、但类型不是字符串 ⇒ 点名报错。**不**用 {@code JSONObject.optString()}：
     * 它会把数字 {@code 123} 悄悄变成字符串 {@code "123"}，那是"静默改数据"。
     */
    private static void bindNullableText(SQLiteStatement statement, int bindIndex, JSONObject info, String field, int elementIndex) {
        Object raw = info.opt(field);
        if (raw == null || raw == JSONObject.NULL) {
            statement.bindNull(bindIndex);
            return;
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 的第 " + elementIndex + " 个元素的 `" + field + "` 必须是字符串或 null，收到 " +
                raw.getClass().getName()
            );
        }
        statement.bindString(bindIndex, (String) raw);
    }

    /**
     * 绑 {@code locationUpdateTime}（{@code tables.ts:135}：{@code INTEGER}，可空）。
     * 字段缺失或为 JSON null ⇒ NULL。在、但**不是整数**（类型不对，或带小数点）⇒ 点名报错：
     * 桌面写进来的只有 {@code Date.now()} 这种整数毫秒，静默截断 {@code 1.9} 是改数据。
     */
    private static void bindNullableTimestamp(SQLiteStatement statement, int bindIndex, JSONObject info, int elementIndex) {
        Object raw = info.opt(COLUMN_LOCATION_UPDATE_TIME);
        if (raw == null || raw == JSONObject.NULL) {
            statement.bindNull(bindIndex);
            return;
        }
        if (!(raw instanceof Number)) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 的第 " + elementIndex + " 个元素的 `" + COLUMN_LOCATION_UPDATE_TIME +
                "` 必须是数字或 null（云端歌单的更新时间戳，毫秒），收到 " + raw.getClass().getName()
            );
        }
        Number number = (Number) raw;
        long millis = number.longValue();
        if (number.doubleValue() != (double) millis) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 的第 " + elementIndex + " 个元素的 `" + COLUMN_LOCATION_UPDATE_TIME +
                "` 必须是整数毫秒，收到 " + number + "（列是 INTEGER，本通道不截断）"
            );
        }
        statement.bindLong(bindIndex, millis);
    }

    // ------------------------------------------------------------------ 工具

    private static Context requireContext(RainMusicIpcPlugin plugin) {
        Context context = plugin.getContext();
        if (context == null) {
            throw new IllegalStateException(
                "拿不到 Context（插件还没挂上 Bridge/Activity）：无法写 " + RainMusicDatabase.DATABASE_NAME
            );
        }
        Context appContext = context.getApplicationContext();
        return appContext == null ? context : appContext;
    }

    /** 只打参数**类型**，不打内容（歌单名是用户数据，不进日志）。 */
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
}
