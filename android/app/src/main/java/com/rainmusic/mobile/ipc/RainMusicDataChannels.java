package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Logger;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * Android 移植 · **P0-2 第二刀**：渲染层键值存储的**读通道** —— 只做 {@code winMain_get_data}，
 * 别的通道（{@code winMain_save_data} / {@code player_list_*} / {@code dislike_*}）一条不做。
 *
 * <pre>
 * winMain_get_data   invoke, args=[path]   → any | null   （契约 docs/android/ipc-contract.md:197）
 * </pre>
 *
 * <h2>形状（抄契约，没有自己发明）</h2>
 *
 * 契约行 {@code ipc-contract.md:197}：
 * <ul>
 *   <li>渲染层封装 9 处：{@code getPlayInfo} {@code R:ipc:140}、{@code getSearchHistoryList} {@code :151}、
 *       {@code getListPositionInfo} {@code :162}、{@code getListPrevSelectId} {@code :173}、
 *       {@code getListUpdateInfo} {@code :184}、{@code getLeaderboardSetting} {@code :194}、
 *       {@code getSongListSetting} {@code :203}、{@code getSearchSetting} {@code :212}、
 *       {@code getViewPrevState} {@code :221}；</li>
 *   <li>主进程 handler {@code M:data:7} = {@code src/main/modules/winMain/rendererEvent/data.ts:7-25}
 *       （{@code mainHandle} ⇒ 渲染层是 {@code rendererInvoke}，异步请求/应答）；</li>
 *   <li>参数 → 返回：{@code path: DATA_KEYS} → {@code any | null}。</li>
 * </ul>
 *
 * 参数只有一个：{@code args[0]} = 键名（{@code rendererInvoke(channel, DATA_KEYS.x)} ⇒
 * {@code args = [path]}，见 {@code src/common/rendererIpc.ts:29-31} 与
 * {@code src/common/platform/ipcBridge/capacitor.js:585-613}）。**不做 DATA_KEYS 白名单校验** ——
 * 桌面也不校验（同一个 store 里还住着 {@code winLegacyMessageShown} 这种不在 DATA_KEYS 里的键，
 * {@code src/main/utils/winLegacy.ts:11}），加白名单只会制造一处桌面没有的失败。
 *
 * <h2>落点：这是**键值存储**，不是 SQL —— 本文件一行 SQL 都没有（含理由）</h2>
 *
 * 桌面侧它的落点是 {@code getStore(STORE_NAMES.DATA)} ⇒ {@code <RainDatas>/data.json}
 * （{@code rendererEvent/data.ts:8}、{@code src/main/platform/storage/core.ts}），也就是一份
 * **JSON 键值表**，跟 {@code src/main/worker/dbService/**}（better-sqlite3）没有关系：
 * {@code M:data:7} 里**只有 {@code playInfo} 分支**会碰 dbService（{@code data.ts:11-24}），
 * 那一步是"播放队列恢复校正"，不是"读数据"。
 *
 * 因此本通道**没有 SQL 落点**，也不该硬造一个：
 * <ol>
 *   <li>阶段 2a 的表结构在 {@code src/main/worker/dbService/tables.ts:121-232}，一共 9 张表
 *       （{@code db_info} / {@code my_list} / {@code my_list_music_info} / {@code my_list_music_info_order} /
 *       {@code music_info_other_source} / {@code lyric} / {@code music_url} / {@code download_list} /
 *       {@code dislike_list}），**没有任何 kv 表** —— 所以"表结构照 tables.ts 逐字对齐"在这条通道上
 *       无表可对；</li>
 *   <li>契约对这条通道给的 Android 方案就是键值：{@code ipc-contract.md:515}
 *       "`@capacitor/preferences`（键值）或 SQLite 表"、{@code :722}
 *       "键值存储 … `@capacitor/preferences` … 也可直接落在 SQLite 里"；</li>
 *   <li>阶段 2b 的结论（{@code docs/android/storage-adapter.md:223-232} §3.2）明确选了
 *       {@code @capacitor/preferences}，并且**明确要求 {@code playInfo} 的恢复校正逻辑留在"主进程"侧**
 *       （Android 上根本没有主进程，见下面「语义差异 2」）；</li>
 *   <li>P0-2 第一刀（{@code RainMusicAppSettingChannels.java}）已经把**同一个 {@code rain:store:} 命名空间**
 *       落在 {@code CapacitorStorage} 这份 SharedPreferences 上，本文件必须与它对齐，否则同一套 store
 *       会在两个地方各写各的。</li>
 * </ol>
 *
 * <p><b>所以落点就是第一刀的落点：SharedPreferences 文件 {@code CapacitorStorage}（= {@code @capacitor/preferences}
 * 的默认 group），键 {@code rain:store:data}，值 = 整份 store 的 JSON 文本</b>
 * （{@code 'rain:store:' + desc.name}，{@code src/main/platform/storage/adapter.android.ts:95}；
 * {@code STORE_NAMES.DATA = 'data'}，{@code src/common/constants.ts:10}）。键名不带 DATA_KEYS ——
 * 一份 store 一个 key，与 {@code adapter.android.ts} 的读/写逐字一致，P0-3 接 Preferences 时不需要迁移。
 * ⚠️ 阶段 2b §3.2 曾建议"每个 {@code DATA_KEYS} 一个 key（{@code rain:data:playInfo}）"以降低写放大，
 * 但**已经落地的骨架**（{@code adapter.android.ts:95}）是"一份 store 一个 key"；两边只能选一个，
 * 本刀选已落地的那一个（写放大是写入方的事，且写入方就是同一份骨架）。这是**需要人来定的点**，
 * 已在汇报里列出。
 *
 * <h2>并发：这条通道**只读**，因此不需要锁（说清楚为什么）</h2>
 *
 * P0-1 的 handler 跑在 {@link RainMusicIpcPlugin} 自己的 2 线程池里，所以并发是真的。本文件：
 * <ol>
 *   <li>**没有 SQLite** ⇒ 没有连接 / 事务 / busy / {@code database is locked} 这一类问题
 *       （本通道不开库、不建表、不持连接）；</li>
 *   <li>整个 handler 只做一次 {@code SharedPreferences.getString()}。它取回的是一个**不可变字符串
 *       快照**，随后在锁外解析 —— 不存在"读到半截文本"的中间态；写入方（未来的
 *       {@code winMain_save_data} / P0-3 的 {@code Preferences.set}）在 SharedPreferences 内部
 *       原子地替换整份文本，读方只会看到**旧的整份**或**新的整份**；</li>
 *   <li>{@code Context.getSharedPreferences(name, …)} 在同一进程内对同一文件名返回**同一个实例**
 *       （{@code ContextImpl} 的进程级缓存）⇒ 不会出现"两个内存副本各看到各的旧值"，P0-3 用
 *       {@code @capacitor/preferences}（默认 group 就是这份文件）写进去的数据，这里立刻读得到；</li>
 *   <li>**本文件没有 read-modify-write**，所以哪怕它与未来的写入方并发也不会互相覆盖。</li>
 * </ol>
 *
 * <p>⚠️ 但**成对的写通道（{@code winMain_save_data}）必须串行化**：它是"读整份文本 → 改一个键 → 写回整份文本"，
 * 两个并发写会丢掉其中一个（桌面不会遇到：Electron 主进程单线程 + 同步写）。这正是第一刀
 * {@code WRITE_LOCK}（{@code RainMusicAppSettingChannels.java:144}）与阶段 2b {@code enqueueWrite}
 * （{@code adapter.android.ts:165}）存在的原因 —— 那条规矩留给下一刀，本刀不预埋一把没人用的锁，
 * 也不假装它已经处理好了。
 *
 * <h2>不假装成功（逐条）</h2>
 * <ul>
 *   <li>{@code args} 为空 / {@code args[0]} 不是**非空字符串** ⇒ 抛错（调用方看到 {@code ok:false} 的 reject，
 *       不是静默 null）。桌面这里会把 {@code undefined} 丢给 {@code store.get()}，行为未定义；
 *       本通道选择"大声报错"；</li>
 *   <li>{@code rain:store:data} 的文本存在但**不是合法 JSON 对象** ⇒ 抛错。**绝不返回 null / {} / []** ——
 *       那会把"数据坏了"伪装成"首次启动"（第一刀在坏 JSON 上就是拒绝这么做的，
 *       {@code RainMusicAppSettingChannels.java:79-81,279-290}）。本通道是只读的，所以它连"覆盖坏数据"
 *       这个选项都没有；</li>
 *   <li>拿不到 {@code Context} ⇒ 抛错，而不是读出一个空 store 当成"没有数据"；</li>
 *   <li>**键不存在 / 从未写过 store ⇒ 返回 null，这是正确的答案而不是失败**：桌面同样读不出来
 *       （{@code store.get()} 给 {@code undefined}），而 JSON 里没有 {@code undefined}，
 *       桥的应答只能是 {@code null}。9 个调用方**全部**有兜底：{@code src/renderer/utils/ipc.ts:198,207,216,225}
 *       的 {@code ?? {...DEFAULT_SETTING.x}}、{@code src/renderer/store/search/action.ts:23} 的 {@code ?? []}、
 *       {@code src/renderer/utils/data.ts:49,82,100} 的 {@code ?? {}} / {@code ?? LIST_IDS.DEFAULT}、
 *       {@code src/renderer/core/useApp/useDataInit.ts:19} 的 {@code info?.listId}、
 *       {@code src/renderer/core/useApp/index.ts:151} 的 {@code invokeWithFallback(…, () => null)}。</li>
 * </ul>
 *
 * <p>三种状态**分别**的表现（这是本通道最容易被写错的一处）：
 *
 * <table border="1">
 *   <caption>空 / 坏 / 缺表</caption>
 *   <tr><th>状态</th><th>本通道</th><th>理由</th></tr>
 *   <tr><td>存储**空**（从没写过 {@code rain:store:data}，或 store 里没有这个键）</td>
 *       <td>resolve {@code null}（不是 reject，也不是 {@code []} / {@code {}}）</td>
 *       <td>与桌面首启一致；调用方自己的默认值接手</td></tr>
 *   <tr><td>存储**坏**（文本不是合法 JSON 对象）</td>
 *       <td>reject {@code ok:false, code=IPC_HANDLER_FAILED}，且**不覆盖**</td>
 *       <td>"坏了"不能伪装成"空的"；这是第一刀立的规矩</td></tr>
 *   <tr><td>**表缺失**（SQLite 语境）</td>
 *       <td>不适用 —— 本通道不建表、不查表</td>
 *       <td>若将来有人把落点改成 SQLite 表（线 A），**"表不存在"必须报错**，
 *           不能当成"空库"返回 null；这条写在这里，免得那一天被顺手写成"空"</td></tr>
 * </table>
 *
 * <h2>与桌面的语义差异（逐条，含理由）</h2>
 * <ol>
 *   <li><b>{@code undefined} vs {@code null}</b>：桌面 {@code store.get(path)} 在键不存在时给
 *       {@code undefined}；本通道只能给 JSON {@code null}（桥的应答要过 JSON 序列化，
 *       {@code RainMusicIpcPlugin.respondOk} 把 null 映射成 {@code JSObject.NULL}）。上面列出的
 *       9 个调用方用的都是 {@code ??} / 可选链，两种值等价；**没有任何调用方区分它们**。
 *       这也是本通道**不需要**改 JS 的原因。</li>
 *   <li><b>{@code playInfo} 不做"播放队列恢复校正"</b>：桌面 {@code M:data:11-24} 在
 *       {@code listId == LIST_IDS.DEFAULT && index >= 0} 时会
 *       {@code await dbService.resolvePlaybackQueueRestoreIndex(...)} → 可能返回 {@code null}，
 *       或按 {@code getListMusics(DEFAULT)} 算出新 index 后**回写 store**，再
 *       {@code await dbService.completePlaybackQueueRestore()}。Android 上这条链**没有可用的落点**：
 *       {@code global.rain.worker.dbService} 是**主进程**里的 SQLite worker（{@code src/main/event/ListEvent.ts:40}
 *       等 40 余处都是这么用的），而 Android 侧根本没有主进程，线 A 的 Android 驱动
 *       （{@code src/main/worker/dbService/adapter/android.ts:53-58}）到现在仍是
 *       {@code throw new Error('… not implemented yet')}。所以本通道**原样返回存储值**，
 *       并打一条 {@code Logger.warn} 点名"校正没有做" —— **不是静默跳过**。
 *       为什么"原样返回"不算假装成功：桌面自己在 {@code listId != DEFAULT || index < 0} 时
 *       也是原样返回（{@code data.ts:11-14}），而且调用方对 index 有自己的守卫
 *       （{@code useDataInit.ts:19-21}：{@code !info?.listId || info.index < 0} 与
 *       {@code !list[info.index]} 都会放弃恢复），越界索引不会变成"恢复错歌"。</li>
 *   <li><b>损坏恢复</b>：桌面把坏 JSON 改名成 {@code .bak} 并弹框，然后继续跑
 *       （{@code storage-adapter.md:183}）；本通道**只读**，既不改名也不覆盖，直接 reject。
 *       理由同上表：把"坏"标出来，比替用户"修好"更不容易把数据搞丢。</li>
 *   <li><b>参数校验</b>：桌面不校验（{@code store.get(undefined)} 的行为未定义）；本通道
 *       对空参数/非字符串**抛错**。理由：这是一条真机上"错了就永远静默"的通道，
 *       宁可让调用方看见一次 reject。</li>
 *   <li><b>文本格式</b>：桌面写的是 {@code JSON.stringify(store, null, '\t')}（tab 缩进），
 *       P0-3 落到 Preferences 的文本由 JS 侧 {@code stringify()} 决定。本通道只把它当 JSON 解析，
 *       格式差异（只影响人肉 diff）不构成语义差异。</li>
 *   <li><b>{@code save_data} 还没做</b>（本刀范围外）：所以 Android 上现在**没有任何写入方**，
 *       除非 P0-3 或别的通道写进去，本通道会一直返回 {@code null}。这是"诚实但暂时读不到东西"，
 *       不是失败 —— 下一刀（{@code winMain_save_data}，{@code M:data:30}，{@code mainOn} 单向）补上即可。</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.content.*} 与 {@code org.json}、JDK 的 {@code java.util.List}。
 * **没有新增任何 gradle 依赖**，也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着本机读到的 {@code @capacitor/android@8.5.2} 源码 + Android 框架 API 逐条核对的，
 * 只能由 CI（{@code .github/workflows/build-android.yml} 的 {@code gradlew assembleDebug}）证伪；
 * 真机行为（Preferences 落盘、与 P0-3 的 {@code @capacitor/preferences} 是否读写同一份数据、
 * 事件时机）同样**未在真机上验证**。
 */
public final class RainMusicDataChannels {

    /**
     * `winMain_get_data`：键名 `get_data`（{@code src/common/ipcNames.ts} 的
     * {@code WIN_MAIN_RENDERER_EVENT_NAME.get_data}）+ 模块前缀 `winMain`
     * （生成规则见 {@code src/common/ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_GET_DATA = "winMain_get_data";

    /**
     * SharedPreferences 文件名 = `@capacitor/preferences` 的默认 group。
     * 与第一刀 {@link RainMusicAppSettingChannels#PREFERENCES_FILE} 必须是同一个文件
     * （同一套 store 命名空间，理由见类注释）。
     */
    public static final String PREFERENCES_FILE = "CapacitorStorage";

    /**
     * store 的落点键，与阶段 2b 的 `preferencesKey()` 逐字一致：
     * {@code 'rain:store:' + desc.name}（`adapter.android.ts:95`），
     * 其中 `STORE_NAMES.DATA = 'data'`（{@code src/common/constants.ts:10}）。
     */
    public static final String STORE_KEY = "rain:store:data";

    /**
     * `playInfo` 的键名（`DATA_KEYS.playInfo`，{@code src/common/constants.ts:39}）。
     * 单独提出来是因为**只有这个键**在桌面上有额外语义（播放队列恢复校正），
     * 而这里明确不做 —— 见类注释「语义差异 2」。
     */
    public static final String DATA_KEY_PLAY_INFO = "playInfo";

    private static final String TAG = "RainMusicData";

    private RainMusicDataChannels() {}

    /**
     * 注册这一条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 `setEmitter`、
     * 第一刀的 `RainMusicAppSettingChannels.register` 同一处）。漏调 = 真机上
     * {@code IPC_CHANNEL_UNSUPPORTED}，不会静默。
     *
     * <p>与第一刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicDataChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_GET_DATA, (args, ctx) -> getData(requireContext(plugin), args));
        Logger.info(
            TAG,
            "P0-2 第二刀：已注册 " + CHANNEL_GET_DATA +
            "（落点 " + PREFERENCES_FILE + " → " + STORE_KEY + "，只读）"
        );
    }

    // ------------------------------------------------------------------ 那条通道

    /**
     * `winMain_get_data`：读 store 里的一个键。
     *
     * @param args {@code args[0]} = 键名（非空字符串）
     * @return 存储值原样返回；**键不存在 / 还没写过 store** 时返回 {@code null}
     *         （与桌面"读不出来"一致，见类注释的三种状态表）
     * @throws IllegalArgumentException 参数不是非空字符串
     * @throws IllegalStateException    store 文本存在但不是合法 JSON 对象（**不覆盖**）
     */
    private static Object getData(Context context, List<Object> args) {
        String path = readPath(args);
        String text = preferences(context).getString(STORE_KEY, null);

        if (text == null) {
            // 与桌面首启同形：store 还没落过盘 ⇒ 任何一个键都读不出来。这不是错误。
            Logger.warn(
                TAG,
                CHANNEL_GET_DATA + "(\"" + path + "\")：Preferences 里还没有 " + STORE_KEY +
                "（首次启动，或还没有任何写入方）→ 返回 null；默认值由渲染层兜底" +
                "（src/renderer/utils/ipc.ts:198,207,216,225 等的 `??`）"
            );
            return null;
        }

        JSONObject store = parseStoreText(text);
        Object value = store.opt(path);
        if (value == null) {
            Logger.info(TAG, CHANNEL_GET_DATA + "：store 里没有键 \"" + path + "\" → 返回 null");
            return null;
        }

        if (DATA_KEY_PLAY_INFO.equals(path)) {
            // 桌面在这一支会做「播放队列恢复校正」（可能改 index / 回写 / 返回 null）。
            // Android 上没有可用的 dbService（线 A 的 Android 驱动仍未实现）⇒ 原样返回，
            // 并且**大声**说明这一点（不静默）。理由与调用方的守卫见类注释「语义差异 2」。
            Logger.warn(
                TAG,
                CHANNEL_GET_DATA + "(\"" + DATA_KEY_PLAY_INFO + "\")：已按原样返回存储值；" +
                "桌面版的「播放队列恢复校正」**没有执行**" +
                "（src/main/modules/winMain/rendererEvent/data.ts:11-24 依赖主进程的 dbService，" +
                "Android 侧无主进程、线 A 的 SQLite 驱动也未实现）" +
                "。调用方对越界 index 有自己的守卫（src/renderer/core/useApp/useDataInit.ts:19-21）。"
            );
        }
        return value;
    }

    // ------------------------------------------------------------------ 存储

    private static Context requireContext(RainMusicIpcPlugin plugin) {
        Context context = plugin.getContext();
        if (context == null) {
            throw new IllegalStateException(
                "拿不到 Context（插件还没挂上 Bridge/Activity）：无法读 " + PREFERENCES_FILE + " 里的 " + STORE_KEY
            );
        }
        Context appContext = context.getApplicationContext();
        return appContext == null ? context : appContext;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE);
    }

    /**
     * 解析 store 文本；不是合法 JSON 对象就抛错。
     *
     * <p>**不返回** {@code null} / {@code {}} / {@code []}：那会把"数据坏了"伪装成"首次启动"。
     * 本通道只读，所以也**不会覆盖**坏数据（第一刀在写通道上还必须额外保证这一点）。
     */
    private static JSONObject parseStoreText(String text) {
        try {
            return new JSONObject(text);
        } catch (JSONException ex) {
            throw new IllegalStateException(
                STORE_KEY + " 里的文本不是合法的 JSON 对象（长度 " + text.length() + "）：" + ex.getMessage() +
                "。这条通道是只读的：既不覆盖它，也**不会**返回 null —— 那会把「存储坏了」伪装成「首次启动」。",
                ex
            );
        }
    }

    // ------------------------------------------------------------------ 参数

    /** 取 `args[0]` 作为键名；必须是**非空字符串**（理由见类注释「语义差异 4」）。 */
    private static String readPath(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_GET_DATA + " 需要一个字符串参数 path（DATA_KEYS.*，见 src/common/constants.ts:37-48），收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (!(first instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_GET_DATA + " 的参数必须是字符串，收到 " + first.getClass().getName() + "：" + describeArgs(args)
            );
        }
        String path = (String) first;
        if (path.length() == 0) {
            throw new IllegalArgumentException(CHANNEL_GET_DATA + " 的参数 path 不能是空字符串");
        }
        return path;
    }

    /** 只打参数**类型**，不打内容（键名很短，但这条通道将来可能被人塞别的东西进来）。 */
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
