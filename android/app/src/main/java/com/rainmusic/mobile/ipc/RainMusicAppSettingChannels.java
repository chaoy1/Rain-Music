package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Logger;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Android 移植 · **P0-2 第一刀**：设置通道的原生实现 —— 只做这两条，别的一条不做。
 *
 * <pre>
 * common_get_app_setting   invoke, args=[]                       → Rain.AppSetting  （契约 docs/android/ipc-contract.md:86）
 * common_set_app_setting   invoke, args=[Partial&lt;AppSetting&gt;]   → void / null       （契约 :87）
 *                          ↑ 落盘成功后广播 winMain_on_config_change（契约 :87 的"主进程落盘后回广播"）
 * </pre>
 *
 * <h2>"同步读"这件事：本通道**不存在**语义冲突</h2>
 *
 * 契约把两条都标成 `mainHandle`（`ipc-contract.md:86-87`），也就是渲染层的 `rendererInvoke`：
 *
 * <ul>
 *   <li>渲染层封装 `getSetting()` / `updateSetting()` 用的是 `rendererInvoke`
 *       （{@code src/renderer/utils/ipc.ts:13-18}），**不是** `rendererSendSync`；</li>
 *   <li>JS 侧桥把它变成 {@code {kind:"invoke"}} 信封（{@code src/common/platform/ipcBridge/capacitor.js:585-613}），
 *       本来就只有异步一条路（{@code sendSync} 结构性不支持，见同文件 :573-583）。</li>
 * </ul>
 *
 * 所以：**两条都是异步 invoke，没有"契约要同步、Android 只能异步"的冲突**。
 * 真正只有异步 API 的是**存储层**（阶段 2b 的 {@code adapter.android.ts} 的 `loadSync`/`saveSync`），
 * 而这一刀不碰存储层：native 这边 `SharedPreferences.commit()` 是**同步**的（在 P0-1 的后台线程里执行），
 * 于是"读 → 改 → 写 → 广播"在一次 handler 调用内原子完成，比阶段 2b 给 JS 侧设计的"预热快照 + 异步回写"
 * 更简单，也不存在写丢失窗口。
 *
 * <h2>落点：复用阶段 2b 的决定（`docs/android/storage-adapter.md` §3.1 / §3.6）</h2>
 *
 * 阶段 2b 的结论是"应用设置走 `@capacitor/preferences`，key = `rain:store:config_v2`，
 * value 仍是同一份 store JSON 文本"。本文件**照着落**，只是没装那个插件、也不新增 gradle 依赖，
 * 直接用同名的原生 API（`@capacitor/preferences` 的 Android 实现就是 `SharedPreferences`）：
 *
 * <pre>
 * 阶段 2b（JS 侧，未接线）                 本文件（原生侧，P0-2 已接线）
 * ─────────────────────────────────────    ───────────────────────────────────────────
 * Preferences.get({key:'rain:store:config_v2'})   ←→   prefs("CapacitorStorage").getString(STORE_KEY)
 * Preferences.set({key:'rain:store:config_v2', v})←→   prefs("CapacitorStorage").edit()…commit()
 * 落点：adapter.android.ts:95 `'rain:store:'+desc.name`
 * </pre>
 *
 * `PREFERENCES_FILE` 取 `@capacitor/preferences` 的**默认 group**（`"CapacitorStorage"`），
 * 那个插件的 Android 实现是 `context.getSharedPreferences(configuration.group, MODE_PRIVATE)`
 * 且键名不加前缀 —— 于是 P0-3 把 `adapter.android.ts` 接到 `Preferences`（默认 group）时，
 * 两边读写的是**同一份数据**，不需要迁移。
 * ⚠️ 依据是上游源码（{@code ionic-team/capacitor-plugins} 的 `Preferences.java` /
 * `PreferencesConfiguration.java`，本机**未安装**该插件、也未真机验证）；若 P0-3 给插件配了别的
 * `group`，必须同时改这里的 `PREFERENCES_FILE`，否则两边会各写各的。
 *
 * <h2>与桌面的语义差异（逐条，都是"没有主进程"的必然结果，不是遗漏）</h2>
 *
 * <ol>
 *   <li><b>默认值的归属</b>：桌面由主进程 `initSetting()` 把 {@code @common/defaultSetting} 合并成**全量**设置
 *       再返回（{@code src/main/utils/index.ts:117-155}）。Android 没有主进程，也没有那 80 多个默认值
 *       （它们在 JS 里：{@code src/common/defaultSetting.ts}），所以原生侧**只做持久化**：
 *       首次启动（还没写过）诚实返回 `{}`，全量默认值由渲染层既有的合并逻辑兜底
 *       （{@code src/renderer/store/setting.ts:5} 的 `{...defaultSetting}` + `:12-21` 的逐键 `mergeSetting`；
 *       即使本通道整条 reject，{@code src/renderer/main.ts:82} 的 `invokeWithFallback` 也会兜底）。
 *       原生侧刻意**不复制**那份默认值表：复制一份必然与 JS 漂移，而漂移的默认值是很难查的一类 bug。</li>
 *   <li><b>落盘时机</b>：桌面即使"一个 key 都没变"也会重写整份 `config_v2`（{@code index.ts:133} 无条件 `override`），
 *       只是不广播（{@code src/main/event/AppEvent.ts:38}）。这里在"没有任何 key 真的变化"时**跳过这次冗余写**
 *       （内容逐字相同，可观察结果不变），理由是不做无意义的全量重写。</li>
 *   <li><b>`version`</b>：桌面每次写都把 `defaultSetting.version` 塞进设置（{@code index.ts:131}）。
 *       原生侧拿不到那个 JS 常量，所以外层 store 的 `version` 原样外提 `setting.version`（没有就是 `""`）。
 *       Android 是全新安装、无旧数据可迁移（{@code storage-adapter.md} §3.5），`migrateSetting` 无对应需求。</li>
 *   <li><b>损坏恢复</b>：桌面把坏 JSON 改名成 `.bak` 后继续。这里**不覆盖**坏数据：
 *       直接回 `ok:false`（`IPC_HANDLER_FAILED`，message 说明怎么修），把"数据坏了"和"首次启动"严格分开 ——
 *       后者返回 `{}`，前者绝不返回 `{}`。</li>
 * </ol>
 *
 * <h2>不假装成功</h2>
 * <ul>
 *   <li>参数不是对象 / 没有参数 ⇒ 抛错（调用方看到 reject，不是静默 no-op）；</li>
 *   <li>store 文本不是合法 JSON、或没有 `setting` 对象 ⇒ 抛错，且**不覆盖**它；</li>
 *   <li>`SharedPreferences.commit()` 返回 false（写没落盘）⇒ 抛错，并且**不广播**；</li>
 *   <li>拿不到 Context ⇒ 抛错，而不是读出一个空 store 当成"没有设置"。</li>
 * </ul>
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经编译**：
 * 语法/API 用法是对着本机读到的 {@code @capacitor/android@8.5.2} 源码与 Android 框架 API 逐条核对的，
 * 只能由 CI（{@code .github/workflows/build-android.yml} 的 `gradlew assembleDebug`）证伪；
 * 真机行为（SharedPreferences 落盘、事件时机、与渲染层的时序）同样未验证。
 */
public final class RainMusicAppSettingChannels {

    /**
     * `common_get_app_setting`：模块前缀见 {@code src/common/ipcNames.ts:171-176}
     * （键名 `get_app_setting` + 模块名 `common`）。
     */
    public static final String CHANNEL_GET = "common_get_app_setting";

    /** `common_set_app_setting`（同上）。 */
    public static final String CHANNEL_SET = "common_set_app_setting";

    /**
     * 设置变更广播：`WIN_MAIN_RENDERER_EVENT_NAME.on_config_change`
     * （{@code src/common/ipcNames.ts:78} + 模块前缀 {@code winMain}）。
     * 渲染层在 {@code src/renderer/core/useApp/useEventListener.ts:115-119} 订阅它并把差异合并进 appSetting。
     */
    public static final String CHANNEL_ON_CONFIG_CHANGE = "winMain_on_config_change";

    /**
     * SharedPreferences 文件名 = `@capacitor/preferences` 的默认 group（见类注释）。
     * ⚠️ P0-3 若给那个插件配了别的 group，必须同时改这里。
     */
    public static final String PREFERENCES_FILE = "CapacitorStorage";

    /**
     * store 的落点键，与阶段 2b 的 `preferencesKey()` 逐字一致：
     * {@code 'rain:store:' + desc.name}（`adapter.android.ts:95`），
     * 其中 `STORE_NAMES.APP_SETTINGS = 'config_v2'`（{@code src/common/constants.ts:9}）。
     */
    public static final String STORE_KEY = "rain:store:config_v2";

    /** store 文本的外层字段，与桌面 `config_v2.json` 一致（{@code src/main/utils/index.ts:133}）。 */
    private static final String FIELD_SETTING = "setting";
    private static final String FIELD_VERSION = "version";

    private static final String TAG = "RainMusicAppSetting";

    /**
     * 串行化「读 → 改 → 写 → 广播」。
     *
     * <p>为什么需要：P0-1 的 handler 跑在 {@link RainMusicIpcPlugin} 自己的 **2 线程**池里
     * （{@code executor()} = `newFixedThreadPool(2)`），而设置写入是读-改-写：
     * 两个并发的 `common_set_app_setting` 会互相覆盖 → **静默丢设置**。
     * 桌面版不会遇到（Electron 主进程单线程 + 同步写）。
     * 这与阶段 2b 给 Android 写路径定的规矩是同一件事（`adapter.android.ts` 的 `enqueueWrite` 串行化）。
     *
     * <p>⚠️ P0-2 第三刀起，本字段是 {@link RainMusicStoreLock#WRITE_LOCK} 的**别名**，也就是与
     * `winMain_save_data`（读-改-写 `rain:store:data`）**共用同一个对象**：两个通道写的是同一份
     * `CapacitorStorage` 文件，而 `commit()` 落盘的是**整份 map 的快照**，各自一把锁挡不住
     * **跨 key** 的丢更新（为什么、依据、边界都写在 {@link RainMusicStoreLock} 的类注释里，这里不重复）。
     * **不要**把它改回 `new Object()` —— 那等于把锁拆成两把，而缺陷是静默的。
     */
    private static final Object WRITE_LOCK = RainMusicStoreLock.WRITE_LOCK;

    private RainMusicAppSettingChannels() {}

    /**
     * 注册这两条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 `setEmitter` 同一处）。
     *
     * <p>为什么传插件实例而不是 Context：`Context` 留到**每次调用时**再取
     * （`Plugin.getContext()` → `bridge.getContext()`），这样 `load()` 阶段拿不到 Activity 也不会让
     * 建桥失败；取不到时 handler 会**大声抛错**（ok:false），不会静默读出一个空 store。
     *
     * <p>⚠️ 静态注册表因此持有插件引用 —— 与 P0-1 的 `setEmitter((channel, args) -> emitEvent(...))`
     * 已经持有的引用是同一个（都是进程级、单 Activity 的 Capacitor 桥），没有新增泄漏面。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicAppSettingChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_GET, (args, ctx) -> getSetting(requireContext(plugin)));
        RainMusicIpcHandlers.register(CHANNEL_SET, (args, ctx) -> updateSetting(requireContext(plugin), ctx, args));
        Logger.info(
            TAG,
            "P0-2：已注册 " + CHANNEL_GET + " / " + CHANNEL_SET +
            "（落点 " + PREFERENCES_FILE + " → " + STORE_KEY + "）"
        );
    }

    // ------------------------------------------------------------------ 两条通道

    /**
     * `common_get_app_setting`：读全量设置。
     *
     * <p>参数：渲染层不传（桌面 `mainHandle` 也无参数），这里忽略 `args`。
     *
     * @return store 里的 `setting` 对象；**没写过**时是空对象 `{}`（默认值由渲染层合并，见类注释差异 1）
     */
    private static JSONObject getSetting(Context context) {
        JSONObject setting = readSettingOrNull(context);
        if (setting == null) {
            Logger.warn(
                TAG,
                "还没有写入过 " + STORE_KEY + "（首次启动）：返回空设置 {}；" +
                "全量默认值由渲染层合并兜底（@common/defaultSetting + src/renderer/store/setting.ts:5,12-21）"
            );
            return new JSONObject();
        }
        return setting;
    }

    /**
     * `common_set_app_setting`：把 `Partial&lt;Rain.AppSetting&gt;` 合并进 store，落盘后广播变更。
     *
     * <p>参数形状（契约 `ipc-contract.md:87`）：`args[0]` = 部分设置对象；
     * `rendererInvoke(channel, params)` ⇒ `args = [params]`（`capacitor.js:41-42`）。
     *
     * @return 固定 `null`（契约是 `void`；`getSetting`/`updateSetting` 的调用方忽略结果）
     */
    private static Object updateSetting(Context context, RainMusicIpcHandlers.RequestContext ctx, List<Object> args)
        throws JSONException {
        JSONObject patch = readPatch(args);
        JSONObject changed;

        synchronized (WRITE_LOCK) {
            JSONObject setting = readSettingOrNull(context);
            if (setting == null) setting = new JSONObject();

            changed = diff(setting, patch);
            if (changed.length() == 0) {
                // 与桌面一致：没有任何 key 真的变了 ⇒ 不广播（AppEvent.ts:38 的 `if (!updatedSettingKeys.length) return`）。
                Logger.debug(TAG, CHANNEL_SET + "：参数里 " + patch.length() + " 个 key 与现值相同 → 不落盘、不广播");
                return null;
            }

            apply(setting, changed);

            String text = buildStoreText(setting);
            if (!preferences(context).edit().putString(STORE_KEY, text).commit()) {
                // commit() = 同步写并回报成功与否。false ⇒ 没落盘：报错、**不广播**，绝不假装成功。
                throw new IllegalStateException(
                    "写入 " + STORE_KEY + " 失败：SharedPreferences.commit() 返回 false（改动未落盘，也没有广播）"
                );
            }

            // 广播放在锁内：保证"广播顺序 == 落盘顺序"。否则两个并发写的广播可能反序到达，
            // 渲染层最后收到的会是旧值（落盘却是新值）——那是比丢一次广播更难查的不一致。
            // 这里不 try/catch：广播发不出去应当让调用方看见（插件会变成 ok:false）。
            ctx.emitTo(CHANNEL_ON_CONFIG_CHANGE, changed);
        }

        Logger.info(
            TAG,
            CHANNEL_SET + "：已落盘 " + changed.length() + " 个 key " + keysOf(changed) + "，并广播 " + CHANNEL_ON_CONFIG_CHANGE
        );
        return null;
    }

    // ------------------------------------------------------------------ 存储（阶段 2b 的原生对应物）

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
     * 读 store 里的 `setting` 对象：**还没写过**时返回 `null`；文本存在但不是阶段 2b 的格式时**抛错**。
     *
     * <p>把这个区分做出来是刻意的：`null`（首次启动）与"坏数据"必须走两条不同的路，
     * 否则"数据坏了"会被伪装成"首次启动"。
     */
    private static JSONObject readSettingOrNull(Context context) {
        String text = preferences(context).getString(STORE_KEY, null);
        if (text == null) return null;

        JSONObject store = parseStoreText(text);
        JSONObject setting = store.optJSONObject(FIELD_SETTING);
        if (setting == null) {
            throw new IllegalStateException(
                STORE_KEY + " 里的 JSON 没有 `" + FIELD_SETTING + "` 对象（顶层键=" + String.valueOf(store.names()) + "）。" +
                "阶段 2b 规定这个键存的是 store 文本 {\"" + FIELD_VERSION + "\":…,\"" + FIELD_SETTING + "\":{…}}" +
                "（src/main/utils/index.ts:133 / src/main/platform/storage/adapter.android.ts:95）：写入方与这里不一致。"
            );
        }
        return setting;
    }

    /** 解析 store 文本；不合法就抛错（**不返回 `{}`**，也**不覆盖**坏数据）。 */
    private static JSONObject parseStoreText(String text) {
        try {
            return new JSONObject(text);
        } catch (JSONException ex) {
            throw new IllegalStateException(
                STORE_KEY + " 里的文本不是合法 JSON（长度 " + text.length() + "）：" + ex.getMessage() +
                "。本次调用**不会**覆盖它，请修好写入方或手动清掉这个键。",
                ex
            );
        }
    }

    /** 按桌面一致的外层结构生成 store 文本（`{version, setting}`）。 */
    private static String buildStoreText(JSONObject setting) throws JSONException {
        JSONObject store = new JSONObject();
        // 与 src/main/utils/index.ts:131-133 一致：外层 version 就是 setting.version。
        // Android 侧拿不到 defaultSetting.version ⇒ 首次写入时这里是 ""（见类注释差异 3）。
        store.put(FIELD_VERSION, setting.optString(FIELD_VERSION, ""));
        store.put(FIELD_SETTING, setting);
        // 注：桌面那份是 `JSON.stringify(store, null, '\t')`（tab 缩进）。org.json 只能输出紧凑或空格缩进，
        // 所以这里的文本格式与桌面不同 —— 两边都只把这段文本当 JSON 解析（阶段 2b 的 parseStore 只 JSON.parse），
        // 唯一受影响的是"人肉 diff 文件"，可接受。
        return store.toString();
    }

    // ------------------------------------------------------------------ 参数与合并

    /**
     * 取 `args[0]` 作为要合并的部分设置。
     *
     * <p>不做 key 白名单校验 —— 桌面也不校验（`mergeSetting` 会把未知 key 一并存下来）。
     */
    private static JSONObject readPatch(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_SET + " 需要一个 Partial<Rain.AppSetting> 对象参数，收到 " + describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (first instanceof JSONObject) {
            // Android 的 org.json 解析结果就是 JSONObject（Capacitor 的 JSObject 是它的子类）。
            return (JSONObject) first;
        }
        if (first instanceof Map) {
            // 防御分支：万一有一天参数以 Java Map 形式到达（当前 P0-1 的路径不会）。
            return new JSONObject((Map) first);
        }
        throw new IllegalArgumentException(
            CHANNEL_SET + " 的参数必须是对象，收到 " + first.getClass().getName() + "：" + describeArgs(args)
        );
    }

    /** 逐 key 比较，只收集**真的变了**的 key（`Rain.AppSetting` 的值全是标量，逐键比较就是精确的）。 */
    private static JSONObject diff(JSONObject current, JSONObject patch) throws JSONException {
        JSONObject changed = new JSONObject();
        Iterator<String> keys = patch.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object next = patch.opt(key);
            if (!sameValue(current.opt(key), next)) changed.put(key, jsonValue(next));
        }
        return changed;
    }

    private static void apply(JSONObject setting, JSONObject changed) throws JSONException {
        Iterator<String> keys = changed.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            setting.put(key, jsonValue(changed.opt(key)));
        }
    }

    /**
     * null → `JSONObject.NULL`。
     *
     * <p>为什么必要：设置里 null 是**有意义的值**（例如 `'common.langId'` 的默认值就是 null），
     * 而 `JSONObject` 对 Java null 的处理不是"存一个 JSON null"。官方文档原文
     * （{@code https://developer.android.com/reference/org/json/JSONObject}，本机核对过）：
     * "calling put(name, null) removes the named entry from the object but
     * put(name, JSONObject.NULL) stores an entry whose value is JSONObject.NULL"。
     * 同一页也写明该类**不是线程安全**的 —— 这是 {@link #WRITE_LOCK} 存在的另一个理由。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static boolean sameValue(Object current, Object next) {
        Object left = unwrapNull(current);
        Object right = unwrapNull(next);
        if (left == null || right == null) return left == null && right == null;
        if (left instanceof Number && right instanceof Number) {
            // org.json 的数字可能是 Integer/Long/Double（1 与 1.0 不等价于 equals）⇒ 按数值比，
            // 否则"把同一个值再写一次"会被误判成变更（多一次无意义落盘 + 广播）。
            return ((Number) left).doubleValue() == ((Number) right).doubleValue();
        }
        return left.equals(right);
    }

    private static Object unwrapNull(Object value) {
        return value == null || value == JSONObject.NULL ? null : value;
    }

    // ------------------------------------------------------------------ 日志辅助

    /** 只打参数**类型**，不打内容：设置值没必要进 logcat，也可能很长。 */
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

    /** 键名列表（最多 8 个 + 省略号），只用于日志/错误信息。 */
    private static String keysOf(JSONObject object) {
        StringBuilder builder = new StringBuilder("{");
        Iterator<String> keys = object.keys();
        int count = 0;
        while (keys.hasNext() && count < 8) {
            if (count > 0) builder.append(", ");
            builder.append(keys.next());
            count++;
        }
        if (keys.hasNext()) builder.append(", …");
        return builder.append("}").toString();
    }
}
