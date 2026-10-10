package com.rainmusic.mobile.ipc;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Rain Music 渲染层 IPC 的原生侧传输桥（Android 移植 · **P0-1**）。
 *
 * <h2>它对应 JS 侧的哪个文件</h2>
 * {@code src/common/platform/ipcBridge/capacitor.js}（web/Capacitor 构建由
 * {@code build-config/renderer/webpack.config.web.js} 的"关键差异 4.7"在构建期指向它）。
 * 两侧的信封格式**必须逐字一致**，改一处要同时改两处，并同步
 * {@code docs/android/ipc-contract.md}。
 *
 * <h2>为什么只有一个 @PluginMethod</h2>
 * 契约里 128 条通道（{@code src/common/ipcNames.ts}），不可能一条一个方法。
 * 通道名是信封里的字段，落到 {@link RainMusicIpcHandlers} 查表（P0-2 往那里填 handler）。
 *
 * <h2>信封</h2>
 * JS → 原生（唯一入口 {@link #post}）：
 * <pre>
 * { "id":"ipc-&lt;会话标签&gt;-&lt;序号&gt;", "kind":"invoke"|"send"|"cancel",
 *   "channel":"player_list_get", "args":[...], "reason":"timeout" }
 * </pre>
 * 原生 → JS（唯一事件 {@link #EVENT_NAME}，经 {@code notifyListeners}）：
 * <pre>
 * { "id":"…", "kind":"response", "channel":"…", "ok":true,  "result":… }
 * { "id":"…", "kind":"response", "channel":"…", "ok":false, "error":{"message":"…","code":"…"} }
 * { "kind":"event", "channel":"winMain_on_config_change", "args":[…] }
 * { "id":"…", "kind":"cancel", "reason":"…" }          // 原生主动取消（本文件暂不主动发）
 * </pre>
 *
 * <h2>时序（为什么 post 立刻 resolve）</h2>
 * {@code post} 只负责"收下并确认"，真正结果走 {@code ipcMessage} 事件：
 * JS 侧的 {@code invoke} 有一个按 {@code id} 配对的 pending 表，**不从 post 的返回值取结果**。
 * 于是：handler 可以慢慢跑（网络 / 数据库），并且**乱序回包天然正确**。
 * 长任务不会占用 Capacitor 的插件线程 —— handler 跑在本插件自己的 daemon 线程池里。
 *
 * <h2>错误形状（不静默）</h2>
 * <ul>
 *   <li>信封残缺 ⇒ {@code post} 直接 {@code reject}（JS 侧立刻 reject，不会干等超时）；</li>
 *   <li>通道没注册 ⇒ 回 {@code ok:false, code:"IPC_CHANNEL_UNSUPPORTED"}（而不是让 JS 等 15 秒）；</li>
 *   <li>handler 抛异常 ⇒ 回 {@code ok:false, code:"IPC_HANDLER_FAILED"}，message 原样带上；</li>
 *   <li>取消（JS 超时后补发的 {@code kind:"cancel"}）⇒ 标记上下文，并且**不再回包**（JS 已经放弃）。</li>
 * </ul>
 *
 * <h2>注册方式</h2>
 * {@code android/app/src/main/java/com/rainmusic/mobile/MainActivity.java} 的
 * {@code onCreate} 里、**{@code super.onCreate()} 之前**调用
 * {@code registerPlugin(RainMusicIpcPlugin.class)} —— 见那个文件的注释。
 * 本插件只依赖 {@code :capacitor-android}（{@code com.getcapacitor.*}）与 Android 框架里的
 * {@code org.json}，**不需要**新增任何 gradle 依赖，也不需要 Kotlin 插件。
 *
 * ⚠️ **本机没有 Android SDK，本文件未经编译验证**：语法与 API 用法是按本机读到的
 * {@code @capacitor/android@8.5.2} 源码（{@code Plugin.java} / {@code PluginCall.java} /
 * {@code JSObject.java} / {@code JSExport.java}）逐条核对的，但**只能由 CI 的
 * {@code .github/workflows/build-android.yml}（{@code cap sync} + {@code gradlew assembleDebug}）
 * 来证伪**；真机行为（事件时机、数据形状）同样未验证。
 */
@CapacitorPlugin(name = RainMusicIpcPlugin.PLUGIN_NAME)
public class RainMusicIpcPlugin extends Plugin {

    /** 插件 id：必须与 JS 侧 {@code capacitorIpc.pluginName} 一致（JS 用它取 Capacitor 注入的代理）。 */
    public static final String PLUGIN_NAME = "RainMusicIpc";

    /** 原生 → JS 的**唯一**事件名：必须与 JS 侧 {@code capacitorIpc.eventName} 一致。 */
    public static final String EVENT_NAME = "ipcMessage";

    private static final String TAG = "RainMusicIpc";

    private static final String KIND_INVOKE = "invoke";
    private static final String KIND_SEND = "send";
    private static final String KIND_CANCEL = "cancel";
    private static final String KIND_RESPONSE = "response";
    private static final String KIND_EVENT = "event";

    /** 通道没注册（P0-2 还没做）：JS 侧会以这个 code reject。 */
    public static final String CODE_CHANNEL_UNSUPPORTED = "IPC_CHANNEL_UNSUPPORTED";
    /** handler 抛异常。 */
    public static final String CODE_HANDLER_FAILED = "IPC_HANDLER_FAILED";
    /** 信封残缺 / kind 未知。 */
    public static final String CODE_BAD_ENVELOPE = "IPC_BAD_ENVELOPE";
    /**
     * 取消。⚠️ 本文件**不主动发**这个 code：JS 超时后发来 `kind:"cancel"` 时，渲染层那条 Promise
     * 早就以 {@code IPC_TIMEOUT} 结束了，再回一条只会变成"迟到应答"。这里保留它是给**将来**
     * 原生侧主动作废在途请求用（形状见 JS 侧 `capacitor.js` 文件头的"取消"一节的第 2 条）。
     */
    public static final String CODE_CANCELLED = "IPC_CANCELLED";

    /** 在途请求：id → 上下文（取消用）。 */
    private final Map<String, RainMusicIpcHandlers.RequestContext> inFlight = new ConcurrentHashMap<>();

    private ExecutorService executor = null;

    @Override
    public void load() {
        RainMusicIpcHandlers.setEmitter((channel, args) -> emitEvent(channel, args));

        // P0-2 第一刀：设置通道的原生实现（common_get_app_setting / common_set_app_setting）。
        // 注册必须在这里、且发生在渲染层第一次 invoke 之前 —— load() 是 Capacitor 建 Bridge 时同步调的
        // （PluginHandle.loadInstance()：先 setBridge 再 load），满足这个时序。
        // 未注册的通道会被 dispatch() 立刻回 IPC_CHANNEL_UNSUPPORTED，所以漏注册 = 真机上直白的坏，
        // 不会静默。
        RainMusicAppSettingChannels.register(this);

        // P0-2 第二刀 + 第三刀：渲染层键值存储的读/写通道（winMain_get_data / winMain_save_data）。
        // 与上一行同一处、同一时序理由：必须在渲染层第一次 invoke/send 之前完成注册。
        RainMusicDataChannels.register(this);

        Logger.info(
            TAG,
            "IPC 传输桥已加载：plugin=" + PLUGIN_NAME + ", event=" + EVENT_NAME +
            ", 已注册通道=" + RainMusicIpcHandlers.size()
        );
    }

    /**
     * JS 侧唯一入口（`@PluginMethod` 默认 `rtype = "promise"`，所以 JS 侧拿到的是 Promise）。
     *
     * 立即 ack，结果/错误走 {@link #EVENT_NAME} 事件。
     */
    @PluginMethod
    public void post(PluginCall call) {
        String id = call.getString("id");
        String kind = call.getString("kind");
        String channel = call.getString("channel");

        if (id == null || id.length() == 0 || kind == null || channel == null || channel.length() == 0) {
            // 残缺信封 = JS 侧的问题，立刻 reject 让它马上以 IPC_TRANSPORT_ERROR 失败（不等超时）。
            call.reject(
                "IPC 信封不完整：需要 id / kind / channel，收到 " + String.valueOf(call.getData()),
                CODE_BAD_ENVELOPE
            );
            return;
        }

        List<Object> args = readArgs(call);

        // 先 ack：让 Capacitor 的 nativePromise 立刻了结（JS 侧不会拿它当结果）。
        call.resolve(ack(id, kind, channel));

        if (KIND_SEND.equals(kind)) {
            dispatch(id, channel, args, false);
            return;
        }
        if (KIND_INVOKE.equals(kind)) {
            dispatch(id, channel, args, true);
            return;
        }
        if (KIND_CANCEL.equals(kind)) {
            cancel(id, call.getString("reason"));
            return;
        }

        Logger.warn(TAG, "未知的信封 kind=\"" + kind + "\"（id=" + id + ", channel=" + channel + "）");
        respondError(id, channel, CODE_BAD_ENVELOPE, "未知的信封 kind：" + kind);
    }

    /** 原生 → JS 的广播出口（给 P0-2 的 handler 之外的代码用，例如 App 生命周期、深链）。 */
    public void emitEvent(String channel, List<Object> args) {
        if (channel == null || channel.length() == 0) {
            Logger.warn(TAG, "emitEvent 收到空 channel，已丢弃");
            return;
        }

        JSObject payload = new JSObject();
        payload.put("kind", KIND_EVENT);
        payload.put("channel", channel);
        // 显式 typed 局部变量：不让 `?:` 的 poly-expression 推断去猜 ArrayList 的元素类型。
        List<Object> safeArgs = args == null ? new ArrayList<Object>() : args;
        payload.put("args", new JSArray((java.util.Collection<Object>) safeArgs));

        notifyListeners(EVENT_NAME, payload);
    }

    @Override
    protected void handleOnDestroy() {
        for (RainMusicIpcHandlers.RequestContext ctx : inFlight.values()) {
            ctx.markCancelled();
        }
        inFlight.clear();

        ExecutorService current = executor;
        executor = null;
        if (current != null) {
            current.shutdownNow();
        }
        Logger.debug(TAG, "IPC 传输桥已销毁（在途请求全部标记取消）");
    }

    // ------------------------------------------------------------------ 内部

    private void dispatch(String id, String channel, List<Object> args, boolean expectsResponse) {
        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(channel);

        if (handler == null) {
            // 未注册的通道**立刻**回错：让 JS 侧马上 reject，而不是干等 15 秒超时。
            // 这正是 P0-2 的工作清单（见 docs/android/web-runtime-blockers.md §8）。
            String message = "原生侧还没有注册通道 \"" + channel + "\" 的 handler（P0-2 待做）";
            if (expectsResponse) {
                respondError(id, channel, CODE_CHANNEL_UNSUPPORTED, message);
            } else {
                Logger.warn(TAG, "send 到未注册的通道：" + channel);
            }
            return;
        }

        RainMusicIpcHandlers.RequestContext ctx = new RainMusicIpcHandlers.RequestContext(id, channel);
        if (expectsResponse) {
            inFlight.put(id, ctx);
        }

        executor().execute(() -> runHandler(handler, expectsResponse, id, channel, args, ctx));
    }

    private void runHandler(
        RainMusicIpcHandlers.Handler handler,
        boolean expectsResponse,
        String id,
        String channel,
        List<Object> args,
        RainMusicIpcHandlers.RequestContext ctx
    ) {
        Object result;
        try {
            result = handler.handle(args, ctx);
        } catch (Exception ex) {
            if (!expectsResponse) {
                // ⚠️ Logger 没有 `error(tag, message)` 这个重载，只有 (message) / (message, throwable)
                // 与 (tag, message, throwable) —— 见本机读到的 `Logger.java`。
                Logger.error(TAG, "send 通道 \"" + channel + "\" 的 handler 抛错", ex);
                return;
            }
            inFlight.remove(id);
            if (ctx.isCancelled()) {
                Logger.debug(TAG, "通道 \"" + channel + "\" 的 handler 抛错时请求已被取消，不再回包（id=" + id + "）");
                return;
            }
            String message = ex.getMessage() == null ? ex.toString() : ex.getMessage();
            respondError(id, channel, CODE_HANDLER_FAILED, message);
            return;
        }

        if (!expectsResponse) {
            return;
        }

        inFlight.remove(id);
        if (ctx.isCancelled()) {
            Logger.debug(TAG, "通道 \"" + channel + "\" 的结果到达时请求已被取消，不再回包（id=" + id + "）");
            return;
        }
        respondOk(id, channel, result);
    }

    /** JS 侧超时后补发的取消通知；也可能是调用方主动放弃。 */
    private void cancel(String id, String reason) {
        RainMusicIpcHandlers.RequestContext ctx = inFlight.remove(id);
        if (ctx == null) {
            Logger.debug(TAG, "取消通知没有对应的在途请求（id=" + id + ", reason=" + reason + "）");
            return;
        }
        ctx.markCancelled();
        Logger.info(TAG, "已取消通道 \"" + ctx.channel() + "\" 的在途请求（id=" + id + ", reason=" + reason + "）");
    }

    private void respondOk(String id, String channel, Object result) {
        JSObject payload = new JSObject();
        payload.put("id", id);
        payload.put("kind", KIND_RESPONSE);
        payload.put("channel", channel);
        payload.put("ok", true);
        payload.put("result", result == null ? JSObject.NULL : result);
        notifyListeners(EVENT_NAME, payload);
    }

    private void respondError(String id, String channel, String code, String message) {
        JSObject error = new JSObject();
        error.put("message", message == null ? "原生侧未提供错误信息" : message);
        error.put("code", code);

        JSObject payload = new JSObject();
        payload.put("id", id);
        payload.put("kind", KIND_RESPONSE);
        payload.put("channel", channel);
        payload.put("ok", false);
        payload.put("error", error);
        notifyListeners(EVENT_NAME, payload);
    }

    private JSObject ack(String id, String kind, String channel) {
        JSObject payload = new JSObject();
        payload.put("accepted", true);
        payload.put("id", id);
        payload.put("kind", kind);
        payload.put("channel", channel);
        return payload;
    }

    /** `args` 恒为数组；缺失按空数组处理。 */
    private List<Object> readArgs(PluginCall call) {
        JSArray array = call.getArray("args");
        if (array == null) {
            return new ArrayList<>();
        }
        try {
            List<Object> values = array.toList();
            return values == null ? new ArrayList<>() : values;
        } catch (Exception ex) {
            Logger.warn(TAG, "args 解析失败，按空数组处理：" + ex);
            return new ArrayList<>();
        }
    }

    /** 懒建 daemon 线程池：handler 在这里跑，不占用 Capacitor 的插件线程。 */
    private synchronized ExecutorService executor() {
        if (executor == null) {
            executor = Executors.newFixedThreadPool(2, new ThreadFactory() {
                private final AtomicInteger seq = new AtomicInteger();

                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable, "rain-ipc-" + seq.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                }
            });
        }
        return executor;
    }
}
