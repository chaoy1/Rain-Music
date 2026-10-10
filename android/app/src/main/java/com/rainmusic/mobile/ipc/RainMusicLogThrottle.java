package com.rainmusic.mobile.ipc;

/**
 * Android 移植 · **P0-2 第六刀**：一条日志的**节流闸门**（纯 JDK，无 Android 类型）。
 *
 * <p>为什么本刀需要它：{@code player_list_music_get} 是渲染层**每次打开播放队列都会调**的通道
 * （{@code player_list_music_get} 的调用点之一就是播放队列的刷新）。而本刀要对"默认队列里有重复"
 * 这件**桌面会顺手修掉、Android 不会修**的事打一条警告 —— 不节流的话，一次会话里这条警告会刷屏，
 * 而 logcat 是本刀**唯一**的可观测面（见 {@link RainMusicListMusicGetChannels} 的类注释）。
 *
 * <h2>规则（四条，精确到边界）</h2>
 * <ol>
 *   <li><b>还没打过</b> ⇒ 放行（第一次永远能看到）；</li>
 *   <li><b>签名变了</b>（脏队列的指纹变了：行数 / 重复数 / 重复样例变了）⇒ 立刻放行
 *       —— 新的脏状态是新消息，不该被旧的节流窗口吃掉；</li>
 *   <li><b>签名一样、且距上次放行不足 {@code windowMs}</b> ⇒ 拦掉（这就是"别每次读都刷"）；</li>
 *   <li><b>签名一样、但已过窗口</b> ⇒ 放行（队列一直脏着，也得隔一阵提醒一次，不能只提醒一次）。</li>
 * </ol>
 *
 * <h2>为什么是"每个线程安全 + 纯 JDK"</h2>
 * <ul>
 *   <li>P0-1 的 handler 跑在 2 线程池里（{@code RainMusicIpcPlugin:337}），并发的两次读完全可能
 *       同时走到这里 ⇒ {@link #shouldLog(String, long)} 是 {@code synchronized} 的
 *       （判定与"记账"必须是一个原子动作，否则两条线程会同时放行、把节流打穿）；</li>
 *   <li>它**只**护住几个计数器，<b>不碰 SQL、不碰游标、不碰 {@link RainMusicDatabase}</b> ——
 *       "读通道不加锁"那套判断（第四 / 第五刀）针对的是数据访问，不针对一条日志的节流状态；</li>
 *   <li>不含 {@code android.*} / {@code com.getcapacitor.Logger} ⇒ 本机（无 Android SDK）能用真
 *       {@code javac} + {@code java} 跑它，见 {@code tests/unit/android-playback-queue-key.test.cjs}
 *       的"闸门行为"那一组用例。日志本身由调用方打（本类不 import Android）。</li>
 * </ul>
 *
 * <h2>时钟倒退</h2>
 * {@code nowMs < lastAtMs} 时 {@code nowMs - lastAtMs} 是负数，会被判成"还在窗口内"⇒ **多拦一条日志**，
 * 不会多打。节流器宁可少说一句，也不要在时钟跳变时刷屏。
 *
 * <h2>依赖</h2>
 * 只用 JDK。没有新增 gradle 依赖，也没有 Kotlin。
 */
final class RainMusicLogThrottle {

    private final long windowMs;

    /** 上一次放行的签名（{@code null} = 还没放过）。以下三个字段都由 this 的监视器保护。 */
    private String lastSignature = null;
    private long lastAtMs = 0L;
    private boolean hasLogged = false;

    /**
     * @param windowMs 同一个签名最多多久报一次（毫秒）；{@code 0} = 不节流（每次都放行）
     */
    RainMusicLogThrottle(long windowMs) {
        if (windowMs < 0) throw new IllegalArgumentException("节流窗口不能是负数：" + windowMs);
        this.windowMs = windowMs;
    }

    /**
     * 这条日志现在该不该打（并记账）。
     *
     * @param signature 这次要报的事的指纹；{@code null} ⇒ 返回 {@code false}（无从判断"是不是同一件事"，
     *                  宁可不打 —— 调用方自己保证签名不为 null）
     * @param nowMs     当前时间（毫秒，调用方给，方便用真 JVM 测边界）
     * @return 该打 ⇒ {@code true}，并把它记成"刚打过"
     */
    synchronized boolean shouldLog(String signature, long nowMs) {
        if (signature == null) return false;
        // ⚠️ 判定与记账必须在同一个 synchronized 里：分两步的话，两条并发线程会同时通过判定。
        if (hasLogged && signature.equals(lastSignature) && (nowMs - lastAtMs) < windowMs) {
            return false;
        }
        lastSignature = signature;
        lastAtMs = nowMs;
        hasLogged = true;
        return true;
    }

    /** 节流窗口（毫秒）；只给日志消息用（把窗口写进警告里，读日志的人才知道"不会马上再看到"）。 */
    long windowMs() {
        return windowMs;
    }
}
