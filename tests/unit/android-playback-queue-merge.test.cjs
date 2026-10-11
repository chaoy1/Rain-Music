/**
 * Android 移植 · **P0-2 第七刀-A（`player_list_music_get` 的默认列去重写回）** 的
 * **行为**回归网：用真的 `javac` + 真的 `java` 把这一刀的 Java 控制流**跑起来**。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：
 * <ol>
 *   <li>本机没有 Android SDK（`docs/android-port-plan.md` §0），`android.*` / `org.json` /
 *       `com.getcapacitor.Logger` / `RainMusicIpcPlugin` 全部是**手写替身**；
 *   </li>
 *   <li>替身里那个 {@code SQLiteDatabase} 是一个**手写的假 SQLite**（内存里的两张表 + 真的事务
 *       快照/回滚 + 语句记录 + 失败注入）。它**不是** SQLite：它只实现本通道用到的那两条查询
 *       （`sqlite_master` 存在性检查、那条 `LEFT JOIN`）与四条写语句，语义是**照 SQL 写道**的，
 *       不是从 SQLite 借来的。真正的 SQL 行为（绑定、NULL、`ORDER BY` 的并列、文件锁、
 *       事务在真机上的可见性）只能由 CI 的 `gradlew assembleDebug` → 真机运行来证伪；
 *   </li>
 *   <li>所以它证明的是"**这一刀的 Java 控制流**在给定 SQL 行为下是对的"：写只在 default 上发生、
 *       四条语句的顺序、整段在同一个事务里、失败会抛且事务回滚、并发下只合并一次。
 *       它证明不了"真机上也这样"。
 * </ol>
 *
 * <h2>为什么值得写这一组（而不是只做源码断言）</h2>
 * 这一刀的风险全是**控制流**上的：少了 `beginTransaction` 就变成"删了再插、中途失败留下半个歌单"；
 * 把写回的错误吞掉就变成"渲染层缓存一份库里并不存在的列表"；把合并扩大到非 default 就会在用户
 * 自建歌单里**删歌**。这几件事在源码断言下都能靠"改写但保持关键字"骗过去，而在这里会真的变红
 * （见下面「变异自证」的 5 处）。判定全在 JS 侧的断言里，探针只**如实报告**它观察到的东西。
 *
 * <h2>变异自证（每一处都真的把源码改坏跑过一遍，见汇报）</h2>
 * <ol>
 *   <li><b>去事务</b>（删掉 beginTransaction / setTransactionSuccessful / endTransaction）⇒
 *       写回中途失败时"库仍是写回前的 N 行"不成立（modelCount 变了）；</li>
 *   <li><b>错误吞掉</b>（catch 住写回异常、返回去重后的列表）⇒ 该 reject 的场景变成 ok；</li>
 *   <li><b>把合并扩大到非 default</b>（去掉 `LIST_ID_DEFAULT` 判断）⇒ 非 default 场景出现写语句
 *       且返回被去重的列表（用户的歌单会少歌）；</li>
 *   <li><b>去并发保护</b>（去掉 `synchronized (DEFAULT_QUEUE_MERGE_LOCK)`）⇒ 并发读 default 时
 *       发生**两次**写回（writeGroups = 2）；</li>
 *   <li><b>DELETE 与 INSERT 顺序颠倒</b>（先插后删）⇒ 语句序列断言变红，且库里最后是空的。</li>
 * </ol>
 *
 * <h2>与桌面源码的关系（三条链都是"照抄"，不是"参考"）</h2>
 * <ul>
 *   <li>合并规则 = `src/common/utils/playbackQueue.ts:10-22` 的 `dedupePlaybackQueue`
 *       —— 本文件直接 `load()` 真的 TS 实现，用它算**期望**；</li>
 *   <li>事务形状 = `dbHelper.ts:340-349`（DELETE ×2 + INSERT ×2N，同一个事务）；</li>
 *   <li>失败语义 = `tests/unit/playback-queue.test.cjs:212-220`（`assert.rejects` + 回滚 + 行数不变）。</li>
 * </ul>
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const load = require('./load-ts.cjs')

const ROOT = path.join(__dirname, '../..')
const PACKAGE = 'com.rainmusic.mobile.ipc'
const JAVA_REL_DIR = path.join('android/app/src/main/java', ...PACKAGE.split('.'))
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const getJava = read(path.join(JAVA_REL_DIR, 'RainMusicListMusicGetChannels.java'))
const statementsTs = read('src/main/worker/dbService/modules/list/statements.ts')
const dbHelperTs = read('src/main/worker/dbService/modules/list/dbHelper.ts')

/** 桌面那把 `dedupePlaybackQueue` 的唯一出处（本文件用它算期望值）。 */
const { dedupePlaybackQueue } = load('src/common/utils/playbackQueue.ts', {}, {})

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 去掉注释再匹配（注释里就写着那些代码，用整份源码匹配会放过"被注释掉"的）。 */
const stripJavaComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const javaTextBlock = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`))
  assert.ok(match, `Java 里找不到文本块 ${name}`)
  return match[1]
}

/** 与桌面 `verifyDB.ts:4` 的那条正则逐字相同（`/\n|\s|;|--.+/g`）。 */
const normalizeSql = sql => sql.replace(/\n|\s|;|--.+/g, '')
/** better-sqlite3 的具名参数 → Android 的位置参数（逐个按出现顺序替换）。 */
const toPositionalSql = sql => sql.replace(/@\w+/g, '?')

/** 跑一个外部进程，把 stdout/stderr 落到**文件**（受限沙箱下 Node 拿不到命名管道）。 */
const runToFile = (command, args, cwd, logFile) => {
  const fd = fs.openSync(logFile, 'w')
  let result
  try {
    result = spawnSync(command, args, { cwd, stdio: ['ignore', fd, fd] })
  } finally {
    fs.closeSync(fd)
  }
  return {
    status: result.status,
    error: result.error,
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '',
  }
}

// ---------------------------------------------------------------------------
// 1. SQL：四条写语句 + 那条读语句都必须与桌面逐字一致（不需要 JDK）
// ---------------------------------------------------------------------------

test('四条写语句逐字对齐 statements.ts（只把具名参数换成 ?），列清单与列顺序一字不改', () => {
  // 桌面的四处出处先钉住（引用没写错文件 / 行）。
  const insertMusicInfo = statementsTs.match(
    /createMusicInfoInsertStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.MusicInfo\]>\(`([\s\S]*?)`\)/,
  )[1]
  const insertMusicOrder = statementsTs.match(
    /createMusicInfoOrderInsertStatement[\s\S]*?db\.prepare<\[Rain\.DBService\.MusicInfoOrder\]>\(`([\s\S]*?)`\)/,
  )[1]
  const deleteMusicInfo = statementsTs.match(
    /createMusicInfoDeleteByListIdStatement[\s\S]*?db\.prepare<\[string\]>\('([^']*)'\)/,
  )[1]
  const deleteMusicOrder = statementsTs.match(
    /createMusicInfoOrderDeleteByListIdStatement[\s\S]*?db\.prepare<\[string\]>\('([^']*)'\)/,
  )[1]

  assert.match(insertMusicInfo, /INSERT INTO "main"\."my_list_music_info" \("id", "listId", "name", "singer", "source", "interval", "meta"\)/)
  assert.match(deleteMusicInfo, /DELETE FROM "main"\."my_list_music_info" WHERE "listId"=\?/)
  assert.match(insertMusicOrder, /INSERT INTO "main"\."my_list_music_info_order" \("listId", "musicInfoId", "order"\)/)
  assert.match(deleteMusicOrder, /DELETE FROM "main"\."my_list_music_info_order" WHERE "listId"=\?/)

  assert.equal(
    normalizeSql(javaTextBlock(getJava, 'SQL_INSERT_MUSIC_INFO')),
    normalizeSql(toPositionalSql(insertMusicInfo)),
    'INSERT my_list_music_info 必须与 statements.ts:84-89 逐字一致（列清单与列顺序决定了绑定顺序）',
  )
  assert.equal(
    normalizeSql(javaTextBlock(getJava, 'SQL_INSERT_MUSIC_ORDER')),
    normalizeSql(toPositionalSql(insertMusicOrder)),
    'INSERT my_list_music_info_order 必须与 statements.ts:170-175 逐字一致',
  )
  assert.equal(
    normalizeSql(javaTextBlock(getJava, 'SQL_DELETE_MUSIC_INFO_BY_LIST_ID')),
    normalizeSql(deleteMusicInfo),
    'DELETE my_list_music_info 必须与 statements.ts:117-120 逐字一致',
  )
  assert.equal(
    normalizeSql(javaTextBlock(getJava, 'SQL_DELETE_MUSIC_ORDER_BY_LIST_ID')),
    normalizeSql(deleteMusicOrder),
    'DELETE my_list_music_info_order 必须与 statements.ts:190-193 逐字一致',
  )

  // 位置参数个数必须与桌面那四条的具名参数个数逐个相等（少一个/多一个绑定就错位）。
  assert.equal((javaTextBlock(getJava, 'SQL_INSERT_MUSIC_INFO').match(/\?/g) ?? []).length, (insertMusicInfo.match(/@\w+/g) ?? []).length)
  assert.equal((javaTextBlock(getJava, 'SQL_INSERT_MUSIC_ORDER').match(/\?/g) ?? []).length, (insertMusicOrder.match(/@\w+/g) ?? []).length)
  assert.equal((javaTextBlock(getJava, 'SQL_DELETE_MUSIC_INFO_BY_LIST_ID').match(/\?/g) ?? []).length, 1)
  assert.equal((javaTextBlock(getJava, 'SQL_DELETE_MUSIC_ORDER_BY_LIST_ID').match(/\?/g) ?? []).length, 1)

  // 桌子那四步的顺序（DELETE info → DELETE order → INSERT info → INSERT order）在源码里的形状。
  const code = stripJavaComments(getJava)
  const body = code.slice(
    code.indexOf('private static void overwriteDefaultQueue('),
    code.indexOf('private static String writeBackFailureMessage('),
  )
  const sequence = [...body.matchAll(/execSQL\((SQL_[A-Z_]+)/g)].map(match => match[1])
  assert.deepEqual(sequence, [
    'SQL_DELETE_MUSIC_INFO_BY_LIST_ID',
    'SQL_DELETE_MUSIC_ORDER_BY_LIST_ID',
    'SQL_INSERT_MUSIC_INFO',
    'SQL_INSERT_MUSIC_ORDER',
  ], '写回的语句顺序必须与 dbHelper.ts:340-349 一致（先两张表全删，再按 order 逐条插）')
  // INSERT info 的绑定数组必须按那句 SQL 的列清单给（id, listId, name, singer, source, interval, meta）。
  assert.match(body, /db\.execSQL\(SQL_INSERT_MUSIC_INFO, row\.insertArgs\(listId\)\);/)
  assert.match(code, /return new Object\[\] \{ id, listId, name, singer, source, interval, metaText\(\) \};/)
  // INSERT order 绑的是 (listId, row.id, 下标)。
  assert.match(body, /db\.execSQL\(SQL_INSERT_MUSIC_ORDER, new Object\[\] \{ listId, row\.id, order \}\);/)
  // order = 去重后列表里的下标（桌面 toDBMusicInfo 的 offset + index）。
  assert.match(body, /for \(int order = 0; order < kept\.size\(\); order\+\+\)/)
  assert.match(body, /db\.beginTransaction\(\)/)
  assert.match(body, /db\.setTransactionSuccessful\(\)/)
  assert.match(body, /finally \{\s*db\.endTransaction\(\);/)
  // 未标记成功就回滚这一点必须写在注释里（改这句的人要知道它在保什么）。
  assert.match(getJava, /未标记成功 ⇒ 整体回滚/)
  assert.match(getJava, /未 setTransactionSuccessful ⇒ 回滚/)
})

// ---------------------------------------------------------------------------
// 2. 真 JVM：手写替身 + 手写假 SQLite
// ---------------------------------------------------------------------------

/**
 * 手写替身。**刻意按 AOSP / Capacitor 的真实形状写**，并且刻意**不**声明真实 API 里没有的方法
 * （例如 `JSONArray` 只有 `length()`、没有 `size()`）—— 这样"用错 API"在这里能变红。
 *
 * ⚠️ `SQLiteDatabase` 不是替身而是一个**手写的假 SQLite**：它真的维护两张表、真的做事务快照与回滚、
 * 真的记录每一条写语句，并支持注入失败。它是本文件唯一能"让控制流真的跑起来"的东西，
 * 也是本文件最大的不确定性来源（它是我照着 SQL 写的，不是 SQLite）。
 */
const STUBS = {
  'android/content/Context.java': String.raw`package android.content;

import java.io.File;

/** 照 AOSP：Context 是抽象类；本通道只用到这两个成员。 */
public abstract class Context {
    public abstract Context getApplicationContext();
    public abstract File getDatabasePath(String name);
}
`,
  'android/database/Cursor.java': String.raw`package android.database;

/** 照 AOSP：Cursor extends Closeable，但 close() 被重声明为**不抛** IOException。 */
public interface Cursor extends java.io.Closeable {
    boolean moveToFirst();
    boolean moveToNext();
    int getColumnIndexOrThrow(String columnName);
    String getString(int columnIndex);
    long getLong(int columnIndex);
    boolean isNull(int columnIndex);
    @Override
    void close();
}
`,
  'android/database/sqlite/SQLiteException.java': String.raw`package android.database.sqlite;

public class SQLiteException extends RuntimeException {
    public SQLiteException() {}
    public SQLiteException(String error) { super(error); }
    public SQLiteException(String error, Throwable cause) { super(error, cause); }
}
`,
  'android/database/sqlite/SQLiteDatabase.java': String.raw`package android.database.sqlite;

import android.database.Cursor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

/**
 * **手写的假 SQLite**（只在测试的临时目录里，不进仓库）。
 *
 * <p>它只实现本通道真正用到的东西：
 * <ul>
 *   <li>{@code sqlite_master} 的存在性检查（永远回答"表在"）；</li>
 *   <li>那条 {@code LEFT JOIN my_list_music_info_order … ORDER BY O."order" ASC}：逐行按
 *       {@code (listId, musicInfoId)} 找 order 记录（一对多时按 SQL 的语义**展开成多行**，
 *       没有匹配时 {@code order} 为 NULL），再按 {@code order ASC}（NULL 最前）**稳定**排序；</li>
 *   <li>四条写语句（DELETE 两张表的 listId / INSERT 两条记录），并记下顺序；</li>
 *   <li>事务：{@code beginTransaction} 拍快照、{@code setTransactionSuccessful} 标记、
 *       {@code endTransaction} 未标记则回滚（与 SQLite 的语义一致）；事务之间**串行**（真 SQLite
 *       的主连接也是同一时刻只跑一个事务）；</li>
 *   <li>失败注入：第 N 条写语句抛错（{@code failAt}）、提交阶段抛错（{@code failOnEndTransaction}）；</li>
 *   <li>并发闸门（{@code gateEnabled}）：那条 SELECT 会等第二个读者到齐（最多 750ms）——
 *       用来把"两次并发读都读到脏队列"这个交错**确定性地**造出来，见 JS 侧的并发用例。</li>
 * </ul>
 *
 * <p>⚠️ 它**不是** SQLite：列类型、绑定、NULL、并列排序、文件锁全都没有真实现。
 * 这里证明的是"Java 控制流 + 我写下的这套 SQL 语义"，不是"真机上的 SQLite"。
 */
public class SQLiteDatabase {

    public interface CursorFactory {}

    /** {@code my_list_music_info} 的一行。 */
    public static final class Info {
        public final String id;
        public final String listId;
        public final String name;
        public final String singer;
        public final String source;
        public final String interval;
        public final String meta;

        Info(String id, String listId, String name, String singer, String source, String interval, String meta) {
            this.id = id;
            this.listId = listId;
            this.name = name;
            this.singer = singer;
            this.source = source;
            this.interval = interval;
            this.meta = meta;
        }
    }

    /** {@code my_list_music_info_order} 的一行。 */
    public static final class Order {
        public final String listId;
        public final String musicInfoId;
        public final int order;

        Order(String listId, String musicInfoId, int order) {
            this.listId = listId;
            this.musicInfoId = musicInfoId;
            this.order = order;
        }
    }

    public final List<Info> infos = new ArrayList<>();
    public final List<Order> orders = new ArrayList<>();
    /** 每一条写语句的名字 + 主键，按执行顺序（用来断言语句顺序与"一条都没发"）。 */
    public final List<String> ops = new ArrayList<>();
    public int transactionCount = 0;
    /** "一次合并"= 一次 DELETE my_list_music_info（并发用例靠它数出到底合并了几次）。 */
    public int writeGroups = 0;
    public int failAt = 0;
    public boolean failOnEndTransaction = false;
    public boolean gateEnabled = false;

    private final Object modelLock = new Object();
    private final ReentrantLock transactionLock = new ReentrantLock();
    private List<Info> txInfos = null;
    private List<Order> txOrders = null;
    private boolean txMarked = false;
    private final CountDownLatch gate = new CountDownLatch(2);
    private volatile boolean gateDisarmed = false;

    // ---------------------------------------------------------------- 建模（JS 侧铺数据）

    public void addInfo(String id, String listId, String name, String singer, String source, String interval, String meta) {
        synchronized (modelLock) { infos.add(new Info(id, listId, name, singer, source, interval, meta)); }
    }

    public void addOrder(String listId, String musicInfoId, int order) {
        synchronized (modelLock) { orders.add(new Order(listId, musicInfoId, order)); }
    }

    public int modelCount() {
        synchronized (modelLock) { return infos.size(); }
    }

    /** {@code id|order|meta|name|singer|source|interval}（interval 为 SQL NULL 时是 "-"；meta 为 SQL NULL 时是 "-"）。 */
    public List<String> modelRows() {
        synchronized (modelLock) {
            List<Info> copy = new ArrayList<>(infos);
            copy.sort((left, right) -> Integer.compare(orderOf(left), orderOf(right)));
            List<String> rows = new ArrayList<>();
            for (Info info : copy) {
                rows.add(
                    info.id + "|" + orderOf(info) + "|" + (info.meta == null ? "-" : info.meta) + "|" +
                    info.name + "|" + info.singer + "|" + info.source + "|" + (info.interval == null ? "-" : info.interval)
                );
            }
            return rows;
        }
    }

    private int orderOf(Info info) {
        for (Order order : orders) {
            if (order.listId.equals(info.listId) && order.musicInfoId.equals(info.id)) return order.order;
        }
        return Integer.MAX_VALUE;
    }

    // ---------------------------------------------------------------- Android 框架 API

    public Cursor rawQuery(String sql, String[] selectionArgs) {
        if (sql.contains("sqlite_master")) {
            List<String[]> rows = new ArrayList<>();
            rows.add(new String[] { selectionArgs[0] });
            return new FakeCursor(Arrays.asList("name"), rows);
        }
        if (sql.contains("LEFT JOIN my_list_music_info_order")) {
            gate();
            String listId = selectionArgs[0];
            List<String[]> rows = new ArrayList<>();
            List<Integer> keys = new ArrayList<>();
            synchronized (modelLock) {
                for (Info info : infos) {
                    if (!info.listId.equals(listId)) continue;
                    List<Integer> matches = new ArrayList<>();
                    for (Order order : orders) {
                        if (order.listId.equals(listId) && order.musicInfoId.equals(info.id)) matches.add(order.order);
                    }
                    if (matches.isEmpty()) {
                        rows.add(new String[] { info.id, info.name, info.singer, info.source, info.interval, info.meta });
                        keys.add(null);
                    } else {
                        for (Integer match : matches) {
                            rows.add(new String[] { info.id, info.name, info.singer, info.source, info.interval, info.meta });
                            keys.add(match);
                        }
                    }
                }
            }
            stableSortByOrder(rows, keys);
            return new FakeCursor(Arrays.asList("id", "name", "singer", "source", "interval", "meta"), rows);
        }
        throw new SQLiteException("假库不认识这条查询：" + sql);
    }

    public void execSQL(String sql) {
        execSQL(sql, new Object[0]);
    }

    public void execSQL(String sql, Object[] bindArgs) {
        String normalized = sql.replaceAll("\\s+", " ").trim();
        if (failAt > 0 && ops.size() + 1 == failAt) {
            throw new SQLiteException("注入的写失败（第 " + failAt + " 条写语句：" + normalized + "）");
        }
        boolean orderTable = normalized.contains("my_list_music_info_order");
        if (normalized.startsWith("DELETE")) {
            String listId = (String) bindArgs[0];
            synchronized (modelLock) {
                if (orderTable) {
                    for (int i = orders.size() - 1; i >= 0; i--) {
                        if (orders.get(i).listId.equals(listId)) orders.remove(i);
                    }
                    ops.add("del-order");
                } else {
                    for (int i = infos.size() - 1; i >= 0; i--) {
                        if (infos.get(i).listId.equals(listId)) infos.remove(i);
                    }
                    writeGroups++;
                    ops.add("del-info");
                }
            }
            return;
        }
        if (normalized.startsWith("INSERT")) {
            synchronized (modelLock) {
                if (orderTable) {
                    orders.add(new Order((String) bindArgs[0], (String) bindArgs[1], ((Number) bindArgs[2]).intValue()));
                    ops.add("ins-order:" + bindArgs[1]);
                } else {
                    infos.add(new Info(
                        (String) bindArgs[0], (String) bindArgs[1], (String) bindArgs[2], (String) bindArgs[3],
                        (String) bindArgs[4], (String) bindArgs[5], (String) bindArgs[6]
                    ));
                    ops.add("ins-info:" + bindArgs[0]);
                }
            }
            return;
        }
        throw new SQLiteException("假库不认识这条写语句：" + normalized);
    }

    public void beginTransaction() {
        transactionLock.lock();
        synchronized (modelLock) {
            txInfos = new ArrayList<>(infos);
            txOrders = new ArrayList<>(orders);
        }
        txMarked = false;
        transactionCount++;
    }

    public void setTransactionSuccessful() {
        txMarked = true;
    }

    public void endTransaction() {
        try {
            if (failOnEndTransaction) {
                rollback();
                throw new SQLiteException("注入的提交失败（endTransaction）");
            }
            if (!txMarked) rollback();
        } finally {
            txInfos = null;
            txOrders = null;
            transactionLock.unlock();
        }
    }

    public void close() {}

    private void rollback() {
        synchronized (modelLock) {
            infos.clear();
            infos.addAll(txInfos);
            orders.clear();
            orders.addAll(txOrders);
        }
    }

    // ---------------------------------------------------------------- 闸门与排序

    private void gate() {
        if (!gateEnabled || gateDisarmed) return;
        gate.countDown();
        try {
            if (!gate.await(750, TimeUnit.MILLISECONDS)) gateDisarmed = true;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    /** 稳定排序：{@code order} 为 NULL 的最前（SQLite 的 ASC 对 NULL 的语义），其余按数值。 */
    private static void stableSortByOrder(List<String[]> rows, List<Integer> keys) {
        for (int i = 1; i < rows.size(); i++) {
            String[] row = rows.get(i);
            Integer key = keys.get(i);
            int j = i - 1;
            while (j >= 0 && compareOrder(keys.get(j), key) > 0) {
                rows.set(j + 1, rows.get(j));
                keys.set(j + 1, keys.get(j));
                j--;
            }
            rows.set(j + 1, row);
            keys.set(j + 1, key);
        }
    }

    private static int compareOrder(Integer left, Integer right) {
        int leftValue = left == null ? Integer.MIN_VALUE : left.intValue();
        int rightValue = right == null ? Integer.MIN_VALUE : right.intValue();
        return Integer.compare(leftValue, rightValue);
    }

    /** 极简游标：只在本次查询的结果上移动。 */
    private static final class FakeCursor implements Cursor {
        private final List<String> header;
        private final List<String[]> rows;
        private int position = -1;

        FakeCursor(List<String> header, List<String[]> rows) {
            this.header = header;
            this.rows = rows;
        }

        @Override public boolean moveToFirst() { position = 0; return rows.size() > 0; }
        @Override public boolean moveToNext() { position++; return position < rows.size(); }
        @Override public int getColumnIndexOrThrow(String columnName) {
            int index = header.indexOf(columnName);
            if (index < 0) throw new IllegalArgumentException("no such column: " + columnName);
            return index;
        }
        @Override public String getString(int columnIndex) { return rows.get(position)[columnIndex]; }
        @Override public long getLong(int columnIndex) {
            String value = getString(columnIndex);
            return value == null ? 0L : Long.parseLong(value);
        }
        @Override public boolean isNull(int columnIndex) { return getString(columnIndex) == null; }
        @Override public void close() {}
    }
}
`,
  'android/database/sqlite/SQLiteOpenHelper.java': String.raw`package android.database.sqlite;

import android.content.Context;

/** 照 AOSP 的形状；FAKE 就是探针铺好的那个假库（每次 getWritableDatabase 都返回当前的那个）。 */
public abstract class SQLiteOpenHelper {

    public static SQLiteDatabase FAKE = null;

    public SQLiteOpenHelper(Context context, String name, SQLiteDatabase.CursorFactory factory, int version) {}

    public SQLiteDatabase getWritableDatabase() { return FAKE; }

    public synchronized void close() {}

    public abstract void onCreate(SQLiteDatabase db);

    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}
}
`,
  'com/getcapacitor/Logger.java': String.raw`package com.getcapacitor;

import java.util.ArrayList;
import java.util.List;

/** 照 Capacitor 的 Logger 形状；顺手把日志记下来给 JS 侧断言（真机是 logcat）。 */
public class Logger {

    public static final List<String[]> MESSAGES = new ArrayList<>();

    public static void reset() { MESSAGES.clear(); }

    public static List<String> messages(String level) {
        List<String> found = new ArrayList<>();
        for (String[] entry : MESSAGES) if (entry[0].equals(level)) found.add(entry[2]);
        return found;
    }

    public static String lastInfo() {
        String last = "";
        for (String[] entry : MESSAGES) if (entry[0].equals("INFO")) last = entry[2];
        return last;
    }

    public static void verbose(String tag, String message) { record("VERBOSE", tag, message); }
    public static void debug(String tag, String message) { record("DEBUG", tag, message); }
    public static void info(String tag, String message) { record("INFO", tag, message); }
    public static void warn(String tag, String message) { record("WARN", tag, message); }
    public static void error(String tag, String message, Throwable e) { record("ERROR", tag, message); }

    private static void record(String level, String tag, String message) {
        MESSAGES.add(new String[] { level, tag, message });
    }
}
`,
  'org/json/JSONException.java': String.raw`package org.json;

public class JSONException extends Exception {
    public JSONException(String message) { super(message); }
}
`,
  'org/json/JSONObject.java': String.raw`package org.json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 手写替身：按 AOSP 的**形状**实现本通道用到的成员 —— 包括两处一旦写错就会静默改变行为的地方：
 * <ul>
 *   <li>{@code put(name, null)} 会**删掉**那个键（所以 Java 侧必须用 {@code JSONObject.NULL}）；</li>
 *   <li>{@code NULL.toString()} 是字符串 {@code "null"}（所以写回时的 meta 文本与 JS 的
 *       {@code JSON.stringify(null)} 一致）。</li>
 * </ul>
 * 另外它真的**解析**与**序列化**（键顺序按插入顺序、紧凑格式、数字去掉小数点后的 0），
 * 这样"meta 被重新序列化后写回"这件事才是被跑出来的，而不是被假装的。
 */
public class JSONObject {

    public static final Object NULL = new Object() {
        @Override public boolean equals(Object other) { return other == this || other == null; }
        @Override public String toString() { return "null"; }
    };

    private final Map<String, Object> values = new LinkedHashMap<>();

    public JSONObject() {}

    /** 照 AOSP：顶层必须是对象，否则抛 JSONException。 */
    public JSONObject(String source) throws JSONException {
        Object parsed = new Parser(source).parseValue();
        if (!(parsed instanceof Map)) {
            throw new JSONException("A JSONObject text must begin with '{'");
        }
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) parsed).entrySet()) {
            values.put(String.valueOf(entry.getKey()), entry.getValue());
        }
    }

    public JSONObject put(String name, Object value) throws JSONException {
        if (name == null) throw new JSONException("Null key");
        if (value == null) { values.remove(name); return this; }
        values.put(name, value);
        return this;
    }

    public boolean has(String name) { return values.containsKey(name); }
    public Object opt(String name) { return values.get(name); }

    public Object get(String name) throws JSONException {
        if (!values.containsKey(name)) throw new JSONException("No value for " + name);
        return values.get(name);
    }

    public String getString(String name) throws JSONException { return String.valueOf(get(name)); }

    public List<String> keySet() { return new ArrayList<>(values.keySet()); }

    @Override public String toString() {
        StringBuilder builder = new StringBuilder();
        writeValue(builder, this);
        return builder.toString();
    }

    void writeInto(StringBuilder builder) { writeObject(builder, values); }

    static void writeValue(StringBuilder builder, Object value) {
        if (value == null || value == NULL) { builder.append("null"); return; }
        if (value instanceof String) { writeString(builder, (String) value); return; }
        if (value instanceof Boolean) { builder.append(((Boolean) value).booleanValue() ? "true" : "false"); return; }
        if (value instanceof Number) { builder.append(numberToString((Number) value)); return; }
        if (value instanceof JSONObject) { ((JSONObject) value).writeInto(builder); return; }
        if (value instanceof JSONArray) { ((JSONArray) value).writeInto(builder); return; }
        if (value instanceof Map) { writeObject(builder, (Map<?, ?>) value); return; }
        if (value instanceof List) { writeArray(builder, (List<?>) value); return; }
        writeString(builder, String.valueOf(value));
    }

    static void writeObject(StringBuilder builder, Map<?, ?> map) {
        builder.append('{');
        boolean first = true;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!first) builder.append(',');
            first = false;
            writeString(builder, String.valueOf(entry.getKey()));
            builder.append(':');
            writeValue(builder, entry.getValue());
        }
        builder.append('}');
    }

    static void writeArray(StringBuilder builder, List<?> list) {
        builder.append('[');
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) builder.append(',');
            writeValue(builder, list.get(i));
        }
        builder.append(']');
    }

    static void writeString(StringBuilder builder, String value) {
        builder.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': builder.append("\\\""); break;
                case '\\': builder.append("\\\\"); break;
                case '\b': builder.append("\\b"); break;
                case '\t': builder.append("\\t"); break;
                case '\n': builder.append("\\n"); break;
                case '\f': builder.append("\\f"); break;
                case '\r': builder.append("\\r"); break;
                default:
                    if (c < 0x20) builder.append(String.format("\\u%04x", Integer.valueOf(c)));
                    else builder.append(c);
            }
        }
        builder.append('"');
    }

    /** 照 AOSP 的 numberToString：去掉小数末尾的 0 与孤立的点。 */
    static String numberToString(Number number) {
        String text = number.toString();
        if (text.indexOf('.') > 0 && text.indexOf('e') < 0 && text.indexOf('E') < 0) {
            while (text.endsWith("0")) text = text.substring(0, text.length() - 1);
            if (text.endsWith(".")) text = text.substring(0, text.length() - 1);
        }
        return text;
    }

    /** 极简 JSON 解析器（只建模本通道真正用到的形态：对象 / 数组 / 字符串 / 数字 / true / false / null）。 */
    private static final class Parser {
        private final String text;
        private int pos = 0;

        Parser(String text) { this.text = text; }

        Object parseValue() throws JSONException {
            skipWhitespace();
            if (pos >= text.length()) throw new JSONException("Unexpected end of input");
            char c = text.charAt(pos);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            if (text.startsWith("true", pos)) { pos += 4; return Boolean.TRUE; }
            if (text.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
            if (text.startsWith("null", pos)) { pos += 4; return NULL; }
            return parseNumber();
        }

        private Map<String, Object> parseObject() throws JSONException {
            Map<String, Object> map = new LinkedHashMap<>();
            pos++;
            skipWhitespace();
            if (pos < text.length() && text.charAt(pos) == '}') { pos++; return map; }
            while (true) {
                skipWhitespace();
                if (pos >= text.length() || text.charAt(pos) != '"') throw new JSONException("Expected a name at " + pos);
                String name = parseString();
                skipWhitespace();
                if (pos >= text.length() || text.charAt(pos) != ':') throw new JSONException("Expected ':' at " + pos);
                pos++;
                map.put(name, parseValue());
                skipWhitespace();
                if (pos >= text.length()) throw new JSONException("Unterminated object");
                char c = text.charAt(pos++);
                if (c == '}') return map;
                if (c != ',') throw new JSONException("Expected ',' or '}' at " + (pos - 1));
            }
        }

        private List<Object> parseArray() throws JSONException {
            List<Object> list = new ArrayList<>();
            pos++;
            skipWhitespace();
            if (pos < text.length() && text.charAt(pos) == ']') { pos++; return list; }
            while (true) {
                list.add(parseValue());
                skipWhitespace();
                if (pos >= text.length()) throw new JSONException("Unterminated array");
                char c = text.charAt(pos++);
                if (c == ']') return list;
                if (c != ',') throw new JSONException("Expected ',' or ']' at " + (pos - 1));
            }
        }

        private String parseString() throws JSONException {
            StringBuilder builder = new StringBuilder();
            pos++;
            while (true) {
                if (pos >= text.length()) throw new JSONException("Unterminated string");
                char c = text.charAt(pos++);
                if (c == '"') return builder.toString();
                if (c != '\\') { builder.append(c); continue; }
                if (pos >= text.length()) throw new JSONException("Unterminated escape");
                char escape = text.charAt(pos++);
                switch (escape) {
                    case '"': builder.append('"'); break;
                    case '\\': builder.append('\\'); break;
                    case '/': builder.append('/'); break;
                    case 'b': builder.append('\b'); break;
                    case 'f': builder.append('\f'); break;
                    case 'n': builder.append('\n'); break;
                    case 'r': builder.append('\r'); break;
                    case 't': builder.append('\t'); break;
                    case 'u':
                        if (pos + 4 > text.length()) throw new JSONException("Bad unicode escape");
                        builder.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
                        pos += 4;
                        break;
                    default: throw new JSONException("Bad escape");
                }
            }
        }

        private Object parseNumber() throws JSONException {
            int start = pos;
            while (pos < text.length()) {
                char c = text.charAt(pos);
                if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') pos++;
                else break;
            }
            String token = text.substring(start, pos);
            if (token.length() == 0) throw new JSONException("Not a JSON value at " + start);
            try {
                if (token.indexOf('.') >= 0 || token.indexOf('e') >= 0 || token.indexOf('E') >= 0) {
                    return Double.valueOf(token);
                }
                return Long.valueOf(token);
            } catch (NumberFormatException ex) {
                throw new JSONException("Not a number: " + token);
            }
        }

        private void skipWhitespace() {
            while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) pos++;
        }
    }
}
`,
  'org/json/JSONArray.java': String.raw`package org.json;

import java.util.ArrayList;
import java.util.List;

/** 照 AOSP：只有 length()，**没有** size()。 */
public class JSONArray {

    private final List<Object> values = new ArrayList<>();

    public JSONArray() {}

    public JSONArray put(Object value) { values.add(value); return this; }

    public int length() { return values.size(); }

    public Object get(int index) throws JSONException {
        if (index < 0 || index >= values.size()) throw new JSONException("Index " + index + " out of range");
        return values.get(index);
    }

    public JSONObject getJSONObject(int index) throws JSONException {
        Object value = get(index);
        if (!(value instanceof JSONObject)) throw new JSONException("Value at " + index + " is not a JSONObject");
        return (JSONObject) value;
    }

    @Override public String toString() {
        StringBuilder builder = new StringBuilder();
        writeInto(builder);
        return builder.toString();
    }

    void writeInto(StringBuilder builder) { JSONObject.writeArray(builder, values); }
}
`,
  'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java': String.raw`package com.rainmusic.mobile.ipc;

import android.content.Context;

/** 只是为了让通道文件能编过 + 让探针能把假 Context 递进去。 */
public class RainMusicIpcPlugin {

    public static Context CONTEXT = null;

    public Context getContext() { return CONTEXT; }
}
`,
}

const PROBE_SOURCE = String.raw`package ${PACKAGE};

import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * 由 tests/unit/android-playback-queue-merge.test.cjs 生成；只**转发调用**并如实报告它看到的东西，
 * 自己不做任何判定（判定全在 JS 侧的断言里，免得"期望值"被写进 Java 变成自己验证自己）。
 *
 * <p>输入：场景文件（UTF-8，一行一个字段，TAB 分隔；### 开头是场景名）。
 * 输出：报告文件（UTF-8，同样的行格式）+ stdout 一句 probe-ok。
 */
public final class RainMusicQueueMergeProbe {

    public static void main(String[] args) throws Exception {
        List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
        StringBuilder report = new StringBuilder();
        String name = null;
        List<String> body = new ArrayList<>();
        for (String line : lines) {
            if (line.startsWith("### ")) {
                if (name != null) runScenario(name, body, report);
                name = line.substring(4);
                body = new ArrayList<>();
                continue;
            }
            if (line.length() > 0) body.add(line);
        }
        if (name != null) runScenario(name, body, report);
        Files.write(Paths.get(args[1]), report.toString().getBytes(StandardCharsets.UTF_8));
        System.out.print("probe-ok");
    }

    private static void runScenario(String name, List<String> body, StringBuilder report) throws Exception {
        SQLiteDatabase db = new SQLiteDatabase();
        List<String> listIds = new ArrayList<>();
        for (String line : body) {
            String[] parts = splitTabs(line);
            String key = parts[0];
            if (key.equals("info")) {
                db.addInfo(parts[1], parts[2], parts[3], parts[4], parts[5], parts[6].equals("-") ? null : parts[6],
                    parts[7].equals("-") ? null : parts[7]);
            } else if (key.equals("order")) {
                db.addOrder(parts[1], parts[2], Integer.parseInt(parts[3]));
            } else if (key.equals("failAt")) {
                db.failAt = Integer.parseInt(parts[1]);
            } else if (key.equals("failKind")) {
                db.failOnEndTransaction = parts[1].equals("commit");
            } else if (key.equals("gate")) {
                db.gateEnabled = Boolean.parseBoolean(parts[1]);
            } else if (key.equals("listId")) {
                listIds.add(parts[1]);
            } else {
                throw new IllegalArgumentException("未知的场景字段：" + key);
            }
        }

        SQLiteOpenHelper.FAKE = db;
        RainMusicIpcPlugin.CONTEXT = new FakeContext();
        Logger.reset();
        RainMusicListMusicGetChannels.register(new RainMusicIpcPlugin());
        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(RainMusicListMusicGetChannels.CHANNEL_MUSIC_GET);

        report.append("### ").append(name).append('\n');
        if (listIds.size() > 1) {
            runConcurrent(handler, listIds.get(0), report);
        } else {
            runOnce(handler, listIds.get(0), report);
        }
        report.append("ops\t").append(join(db.ops, ",")).append('\n');
        report.append("txCount\t").append(db.transactionCount).append('\n');
        report.append("writeGroups\t").append(db.writeGroups).append('\n');
        report.append("modelCount\t").append(db.modelCount()).append('\n');
        for (String row : db.modelRows()) report.append("modelRow\t").append(row).append('\n');
        for (String message : Logger.messages("WARN")) report.append("warn\t").append(flatten(message)).append('\n');
        report.append("infoLog\t").append(flatten(Logger.lastInfo())).append('\n');
    }

    private static void runOnce(RainMusicIpcHandlers.Handler handler, String listId, StringBuilder report) {
        try {
            Object result = handler.handle(Arrays.asList((Object) listId), null);
            report.append("result\tok\n");
            reportReturned(result, report);
        } catch (Exception ex) {
            report.append("result\terror\n");
            report.append("errorClass\t").append(ex.getClass().getName()).append('\n');
            report.append("errorMessage\t").append(flatten(String.valueOf(ex.getMessage()))).append('\n');
        }
    }

    /** 两条线程同时读同一个 listId（假库里的闸门会把"两次都读到脏队列"这个交错造出来）。 */
    private static void runConcurrent(RainMusicIpcHandlers.Handler handler, String listId, StringBuilder report) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        Callable<String> task = () -> {
            try {
                return "ok:" + ids(handler.handle(Arrays.asList((Object) listId), null));
            } catch (Exception ex) {
                return "error:" + ex.getClass().getSimpleName();
            }
        };
        Future<String> first = pool.submit(task);
        Future<String> second = pool.submit(task);
        report.append("threadA\t").append(first.get()).append('\n');
        report.append("threadB\t").append(second.get()).append('\n');
        pool.shutdown();
    }

    private static void reportReturned(Object result, StringBuilder report) {
        report.append("returnedIds\t").append(ids(result)).append('\n');
        JSONArray array = (JSONArray) result;
        for (int i = 0; i < array.length(); i++) {
            try {
                report.append("returnedRow\t").append(describe(array.getJSONObject(i))).append('\n');
            } catch (Exception ex) {
                report.append("returnedRowError\t").append(ex.getClass().getSimpleName()).append('\n');
            }
        }
    }

    private static String ids(Object result) {
        StringBuilder builder = new StringBuilder();
        try {
            JSONArray array = (JSONArray) result;
            for (int i = 0; i < array.length(); i++) {
                if (i > 0) builder.append(',');
                builder.append(array.getJSONObject(i).getString("id"));
            }
        } catch (Exception ex) {
            return "<ids-failed:" + ex.getClass().getSimpleName() + ">";
        }
        return builder.toString();
    }

    /** keys=…|id=…|name=…|singer=…|source=…|interval=…|meta=…（meta 是对象/JSON null 的紧凑文本）。 */
    private static String describe(JSONObject item) throws Exception {
        StringBuilder builder = new StringBuilder();
        builder.append("keys=").append(join(item.keySet(), ","));
        for (String key : new String[] { "id", "name", "singer", "source", "interval", "meta" }) {
            builder.append('|').append(key).append('=').append(String.valueOf(item.get(key)));
        }
        return builder.toString();
    }

    private static String[] splitTabs(String line) {
        List<String> parts = new ArrayList<>();
        int start = 0;
        for (int i = 0; i < line.length(); i++) {
            if (line.charAt(i) == (char) 9) {
                parts.add(line.substring(start, i));
                start = i + 1;
            }
        }
        parts.add(line.substring(start));
        return parts.toArray(new String[0]);
    }

    private static String join(List<String> values, String separator) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) builder.append(separator);
            builder.append(values.get(i));
        }
        return builder.toString();
    }

    private static String flatten(String value) {
        if (value == null) return "";
        return value.replace("\r", " ").replace("\n", " ");
    }

    private static final class FakeContext extends android.content.Context {
        @Override public android.content.Context getApplicationContext() { return this; }
        @Override public File getDatabasePath(String name) {
            return new File(System.getProperty("java.io.tmpdir"), name);
        }
    }
}
`

const JAVAC_AVAILABLE = (() => {
  const result = spawnSync('javac', ['-version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()
const SKIP_REASON = JAVAC_AVAILABLE
  ? false
  : '本机没有可用的 javac（JDK）⇒ 这一组"用假 SQLite 把这一刀跑起来"的用例无法执行'

const temporaryDirs = []
after(() => {
  for (const dir of temporaryDirs) fs.rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 场景语料与"期望值"（期望值全部由 JS 侧的真实现算出来）
// ---------------------------------------------------------------------------

/** 场景文件的一行：info。interval / meta 用 `-` 表示 SQL NULL。 */
const infoLine = (id, listId, name, singer, source, interval, meta) =>
  ['info', id, listId, name, singer, source, interval === null ? '-' : interval, meta === null ? '-' : meta].join('\t')
const orderLine = (listId, musicInfoId, order) => ['order', listId, musicInfoId, String(order)].join('\t')

/**
 * 那条 `LEFT JOIN … ORDER BY O."order" ASC` 在 JS 侧的**同一份语义**（期望值要用它）：
 * 每一行 info 按 `(listId, musicInfoId)` 找 order 记录 —— 一个都没有时 order 为 null，
 * 有多个时**展开成多行**（SQL 的 JOIN 就是一对多）；然后按 order 升序（NULL 最前）、稳定排序。
 */
const joinRows = (infos, orders, listId) => {
  const out = []
  for (const info of infos) {
    if (info.listId !== listId) continue
    const matches = orders.filter(order => order.listId === listId && order.musicInfoId === info.id)
    if (matches.length === 0) out.push({ ...info, order: null })
    else for (const match of matches) out.push({ ...info, order: match.order })
  }
  return out
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = left.row.order === null ? -Infinity : left.row.order
      const b = right.row.order === null ? -Infinity : right.row.order
      return a === b ? left.index - right.index : a - b
    })
    .map(entry => entry.row)
}

/** 走一次真实调用需要的最小东西。 */
const compileOnce = (() => {
  let state = null
  return () => {
    if (state != null) return state
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-android-merge-'))
    temporaryDirs.push(dir)
    const stubRoot = path.join(dir, 'stub')
    const outDir = path.join(dir, 'out')
    const srcDir = path.join(dir, 'probe', ...PACKAGE.split('.'))
    fs.mkdirSync(outDir, { recursive: true })
    fs.mkdirSync(srcDir, { recursive: true })
    for (const [relative, source] of Object.entries(STUBS)) {
      const file = path.join(stubRoot, ...relative.split('/'))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, source)
    }
    const probePath = path.join(srcDir, 'RainMusicQueueMergeProbe.java')
    fs.writeFileSync(probePath, PROBE_SOURCE)
    const javaDir = path.join(ROOT, JAVA_REL_DIR)
    const compiled = runToFile(
      'javac',
      [
        '-encoding', 'UTF-8', '-sourcepath', stubRoot, '-d', outDir, probePath,
        path.join(javaDir, 'RainMusicListMusicGetChannels.java'),
        path.join(javaDir, 'RainMusicPlaybackQueueKey.java'),
        path.join(javaDir, 'RainMusicLogThrottle.java'),
        path.join(javaDir, 'RainMusicDatabase.java'),
        path.join(javaDir, 'RainMusicIpcHandlers.java'),
      ],
      dir,
      path.join(dir, 'javac.log'),
    )
    assert.equal(compiled.status, 0, `javac 编不过（probe + 本刀的 5 个文件）：\n${compiled.log}`)
    state = { dir, outDir }
    return state
  }
})()

/** 跑一个场景文件，返回 `场景名 → { 字段名: [值…] }`。 */
const runScenarios = scenarios => {
  const state = compileOnce()
  const scenarioFile = path.join(state.dir, 'scenarios.txt')
  const reportFile = path.join(state.dir, 'report.txt')
  fs.writeFileSync(scenarioFile, scenarios.join('\n') + '\n', 'utf8')
  const result = runToFile(
    'java',
    ['-cp', state.outDir, `${PACKAGE}.RainMusicQueueMergeProbe`, scenarioFile, reportFile],
    state.dir,
    path.join(state.dir, 'java.log'),
  )
  assert.equal(result.status, 0, `java 探针退出码 ${result.status}：\n${result.log}`)
  assert.match(result.log, /probe-ok/, '探针没有正常跑完')

  const report = fs.readFileSync(reportFile, 'utf8')
  const out = {}
  let current = null
  for (const line of report.split('\n')) {
    if (line.length === 0) continue
    if (line.startsWith('### ')) {
      current = {}
      out[line.slice(4)] = current
      continue
    }
    const [key, ...values] = line.split('\t')
    assert.ok(current, `报告里 ${key} 出现在场景标题之前`)
    ;(current[key] ??= []).push(values)
  }
  return out
}

const first = (section, key) => {
  const values = section[key]
  assert.ok(values && values.length > 0, `报告里没有字段 ${key}`)
  return values[0].length === 1 ? values[0][0] : values[0]
}
/** 只用在"失败时才需要看"的断言消息里（缺字段时给空串，不要在拼消息时又抛一次）。 */
const optionalFirst = (section, key) => {
  const values = section[key]
  return values && values.length > 0 ? values[0].join('\t') : ''
}
const lines = (section, key) => (section[key] ?? []).map(values => values.join('\t'))

// ---------------------------------------------------------------------------
// 3. default + 重复 ⇒ 一次合并：两张表全删 → 按 order 逐条插回 → 返回去重后的列表
// ---------------------------------------------------------------------------

/** 这一组语料是"看得见的"：名字/歌手/大小写/空白都手工列出，重复的来源有四种。 */
const NAMED_INFOS = [
  // id, listId, name, singer, source, interval, meta
  ['m-1', 'default', 'Song One', 'Singer A', 'wy', '03:55', '{"qualitys":["320k"],"n":1}'],
  ['m-2', 'default', 'song one', 'singer a', 'kg', null, '{"qualitys":["128k"]}'], // 与 m-1 的键相同（大小写）⇒ 删
  ['m-3', 'default', 'Unique', 'Singer B', 'wy', null, '{}'],
  ['m-1', 'default', 'Different Name', 'Singer C', 'kw', null, '{"alt":true}'], // id 重复（UNIQUE(id,listId) 下不可达，这里是防御路径）⇒ 删
  ['m-4', 'default', '', 'Singer D', 'wy', null, '{"x":{"y":[1,2,3]}}'], // 名字为空 ⇒ 退化成 id 键 ⇒ 留
  ['m-5', 'default', 'Song One', 'Singer A', 'tx', null, '{"src":"tx"}'], // 同上键 ⇒ 删
]
const NAMED_ORDERS = [
  ['default', 'm-1', 0],
  ['default', 'm-2', 1],
  ['default', 'm-3', 2],
  ['default', 'm-5', 4],
  ['default', 'm-404', 99], // 孤儿：info 里没有它 —— 写回的 DELETE … WHERE listId=? 应该把它一起删掉
]
const toInfoObject = ([id, listId, name, singer, source, interval, meta]) =>
  ({ id, listId, name, singer, source, interval, metaText: meta })
const toOrderObject = ([listId, musicInfoId, order]) => ({ listId, musicInfoId, order })

test('default 有重复 ⇒ 去重 + 单事务写回：语句顺序、写回的 order、返回的是去重后的列表', { skip: SKIP_REASON }, () => {
  const infos = NAMED_INFOS.map(toInfoObject)
  const orders = NAMED_ORDERS.map(toOrderObject)
  const joined = joinRows(infos, orders, 'default')
  const kept = dedupePlaybackQueue(joined)
  assert.deepEqual(kept.map(music => music.id), ['m-4', 'm-1', 'm-3'], 'JS 侧的期望本身要先对（真实现算的）')

  const report = runScenarios([
    '### default-dirty',
    ...NAMED_INFOS.map(row => infoLine(...row)),
    ...NAMED_ORDERS.map(row => orderLine(...row)),
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['default-dirty']
  assert.equal(first(section, 'result'), 'ok', `不该失败：${optionalFirst(section, 'errorMessage')}`)

  // 1) 返回的是**去重后的**那一份（桌面 :201 的 targetList = merged）。
  assert.equal(first(section, 'returnedIds'), kept.map(music => music.id).join(','))
  const returnedRows = lines(section, 'returnedRow')
  assert.equal(returnedRows.length, kept.length)
  kept.forEach((music, index) => {
    // meta 被重新序列化（紧凑、键顺序不变）⇒ 与 JS 的 JSON.stringify(JSON.parse(text)) 逐字节相同。
    const expectedMeta = JSON.stringify(JSON.parse(music.metaText))
    assert.match(returnedRows[index], new RegExp(`\\|id=${music.id}\\|`))
    assert.ok(returnedRows[index].includes(`|meta=${expectedMeta}|`) || returnedRows[index].endsWith(`|meta=${expectedMeta}`),
      `第 ${index} 行的 meta 不是重新序列化后的对象：${returnedRows[index]}`)
    assert.ok(returnedRows[index].startsWith('keys=id,name,singer,source,interval,meta|'),
      '返回值必须只有那六个键（没有 listId、没有 order）')
  })

  // 2) 语句顺序 = dbHelper.ts:340-349（两张表全删 → 按 order 逐条插）。
  const expectedOps = ['del-info', 'del-order']
  kept.forEach(music => expectedOps.push(`ins-info:${music.id}`, `ins-order:${music.id}`))
  assert.deepEqual(first(section, 'ops').split(','), expectedOps,
    '写语句的顺序/条数必须与 dbHelper.ts:340-349 一致（先两张表全删，再逐条 INSERT info + INSERT order）')

  // 3) 一个事务、一次合并。
  assert.equal(first(section, 'txCount'), '1', '整段写回必须只开一个事务')
  assert.equal(first(section, 'writeGroups'), '1')

  // 4) 库里的最终状态 = kept，且 order 重新编号成 0..N-1（桌面 toDBMusicInfo 的 offset + index）。
  const modelRows = lines(section, 'modelRow')
  assert.equal(first(section, 'modelCount'), String(kept.length), '写回后的行数 = 去重后剩下的行数')
  assert.deepEqual(
    modelRows,
    kept.map((music, index) => [
      music.id, index, JSON.stringify(JSON.parse(music.metaText)),
      music.name, music.singer, music.source, music.interval ?? '-',
    ].join('|')),
    '写回后的每一行都应该是"读到的那一行"（含 meta 的重新序列化）',
  )
  // 孤儿 order 记录（m-404）被 `DELETE … WHERE listId=?` 一起删掉了。
  assert.ok(!modelRows.some(row => row.startsWith('m-404|')), 'DELETE 是按 listId 删的，孤儿 order 记录也该被清掉')

  // 5) 日志：一条 warn，说"已去重并写回 N → M 行"，而且不再说"只读、不写回"。
  const warns = lines(section, 'warn')
  assert.equal(warns.length, 1, `默认列合并成功应当有一条 warn：${JSON.stringify(warns)}`)
  assert.match(warns[0], /里有 3 条重复（共 6 行）/)
  assert.match(warns[0], /6 → 3 行/)
  assert.ok(!/只读、不写回/.test(warns[0]), '那条说谎的临时 warn 必须已经不在')
  assert.match(warns[0], /db_info/, '必须点名"快照还没做"这件事')
  assert.ok(!/只读/.test(first(section, 'infoLog')), 'register 的日志不该还说"写回未做"')
  assert.match(first(section, 'infoLog'), /第七刀-A/)
})

// ---------------------------------------------------------------------------
// 4. 非 default：一模一样的重复也**一条写语句都不发**（普通歌单永不合并）
// ---------------------------------------------------------------------------

test('非 default（用户歌单 / temp）：同样的重复也一条写语句都不发、返回原始行', { skip: SKIP_REASON }, () => {
  const listId = 'list-1'
  const infos = NAMED_INFOS.map(([id, , name, singer, source, interval, meta]) =>
    toInfoObject([id, listId, name, singer, source, interval, meta]))
  const orders = NAMED_ORDERS.map(([, musicInfoId, order]) => toOrderObject([listId, musicInfoId, order]))
  const joined = joinRows(infos, orders, listId)
  // 这一条语料本身确实有重复（否则"没写"这件事证明不了什么）。
  assert.ok(dedupePlaybackQueue(joined).length < joined.length, '语料必须真的有重复')

  const report = runScenarios([
    '### non-default-dirty',
    ...NAMED_INFOS.map(([id, , name, singer, source, interval, meta]) =>
      infoLine(id, listId, name, singer, source, interval, meta)),
    ...NAMED_ORDERS.map(([, musicInfoId, order]) => orderLine(listId, musicInfoId, order)),
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    `listId\t${listId}`,
  ])
  const section = report['non-default-dirty']
  assert.equal(first(section, 'result'), 'ok')
  // 返回的是**原始行**（含重复），不是去重后的 —— 去重只属于 default。
  assert.equal(first(section, 'returnedIds'), joined.map(row => row.id).join(','),
    '非 default 必须原样返回（连重复都在），否则就是在用户歌单里删歌')
  assert.ok(first(section, 'returnedIds').split(',').length > new Set(joined.map(row => row.id)).size)
  // 一条写语句都没有。
  assert.equal(first(section, 'ops'), '', '非 default 不许发任何写语句')
  assert.equal(first(section, 'txCount'), '0', '非 default 不许开事务')
  assert.equal(first(section, 'writeGroups'), '0')
  assert.equal(first(section, 'modelCount'), String(infos.length), '库必须一行都没变')
  assert.equal(lines(section, 'modelRow').length, infos.length)
  assert.deepEqual(lines(section, 'warn'), [], '非 default 不该有合并日志')
})

// ---------------------------------------------------------------------------
// 5. 失败语义：写回失败 ⇒ 抛错 + 点名两半 + 回滚（库仍是 N 行）
// ---------------------------------------------------------------------------

/** 4 行、1 条重复 ⇒ 去重后 3 行（写回要发 2 条 DELETE + 6 条 INSERT）。 */
const FAIL_INFOS = [
  ['f-1', 'default', 'Alpha', 'One', 'wy', '03:00', '{"n":1}'],
  ['f-2', 'default', 'alpha', 'one', 'kg', null, '{"n":2}'], // 键重复 ⇒ 删
  ['f-3', 'default', 'Beta', 'Two', 'wy', null, '{}'],
  ['f-4', 'default', 'Gamma', 'Three', 'tx', null, '{"n":4}'],
]
const FAIL_ORDERS = [['default', 'f-1', 0], ['default', 'f-2', 1], ['default', 'f-3', 2], ['default', 'f-4', 3]]

test('写回失败（第 3 条写语句就炸）⇒ 整条 ok:false：消息同时点名"读到 N 行成功"与"写回失败"，且事务回滚', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### write-fails',
    ...FAIL_INFOS.map(row => infoLine(...row)),
    ...FAIL_ORDERS.map(row => orderLine(...row)),
    'failKind\tnone',
    'failAt\t3', // del-info(1) → del-order(2) → 第一条 INSERT info(3) 抛错
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['write-fails']
  assert.equal(first(section, 'result'), 'error', '写回失败必须让整条调用失败（不许返回去重后的列表）')
  assert.equal(first(section, 'errorClass'), 'java.lang.IllegalStateException')
  const message = first(section, 'errorMessage')

  // 五件必须点名的事：读到 N 行成功 / 写回失败 / 已回滚 / 库仍是 N 行 / 原始异常。
  assert.match(message, /读到 4 行成功/)
  assert.match(message, /写回失败/)
  assert.match(message, /已回滚/)
  assert.match(message, /库仍是写回前的 4 行/)
  assert.match(message, /注入的写失败/)
  assert.match(message, /不会\*\*吞掉写回错误/)
  // 它**不许**被包成"读失败"（那正是第六刀当时不肯做写回的理由）。
  assert.ok(!message.includes('读 "my_list_music_info" 失败'), `写回失败不能被误报成读失败：${message}`)

  // 事务回滚：库里仍是写回前的 4 行，且顺序/内容一个字节都没变。
  assert.equal(first(section, 'modelCount'), '4')
  assert.deepEqual(
    lines(section, 'modelRow'),
    FAIL_INFOS.map(([id, , name, singer, source, interval, meta], index) =>
      [id, index, JSON.stringify(JSON.parse(meta)), name, singer, source, interval ?? '-'].join('|')),
  )
  assert.equal(first(section, 'txCount'), '1', '失败路径也必须只开一个事务（那次事务负责回滚）')
  assert.deepEqual(lines(section, 'warn'), [], '失败不该同时又打一条"已写回"的 warn（那会让 logcat 说谎）')
})

test('提交阶段失败（endTransaction 抛）⇒ 消息**不**声称"已回滚 / 库仍是 N 行"（那会是一句无法证明的话）', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### commit-fails',
    ...FAIL_INFOS.map(row => infoLine(...row)),
    ...FAIL_ORDERS.map(row => orderLine(...row)),
    'failKind\tcommit',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['commit-fails']
  assert.equal(first(section, 'result'), 'error')
  const message = first(section, 'errorMessage')
  assert.match(message, /读到 4 行成功/)
  assert.match(message, /写回失败/)
  assert.match(message, /提交阶段/)
  assert.ok(!message.includes('已回滚'), '提交阶段失败时不能声称已经回滚')
  assert.ok(!/库仍是写回前的/.test(message), '提交阶段失败时不能声称库还是 N 行')
})

test('并发两次读 default：只合并**一次**（第二次读到的是已经干净的行）', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### concurrent-default',
    infoLine('c-1', 'default', 'Song', 'Singer', 'wy', null, '{"n":1}'),
    infoLine('c-2', 'default', 'song', 'singer', 'kg', null, '{"n":2}'), // 键重复 ⇒ 删
    infoLine('c-3', 'default', 'Other', 'X', 'tx', null, '{}'),
    orderLine('default', 'c-1', 0),
    orderLine('default', 'c-2', 1),
    orderLine('default', 'c-3', 2),
    'failKind\tnone',
    'failAt\t0',
    'gate\ttrue', // 假库让两条线程都先读到脏队列（不确定性交错被确定性地造出来）
    'listId\tdefault',
    'listId\tdefault', // 两个 listId 行 ⇒ 并发读
  ])
  const section = report['concurrent-default']
  // 两条线程都必须拿到去重后的两份行（谁先谁后都一样）。
  assert.equal(first(section, 'threadA'), 'ok:c-1,c-3')
  assert.equal(first(section, 'threadB'), 'ok:c-1,c-3')
  // 关键：只发生**一次**合并（第二次读看到的是已经干净的行 ⇒ 不再写）。
  assert.equal(first(section, 'writeGroups'), '1',
    '并发下必须只合并一次（专用锁从 SELECT 之前开始）；=2 说明两次读都拿到脏队列、各写了一遍')
  assert.equal(first(section, 'txCount'), '1', '只有一次写回 ⇒ 只开一个事务')
  assert.deepEqual(first(section, 'ops').split(','), [
    'del-info', 'del-order', 'ins-info:c-1', 'ins-order:c-1', 'ins-info:c-3', 'ins-order:c-3',
  ])
  assert.equal(first(section, 'modelCount'), '2')
})

// ---------------------------------------------------------------------------
// 6. 读的边界：坏 meta / NULL 列 / 随机语料（期望值都由 JS 侧算）
// ---------------------------------------------------------------------------

test('**将被删掉的**重复行 meta 是坏的 ⇒ 整条读失败（桌面先 parse 全部行、再去重）', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### bad-meta-on-dropped',
    infoLine('b-1', 'default', 'Song', 'Singer', 'wy', null, '{"n":1}'),
    infoLine('b-2', 'default', 'song', 'singer', 'kg', null, '{oops'), // 键重复（本来会被删）但 meta 坏了
    orderLine('default', 'b-1', 0),
    orderLine('default', 'b-2', 1),
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['bad-meta-on-dropped']
  assert.equal(first(section, 'result'), 'error',
    '桌面是"先把所有行 JSON.parse 成 targetList、再去重"⇒ 重复行的坏 meta 同样会让整条读失败')
  assert.match(first(section, 'errorMessage'), /b-2/)
  assert.match(first(section, 'errorMessage'), /不是合法的 JSON 对象/)
  assert.equal(first(section, 'ops'), '', '读都失败了，一条写语句都不该发')
  assert.equal(first(section, 'modelCount'), '2', '库必须一行都没变')
})

test('NULL 列：interval 为 SQL NULL ⇒ 返回 JSON null 且写回绑 NULL；meta 为 SQL NULL ⇒ 写回文本 "null"', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### null-columns',
    // 存活的这一行：interval 与 meta **都是 SQL NULL**（meta 列是 TEXT NOT NULL，这属于被写坏的库）。
    infoLine('n-1', 'default', 'Song', 'Singer', 'wy', null, null),
    // 重复的那一行有正常的 meta/interval（它会被删掉，但照样要参与"读到的那一行"的检查）。
    infoLine('n-2', 'default', 'song', 'singer', 'kg', '03:00', '{"n":2}'),
    orderLine('default', 'n-1', 0),
    orderLine('default', 'n-2', 1),
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['null-columns']
  assert.equal(first(section, 'result'), 'ok')
  assert.equal(first(section, 'returnedIds'), 'n-1')
  const row = lines(section, 'returnedRow')[0]
  assert.ok(row.includes('|interval=null'), `interval 的 SQL NULL 必须变成 JSON null：${row}`)
  assert.ok(row.endsWith('|meta=null'), `meta 的 SQL NULL 必须变成 JSON null（与桌面的 JSON.parse(null) 一致）：${row}`)
  // 写回：interval 绑 NULL（模型里是 "-"），meta 写作文本 "null"（模型里是 null 这个 4 字面量）——
  // 后者正是桌面的 JSON.stringify(null) ⇒ "null"。
  assert.deepEqual(lines(section, 'modelRow'), ['n-1|0|null|Song|Singer|wy|-'])
})

test('随机语料（确定性种子）180 行：Java 去重后的返回值与库里写的行 == JS dedupePlaybackQueue 的结果', { skip: SKIP_REASON }, () => {
  const random = (() => {
    let state = 20260707
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 0x100000000
    }
  })()
  const NAMES = ['Song', 'song', ' SONG ', '\u3000Song\u3000', '歌曲', 'Ｓｏｎｇ', 'Song A', '', '  ', 'Unique', 'αβγ']
  const SINGERS = ['Singer', 'singer', 'SINGER', '\u00a0Singer\u00a0', '歌手', 'ΣΙΓΜΑ', '', 'X']
  const pick = pool => pool[Math.floor(random() * pool.length)]

  const infos = []
  const orders = []
  for (let index = 0; index < 180; index++) {
    const id = `r-${index}`
    // 故意让一部分行共用 (name, singer) ⇒ 键重复；id 全局唯一（UNIQUE(id,listId) 下 id 不可能重复）。
    const name = index % 3 === 0 ? pick(NAMES) : `unique-${index}`
    const singer = index % 3 === 0 ? pick(SINGERS) : `S-${index}`
    const interval = random() < 0.5 ? null : '03:0' + (index % 10)
    const meta = `{"i":${index},"s":"s${index % 7}"${random() < 0.3 ? ',"a":[1,2]' : ''}}`
    infos.push({ id, listId: 'default', name, singer, source: 'wy', interval, metaText: meta })
    orders.push({ listId: 'default', musicInfoId: id, order: index })
  }
  const joined = joinRows(infos, orders, 'default')
  const kept = dedupePlaybackQueue(joined)
  assert.ok(kept.length < joined.length, '语料必须真的有重复')

  const report = runScenarios([
    '### random-corpus',
    ...infos.map(row => infoLine(row.id, row.listId, row.name, row.singer, row.source, row.interval, row.metaText)),
    ...orders.map(row => orderLine(row.listId, row.musicInfoId, row.order)),
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['random-corpus']
  assert.equal(first(section, 'result'), 'ok', `不该失败：${optionalFirst(section, 'errorMessage')}`)
  assert.equal(first(section, 'returnedIds'), kept.map(music => music.id).join(','),
    'Java 的去重结果与 JS 的 dedupePlaybackQueue 不同（"留下哪一条"会因此不同）')
  assert.equal(first(section, 'modelCount'), String(kept.length))
  assert.deepEqual(
    lines(section, 'modelRow'),
    kept.map((music, index) => [
      music.id, index, JSON.stringify(JSON.parse(music.metaText)),
      music.name, music.singer, music.source, music.interval ?? '-',
    ].join('|')),
    '写回库里的行必须与 JS 侧算出来的"去重后剩下的行"逐行相同（含 order = 下标、meta 重新序列化）',
  )
  // 返回值的每一行也与 kept 一致（JSON 语义相等；文本由 org.json 重新序列化）。
  const returnedRows = lines(section, 'returnedRow')
  kept.forEach((music, index) => {
    assert.ok(returnedRows[index].startsWith(`keys=id,name,singer,source,interval,meta|id=${music.id}|`), returnedRows[index])
    const meta = returnedRows[index].slice(returnedRows[index].indexOf('|meta=') + 6)
    assert.deepEqual(JSON.parse(meta), JSON.parse(music.metaText), `第 ${index} 行的 meta 值与读到的不一致`)
  })
})
