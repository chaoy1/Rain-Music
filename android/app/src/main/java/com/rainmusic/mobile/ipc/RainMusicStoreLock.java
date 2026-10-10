package com.rainmusic.mobile.ipc;

/**
 * 写 {@code CapacitorStorage} 这份 SharedPreferences 的**唯一一把锁**
 * （Android 移植 · P0-2 第三刀引入，{@code winMain_save_data} 落地时）。
 *
 * <h2>为什么需要它</h2>
 *
 * P0-1 的 handler 跑在 {@link RainMusicIpcPlugin} 自己的 **2 线程**池里
 * （{@code executor()} = {@code newFixedThreadPool(2)}），所以下面两件事会**真的并发**发生：
 *
 * <pre>
 * common_set_app_setting   →  rain:store:config_v2   （读-改-写整份「设置」store 文本）
 * winMain_save_data        →  rain:store:data        （读-改-写整份「数据」store 文本）
 * </pre>
 *
 * <p>两者都是「读整份文本 → 改一个键 → 写回整份文本」，因此都需要串行化：
 * 后写的那次如果拿着**旧文本**覆盖，先写的那次就**静默丢了**（桌面不会遇到：
 * Electron 主进程单线程 + {@code Store.set()} 同步写，{@code src/main/platform/storage/core.ts:79-82}）。
 * 这与阶段 2b 给 Android 写路径定的规矩是同一件事
 * （{@code adapter.android.ts:158-175} 的 {@code enqueueWrite} 串行化）。
 *
 * <h2>为什么两个通道必须**共用同一个对象**（而不是各自一把锁）</h2>
 *
 * <ol>
 *   <li><b>同一个 key 的两个写者</b>：必须串行化，否则丢数据。目前两个通道各写各的 key
 *       （{@code config_v2} / {@code data}），所以"每个通道一把锁"对**它自己那个 key** 已经够了；</li>
 *   <li><b>但它们写的是同一份 SharedPreferences 文件</b>，而 {@code commit()} 落盘写的是
 *       **「整份 map 的快照」**（AOSP {@code SharedPreferencesImpl.writeToFile()} 写的是
 *       {@code MemoryCommitResult.mapToWriteToDisk}，也就是提交那一刻整个文件的键值对），
 *       不是"只写我这次改的那个 key"。{@code commitToMemory()} 虽然在实例锁内完成，但把快照
 *       交给磁盘写的那一步（{@code enqueueDiskWrite()}）在实例锁**外** —— 两个线程交错时
 *       （A 先 commitToMemory、被抢占；B 完成 commitToMemory 并入队；A 才入队），
 *       **较旧、较小的快照可能后落盘**，把另一个通道刚写进文件的那个 key 抹掉
 *       （内存里还在，直到下一次任意写入 —— 若此时进程被杀，那次写入就真的丢了）。
 *       这种**跨 key 的丢更新**，"每个通道一把锁"一把都挡不住，只有两边共用同一把锁才能挡住：
 *       共用之后「读 → 改 → commit」成为同一个临界区，快照只会按**一个**顺序产生并入队。</li>
 *   <li>代价约为 0：只是一个静态对象；两个通道的写入都是低频（设置）或节流过的（{@code data}
 *       的 9 个调用方全部经 {@code throttle}，200ms~2000ms），不构成实际争用。</li>
 * </ol>
 *
 * <p>⚠️ 第 2 条的依据是 AOSP {@code SharedPreferencesImpl} 的公开设计（"整份 map 快照落盘"）
 * 与仓库里既有的同款判断（{@code adapter.android.ts:158-175}）。
 * **本机没有 Android SDK（{@code docs/android-port-plan.md} §0），无法在本机核对 AOSP 源码**，
 * 也无法在本机复现这个时序竞争。判断的方向是明确的：共用一把锁在任何一种解释下都不比
 * 各自一把锁更差，而"各自一把锁"在某一种解释下有一个静默丢数据的窗口 —— 所以按"宁严勿宽"落地。
 * 这是一条**只能由真机长时间运行去证伪**（或证不伪）的结论，CI 编译与单测都覆盖不到它。
 *
 * <h2>谁在用这把锁</h2>
 * <ul>
 *   <li>{@link RainMusicAppSettingChannels}：{@code WRITE_LOCK} 字段**就是**本对象
 *       （{@code RainMusicAppSettingChannels.java} 里那一行赋值，不是再造一个）；</li>
 *   <li>{@link RainMusicDataChannels}：{@code winMain_save_data} 的「读 → 改 → 写」整段
 *       在 {@code synchronized (RainMusicStoreLock.WRITE_LOCK)} 内完成
 *       （{@code winMain_get_data} 是只读的，**不入锁** —— 理由见该文件类注释）。</li>
 * </ul>
 *
 * <h2>边界</h2>
 * 这把锁只覆盖**本进程内**、**走这两个通道**的写者。它管不了：
 * <ul>
 *   <li>P0-3 的 JS 侧 {@code @capacitor/preferences} 直接写（{@code adapter.android.ts} 有它
 *       自己的 {@code enqueueWrite}，两把锁互不相识 —— 真机接线时必须保证同一条路径只有一个写者，
 *       这是**需要人定的点**，见汇报）；</li>
 *   <li>别的进程（Android 上不会有第二个进程写这份 Preferences）；</li>
 *   <li>系统在 {@code commit()} 之后才真正 fsync 的部分 —— 那是框架的事。</li>
 * </ul>
 *
 * <h2>依赖</h2>
 * 纯 JDK 对象（{@code java.lang.Object}），**没有新增任何 gradle 依赖**，也不碰 Android API。
 */
final class RainMusicStoreLock {

    /**
     * 两个 store 写通道共用的监视器对象。**只允许有这一个实例**：
     * 谁把它改成 {@code new Object()}，就等于把锁拆成两把，第 2 条理由立刻失效。
     */
    static final Object WRITE_LOCK = new Object();

    private RainMusicStoreLock() {}
}
