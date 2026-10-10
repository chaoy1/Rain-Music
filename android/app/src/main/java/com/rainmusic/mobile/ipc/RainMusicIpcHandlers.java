package com.rainmusic.mobile.ipc;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Android 侧 IPC 通道注册表 —— P0-1 的"插槽"，P0-2 往这里逐条填 handler。
 *
 * <h2>为什么需要它</h2>
 *
 * 契约里有 128 条通道（{@code src/common/ipcNames.ts}），Capacitor 不可能为每条通道生成一个
 * {@code @PluginMethod}。所以传输层只有 {@link RainMusicIpcPlugin#post} 一个入口，
 * 通道名是信封里的字段，落到这里查表：
 *
 * <pre>
 * 渲染层 invoke("player_list_get")
 *   → bridge.post({id,kind:"invoke",channel:"player_list_get",args:[]})
 *     → RainMusicIpcPlugin.post → RainMusicIpcHandlers.get("player_list_get")
 *       → Handler.handle(args, ctx)  ← P0-2 在这里实现（读 SQLite / 设置 / 缓存…）
 *         → ctx.emit(...) 广播 / 返回值作为应答
 * </pre>
 *
 * <h2>一条通道的两种出口</h2>
 * <ul>
 *   <li><b>返回值</b>：{@link Handler#handle} 的返回值会被包成
 *       {@code {id,kind:"response",ok:true,result}} 推回渲染层（请求/应答，对应 {@code invoke}）；</li>
 *   <li><b>主动广播</b>：{@link RequestContext#emit} / {@link RequestContext#emitTo}
 *       推 {@code {kind:"event",channel,args}}，对应渲染层的 {@code on/once} 订阅
 *       （例如 {@code winMain_on_config_change}）。</li>
 * </ul>
 *
 * 抛异常的 handler ⇒ 渲染层那条 {@code invoke} 会以 {@code IPC_HANDLER_FAILED} reject，
 * <b>不吞异常</b>（JS 侧 {@code src/common/platform/ipcBridge/capacitor.js} 会把 code/message 带上）。
 *
 * <h2>未注册的通道</h2>
 * 立即回 {@code IPC_CHANNEL_UNSUPPORTED}（而不是让渲染层干等 15 秒超时）—— 见
 * {@code docs/android/web-runtime-blockers.md} 的 P0-2 清单。
 *
 * ⚠️ 本文件与 JS 侧的信封格式必须逐字一致，改一处要同时改：
 * {@code src/common/platform/ipcBridge/capacitor.js} 的文件头 + {@link RainMusicIpcPlugin}。
 */
public final class RainMusicIpcHandlers {

    private RainMusicIpcHandlers() {}

    /**
     * 一条通道的 handler。在后台线程里执行（不占用 Capacitor 的插件线程），
     * 可以阻塞（读数据库、读文件）；**不要**碰 UI。
     */
    public interface Handler {
        /**
         * @param args 渲染层传来的参数数组（`invoke(channel, params)` ⇒ 长度 0 或 1；可能为空列表，不会为 null）
         * @param ctx  本次请求的上下文（可查取消状态、可主动广播）
         * @return 任意可被 JSON 序列化的对象；{@code null} 会被序列化成 JSON null
         * @throws Exception 任何异常都会被包成 {@code ok:false} 的应答（绝不静默）
         */
        Object handle(List<Object> args, RequestContext ctx) throws Exception;
    }

    /** 原生 → 渲染层的广播出口（由 {@link RainMusicIpcPlugin} 在 {@code load()} 里注入）。 */
    public interface Emitter {
        void emit(String channel, List<Object> args);
    }

    private static final Map<String, Handler> HANDLERS = new ConcurrentHashMap<>();

    private static volatile Emitter emitter = null;

    /** 注册（或覆盖）一条通道的 handler。应当在插件 {@code load()} 里调用。 */
    public static void register(String channel, Handler handler) {
        if (channel == null || channel.length() == 0) {
            throw new IllegalArgumentException("IPC 通道名不能为空");
        }
        if (handler == null) {
            throw new IllegalArgumentException("IPC 通道 \"" + channel + "\" 的 handler 不能为 null");
        }
        HANDLERS.put(channel, handler);
    }

    /** 注销一条通道；返回是否真的存在过。 */
    public static boolean unregister(String channel) {
        return channel != null && HANDLERS.remove(channel) != null;
    }

    /** 查表；未注册返回 {@code null}（调用方负责回 {@code IPC_CHANNEL_UNSUPPORTED}）。 */
    public static Handler get(String channel) {
        return channel == null ? null : HANDLERS.get(channel);
    }

    /** 已注册通道数（诊断用，会打在 logcat 上）。 */
    public static int size() {
        return HANDLERS.size();
    }

    /** 已被注册的全部通道名（诊断用）。 */
    public static List<String> channels() {
        return new ArrayList<>(HANDLERS.keySet());
    }

    /** 由 {@link RainMusicIpcPlugin#load()} 注入。 */
    public static void setEmitter(Emitter value) {
        emitter = value;
    }

    /** 内部：把一条广播交给已注入的出口。没有出口（插件还没 load）时只丢弃并返回 false。 */
    static boolean emit(String channel, List<Object> args) {
        Emitter current = emitter;
        if (current == null || channel == null || channel.length() == 0) {
            return false;
        }
        current.emit(channel, args == null ? Collections.emptyList() : args);
        return true;
    }

    /** 一次请求的上下文：取消状态 + 广播出口。 */
    public static final class RequestContext {

        private final String requestId;
        private final String channel;
        private final AtomicBoolean cancelled = new AtomicBoolean(false);

        RequestContext(String requestId, String channel) {
            this.requestId = requestId;
            this.channel = channel;
        }

        /** 渲染层给这次请求生成的 id（`ipc-<会话>-<序号>`）。 */
        public String id() {
            return requestId;
        }

        /** 这次请求的通道名。 */
        public String channel() {
            return channel;
        }

        /**
         * 渲染层是否已经放弃这次请求（超时后 JS 侧会补发 `kind:"cancel"`）。
         * handler 应当在长循环里检查它，及时收工。
         */
        public boolean isCancelled() {
            return cancelled.get();
        }

        void markCancelled() {
            cancelled.set(true);
        }

        /** 向**本通道**推一条广播（{@code {kind:"event",channel,args}}）。 */
        public void emit(Object... args) {
            emitTo(channel, args);
        }

        /** 向指定通道推一条广播（例如 handler 处理 `common_set_app_setting` 时回 `winMain_on_config_change`）。 */
        public void emitTo(String targetChannel, Object... args) {
            List<Object> list = args == null ? Collections.emptyList() : Arrays.asList(args);
            RainMusicIpcHandlers.emit(targetChannel, list);
        }
    }
}
