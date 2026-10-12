package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Android 移植 · **P0-2 第八刀**：歌单写通道的第一条 —— 改名
 * {@code player_list_update}（**invoke + 广播两半**）。
 *
 * <pre>
 * player_list_update   invoke,  args=[listInfos[]]  → void   （契约 docs/android/ipc-contract.md:104）
 * player_list_update   event,   args=[listInfos[]]           （主进程 → 渲染层，裸数组；契约同一条，
 *                                                              本刀把它从"单向"改成"双向"）
 * </pre>
 *
 * <p>这一族（{@code player_list_*}）的写侧一共 5 条，本刀**只做 1 条**：
 * {@code player_list_add}（{@code list_create}）与 {@code player_list_remove}（{@code list_remove}）
 * 留给第九 / 第十刀，{@code player_list_update_position} 与 {@code player_list_data_overwire}
 * 各有各的形状（前者是"一批 id 的 position 重排"、后者是整表覆盖），都不在本刀范围。
 * 三条写通道（add / update / remove）**共用本文件**：这是刻意的 —— 见「{@code LIST_WRITE_LOCK}」。
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
 * （本刀的 {@code player_list_update}，第九刀的 {@code player_list_add}，第十刀的
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
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.database.*} 与 {@code org.json}、JDK 的 {@code java.util.List}，
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

    /** {@code my_list} 的列名（{@code tables.ts:129-137}），只在本文件里用。 */
    private static final String COLUMN_NAME = "name";
    private static final String COLUMN_SOURCE = "source";
    private static final String COLUMN_SOURCE_LIST_ID = "sourceListId";
    private static final String COLUMN_LOCATION_UPDATE_TIME = "locationUpdateTime";
    private static final String COLUMN_ID = "id";

    /**
     * 契约那一格写的参数名 {@code listInfos}（{@code ipc-contract.md:104}）。
     * 只出现在**错误信息**里：桌面 {@code rendererEvent.ts:18} 是靠
     * {@code ({params: listInfos})` 的**解构名**取的，wire 上根本没有这个键 ——
     * 参数就是那个数组本身。错误信息里点名它，是为了让写错的人一眼看见自己该传什么。
     */
    private static final String FIELD_LIST_INFOS = "listInfos";

    private static final String TAG = "RainMusicListWrite";

    private RainMusicListWriteChannels() {}

    /**
     * 注册这一条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的
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
        // ⚠️ 这里**只打文件名**、不调 getDatabasePath()：load() 阶段 Context 可能还没有
        // （所以 Context 一律留到 handler 调用时再取）。绝对路径由 open() 在真机上打进错误信息。
        Logger.info(
            TAG,
            "P0-2 第八刀：已注册 " + CHANNEL_LIST_UPDATE +
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
        JSONArray listInfos = readListInfos(args);

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

    // ------------------------------------------------------------------ 参数校验

    /**
     * 取 {@code args[0]} 作为 {@code listInfos} 数组。
     *
     * <p>契约的形状是 {@code args = [ [{id,name,…}, …] ]}（一个数组包着若干对象），
     * 渲染层也是这么发的（{@code rendererInvoke(channel, data)} 的 {@code data} 就是数组 ⇒
     * 信封里 {@code args = [data]}）。
     * 所以"对象"（例如误包成 {@code {listInfos: […]}}）是**参数错误**，不是"空列表"。
     *
     * <p>只接受 {@code org.json.JSONArray}：Capacitor 的 {@code JSArray} 是它的子类
     * （{@code @capacitor/android} 的 {@code JSArray extends JSONArray}），而
     * {@code MessageHandler.java:54} 是从 JSON 字符串解析出调用参数的 ⇒ 嵌套数组到这一层
     * 就是 {@code JSONArray}。多一层 {@code List} 兜底在这里没有意义，反而会让"传错了"
     * 变成"能跑"，所以不加。
     */
    private static JSONArray readListInfos(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_LIST_UPDATE + " 需要一个 `" + FIELD_LIST_INFOS + "` 数组参数" +
                "（契约 docs/android/ipc-contract.md:104：`listInfos[]` → `void`），收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (first instanceof JSONArray) return (JSONArray) first;
        throw new IllegalArgumentException(
            CHANNEL_LIST_UPDATE + " 的参数必须是数组（`" + FIELD_LIST_INFOS + "`），收到 " +
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
