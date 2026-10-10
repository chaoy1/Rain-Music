package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Android 移植 · **P0-2 第四刀**：歌单 / 列表读取通道 {@code player_list_get}。
 *
 * <pre>
 * player_list_get   invoke, args=[]  → Rain.List.UserListInfo[]   （契约 docs/android/ipc-contract.md:101）
 * </pre>
 *
 * <p>本刀**只做读取侧**这一条。写侧（{@code player_list_add} / {@code player_list_remove} /
 * {@code player_list_update} / {@code player_list_update_position} / {@code player_list_data_overwire} /
 * {@code player_list_music_*}）**一条都不做**，下一刀再说。
 *
 * <h2>形状（抄契约，没有自己发明）</h2>
 *
 * 契约行 {@code ipc-contract.md:101}：
 * <ul>
 *   <li>通道名 {@code player_list_get} = 模块 {@code player} + 键名 {@code list_get}
 *       （{@code src/common/ipcNames.ts:12-23} 的 {@code PLAYER_EVENT_NAME.list_get}，
 *       拼名规则 {@code ipcNames.ts:171-176} ⚠️ 模块前缀是 {@code player}，
 *       与渲染层文件名 {@code listManage} 无关）；</li>
 *   <li>渲染层封装 {@code getUserLists} {@code R:listManage:28}
 *       = {@code src/renderer/store/list/listManage/rendererListManage.ts:27-30}：
 *       {@code rendererInvoke<Rain.List.UserListInfo[]>(PLAYER_EVENT_NAME.list_get)} ——
 *       <b>不传第二个参数</b> ⇒ 信封里 {@code args = []}；</li>
 *   <li>主进程 handler {@code M:list:6} = {@code src/main/modules/commonRenderers/list/rendererEvent.ts:6-8}：
 *       {@code mainHandle<Rain.List.UserListInfo[]>(PLAYER_EVENT_NAME.list_get, async() => …)}
 *       {@code mainHandle} ⇒ 渲染层是 {@code rendererInvoke}（请求 / 应答，**不是** send，**不是**广播）；</li>
 *   <li>参数 → 返回：<b>无参数</b> → {@code Rain.List.UserListInfo[]}（契约那一格写的就是"无"）。</li>
 * </ul>
 *
 * <h2>桌面实现（本通道抄的就是这条链）</h2>
 * <pre>
 * rendererEvent.ts:7   global.rain.worker.dbService.getAllUserList()
 *   → modules/list/index.ts:54-63   getAllUserList()
 *   → modules/list/dbHelper.ts:42-51 queryAllUserList()
 *   → modules/list/statements.ts:14-21  SELECT … FROM "main"."my_list" ORDER BY "position" ASC, "rowid" ASC
 * </pre>
 * 也就是说：<b>这条通道的落点在桌面上就是 SQLite 的 {@code my_list} 表</b>
 * （与第三刀的 {@code winMain_get_data} 不同 —— 那条通道在桌面上是 JSON 键值表，没有 SQL 落点）。
 *
 * <h2>SQLite 落点</h2>
 * 文件、建表时机、版本与迁移、并发，全部写在 {@link RainMusicDatabase} 的类注释里（逐条有依据）。
 * 这里只放这条通道自己的 SQL 与结果映射：
 * <ul>
 *   <li>{@link #SQL_LIST_GET} 逐字抄 {@code statements.ts:16-20}（列清单、{@code "main".} 前缀、
 *       {@code ORDER BY "position" ASC, "rowid" ASC} 一字不改）；</li>
 *   <li>表 / 列名与 {@code src/main/worker/dbService/tables.ts:128-138} 的 {@code my_list} 一致；</li>
 *   <li>{@link RainMusicDatabase#TABLE_MY_LIST} 缺失 / 库打不开 / 查询抛错 ⇒ <b>抛错</b>
 *       （{@code ok:false, IPC_HANDLER_FAILED}），**绝不返回空数组** ——
 *       理由写在类注释「不假装成功」那一节。</li>
 * </ul>
 *
 * <h2>一行的形状：{@code position} 被剥掉，{@code sourceListId} 修掉历史的 {@code .0}</h2>
 * 这两处都是**照桌面抄的**，不是本刀发明的：
 * <ol>
 *   <li><b>返回的对象里没有 {@code position}</b>：桌面 {@code getAllUserList()}
 *       （{@code modules/list/index.ts:58-62}）是
 *       {@code const { position, ...newList } = list; return newList} ——
 *       {@code position} 只进模块内的 {@code rawPoss}（排序用），**不出去**。
 *       {@code Rain.List.UserListInfo} 的定义里也没有它（{@code src/common/types/list.d.ts:3-11}，
 *       连 {@code position?: number} 那行都是注释掉的）。
 *       所以本文件 SELECT 了 {@code position}（SQL 逐字一致需要它），但**不把它放进 JSON**。</li>
 *   <li><b>{@code sourceListId} 末尾的 {@code .0} 被去掉</b>：桌面 {@code queryAllUserList()}
 *       （{@code dbHelper.ts:44-49}）对每条记录做
 *       {@code if (info.sourceListId?.endsWith?.('.0')) info.sourceListId = info.sourceListId.replace(/\.0$/, '')}，
 *       注释写明是"兼容 v2.3.0 之前版本插入数字类型的 ID"。
 *       这是**读路径上的既有语义**：不抄它，从备份导入的老数据就会带着 {@code "123.0"} 这种 id
 *       进到渲染层。等价实现见 {@link #stripLegacyNumericIdSuffix(String)}
 *       （{@code endsWith(".0")} 与正则 {@code /\.0$/} 在这里等价：正则未带 {@code g}，
 *       而 {@code $} 锚定末尾 ⇒ 只可能匹配最后两个字符）。
 *       ⚠️ 注意桌面这一处是**就地改**它自己读出来的对象（不是改库）：本文件同样只改返回的 JSON。</li>
 * </ol>
 *
 * <p>⚠️ <b>{@code data} 为 {@code null} 的列</b>：{@code org.json} 的
 * {@code put(name, null)} 会**把键删掉**，只有 {@code put(name, JSONObject.NULL)} 才写出一个 JSON null
 * （第一刀 / 第三刀 {@code jsonValue()} 的同一处理，见 {@code RainMusicDataChannels.jsonValue()} 的注释）。
 * 桌面这条链上的 {@code null} 是<b>正常取值</b>（{@code source} / {@code sourceListId} /
 * {@code locationUpdateTime} 三列都可空，{@code list.d.ts:10} 的
 * {@code locationUpdateTime: number | null} 就是明证），所以这里必须走
 * {@link #jsonValue(Object)}，不能把 {@code "source": null} 变成"没有 source 这个键"。
 *
 * <h2>{@code player_list_data_overwire}（广播那条）本刀为什么不做</h2>
 * 契约 {@code ipc-contract.md:106} 把它记成**双向**：
 * <ul>
 *   <li><b>渲染层 → 主进程</b>（{@code overwriteUserLists} {@code R:listManage:149} =
 *       {@code rendererListManage.ts:149} 的 {@code rendererInvoke(list_data_overwire, data)}，
 *       主进程 {@code M:list:9} = {@code rendererEvent.ts:9-11}）—— 这是
 *       <b>整表覆盖（导入备份）</b>，是一条**写**通道。任务书明确"不要做写侧"，下一刀再做；</li>
 *   <li><b>主进程 → 渲染层</b>（{@code M:listSend:7} =
 *       {@code src/main/modules/commonRenderers/list/winRendererEvent.ts:6-8} 的
 *       {@code sendEvent(PLAYER_EVENT_NAME.list_data_overwire, listData)}；
 *       渲染层在 {@code rendererListManage.ts:228} 订阅）—— 它唯一的**生产者**是主进程里
 *       {@code global.rain.event_list.on('list_data_overwrite', …)} 那一支，
 *       也就是被上面那条写通道（或别的写操作）触发之后，把整份列表推回渲染层。</li>
 * </ul>
 * 于是本刀**不需要**它，两条理由都成立：
 * <ol>
 *   <li><b>读取侧不依赖它</b>：{@code getUserLists()} 是一条普通 invoke，一次拿回整份列表；
 *       渲染层订阅它是为了接"主进程发起的变更"，而 Android 侧**没有主进程** ——
 *       在本刀里根本没有代码路径会去覆盖整表，也就没有东西可广播；</li>
 *   <li><b>它没有生产者</b>：唯一会发这条广播的就是上面那条写通道的实现（下一刀）。
 *       现在注册一个"永远不发"的广播，只会让人以为"导入备份已经能用"。</li>
 * </ol>
 * 因此本文件<b>不注册</b> {@code player_list_data_overwire}：渲染层若真去 invoke 它，会立刻拿到
 * {@code IPC_CHANNEL_UNSUPPORTED}（**大声**失败，不是静默）；渲染层那一侧的
 * {@code rendererOn(…, list_data_overwire)} 订阅本来就在（{@code rendererListManage.ts:228}），
 * 与桥无关、**不需要改 JS**（P0-1 的桥是通道无关的）。
 *
 * <h2>不假装成功（逐条）</h2>
 * <table border="1">
 *   <caption>空 / 坏 / 表缺失 / 查询失败</caption>
 *   <tr><th>状态</th><th>本通道</th><th>理由</th></tr>
 *   <tr><td><b>没有歌单</b>（库刚建好、{@code my_list} 零行；或用户确实一个自建歌单都没有）</td>
 *       <td>resolve {@code []}</td>
 *       <td>与桌面首启**同形**：桌面启动期就建了表（{@code db.ts:44-50}），
 *           {@code getAllUserList()} 返回的也是 {@code []}。这才是"空"的正确取值</td></tr>
 *   <tr><td><b>库打不开</b>（文件损坏 / 不是 SQLite 库 / 没有权限 / 首次建表失败 / 迁移抛错）</td>
 *       <td>reject {@code ok:false, code=IPC_HANDLER_FAILED}；消息里带库的绝对路径与原始原因</td>
 *       <td>"坏了"不能伪装成"空的"</td></tr>
 *   <tr><td><b>表缺失</b>（库在、但没有 {@code my_list}）</td>
 *       <td>reject，消息里点名"表缺失"与 {@code tables.ts} 是期望结构的出处</td>
 *       <td>同上；而且这条通道是**只读**的，它连"把表建回来"这个选项都没有
 *           （建表只在文件不存在时由 {@link RainMusicDatabase} 做一次）</td></tr>
 *   <tr><td><b>查询失败</b>（列不存在等结构漂移、游标异常）</td>
 *       <td>reject，消息里带原始异常</td>
 *       <td>绝不 {@code catch} 之后返回空数组</td></tr>
 * </table>
 *
 * <p><b>渲染层看得见这个 {@code ok:false} 吗？</b>看得见，而且是**大声**的：唯一的调用点
 * {@code src/renderer/core/useApp/useDataInit.ts:102} 是
 * {@code invokeSkippable(async() => getUserLists(), PLAYER_EVENT_NAME.list_get, 'A', …)} ⇒
 * 失败时 `undefined`（**不赋值** {@code window.rainData.userLists}，见
 * {@code useDataInit.ts:100-103} 与 {@code listAutoUpdate.ts:31-32} 的"不塞任何假数据"），
 * 并留下一条 {@code console.error}（{@code platform/ipcFallback/subscribe.ts:72-76,89-101}）。
 * 也就是说：**"空"与"坏"在界面上是两种表现** —— 空 = 渲染层拿到一个真的空列表；
 * 坏 = 这一步被跳过 + 一条点名通道名的错误日志。这正是"绝不返回空数组假装没有歌单"要守住的东西。
 *
 * <h2>参数</h2>
 * 契约那一格是"无"。渲染层也确实不传（{@code rendererListManage.ts:28} 只给通道名）⇒ {@code args = []}。
 * 桌面 {@code M:list:6} 的回调**根本不读参数**。所以本通道**不校验参数**：多传了参数只打一条
 * {@code Logger.debug}（点一下"桌面这里不读参数"），不 reject ——
 * 加一条桌面没有的失败，只会制造一处真机上才会暴露的差异
 * （与第三刀"不给 {@code DATA_KEYS} 加白名单"是同一个取舍）。
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
 * 逐条核对的，只能由 CI（{@code .github/workflows/build-android.yml} 的 {@code gradlew assembleDebug}）证伪。
 * 真机行为（首装建库、{@code []} / 报错的实际表现、并发读、与线 A 的
 * {@code @capacitor-community/sqlite} 是否打开同一个文件）**同样未在真机验证**。
 */
public final class RainMusicListChannels {

    /**
     * {@code player_list_get}：键名 {@code list_get}
     * （{@code src/common/ipcNames.ts:23} 的 {@code PLAYER_EVENT_NAME.list_get}）
     * + 模块前缀 {@code player}（生成规则 {@code ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_LIST_GET = "player_list_get";

    /**
     * 读全部用户歌单。逐字抄 {@code src/main/worker/dbService/modules/list/statements.ts:14-21} 的
     * {@code createListQueryStatement()}：
     * <ul>
     *   <li>列清单与顺序一字不改（含 {@code position}，桌面用它维护排序；返回给渲染层时会剥掉）；</li>
     *   <li>{@code FROM "main"."my_list"}（{@code "main".} 前缀保留）；</li>
     *   <li>{@code ORDER BY "position" ASC, "rowid" ASC} —— 注释原文：
     *       "用户自建歌单的顺序以 position 列为准 … 否则取回的是 SQLite 的存储顺序（rowid），
     *       VACUUM 后可能改变，排序结果便无法保证重启后仍然生效。排序值相同的旧数据再按 rowid 兜底"。
     *       这一句**是本条通道语义的一部分**，不许省。</li>
     * </ul>
     */
    static final String SQL_LIST_GET = """
        SELECT "id", "name", "source", "sourceListId", "position", "locationUpdateTime"
        FROM "main"."my_list"
        ORDER BY "position" ASC, "rowid" ASC
        """;

    /** {@code my_list} 的列名（{@code tables.ts:129-137}），只在本文件里用。 */
    private static final String COLUMN_ID = "id";
    private static final String COLUMN_NAME = "name";
    private static final String COLUMN_SOURCE = "source";
    private static final String COLUMN_SOURCE_LIST_ID = "sourceListId";
    private static final String COLUMN_LOCATION_UPDATE_TIME = "locationUpdateTime";

    private static final String TAG = "RainMusicList";

    private RainMusicListChannels() {}

    /**
     * 注册这一条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 {@code setEmitter}、
     * 第一刀 / 第二刀的 {@code register} 同一处、同一时序理由：必须在渲染层第一次 invoke 之前完成，
     * 否则真机上就是 {@code IPC_CHANNEL_UNSUPPORTED}）。
     *
     * <p>与前面几刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicListChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_LIST_GET, (args, ctx) -> listGet(requireContext(plugin), args));
        // ⚠️ 这里**只打文件名**、不调 getDatabasePath()：load() 阶段 Context 可能还没有
        // （所以 Context 一律留到 handler 调用时再取）。绝对路径由 open() 在真机上打进错误信息。
        Logger.info(
            TAG,
            "P0-2 第四刀：已注册 " + CHANNEL_LIST_GET + "（只读；落点 " + RainMusicDatabase.DATABASE_NAME +
            " 的 \"" + RainMusicDatabase.TABLE_MY_LIST + "\" 表，schema 版本 " +
            RainMusicDatabase.SCHEMA_VERSION_TEXT + "）"
        );
    }

    // ------------------------------------------------------------------ 通道实现

    /**
     * {@code player_list_get}：读 {@code my_list} 全表。
     *
     * @param args 渲染层不传参数（契约那一格就是"无"）；多传了只打一条 debug，不失败
     * @return 一个 {@link JSONArray}，元素形状 = {@code Rain.List.UserListInfo}
     *         （{@code id} / {@code name} / {@code source} / {@code sourceListId} / {@code locationUpdateTime}，
     *         **没有 {@code position}**）；没有任何歌单时是**空数组**（那才是"空"的正确取值）
     * @throws IllegalStateException 库打不开 / 表缺失 / 查询失败（**不返回空数组**，见类注释）
     */
    private static Object listGet(Context context, List<Object> args) {
        if (args != null && !args.isEmpty()) {
            Logger.debug(
                TAG,
                CHANNEL_LIST_GET + "：收到 " + args.size() + " 个参数。桌面这一支" +
                "（src/main/modules/commonRenderers/list/rendererEvent.ts:6-8）**不读参数**，" +
                "本通道同样忽略（渲染层的 getUserLists 也确实不传，rendererListManage.ts:28）"
            );
        }
        SQLiteDatabase db = RainMusicDatabase.open(context);
        return readLists(db);
    }

    /**
     * 执行 {@link #SQL_LIST_GET} 并逐行转成 JSON。
     *
     * <p>游标一律在 {@code finally} 里关（见 {@link RainMusicDatabase} 类注释「游标」）；
     * 任何异常都换成 {@code IllegalStateException} 抛出去，**不吞、也不返回空数组**。
     */
    private static JSONArray readLists(SQLiteDatabase db) {
        JSONArray lists = new JSONArray();
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(SQL_LIST_GET, null);

            int idIndex = cursor.getColumnIndexOrThrow(COLUMN_ID);
            int nameIndex = cursor.getColumnIndexOrThrow(COLUMN_NAME);
            int sourceIndex = cursor.getColumnIndexOrThrow(COLUMN_SOURCE);
            int sourceListIdIndex = cursor.getColumnIndexOrThrow(COLUMN_SOURCE_LIST_ID);
            int locationUpdateTimeIndex = cursor.getColumnIndexOrThrow(COLUMN_LOCATION_UPDATE_TIME);
            // ⚠️ "position" 故意**不取下标**：桌面的 getAllUserList() 把它剥掉之后再返回
            // （modules/list/index.ts:58-62），所以它只参与 SQL 的 ORDER BY，不进返回值。

            while (cursor.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put(COLUMN_ID, jsonValue(cursor.getString(idIndex)));
                item.put(COLUMN_NAME, jsonValue(cursor.getString(nameIndex)));
                item.put(COLUMN_SOURCE, jsonValue(cursor.getString(sourceIndex)));
                // 与桌面 queryAllUserList() 的 .0 修复逐字等价（dbHelper.ts:44-49），见类注释「一行的形状」。
                item.put(
                    COLUMN_SOURCE_LIST_ID,
                    jsonValue(stripLegacyNumericIdSuffix(cursor.getString(sourceListIdIndex)))
                );
                if (cursor.isNull(locationUpdateTimeIndex)) {
                    // number | null（src/common/types/list.d.ts:10）：NULL 必须写成 JSON null。
                    item.put(COLUMN_LOCATION_UPDATE_TIME, JSONObject.NULL);
                } else {
                    item.put(COLUMN_LOCATION_UPDATE_TIME, cursor.getLong(locationUpdateTimeIndex));
                }
                lists.put(item);
            }
        } catch (Exception ex) {
            // 结构漂移（列不存在）、游标异常、JSON 组装异常：全部**大声抛错**。
            // 绝不 `return new JSONArray()` —— 那会把"读不出来"伪装成"用户没有歌单"。
            throw new IllegalStateException(
                "读 \"" + RainMusicDatabase.TABLE_MY_LIST + "\" 失败（" + SQL_LIST_GET.trim().replaceAll("\\s+", " ") +
                "）：" + ex.getMessage() +
                "。本通道**不会**返回空数组假装「用户没有歌单」。",
                ex
            );
        } finally {
            if (cursor != null) cursor.close();
        }
        return lists;
    }

    // ------------------------------------------------------------------ 工具

    /**
     * {@code /.0$/} 的等价实现：**只**去掉末尾的 {@code .0}（桌面 {@code dbHelper.ts:44-49}）。
     * {@code null} 原样返回（该列可空）。
     */
    private static String stripLegacyNumericIdSuffix(String sourceListId) {
        if (sourceListId == null) return null;
        return sourceListId.endsWith(".0") ? sourceListId.substring(0, sourceListId.length() - 2) : sourceListId;
    }

    /**
     * Java {@code null} → {@code JSONObject.NULL}。
     *
     * <p>为什么必要：{@code org.json} 的 {@code put(name, null)} 会**删掉这个键**，
     * 只有 {@code put(name, JSONObject.NULL)} 才写出一个 JSON null —— 而这条通道的三个可空列
     * （{@code source} / {@code sourceListId} / {@code locationUpdateTime}）在桌面就是 {@code null}
     * （better-sqlite3 的 NULL → JS {@code null} → {@code JSON.stringify} 里就是 {@code null}）。
     * 官方文档原文见 {@code RainMusicAppSettingChannels.jsonValue()} 的注释。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
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
