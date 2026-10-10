package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.Map;

/**
 * Android 移植 · **P0-2 第五刀**：歌单内歌曲的**纯读**通道（2 条）。
 *
 * <pre>
 * player_list_music_check_exist    invoke, args=[{listId, musicInfoId}] → boolean    （契约 docs/android/ipc-contract.md:115）
 * player_list_music_get_list_ids   invoke, args=[musicInfoId]           → string[]   （契约 docs/android/ipc-contract.md:116）
 * </pre>
 *
 * <p>本文件是第四刀 {@link RainMusicListChannels}（{@code player_list_get}）的**同族续作**：
 * 同样的落点（{@link RainMusicDatabase} 的 SQLite 句柄与 {@code my_list_music_info} 表）、
 * 同样的"逐字对齐阶段 2a 的 {@code statements.ts} / {@code tables.ts}"、同样的"空 vs 坏必须可分辨"。
 * 第四刀那个文件**一行都没改**（它的用例里有一条"本文件只应注册 1 条通道"的范围守卫，本刀新增的
 * 2 条注册在**本文件**里，所以那条守卫仍然成立）。
 *
 * <h2>这一刀为什么只做 2 条：把 16 条 {@code player_list_*} 逐条过一遍纯读性</h2>
 *
 * <p>契约 {@code ipc-contract.md:101-116} 把这一族记成 16 条。逐条核对**渲染层 → 主进程**方向
 * 的落点（{@code src/main/modules/commonRenderers/list/rendererEvent.ts}，行号见契约那一列）：
 *
 * <table border="1">
 *   <caption>16 条 {@code player_list_*} 的读写分类</caption>
 *   <tr><th>通道</th><th>桌面实现</th><th>分类</th></tr>
 *   <tr><td>{@code player_list_get}</td><td>{@code getAllUserList()}</td><td>读（<b>第四刀已做</b>）</td></tr>
 *   <tr><td>{@code player_list_add} / {@code _remove} / {@code _update} / {@code _update_position}</td>
 *       <td>{@code createUserLists} / {@code removeUserLists} / {@code updateUserLists} / {@code updateUserListsPosition}</td>
 *       <td><b>写</b>（{@code dbHelper.ts} 的 INSERT / DELETE / UPDATE）</td></tr>
 *   <tr><td>{@code player_list_data_overwire}</td><td>{@code listDataOverwrite()}</td>
 *       <td><b>写</b>（整表覆盖 {@code overwriteListData}，DELETE + INSERT）</td></tr>
 *   <tr><td>{@code player_list_music_get}</td>
 *       <td>{@code getListMusics(listId)}</td>
 *       <td><b>不是纯读</b> —— 见类注释「{@code player_list_music_get} 为什么留给下一刀」</td></tr>
 *   <tr><td>{@code player_list_music_add} / {@code _move} / {@code _remove} / {@code _update} /
 *       {@code _update_position} / {@code _overwrite} / {@code _clear}</td>
 *       <td>{@code musicsAdd} / {@code musicsMove} / {@code musicsRemove} / {@code musicsUpdate} /
 *       {@code musicsPositionUpdate} / {@code musicOverwrite} / {@code musicsClear}</td>
 *       <td><b>写</b>（{@code dbHelper.ts} 的 INSERT / DELETE / UPDATE）</td></tr>
 *   <tr><td>{@code player_list_music_check_exist}</td>
 *       <td>{@code checkListExistMusic(listId, musicInfoId)}（{@code index.ts:436-439}）</td>
 *       <td><b>纯读</b> ⇒ <b>本刀</b></td></tr>
 *   <tr><td>{@code player_list_music_get_list_ids}</td>
 *       <td>{@code getMusicExistListIds(musicInfoId)}（{@code index.ts:446-449}）</td>
 *       <td><b>纯读</b> ⇒ <b>本刀</b></td></tr>
 * </table>
 *
 * <p><b>这一族里除第四刀那条之外，只有这 2 条是纯读</b>（13 条写 + 1 条"读里带写"）。
 * 其余同族通道（{@code dislike_*} / {@code winMain_download_list_*} / 歌词 / URL 缓存）属于
 * **别的族**，各有各的落点与形状，不在本刀范围。
 *
 * <h2>为什么这 2 条是纯读（逐条查过，不是"看名字像读"）</h2>
 *
 * <ol>
 *   <li><b>{@code checkListExistMusic}</b>（{@code src/main/worker/dbService/modules/list/index.ts:436-439}）：
 *       函数体只有两句 —— {@code await queryMusicInfoByListIdAndMusicInfoId(listId, musicInfoId)}
 *       与 {@code return musicInfo != null}。被调的那个函数（{@code dbHelper.ts:293-296}）也只有
 *       {@code createMusicInfoByListAndMusicInfoIdQueryStatement().get({listId, musicInfoId})}，
 *       也就是一条 {@code SELECT}。
 *       <b>没有</b>模块级缓存读写（不碰 {@code musicLists} / {@code userLists} / {@code rawPoss}）、
 *       <b>没有</b> {@code queueStartupRestorePending}、<b>没有</b>任何 {@code db.transaction}
 *       ⇒ 连"读内存缓存 → 写库 → 改缓存"这种复合操作的边都不沾。</li>
 *   <li><b>{@code getMusicExistListIds}</b>（{@code index.ts:446-449}）：只有
 *       {@code queryMusicInfoByMusicInfoId(musicInfoId)}（{@code dbHelper.ts:303-306}，
 *       一条 {@code SELECT}）加一个 {@code .map(m => m.listId)}。
 *       同样不碰任何模块级状态。</li>
 * </ol>
 *
 * <p>⚠️ 两条都**经过** {@code dbService} 入口的串行化队列
 * （{@code src/main/worker/dbService/index.ts:24-42} 的 {@code serializeCalls}）——
 * 那是"同一时刻只跑一个业务调用"的执行顺序保证（{@code ignore} 之类只是队列，不改数据），
 * <b>不是写</b>，也不改这两条通道的纯读性质。
 *
 * <h2>SQL 逐字对齐（含"查了不用的列"）</h2>
 * <ul>
 *   <li>{@link #SQL_MUSIC_BY_LIST_AND_MUSIC_ID} 抄 {@code statements.ts:135-141} 的
 *       {@code createMusicInfoByListAndMusicInfoIdQueryStatement}；</li>
 *   <li>{@link #SQL_MUSIC_BY_MUSIC_ID} 抄 {@code statements.ts:147-152} 的
 *       {@code createMusicInfoByMusicInfoIdQueryStatement}。</li>
 * </ul>
 *
 * <p><b>唯一的差异是参数占位符</b>：桌面用 better-sqlite3 的**具名参数**
 * （{@code @musicInfoId} / {@code @listId}），Android 的
 * {@code SQLiteDatabase.rawQuery(String, String[])} 只支持位置参数 {@code ?}，
 * 所以抄成 {@code "id"=? AND "listId"=?}，绑定顺序与桌面 SQL 里出现的顺序**逐个对应**
 * （先 {@code "id"} 后 {@code "listId"}）。除占位符之外，列清单、表名、{@code "main".} 前缀、
 * {@code WHERE} 的结构一字不改；**没有加** {@code ORDER BY}、{@code DISTINCT}、{@code LIMIT}。
 *
 * <p>两条 SQL 都选了 {@code "meta"}（甚至 {@code "name"} / {@code "singer"}）却在
 * Java 里**一个都没读**。这是**有意**的：中文注释里"逐字对齐"如果不含这些列就不再是逐字对齐，
 * 而阶段 2a 的语句一旦改动（比如 {@code my_list_music_info} 加列），本文件必须跟着改 ——
 * 留着一字不差的副本，测试才能拿它和 {@code statements.ts} 做归一化比对
 * （与第四刀保留 {@code "position"} 是同一个取舍）。
 *
 * <h2>返回值形状（照桌面抄）</h2>
 * <ul>
 *   <li>{@code player_list_music_check_exist} → <b>裸 boolean</b>：桌面是
 *       {@code return musicInfo != null}（{@code index.ts:438}），
 *       对应 {@code createMusicInfoByListAndMusicInfoIdQueryStatement().get(...)} 的
 *       "有行 / 无行"。{@code my_list_music_info} 建表时有 {@code UNIQUE("id","listId")}
 *       （{@code tables.ts:139-150}），所以"最多一行"是本刀可以用
 *       {@code cursor.moveToFirst()} 等价实现 {@code .get()} 的依据
 *       （{@code .get()} 在 better-sqlite3 里也只取第一行）。</li>
 *   <li>{@code player_list_music_get_list_ids} → {@code string[]}：桌面是
 *       {@code musicInfos.map(m => m.listId)}（{@code index.ts:448}）。
 *       <b>不许去重、不许排序、不许过滤</b> —— 桌面就是 {@code SELECT} 的原样顺序
 *       （SQL 里没有 {@code ORDER BY}），同一首歌在 N 个歌单里就是 N 个元素。</li>
 *   <li>{@code listId} 列在表结构里是 {@code TEXT NOT NULL}（{@code tables.ts:139-150}），
 *       正常不可能为 NULL；但万一有人手工写坏了库，桌面那行会得到 JS {@code undefined}
 *       （序列化后是 {@code null}），所以这里同样走 {@link #jsonValue(Object)}
 *       写成 JSON {@code null} 而**不是**把数组元素挪掉。</li>
 * </ul>
 *
 * <h2>参数（唯一一处与桌面**有意**不同的地方，写清楚）</h2>
 * <ul>
 *   <li>{@code player_list_music_check_exist}：{@code args = [{listId, musicInfoId}]}
 *       （渲染层 {@code rendererListManage.ts:158} 的
 *       {@code rendererInvoke(channel, { listId, musicInfoId })} ⇒ P0-1 的信封里
 *       {@code args = [params]}）；</li>
 *   <li>{@code player_list_music_get_list_ids}：{@code args = [musicInfoId]}（裸字符串，
 *       {@code rendererListManage.ts:166}）—— **不是** {@code [{musicInfoId}]}。</li>
 *   <li><b>缺失的键 ⇒ 抛错</b>（{@code IllegalArgumentException}）：
 *       桌面 {@code async({ params: { listId, musicInfoId } })} 在缺键时拿到 {@code undefined}，
 *       而 better-sqlite3 **不能绑定 {@code undefined}**（会抛
 *       {@code TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null}）
 *       ⇒ 桌面在这一点上**本来就是抛错**。这里照抛，并且把收到的顶层键打出来。</li>
 *   <li><b>{@code null} ⇒ 不查库，直接给"查不到"</b>：桌面 {@code null} 会被绑成 SQL NULL，
 *       而 {@code WHERE "id"=NULL AND "listId"=NULL} 在 SQL 里**永远不成立**（不是 {@code IS NULL}）
 *       ⇒ 桌面返回 {@code false} / {@code []}。本文件直接返回同一个值，**不绑 NULL**：
 *       Android 的 {@code rawQuery(String, String[])} 走
 *       {@code SQLiteProgram.bindAllArgsAsStrings} → {@code bindString}，
 *       而 AOSP 的 {@code bindString(int, String)} 对 {@code null} 抛
 *       {@code IllegalArgumentException("the bind value at index N is null")}。
 *       短路之后结果与桌面**逐字等价**（false / []），所以即使上面那条平台行为记错了，
 *       本文件的返回值也仍然是对的（见 {@code Logger.debug} 里那条记录）。</li>
 *   <li><b>类型不是字符串</b>（数字 / 布尔 / 对象）⇒ 抛错。⚠️ 这是**有意**的一处差异：
 *       桌面会把数字直接交给 better-sqlite3，而 SQLite 的 TEXT 列亲和性可能把它转成文本
 *       （{@code 42} → {@code '42'}）从而"匹配上"，也可能匹配不上 —— 两种结果都不确定。
 *       本通道的契约（{@code ipc-contract.md:115-116}）与类型定义
 *       （{@code src/common/types/music.d.ts:41} 的 {@code id: string}）都写的是字符串，
 *       渲染层两个真实调用点（{@code FavoriteButton.vue:53} / {@code ListAddModal.vue:76}）
 *       传的也都是字符串 ⇒ 这里**拒绝**而不是猜一个，避免"界面显示这首歌不在任何歌单里"
 *       这种静默错答案（**需要人复核**，见汇报）。</li>
 *   <li>空字符串**不拒绝**：桌面 {@code WHERE "id"=''} 只是匹配不上 ⇒ 返回
 *       {@code false} / {@code []}。这里照抄这个语义（不制造桌面没有的失败）。
 *       唯一的例外是"键缺失 / null"，理由见上。</li>
 * </ul>
 *
 * <h2>不假装成功（三种状态逐条）</h2>
 * <table border="1">
 *   <caption>空 / 坏 / 表缺失</caption>
 *   <tr><th>状态</th><th>本刀的两条通道</th><th>理由</th></tr>
 *   <tr><td><b>查不到</b>（这首歌确实不在该歌单 / 不在任何歌单）</td>
 *       <td>{@code check_exist} → {@code false}；{@code get_list_ids} → {@code []}</td>
 *       <td>这才是"空"的正确取值，与桌面逐字同形（{@code index.ts:438,448}）</td></tr>
 *   <tr><td><b>库打不开</b>（文件损坏 / 没有权限 / 首次建表失败 / 迁移抛错）</td>
 *       <td>抛错 ⇒ {@code ok:false, IPC_HANDLER_FAILED}（消息里带绝对路径与原始原因）</td>
 *       <td>"坏了"不能伪装成 {@code false} / {@code []}</td></tr>
 *   <tr><td><b>表缺失</b>（库在、但没有 {@code my_list_music_info}）</td>
 *       <td>抛错，消息里点名表名与 {@code tables.ts} 是期望结构的出处</td>
 *       <td>同上。⚠️ 本文件是**只读**通道，连"把表建回来"这个选项都没有
 *           （建表只在库文件不存在时由 {@link RainMusicDatabase} 做一次）</td></tr>
 *   <tr><td><b>查询失败</b>（列不存在等结构漂移、游标异常、参数缺失）</td>
 *       <td>抛错，消息里带原始异常</td>
 *       <td>绝不 {@code catch} 之后返回 {@code false} / 空数组</td></tr>
 * </table>
 *
 * <p><b>渲染层看得见这个 {@code ok:false} 吗？</b>看得见，但两个调用点的处理**不一样**
 * （这是既有代码，本刀不改 JS）：
 * <ul>
 *   <li>{@code FavoriteButton.vue:52-57}：{@code try { … } catch { isFavorite.value = false }}
 *       ⇒ 失败时收藏态显示为"未收藏"，但**不静默**：桥在
 *       {@code platform/ipcFallback/subscribe.ts:72-76} 留下点名通道名的 {@code console.error}
 *       （与第四刀那条取值点同一个出口）；</li>
 *   <li>{@code ListAddModal.vue:76-81}：{@code void getMusicExistListIds(mid).then(...)} ——
 *       **没有 catch** ⇒ 失败是一条未处理的 rejection（控制台可见），弹窗里的
 *       {@code isExist} 保持 {@code false}。⚠️ 这一点本机无法验证真机表现，已列在汇报的
 *       "不确定"里（它是渲染层既有代码，不属于本刀范围）。</li>
 * </ul>
 *
 * <h2>{@code player_list_music_get} 为什么留给下一刀（本刀不做）</h2>
 * <p>桌面 {@code getListMusics(listId)}（{@code modules/list/index.ts:182-207}）**不是纯读**：
 * 当 {@code listId == LIST_IDS.DEFAULT}（{@code 'default'}）且
 * {@code dedupePlaybackQueue(targetList)} 真的删掉了元素时，它会调
 * {@code overwriteMusicInfo(...)}（{@code dbHelper.ts:328-351}）把去重后的结果**写回库**，
 * 并可能往 {@code db_info} 里插一条 {@code playback_queue_startup_restore} 快照。
 * 把这条混进"只读"的一刀，会让"读失败"和"写失败"落在同一个 {@code ok} 上、无法分辨；
 * 而且它牵扯 {@code queueStartupRestorePending}（模块级可变状态）、
 * {@code resolvePlaybackQueueRestoreIndex} 与 {@code completePlaybackQueueRestore}
 * 三个跨模块的收尾动作。依赖清单与"不写回会怎样"写在汇报里，供下一刀决策。
 *
 * <h2>并发：本刀不需要锁（与第四刀同一套判断框架，逐条给依据）</h2>
 * <ol>
 *   <li><b>没有任何 read-modify-write</b>：两条通道各只有一条 {@code SELECT}，
 *       而且不碰任何模块级可变状态（上面「为什么这 2 条是纯读」第 1/2 条的清单）。
 *       第三刀之所以必须共用 {@link RainMusicStoreLock#WRITE_LOCK}，是因为它的写是
 *       "读整份文本 → 改一个键 → 写回整份"；这里没有这种复合写。</li>
 *   <li><b>并发的两次查询之间没有共享可变状态</b>：每次调用新开一个 {@code Cursor}，
 *       用完在 {@code finally} 里关，不持有任何跨调用的中间状态。</li>
 *   <li><b>框架自己就是线程安全的</b>：{@code SQLiteDatabase} / {@code SQLiteOpenHelper}
 *       内部有同步与连接池；P0-1 的 handler 跑在 2 线程池里（{@code RainMusicIpcPlugin:337}），
 *       两条通道完全可能同时在跑，这由框架处理。</li>
 *   <li><b>跨连接靠 SQLite 自己</b>：将来线 A 的 JS 驱动、下一刀的写通道是**另外的连接**，
 *       一把 Java 监视器根本管不到它们（文件锁 / 事务 / busy 处理才是那条路的机制）。
 *       加锁只会给出"已经被保护了"的错觉。</li>
 *   <li>本文件里**没有** {@code synchronized}、没有 {@code new Object()}、
 *       没有显式事务（单条 {@code SELECT} 本来就是隐式读事务），
 *       也没有 {@code RainMusicDatabase} 之外的第二个 SQLite 入口。</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.database.*} 与 {@code org.json}、JDK 的 {@code java.util.List} / {@code java.util.Map}，
 * 以及同包的 {@link RainMusicDatabase} / {@link RainMusicIpcHandlers}。
 * <b>没有新增任何 gradle 依赖</b>，也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着 Android 框架 API + 本机读到的 {@code @capacitor/android@8.5.2} 源码
 * 逐条核对的，只能由 CI（{@code .github/workflows/build-android.yml} 的
 * {@code gradlew assembleDebug}）证伪。真机行为（首装建库后的 {@code false} / {@code []}、
 * 报错表现、两条通道并发读）**同样未在真机验证**。
 */
public final class RainMusicListMusicChannels {

    /**
     * {@code player_list_music_check_exist}：键名 {@code list_music_check_exist}
     * （{@code src/common/ipcNames.ts:36} 的 {@code PLAYER_EVENT_NAME.list_music_check_exist}）
     * + 模块前缀 {@code player}（生成规则 {@code ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_CHECK_EXIST = "player_list_music_check_exist";

    /**
     * {@code player_list_music_get_list_ids}：键名 {@code list_music_get_list_ids}
     * （{@code src/common/ipcNames.ts:37}）。
     */
    public static final String CHANNEL_GET_LIST_IDS = "player_list_music_get_list_ids";

    /**
     * {@code check_exist} 的 WHERE 条件一：音乐 id。逐字抄
     * {@code src/main/worker/dbService/modules/list/statements.ts:135-141} 的
     * {@code createMusicInfoByListAndMusicInfoIdQueryStatement}，只把 better-sqlite3 的具名参数
     * {@code @musicInfoId} / {@code @listId} 换成位置参数 {@code ?}（顺序不变，见类注释「SQL」）。
     *
     * <p>列清单里那 6 列本通道**只判断"有没有行"**，一列都不读；保留它们是"逐字对齐"的要求。
     */
    static final String SQL_MUSIC_BY_LIST_AND_MUSIC_ID = """
        SELECT "id", "name", "singer", "source", "interval", "meta"
        FROM "main"."my_list_music_info"
        WHERE "id"=?
        AND "listId"=?
        """;

    /**
     * {@code get_list_ids} 的语句。逐字抄
     * {@code src/main/worker/dbService/modules/list/statements.ts:147-152} 的
     * {@code createMusicInfoByMusicInfoIdQueryStatement}（那条本来就是位置参数 {@code ?}，
     * 一个字都不用换）。
     *
     * <p>⚠️ 这一列清单末尾的 {@code "listId"} 是本通道唯一真正读取的列；
     * 前面的 {@code "id"} / {@code "name"} / {@code "singer"} / {@code "source"} /
     * {@code "interval"} / {@code "meta"} 逐字保留但不读（见类注释「SQL」）。
     */
    static final String SQL_MUSIC_BY_MUSIC_ID = """
        SELECT "id", "name", "singer", "source", "interval", "meta", "listId"
        FROM "main"."my_list_music_info"
        WHERE "id"=?
        """;

    /** {@code check_exist} 的参数名（契约 {@code ipc-contract.md:115}：{@code {listId, musicInfoId}}）。 */
    private static final String FIELD_LIST_ID = "listId";
    private static final String FIELD_MUSIC_INFO_ID = "musicInfoId";

    /** {@code my_list_music_info} 的列名（{@code tables.ts:139-150}）。本文件只读这一列。 */
    private static final String COLUMN_LIST_ID = "listId";

    private static final String TAG = "RainMusicListMusic";

    private RainMusicListMusicChannels() {}

    /**
     * 注册这 2 条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的
     * {@code setEmitter}、第一刀到第四刀的 {@code register} 同一处、同一时序理由：
     * 必须在渲染层第一次 invoke 之前完成，否则真机上就是 {@code IPC_CHANNEL_UNSUPPORTED}）。
     *
     * <p>与前面几刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicListMusicChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_CHECK_EXIST, (args, ctx) -> checkExist(requireContext(plugin), args));
        RainMusicIpcHandlers.register(CHANNEL_GET_LIST_IDS, (args, ctx) -> getListIds(requireContext(plugin), args));
        // ⚠️ 这里**只打表名**、不调 getDatabasePath()：load() 阶段 Context 可能还没有
        // （所以 Context 一律留到 handler 调用时再取）。绝对路径由 open() 在真机上打进错误信息。
        Logger.info(
            TAG,
            "P0-2 第五刀：已注册 " + CHANNEL_CHECK_EXIST + " / " + CHANNEL_GET_LIST_IDS +
            "（只读；落点 " + RainMusicDatabase.DATABASE_NAME + " 的 \"" +
            RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + "\" 表，schema 版本 " +
            RainMusicDatabase.SCHEMA_VERSION_TEXT + "）"
        );
    }

    // ------------------------------------------------------------------ 通道实现

    /**
     * {@code player_list_music_check_exist}：这首歌在这个歌单里吗。
     *
     * @param args {@code args[0]} = {@code {listId, musicInfoId}}（契约 :115）
     * @return {@link Boolean}：有行 ⇒ {@code true}；没有 ⇒ {@code false}
     *         （"这首歌不在这个歌单里"与"没有这个歌单"在桌面上同样是 {@code false}，这里一致）
     * @throws IllegalArgumentException 参数不是对象 / 缺键 / 值既不是字符串也不是 null
     * @throws IllegalStateException    库打不开 / 表缺失 / 查询失败（**不返回 false**）
     */
    private static Object checkExist(Context context, List<Object> args) {
        JSONObject params = readParamsObject(args, CHANNEL_CHECK_EXIST, FIELD_LIST_ID, FIELD_MUSIC_INFO_ID);
        String listId = readNullableString(params, FIELD_LIST_ID, CHANNEL_CHECK_EXIST);
        String musicInfoId = readNullableString(params, FIELD_MUSIC_INFO_ID, CHANNEL_CHECK_EXIST);

        if (listId == null || musicInfoId == null) {
            // 桌面把 null 绑成 SQL NULL ⇒ `"id"=NULL AND "listId"=NULL` 恒不成立 ⇒ false。
            // 这里直接给同一个值，不去绑 NULL（Android 的 String[] 绑定不接受 null 元素，
            // 理由见类注释「参数」第 3 条）。
            Logger.debug(
                TAG,
                CHANNEL_CHECK_EXIST + "：listId / musicInfoId 里有 null ⇒ 直接返回 false" +
                "（与桌面把 null 绑成 SQL NULL 的结果逐字等价；本通道不把 null 当参数错误）"
            );
            return false;
        }

        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO);
        Cursor cursor = null;
        try {
            // 绑定顺序 = SQL 里 ? 出现的顺序：先 "id"（musicInfoId），后 "listId"。
            cursor = db.rawQuery(SQL_MUSIC_BY_LIST_AND_MUSIC_ID, new String[] { musicInfoId, listId });
            // my_list_music_info 有 UNIQUE("id","listId") ⇒ 最多一行，
            // 所以"有没有第一行"与桌面 better-sqlite3 的 .get() 逐字等价。
            return cursor.moveToFirst();
        } catch (Exception ex) {
            throw new IllegalStateException(
                readFailureMessage(SQL_MUSIC_BY_LIST_AND_MUSIC_ID, ex) +
                "本通道**不会**返回 false —— 那等于告诉界面「这首歌不在这个歌单里」，" +
                "把「读不出来」伪装成一个确定的答案。",
                ex
            );
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /**
     * {@code player_list_music_get_list_ids}：这首歌在哪些歌单里。
     *
     * @param args {@code args[0]} = {@code musicInfoId}（裸字符串，**不是**对象，契约 :116）
     * @return 一个 {@link JSONArray}，元素是 {@code listId} 字符串，
     *         **顺序就是 {@link #SQL_MUSIC_BY_MUSIC_ID} 的结果顺序**（桌面 {@code .map()} 不去重、不排序）；
     *         这首歌不在任何歌单里时是**空数组**（那才是"空"的正确取值）
     * @throws IllegalArgumentException 参数不是字符串/null
     * @throws IllegalStateException    库打不开 / 表缺失 / 查询失败（**不返回空数组**）
     */
    private static Object getListIds(Context context, List<Object> args) {
        String musicInfoId = readBareString(args, CHANNEL_GET_LIST_IDS);

        if (musicInfoId == null) {
            Logger.debug(
                TAG,
                CHANNEL_GET_LIST_IDS + "：musicInfoId 是 null ⇒ 直接返回 []" +
                "（与桌面把 null 绑成 SQL NULL 的结果逐字等价；本通道不把 null 当参数错误）"
            );
            return new JSONArray();
        }

        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO);
        JSONArray listIds = new JSONArray();
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(SQL_MUSIC_BY_MUSIC_ID, new String[] { musicInfoId });
            int listIdIndex = cursor.getColumnIndexOrThrow(COLUMN_LIST_ID);
            while (cursor.moveToNext()) {
                // listId 是 NOT NULL 列；万一被写坏成 NULL，桌面那行会得到 undefined（序列化后 null），
                // 所以这里同样写出 JSON null，而不是把元素挪掉（org.json 的 put(name, null) 会删键）。
                listIds.put(jsonValue(cursor.getString(listIdIndex)));
            }
        } catch (Exception ex) {
            throw new IllegalStateException(
                readFailureMessage(SQL_MUSIC_BY_MUSIC_ID, ex) +
                "本通道**不会**返回空数组假装「这首歌不在任何歌单里」。",
                ex
            );
        } finally {
            if (cursor != null) cursor.close();
        }
        return listIds;
    }

    // ------------------------------------------------------------------ 参数

    /**
     * 取 {@code args[0]} 作为对象，并要求 {@code requiredKeys} 里的每个键都**存在**
     * （值可以是 {@code null}，那是一个合法取值）。
     *
     * <p>与第三刀 {@code RainMusicDataChannels.readSavePayload()} 同款：
     * {@code JSONObject} 直取（Capacitor 的 {@code JSObject} 是它的子类），{@code Map} 只作防御分支。
     */
    private static JSONObject readParamsObject(List<Object> args, String channel, String... requiredKeys) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                channel + " 需要一个对象参数 `{" + describeKeys(requiredKeys) + "}`，收到 " +
                describeArgs(args) + "（渲染层的调用形状见 " +
                "src/renderer/store/list/listManage/rendererListManage.ts:158 的 " +
                "rendererInvoke(channel, {listId, musicInfoId}) ⇒ 信封里 args=[params]；" +
                "契约 docs/android/ipc-contract.md:115）"
            );
        }
        Object first = args.get(0);
        JSONObject payload;
        if (first instanceof JSONObject) {
            payload = (JSONObject) first;
        } else if (first instanceof Map) {
            payload = new JSONObject((Map) first);
        } else {
            throw new IllegalArgumentException(
                channel + " 的参数必须是对象，收到 " + first.getClass().getName() + "：" +
                describeArgs(args) + "（契约是 args=[{" + describeKeys(requiredKeys) + "}]……**不是** args=[" +
                describeKeys(requiredKeys) + "]）"
            );
        }
        for (String key : requiredKeys) {
            if (!payload.has(key)) {
                throw new IllegalArgumentException(
                    channel + " 的参数缺少 `" + key + "` 字段（收到的顶层键=" +
                    String.valueOf(payload.names()) + "）。桌面那一支（rendererEvent.ts:48 / 51）在缺键时" +
                    "拿到 undefined，而 better-sqlite3 **不能绑定 undefined**（会抛 TypeError）⇒ " +
                    "「缺键就是失败」是桌面本来就有的语义，不是本通道新加的。"
                );
            }
        }
        if (args.size() > 1) {
            // 桌面 {@code async({ params })} 只读第一个参数；多传的忽略（不失败），与第四刀同一取舍。
            Logger.debug(TAG, channel + "：收到 " + args.size() + " 个参数，只读 args[0]（桌面同样只读 params）");
        }
        return payload;
    }

    /**
     * 取 {@code args[0]} 作为**裸字符串**（{@code get_list_ids} 的参数形状）。
     * 缺参数 / 类型不对 ⇒ 抛错；{@code null} ⇒ 返回 {@code null}（由调用方短路成"查不到"）。
     */
    private static String readBareString(List<Object> args, String channel) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                channel + " 需要一个字符串参数 musicInfoId，收到 " + describeArgs(args) +
                "（渲染层的调用形状见 src/renderer/store/list/listManage/rendererListManage.ts:166 的 " +
                "rendererInvoke(channel, musicInfoId) ⇒ 信封里 args=[musicInfoId]；契约 docs/android/ipc-contract.md:116）"
            );
        }
        Object first = args.get(0);
        if (first == JSONObject.NULL) return null;
        if (!(first instanceof String)) {
            throw new IllegalArgumentException(
                channel + " 的参数必须是字符串，收到 " + first.getClass().getName() + "：" + describeArgs(args) +
                "（桌面在缺键时抛 TypeError「不能绑定 undefined」，本通道把「不是字符串」也当成失败：" +
                "静默返回 [] 会让界面显示「这首歌不在任何歌单里」这种确定的错答案）"
            );
        }
        return (String) first;
    }

    /**
     * 取 {@code payload} 里的一个字段，要求它是**字符串或 null**（缺失由
     * {@link #readParamsObject} 提前拦下）。
     *
     * @return 字符串原样返回；JSON {@code null} ⇒ {@code null}（调用方短路成"查不到"）
     * @throws IllegalArgumentException 字段存在但不是字符串 / null
     */
    private static String readNullableString(JSONObject payload, String field, String channel) {
        Object raw = payload.opt(field);
        if (raw == null || raw == JSONObject.NULL) return null;
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                channel + " 的参数 `" + field + "` 必须是字符串或 null，收到 " + raw.getClass().getName() +
                "：" + describeValue(raw) + "（契约那两格写的就是字符串：" +
                "docs/android/ipc-contract.md:115-116；渲染层的两个真实调用点传的也都是字符串："
                + "src/renderer/components/common/FavoriteButton.vue:53 与 ListAddModal.vue:76）"
            );
        }
        return (String) raw;
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
     * <p>为什么必要（与第一 / 三 / 四刀是同一件事）：{@code org.json} 的 {@code put(name, null)}
     * 会**删掉这个键**；往 {@code JSONArray} 里放裸 {@code null} 也不该依赖具体实现。
     * 桌面 {@code getMusicExistListIds} 的 {@code m.listId} 序列化后就是 JSON {@code null}。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    /** 把 {@code requiredKeys} 用人能读的形式拼出来（不用 {@code String.join}：那是 API 26+）。 */
    private static String describeKeys(String[] keys) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < keys.length; i++) {
            if (i > 0) builder.append(", ");
            builder.append(keys[i]);
        }
        return builder.toString();
    }

    /** 只打参数**类型**，不打内容（与第三刀 {@code describeArgs} 同款）。 */
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

    /** 只打一个值的**类型与极短预览**（参数错误里点名"收到的是什么"，但不整份回显）。 */
    private static String describeValue(Object value) {
        String text = String.valueOf(value);
        if (text.length() > 40) text = text.substring(0, 40) + "…";
        return text;
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
