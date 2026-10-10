package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Android 移植 · **P0-2 第六刀**：{@code player_list_music_get} 的**纯读**实现
 * （默认列的去重**写回**留给下一刀）。
 *
 * <pre>
 * player_list_music_get   invoke, args=[listId]  → Rain.Music.MusicInfo[]   （契约 docs/android/ipc-contract.md:107）
 * </pre>
 *
 * <p>落点、建表、版本、单例一律复用 {@link RainMusicDatabase}；本文件只放这条通道自己的
 * {@code SELECT}、结果映射、以及"默认队列检出重复"的那一条警告。
 * 第五刀那两个只读通道（{@code player_list_music_check_exist} / {@code player_list_music_get_list_ids}）
 * 在 {@link RainMusicListMusicChannels} 里，<b>那个文件一行都没改</b>
 * （它自己的用例里有一条"本文件只应注册 2 条通道"的范围守卫，本刀新开的文件不会碰它）——
 * 与"第四刀的文件一行都没改"是同一个取舍：每一刀一个文件，老文件冻结，才看得出谁改了什么。
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
 * <h2>本刀**只**做读：桌面那一支的写回不抄</h2>
 * 桌面 {@code getListMusics}（{@code modules/list/index.ts:182-207}）在
 * {@code listId == LIST_IDS.DEFAULT}（{@code 'default'}）时会多做两件事：
 * <pre>
 * :196  const merged = dedupePlaybackQueue(targetList)
 * :197  if (merged.length != targetList.length) {
 * :198    const restoreSnapshot = queueStartupRestorePending ? targetList.map(…) : undefined
 * :199    await overwriteMusicInfo(listId, toDBMusicInfo(merged, listId), restoreSnapshot)   ← **写库**
 * :201  targetList = merged
 * </pre>
 * 也就是"读到脏队列就顺手修库 + 可能写一条 {@code db_info.playback_queue_startup_restore} 快照"。
 * <b>本刀不做</b>，而且是有意的：
 * <ol>
 *   <li><b>它把"读失败"和"写失败"压到同一个 {@code ok} 上</b>，事后无法分辨是读坏了还是写坏了；</li>
 *   <li><b>它牵扯三个跨模块的收尾动作</b>（{@code queueStartupRestorePending} 标志、
 *       {@code resolvePlaybackQueueRestoreIndex}、{@code completePlaybackQueueRestore}，
 *       后两个的消费者在主进程 {@code winMain/rendererEvent/data.ts}，Android 侧还没有对应的那一支）；</li>
 *   <li><b>不写回时界面所见不变</b>：渲染层读 {@code default} 时**自己就会去重**
 *       （{@code src/renderer/store/list/listManage/action.ts:19} 的
 *       {@code setMusicList()}：{@code if (listId == LIST_IDS.DEFAULT) musicList = dedupePlaybackQueue(musicList)}）——
 *       这是本刀敢只做读的**唯一**依据。</li>
 * </ol>
 * 于是本刀把"库里有重复"这件事变成**一条点名警告**（见下节），而不是一次静默的写。
 * 下一刀要做的正是上面那三行 + 快照那一套。
 *
 * <h2>脏队列警告（logcat 是本刀唯一的可观测面）</h2>
 * 只读、不写回 ⇒ 库里会一直是脏的，而"读起来像一次正常读"是**不能接受**的。所以：
 * <ul>
 *   <li><b>触发条件</b>（三条同时成立）：{@code listId} **等于** {@code 'default'}；
 *       这一次读**成功**（失败会抛错，不走这里）；{@link RainMusicPlaybackQueueKey#findDuplicates(List)}
 *       判定**至少有一条**重复。</li>
 *   <li><b>判定用的键与桌面逐字节相同</b>：见 {@link RainMusicPlaybackQueueKey}
 *       （NFKC + JS 的 trim + {@code Locale.ROOT} 的 toLowerCase，且键的 JSON 文本也一致）。
 *       用 {@link String#trim()} / 无参 {@code toLowerCase()} 写出来的日志会**说谎**
 *       （NBSP、U+3000、土耳其语环境下的 I/İ 都会判错）。</li>
 *   <li><b>节流</b>：{@link #DIRTY_QUEUE_WARN}（{@link RainMusicLogThrottle}，
 *       窗口 {@link #DIRTY_QUEUE_WARN_WINDOW_MS} = 60 秒）。签名 = 行数 + 重复数 + 前三条重复的键
 *       ⇒ 队列没变时最多每分钟一条；队列**变了**（新的重复出现 / 行数变了）立刻再报一条。</li>
 *   <li>用 {@code Logger.warn}（不是 debug）：这是"数据没被修"的警告，不该被降级。
 *       ⚠️ Capacitor 的 {@code Logger} 受 {@code Logger.shouldLog()} 控制
 *       （{@code CapConfig.isLoggingEnabled()}，默认开），关掉日志时这条也会消失 —— 这是平台属性，
 *       本文件不去绕它（绕法就是直接用 {@code android.util.Log}，那会破坏"日志统一走 Logger"的既有形状）。</li>
 * </ul>
 *
 * <h2>SQL 逐字对齐 {@code statements.ts:68-78}</h2>
 * {@link #SQL_MUSIC_BY_LIST_ID} 是 {@code createMusicInfoQueryStatement()} 的**逐字副本**，
 * 唯一的差异是 **better-sqlite3 的具名参数 {@code @listId} → Android 的位置参数 {@code ?}**
 * （{@code SQLiteDatabase.rawQuery(String, String[])} 只支持 {@code ?}）。那一句里
 * {@code @listId} 出现**两次**（{@code ON … O.listId=@listId} 与 {@code WHERE mInfo.listId=@listId}），
 * 所以绑定数组是 {@code new String[] { listId, listId }} —— <b>两次都要绑同一个值</b>。
 *
 * <p>⚠️ <b>没有</b>加 {@code DISTINCT}、<b>没有</b>加 {@code LIMIT}、<b>也没有</b>加列表通道那种
 * {@code "rowid" ASC} 兜底排序。理由：这条语句的 {@code ORDER BY O."order" ASC} 里，
 * 没有 order 记录的行 {@code O."order"} 是 NULL，SQLite 的 ASC 把 NULL 排在最前 ——
 * 这是**桌面既有的行序语义**（"{@code dedupePlaybackQueue} 保留第一条"依赖它）。
 * 抄一个 rowid 兜底进去会改变"哪一条存活"与整体行序，属于**改语义**，不是修 bug。
 * 表名写法（{@code FROM my_list_music_info mInfo} 无 {@code "main".} 前缀、{@code ON mInfo.id=O.musicInfoId}
 * 不加引号）也逐字保留。
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
 * 写法与既有两处一致：{@code RainMusicDataChannels.parseStoreText()}（:508-518）与
 * {@code RainMusicAppSettingChannels.parseStoreText()}（:286-296）都是
 * {@code new JSONObject(text)} + 点名抛错。
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
 *       <td>同上。⚠️ 本文件是**只读**通道，连"把表建回来"这个选项都没有
 *           （建表只在库文件不存在时由 {@link RainMusicDatabase} 做一次）</td></tr>
 *   <tr><td><b>查询失败</b>（列漂移、{@code my_list_music_info_order} 缺失导致 JOIN 失败、游标异常）</td>
 *       <td>抛错，消息里带归一化后的 SQL 与原始异常</td>
 *       <td>桌面也是抛（better-sqlite3 准备/执行时抛）</td></tr>
 *   <tr><td><b>{@code meta} 不是合法 JSON / 不是对象</b></td><td>抛错，消息里点名 music id</td>
 *       <td>见上表（非法 JSON 同形；合法非对象是**有意**差异）</td></tr>
 *   <tr><td><b>默认列检出重复</b></td><td><b>照常返回原始行</b>（去重后写回不做）+ 一条
 *       {@code Logger.warn} 警告（节流）</td>
 *       <td>桌面会去重并**写回**；渲染层自己会去重（{@code listManage/action.ts:19}）⇒
 *           <b>界面所见不变</b>，差别只在库里还是脏的</td></tr>
 * </table>
 *
 * <h2>{@code open()} 只点名 {@code my_list_music_info}（一个**有意**的取舍）</h2>
 * 这条 SQL 还用到 {@code my_list_music_info_order}。这里**没有**把它也加进
 * {@code open(context, …)} 的必查表清单，两个理由：
 * <ol>
 *   <li>{@link RainMusicDatabase} 里没有那张表的公开常量，加常量就要改第四 / 第五刀的文件
 *       （而"老文件冻结"是本刀的规矩）；</li>
 *   <li>那张表缺失时**照样大声失败**：JOIN 会在 {@code rawQuery} 上抛
 *       {@code no such table: my_list_music_info_order}，被本文件的 catch 包成
 *       {@code IllegalStateException}（消息里带 SQL，一眼能看出是 JOIN 那一句）。
 *       与桌面**同形**：桌面也是在准备/执行那条语句时才炸。</li>
 * </ol>
 *
 * <h2>并发：本通道不需要数据锁</h2>
 * <ol>
 *   <li><b>没有任何 read-modify-write</b>：一次调用 = 一条 {@code SELECT} + 只读的 JSON 组装。
 *       "默认列去重并写回"那一半**本刀没做**（做了才需要考虑把它放进事务）；</li>
 *   <li><b>没有跨调用的数据状态</b>：每次调用新开 {@code Cursor}、读完在 {@code finally} 里关，
 *       不缓存任何行、也不碰桌面的 {@code musicLists} 模块级缓存；</li>
 *   <li><b>唯一跨调用可变状态是那条日志的节流器</b>（{@link #DIRTY_QUEUE_WARN}），
 *       它只护住几个计数器（{@link RainMusicLogThrottle#shouldLog(String, long)} 是
 *       {@code synchronized}），**不护 SQL、不护游标**；</li>
 *   <li><b>跨连接（线 A 的 JS 驱动 / 下一刀的写通道）靠 SQLite 自己</b>：文件锁 / 事务 / busy 处理。
 *       一把 Java 监视器管不到别的连接，加它只会给出"已经被保护了"的错觉。</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.database.*} 与 {@code org.json}、JDK 的 {@code java.util.ArrayList} /
 * {@code java.util.List}，
 * 以及同包的 {@link RainMusicDatabase} / {@link RainMusicIpcHandlers} /
 * {@link RainMusicPlaybackQueueKey} / {@link RainMusicLogThrottle}。
 * <b>没有新增任何 gradle 依赖</b>，也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着 Android 框架 API + 本机读到的 {@code @capacitor/android@8.5.2} 源码
 * 逐条核对的，只能由 CI（{@code .github/workflows/build-android.yml} 的 {@code gradlew assembleDebug}）证伪。
 * 本机的 {@code javac}（JDK 20）只做过两件事：① 用一组**手写替身**（{@code android.*} / {@code org.json} /
 * {@code Logger} / 插件）把它编过一遍；② 把 {@link RainMusicPlaybackQueueKey} 与
 * {@link RainMusicLogThrottle}（这两个不含 Android 类型）**真的跑起来**与 JS 对比。
 * 替身的签名是人手写的，与真实框架 API 一旦不一致，那次 {@code javac} 不会发现。
 * 真机行为（首装建库后返回 {@code []}、JOIN 的实际行序、meta 解析、警告是否真的出现在 logcat、
 * 警告节流的实际频率）**同样未在真机验证**。
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
     * （出现**两次**，绑定顺序见 {@link #getListMusics(Context, List)}）。
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

    /** {@code player_list_music_get} 的参数名（契约 :107：{@code listId: string}，裸字符串）。 */
    private static final String FIELD_LIST_ID = "listId";

    /**
     * 默认播放队列的 id（{@code src/common/constants.ts} 的 {@code LIST_IDS.DEFAULT === 'default'};
     * 与 {@code RainMusicDataChannels} 的同名常量同一个值）。
     *
     * <p>为什么这条通道需要知道它：桌面**只**在 {@code default} 上做去重（含写回），
     * 所以"库里脏了"这件事只可能发生在它身上，警告也只该在它身上出现。
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
     * {@code LEFT JOIN} 与日志消息里。
     *
     * <p>它**故意**是本地常量：{@link RainMusicDatabase} 里没有这张表的公开常量，而本刀的规矩是
     * **老文件冻结**（第四 / 第五刀的文件一行都不改）。{@code RainMusicDatabase} 里那张表的 DDL
     * （{@code DDL_MY_LIST_MUSIC_INFO_ORDER}）才是结构的唯一出处，这里只放名字。
     */
    private static final String TABLE_MY_LIST_MUSIC_INFO_ORDER = "my_list_music_info_order";

    /**
     * 脏队列警告的节流窗口（毫秒）。取 60 秒：比"一次进播放队列"长得多（够挡住连续刷屏），
     * 又比一次会话短得多（队列真的脏着，用户过一会儿还能再看到一条）。
     */
    private static final long DIRTY_QUEUE_WARN_WINDOW_MS = 60_000L;

    /**
     * 脏队列警告的节流闸门（{@link RainMusicLogThrottle} 是线程安全的）。
     *
     * <p>⚠️ 这是本文件**唯一**的跨调用可变状态，它只装"上一条警告的签名与时间"，
     * 不含任何音乐数据、不影响任何返回值。
     */
    private static final RainMusicLogThrottle DIRTY_QUEUE_WARN =
        new RainMusicLogThrottle(DIRTY_QUEUE_WARN_WINDOW_MS);

    /**
     * "meta 列是 NULL"那条警告的节流闸门 —— 与脏队列警告**分开**计数：两件事互不相干，
     * 共用一个闸门会让后发生的那件事被前一件的窗口吃掉。
     *
     * <p>为什么要节流：{@code meta} 是 {@code TEXT NOT NULL}，出现 NULL 说明那一行被写坏了；
     * 坏行**每次读都会命中**，不节流就是每次读都刷一条。
     */
    private static final RainMusicLogThrottle META_NULL_WARN =
        new RainMusicLogThrottle(DIRTY_QUEUE_WARN_WINDOW_MS);


    /** 警告里最多列几条重复样例（再多就把 logcat 淹了）。 */
    private static final int DIRTY_QUEUE_WARN_EXAMPLES = 3;
    /** 警告里每个字段最长打多少字符（人名/曲名可能极长，logcat 一条有上限）。 */
    private static final int DIRTY_QUEUE_WARN_FIELD_LIMIT = 40;

    private static final String TAG = "RainMusicListMusicGet";

    private RainMusicListMusicGetChannels() {}

    /**
     * 注册这一条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 {@code setEmitter}、
     * 第一刀到第五刀的 {@code register} 同一处、同一时序理由：必须在渲染层第一次 invoke 之前完成，
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
            "P0-2 第六刀：已注册 " + CHANNEL_MUSIC_GET + "（只读；落点 " + RainMusicDatabase.DATABASE_NAME +
            " 的 \"" + RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + "\" 表 LEFT JOIN \"" +
            TABLE_MY_LIST_MUSIC_INFO_ORDER + "\" 表，schema 版本 " +
            RainMusicDatabase.SCHEMA_VERSION_TEXT + "；默认列的去重**写回**未做，" +
            "检出重复时只打一条节流警告）"
        );
    }

    // ------------------------------------------------------------------ 通道实现

    /**
     * {@code player_list_music_get}：读某个歌单里的歌曲（含 {@code meta} 的对象化）。
     *
     * @param args {@code args[0]} = {@code listId}（裸字符串，**不是** {@code {listId}}，契约 :107）
     * @return 一个 {@link JSONArray}，元素形状 = {@code Rain.Music.MusicInfo}
     *         （{@code id/name/singer/source/interval/meta} 六个键，{@code meta} 是**对象**）；
     *         这个歌单是空的（或没有这个歌单）时是**空数组**（那才是"空"的正确取值）
     * @throws IllegalArgumentException 参数不是字符串 / 缺参数
     * @throws IllegalStateException    库打不开 / 表缺失 / 查询失败 / meta 坏（**不返回空数组**）
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

        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO);
        JSONArray musics = new JSONArray();
        // 只在默认播放队列上收集去重键：桌面也只对它调 dedupePlaybackQueue（index.ts:195）。
        // 非默认歌单不建这份列表，省掉一次全表算键。
        List<RainMusicPlaybackQueueKey.MusicRow> queueRows =
            LIST_ID_DEFAULT.equals(listId) ? new ArrayList<>() : null;
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
                String name = cursor.getString(nameIndex);
                String singer = cursor.getString(singerIndex);
                JSONObject item = new JSONObject();
                item.put(COLUMN_ID, jsonValue(id));
                item.put(COLUMN_NAME, jsonValue(name));
                item.put(COLUMN_SINGER, jsonValue(singer));
                item.put(COLUMN_SOURCE, jsonValue(cursor.getString(sourceIndex)));
                // interval 是 string | null（src/common/types/music.d.ts:45）：NULL 必须写成 JSON null。
                item.put(COLUMN_INTERVAL, jsonValue(cursor.getString(intervalIndex)));
                // meta 必须是**对象**（桌面那一句是 JSON.parse，见类注释「meta」）。
                item.put(COLUMN_META, parseMeta(id, cursor.getString(metaIndex)));
                musics.put(item);
                if (queueRows != null) {
                    queueRows.add(new RainMusicPlaybackQueueKey.MusicRow(id, name, singer));
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

        // 读**成功之后**才判断脏 —— 读失败已经抛出去了，不该在这里再多说一句没有依据的话。
        // ⚠️ JSONArray 用的是 length()（AOSP 的 org.json.JSONArray **没有** size()）。
        if (queueRows != null) warnIfDefaultQueueLooksDirty(listId, queueRows, musics.length());
        return musics;
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
            // 与脏队列警告一样要节流：坏行每次读都会命中（见 META_NULL_WARN 的注释）。
            if (META_NULL_WARN.shouldLog(COLUMN_META + "-null|" + textOrNull(musicId), System.currentTimeMillis())) {
                Logger.warn(
                    TAG,
                    CHANNEL_MUSIC_GET + "：music id=\"" + textOrNull(musicId) + "\" 的 \"" + COLUMN_META +
                    "\" 列是 NULL（表结构是 TEXT NOT NULL，只可能是被人写坏的）。" +
                    "桌面此时是 JSON.parse(null) ⇒ null，本通道同样给 JSON null（不抛错，两边逐字等价）。" +
                    "本条警告节流 " + (DIRTY_QUEUE_WARN.windowMs() / 1000) + " 秒一次。"
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

    // ------------------------------------------------------------------ 脏队列警告

    /**
     * 默认播放队列里检出重复 ⇒ 打一条点名警告（节流）。
     *
     * <p>这是本刀对"桌面会顺手写回、Android 不写回"这件事的**唯一**交代：见类注释
     * 「脏队列警告」。非默认歌单直接返回（桌面也只对 default 去重）。
     *
     * @param listId 调用方已经确认等于 {@code 'default'}（这里再判一次，防止将来被别处复用）
     * @param rows   这一次读出来的三列（顺序 = SQL 顺序）
     * @param total  这一次读出来的行数（= {@code rows.size()}；单独传是为了让消息与 JSON 数组一致）
     */
    private static void warnIfDefaultQueueLooksDirty(
        String listId,
        List<RainMusicPlaybackQueueKey.MusicRow> rows,
        int total
    ) {
        if (!LIST_ID_DEFAULT.equals(listId)) return;
        List<RainMusicPlaybackQueueKey.MusicRow> duplicates =
            RainMusicPlaybackQueueKey.findDuplicates(rows);
        if (duplicates.isEmpty()) return;

        String signature = dirtyQueueSignature(listId, total, duplicates);
        if (!DIRTY_QUEUE_WARN.shouldLog(signature, System.currentTimeMillis())) return;

        Logger.warn(
            TAG,
            CHANNEL_MUSIC_GET + "：默认播放队列（\"" + FIELD_LIST_ID + "\"=\"" + LIST_ID_DEFAULT + "\"）里有 " +
            duplicates.size() + " 条重复（共 " + total + " 行）：" + describeDuplicates(duplicates) +
            "。桌面在这里会去重并**写回**库（src/main/worker/dbService/modules/list/index.ts:195-202 的 " +
            "dedupePlaybackQueue + overwriteMusicInfo，还可能在 " + RainMusicDatabase.TABLE_DB_INFO +
            " 里写一条播放队列恢复快照），Android 本刀**只读、不写回** ⇒ 库里仍然是脏的。" +
            "界面不受影响：渲染层读 default 时自己就会去重" +
            "（src/renderer/store/list/listManage/action.ts:19）⇒ 用户看到的与桌面一致。" +
            "本条警告节流 " + (DIRTY_QUEUE_WARN.windowMs() / 1000) + " 秒一次，队列内容变了会立刻再报一条" +
            "（判定用的键与 JS 的 getPlaybackQueueMusicKey 逐字节相同，见 " +
            "RainMusicPlaybackQueueKey 的注释）。"
        );
    }

    /**
     * 警告的指纹：{@code listId | 行数 | 重复数 | 前 N 条重复的键}。
     *
     * <p>为什么这么取：队列**没变**时四次读得到同一个签名 ⇒ 被节流器挡住（"别每次读都刷"）；
     * 行数变了、重复数变了、或者换了一批重复的歌 ⇒ 签名变化 ⇒ 立刻再报一条
     * （新的脏状态是新消息，不该被上一个窗口吃掉）。
     */
    private static String dirtyQueueSignature(
        String listId,
        int total,
        List<RainMusicPlaybackQueueKey.MusicRow> duplicates
    ) {
        StringBuilder builder = new StringBuilder();
        builder.append(listId).append('|').append(total).append('|').append(duplicates.size());
        int examples = Math.min(DIRTY_QUEUE_WARN_EXAMPLES, duplicates.size());
        for (int i = 0; i < examples; i++) {
            builder.append('|').append(duplicates.get(i).key());
        }
        return builder.toString();
    }

    /** 最多列 {@link #DIRTY_QUEUE_WARN_EXAMPLES} 条重复样例（每条只打 id / name / singer）。 */
    private static String describeDuplicates(List<RainMusicPlaybackQueueKey.MusicRow> duplicates) {
        StringBuilder builder = new StringBuilder();
        int examples = Math.min(DIRTY_QUEUE_WARN_EXAMPLES, duplicates.size());
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
        return "\"" + (value.length() > DIRTY_QUEUE_WARN_FIELD_LIMIT
            ? value.substring(0, DIRTY_QUEUE_WARN_FIELD_LIMIT) + "…"
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
     * <p>为什么必要（与第一 / 三 / 四 / 五刀是同一件事）：{@code org.json} 的 {@code put(name, null)}
     * 会**删掉这个键**；而桌面 {@code index.ts:185-194} 构造的那个对象里，{@code interval} 是
     * {@code string | null}（{@code music.d.ts:45}），NULL 列必须原样写成 JSON {@code null}。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    /** 只打参数**类型**，不打内容（与第三 / 五刀 {@code describeArgs} 同款）。 */
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
