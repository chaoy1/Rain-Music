package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Logger;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Map;

/** Preferences DATA store. playInfo restoration uses SQLite identity snapshots and acknowledges only after commit. */
public final class RainMusicDataChannels {

    /**
     * `winMain_get_data`：键名 `get_data`（{@code src/common/ipcNames.ts} 的
     * {@code WIN_MAIN_RENDERER_EVENT_NAME.get_data}）+ 模块前缀 `winMain`
     * （生成规则见 {@code src/common/ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_GET_DATA = "winMain_get_data";

    /**
     * `winMain_save_data`：键名 `save_data`（{@code src/common/ipcNames.ts:89} 的
     * {@code WIN_MAIN_RENDERER_EVENT_NAME.save_data}）+ 模块前缀 `winMain`（同上）。
     */
    public static final String CHANNEL_SAVE_DATA = "winMain_save_data";

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
     * 单独提出来是因为**只有这个键**在桌面上有额外语义（读侧"播放队列恢复校正"、
     * 写侧持久确认后清理启动快照）。
     */
    public static final String DATA_KEY_PLAY_INFO = "playInfo";

    /**
     * `save_data` 参数里的两个字段名（契约 `ipc-contract.md:198` 的 `{path, data}`）。
     */
    private static final String FIELD_PATH = "path";
    private static final String FIELD_DATA = "data";

    /** `playInfo` 身体里的两个字段（只用来判断桌面写侧会不会去调 dbService，见类注释「语义差异 7」）。 */
    private static final String FIELD_LIST_ID = "listId";
    private static final String FIELD_MUSIC_ID = "musicId";

    /**
     * `LIST_IDS.DEFAULT = 'default'`（{@code src/common/constants.ts:24}）。
     * 只用于判断桌面写侧**会不会**去调 {@code completePlaybackQueueRestore()}（{@code data.ts:32}），
     * 在成功持久写入后确认默认队列的恢复。
     */
    private static final String LIST_ID_DEFAULT = "default";

    private static final String TAG = "RainMusicData";

    private RainMusicDataChannels() {}

    /**
     * 注册这两条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 `setEmitter`、
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
        RainMusicIpcHandlers.register(CHANNEL_SAVE_DATA, (args, ctx) -> saveData(requireContext(plugin), args));
        Logger.info(
            TAG,
            "P0-2 第二刀 + 第三刀：已注册 " + CHANNEL_GET_DATA + " / " + CHANNEL_SAVE_DATA +
            "（落点 " + PREFERENCES_FILE + " → " + STORE_KEY + "，读 + 写；写侧与 " +
            "RainMusicAppSettingChannels 共用同一把锁）"
        );
    }

    // ------------------------------------------------------------------ 读通道（第二刀）

    /**
     * `winMain_get_data`：读 store 里的一个键。
     *
     * @param args {@code args[0]} = 键名（非空字符串）
     * @return 存储值原样返回；**键不存在 / 还没写过 store** 时返回 {@code null}
     *         （与桌面"读不出来"一致，见类注释的三种状态表）
     * @throws IllegalArgumentException 参数不是非空字符串
     * @throws IllegalStateException    store 文本存在但不是合法 JSON 对象（**不覆盖**）
     */
    private static Object getData(Context context, List<Object> args) throws JSONException {
        String path = readPath(args);
        if (!DATA_KEY_PLAY_INFO.equals(path)) {
            String text = preferences(context).getString(STORE_KEY, null);
            return text == null ? null : parseStoreText(text).opt(path);
        }
        synchronized (RainMusicListWriteLock.LOCK) {
            synchronized (RainMusicStoreLock.WRITE_LOCK) {
                SharedPreferences prefs = preferences(context);
                String text = prefs.getString(STORE_KEY, null);
                JSONObject store = text == null ? new JSONObject() : parseStoreText(text);
                Object value = store.opt(path);
                if (value instanceof JSONObject && LIST_ID_DEFAULT.equals(((JSONObject) value).opt(FIELD_LIST_ID))) {
                    Object rawIndex = ((JSONObject) value).opt("index");
                    if (!(rawIndex instanceof Number)) throw new IllegalArgumentException("playInfo.index must be an integer");
                    double index = ((Number) rawIndex).doubleValue();
                    if (Double.isNaN(index) || Double.isInfinite(index) || index != Math.rint(index)) {
                        throw new IllegalArgumentException("playInfo.index must be an integer");
                    }
                    if (index >= 0) {
                        value = RainMusicPlaybackQueueRestore.resolve(context, (JSONObject) value);
                        if (value == null) return null;
                        store.put(path, value);
                    }
                } else if (value != null && value != JSONObject.NULL && !(value instanceof JSONObject)) {
                    throw new IllegalArgumentException("playInfo must be an object or null");
                }
                persist(prefs, store, path);
                RainMusicPlaybackQueueRestore.complete(context);
                return value == JSONObject.NULL ? null : value;
            }
        }
    }

    // ------------------------------------------------------------------ 写通道（第三刀）

    /**
     * `winMain_save_data`：写 store 里的一个键 —— **读整份文本 → 改这一个键 → 写回整份文本**，
     * 整段在 {@link RainMusicStoreLock#WRITE_LOCK} 内完成（为什么必须串行化、为什么与设置通道
     * 共用同一把锁，见类注释「并发」与 {@link RainMusicStoreLock}）。
     *
     * <p>参数形状：{@code args[0]} = {@code {path, data}}（契约 {@code ipc-contract.md:198}；
     * 渲染层 9 处全是 {@code rendererSend(channel, {path, data})} ⇒ {@code args = [{path, data}]}）。
     *
     * @return 固定 {@code null}（契约是 {@code void}；9 个调用方都是单向 {@code send}，不看返回值）
     * @throws IllegalArgumentException 参数不是对象 / 缺 {@code path} / {@code path} 不是非空字符串 /
     *                                  缺 {@code data} 字段（理由见类注释「写通道 3」）
     * @throws IllegalStateException    store 文本存在但不是合法 JSON 对象（**不覆盖**），
     *                                  或 {@code commit()} 返回 false（**不落盘就不假装成功**）
     */
    private static Object saveData(Context context, List<Object> args) throws JSONException {
        JSONObject payload = readSavePayload(args);
        String path = requirePath(payload);
        if (!payload.has(FIELD_DATA)) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 的参数缺少 `" + FIELD_DATA + "` 字段（收到的顶层键=" +
                String.valueOf(payload.names()) + "）。{" + FIELD_PATH + ":…," + FIELD_DATA +
                ":null} 是合法的「写一个 JSON null」（渲染层 saveListPrevSelectId 允许 null，R:ipc:169），" +
                "而字段缺失在桌面等价于 undefined ⇒ JSON.stringify 会把这个键从文件里**抹掉**，两者不是一回事；" +
                "参数过 JSON 序列化之后已经无法区分，所以这里**拒绝**而不是猜一个（见类注释「写通道 3」）。"
            );
        }
        Object value = jsonValue(payload.opt(FIELD_DATA));

        if (DATA_KEY_PLAY_INFO.equals(path)) {
            synchronized (RainMusicListWriteLock.LOCK) {
                saveValue(context, path, value);
                if (desktopWouldFinishQueueRestore(value)) RainMusicPlaybackQueueRestore.complete(context);
            }
        } else saveValue(context, path, value);
        Logger.debug(TAG, CHANNEL_SAVE_DATA + "：已落盘键 \"" + path + "\"");
        return null;
    }

    private static void saveValue(Context context, String path, Object value) throws JSONException {
        synchronized (RainMusicStoreLock.WRITE_LOCK) {
            SharedPreferences prefs = preferences(context);
            String text = prefs.getString(STORE_KEY, null);
            JSONObject store = text == null ? new JSONObject() : parseStoreText(text);
            store.put(path, value);
            persist(prefs, store, path);
        }
    }

    private static void persist(SharedPreferences prefs, JSONObject store, String path) {
        if (!prefs.edit().putString(STORE_KEY, store.toString()).commit()) {
            throw new IllegalStateException("写入 " + STORE_KEY + " 失败：SharedPreferences.commit() 返回 false（键 " + path + " 未落盘）");
        }
    }

    // ------------------------------------------------------------------ 存储

    private static Context requireContext(RainMusicIpcPlugin plugin) {
        Context context = plugin.getContext();
        if (context == null) {
            throw new IllegalStateException(
                "拿不到 Context（插件还没挂上 Bridge/Activity）：无法读写 " + PREFERENCES_FILE + " 里的 " + STORE_KEY
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
     * 读通道用它 ⇒ 不覆盖坏数据（它只读）；写通道也用同一个它 ⇒ **同样不覆盖** ——
     * 桌面那条"先改名成 {@code .bak} 再重建"的路在 Android 上没有留底步骤
     * （{@code adapter.android.ts:144-155} 的 {@code backupSync} 是有意的空实现），
     * 覆盖就等于无备份地丢用户数据，见类注释「不假装成功」写通道第 2 条。
     */
    private static JSONObject parseStoreText(String text) {
        try {
            RainMusicPlaybackQueueRestore.validateJson(text);
            return new JSONObject(text);
        } catch (JSONException ex) {
            throw new IllegalStateException(
                STORE_KEY + " 里的文本不是合法的 JSON 对象（长度 " + text.length() + "）：" + ex.getMessage() +
                "。本次调用**不会覆盖它**，也**不会**返回 null / {} —— 那会把「存储坏了」伪装成「首次启动」。",
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

    // ------------------------------------------------------------------ 写通道的参数

    /**
     * 取 `args[0]` 作为 `{path, data}` 对象（`save_data`）。与第一刀 `readPatch()` 同款：
     * {@code JSONObject} 直取（Capacitor 的 {@code JSObject} 是它的子类），{@code Map} 只作防御分支。
     */
    private static JSONObject readSavePayload(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 需要一个 {" + FIELD_PATH + ", " + FIELD_DATA + "} 对象参数，收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (first instanceof JSONObject) return (JSONObject) first;
        if (first instanceof Map) return new JSONObject((Map) first);
        throw new IllegalArgumentException(
            CHANNEL_SAVE_DATA + " 的参数必须是对象，收到 " + first.getClass().getName() + "：" + describeArgs(args) +
            "（契约是 args=[{" + FIELD_PATH + ", " + FIELD_DATA + "}]，**不是** args=[" +
            FIELD_PATH + ", " + FIELD_DATA + "]）"
        );
    }

    /** 取 `payload.path`；必须是**非空字符串**（理由见类注释「写通道」那一节）。 */
    private static String requirePath(JSONObject payload) {
        Object raw = payload.opt(FIELD_PATH);
        if (raw == null) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 的参数缺少 `" + FIELD_PATH + "` 字段（收到的顶层键=" +
                String.valueOf(payload.names()) + "）"
            );
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 的 `" + FIELD_PATH + "` 必须是字符串，收到 " + raw.getClass().getName()
            );
        }
        String path = (String) raw;
        if (path.length() == 0) {
            throw new IllegalArgumentException(CHANNEL_SAVE_DATA + " 的 `" + FIELD_PATH + "` 不能是空字符串");
        }
        return path;
    }

    /**
     * Java {@code null} → {@code JSONObject.NULL}。
     *
     * <p>为什么必要（与第一刀 `jsonValue()` 是同一件事）：{@code org.json} 的
     * {@code put(name, null)} 会**删掉这个键**，只有 {@code put(name, JSONObject.NULL)}
     * 才存下一个 JSON null —— 而 `save_data` 的 `data` 允许是 null
     * （渲染层 {@code saveListPrevSelectId(listPosition: string | null)}，{@code R:ipc:169}）。
     * 官方文档原文见 {@code RainMusicAppSettingChannels.jsonValue()} 的注释。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    /**
     * 桌面在这个 `playInfo` 上**会不会**去调 {@code dbService.completePlaybackQueueRestore()}？
     *
     * <p>条件逐字抄 {@code data.ts:32}：{@code data?.listId != LIST_IDS.DEFAULT || data?.musicId}。
     * 只有满足此条件的成功保存才能清理原始索引映射；无稳定身份的 default 保存仍待恢复。
     */
    private static boolean desktopWouldFinishQueueRestore(Object value) {
        if (!(value instanceof JSONObject)) return true;
        JSONObject data = (JSONObject) value;

        Object listId = data.opt(FIELD_LIST_ID);
        boolean otherList = !(listId instanceof String) || !LIST_ID_DEFAULT.equals(listId);

        Object musicId = data.opt(FIELD_MUSIC_ID);
        boolean hasMusicId = musicId != null && musicId != JSONObject.NULL && !"".equals(musicId);

        return otherList || hasMusicId;
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
