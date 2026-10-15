/**
 * Android 移植 · **P0-2 第七刀-A（`player_list_music_get` 的默认列去重写回）+
 * 第七刀-B（同事务的"合并前身份快照"）** 的**行为**回归网：用真的 `javac` + 真的 `java`
 * 把这两刀的 Java 控制流**跑起来**。
 *
 * ⚠️ 先写清楚这个文件**做不到**什么：
 * <ol>
 *   <li>本机没有 Android SDK（`docs/android-port-plan.md` §0），`android.*` / `org.json` /
 *       `com.getcapacitor.Logger` / `RainMusicIpcPlugin` 全部是**手写替身**；
 *   </li>
 *   <li>替身里那个 {@code SQLiteDatabase} 是一个**手写的假 SQLite**（内存里的三张表 + 真的事务
 *       快照/回滚 + 语句记录 + 失败注入）。它**不是** SQLite：它只实现本通道用到的那三条查询
 *       （`sqlite_master` 存在性检查、那条 `LEFT JOIN`、`db_info` 的快照存在性检查）与五条写语句，
 *       语义是**照 SQL 写道**的，不是从 SQLite 借来的。真正的 SQL 行为（绑定、NULL、`ORDER BY` 的并列、
 *       文件锁、事务在真机上的可见性）只能由 CI 的 `gradlew assembleDebug` → 真机运行来证伪；
 *   </li>
 *   <li>所以它证明的是"**这两刀的 Java 控制流**在给定 SQL 行为下是对的"：写只在 default 上发生、
 *       五条语句的顺序（**快照 INSERT 在两条 DELETE 之前**）、整段在同一个事务里、失败会抛且
 *       事务回滚（**连快照那一行一起**）、并发下只合并一次、快照只在"库里还没有"时插一次。
 *       它证明不了"真机上也这样"。
 * </ol>
 *
 * <h2>为什么值得写这一组（而不是只做源码断言）</h2>
 * 这一刀的风险全是**控制流**上的：少了 `beginTransaction` 就变成"删了再插、中途失败留下半个歌单"；
 * 把写回的错误吞掉就变成"渲染层缓存一份库里并不存在的列表"；把合并扩大到非 default 就会在用户
 * 自建歌单里**删歌**；**把快照放到 DELETE 之后**就变成"记的是合并后的身份"（那份快照永远无法
 * 还原去重前的行序）；**把快照挪出事务**就会在合并失败时留下一份脏快照（下次读会以为"已经记过"）。
 * 这几件事在源码断言下都能靠"改写但保持关键字"骗过去，而在这里会真的变红
 * （见下面「变异自证」的 10 处）。判定全在 JS 侧的断言里，探针只**如实报告**它观察到的东西。
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
 *   <li><b>DELETE 与 INSERT 顺序颠倒</b>（先插后删）⇒ 语句序列断言变红，且库里最后是空的；</li>
 *   <li><b>快照放到两条 DELETE 之后</b>（第七刀-B）⇒ 语句序列断言变红
 *       （`ins-db-info` 不再排在 `del-info` 之前）；</li>
 *   <li><b>去掉"仅在不存在时"</b>（无条件插快照）⇒ 预置了快照的场景会多插一行
 *       （`ins-db-info` 出现两次 / db_info 行数 = 2）；</li>
 *   <li><b>快照脱离事务</b>（INSERT 挪到 `beginTransaction()` 之前）⇒ 合并失败时那份快照**留在库里**
 *       （回滚只覆盖事务快照里的表）；</li>
 *   <li><b>快照内容用合并后的行</b>（只对 `kept` 采集，或先删再采）⇒ 内容断言变红
 *       （快照里缺了那些被删掉的重复行 ⇒ 还原不了去重前的行序）；</li>
 *   <li><b>快照只在非 default 上写 / 完全不写</b>（把那一句挪到 `readListMusics` 的纯读分支）⇒
 *       default 场景没有 `ins-db-info`、db_info 行数 = 0。</li>
 * </ol>
 *
 * <h2>与桌面源码的关系（四条链都是"照抄"，不是"参考"）</h2>
 * <ul>
 *   <li>合并规则 = `src/common/utils/playbackQueue.ts:10-22` 的 `dedupePlaybackQueue`
 *       —— 本文件直接 `load()` 真的 TS 实现，用它算**期望**；</li>
 *   <li>事务形状 = `dbHelper.ts:337-349`（**条件插快照** + DELETE ×2 + INSERT ×2N，同一个事务）；</li>
 *   <li>快照内容 = `index.ts:198` 的 `targetList.map(({ id, name, singer }) => ({ id, name, singer }))`
 *       —— 期望值同样由 JS 侧从**去重前**的行算出来；</li>
 *   <li>失败语义 = `tests/unit/playback-queue.test.cjs:212-220`（`assert.rejects` + 回滚 + 行数不变；
 *       那一组同时证明"合并失败 ⇒ 行与快照一起回滚，不留脏快照"）。</li>
 * </ul>
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const load = require('./load-ts.cjs')
const assertCheckedJsonSignatures = require('./json-checked-exception-probe.cjs')

const ROOT = path.join(__dirname, '../..')
const PACKAGE = 'com.rainmusic.mobile.ipc'
const JAVA_REL_DIR = path.join('android/app/src/main/java', ...PACKAGE.split('.'))
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const getJava = read(path.join(JAVA_REL_DIR, 'RainMusicListMusicGetChannels.java'))
const statementsTs = read('src/main/worker/dbService/modules/list/statements.ts')
const dbHelperTs = read('src/main/worker/dbService/modules/list/dbHelper.ts')
const tablesTs = read('src/main/worker/dbService/tables.ts')

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

test('五条写语句逐字对齐 statements.ts / dbHelper.ts（只把具名参数换成 ?），列清单与列顺序一字不改', () => {
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

  // ---- 第七刀-B：db_info 的两句（存在性检查 + 快照 INSERT）----
  // 句子的"出处"是 dbHelper.ts:28 / :338；**列名**的出处是 tables.ts:120-127（db_info 的 DDL）。
  const dbInfoDdl = tablesTs.match(/tables\.set\('db_info',\s*`([\s\S]*?)`\)/)[1]
  const dbInfoColumns = [...dbInfoDdl.matchAll(/"(\w+)"\s+(INTEGER|TEXT|REAL|BLOB)/g)].map(match => match[1])
  assert.deepEqual(dbInfoColumns, ['id', 'field_name', 'field_value'], 'tables.ts 的 db_info 列清单变了 → 本刀的列名要重新核')

  const desktopSnapshotSelect = dbHelperTs.match(/prepare\('(SELECT [^']*FROM db_info WHERE field_name = \?)'\)/)[1]
  const desktopSnapshotInsert = dbHelperTs.match(/prepare\('(INSERT INTO db_info \(field_name, field_value\) VALUES \(\?, \?\))'\)/)[1]
  const javaSnapshotSelect = javaTextBlock(getJava, 'SQL_SELECT_QUEUE_RESTORE_SNAPSHOT')
  const javaSnapshotInsert = javaTextBlock(getJava, 'SQL_INSERT_QUEUE_RESTORE_SNAPSHOT')

  // 列清单与列顺序：从两句 SQL 里各抽出字段名，必须与 tables.ts 的 DDL 逐个相同（顺序也算）。
  const selectColumns = [...javaSnapshotSelect.matchAll(/"(\w+)"/g)].map(match => match[1])
  assert.deepEqual(
    selectColumns,
    ['field_value', 'main', 'db_info', 'field_name'],
    'SQL_SELECT_QUEUE_RESTORE_SNAPSHOT 只许出现 db_info 的那三列/表名（列名逐字对齐 tables.ts:120-127）',
  )
  const insertColumns = [...javaSnapshotInsert.matchAll(/"(\w+)"/g)].map(match => match[1])
  assert.deepEqual(
    insertColumns,
    ['main', 'db_info', 'field_name', 'field_value'],
    'SQL_INSERT_QUEUE_RESTORE_SNAPSHOT 的列清单必须是 ("field_name", "field_value")、**不动**自增主键 "id"',
  )
  // 与桌面那两句的"语义"逐字相同：表名 db_info + 两个列名 + 参数个数。
  for (const [javaSql, desktopSql, label] of [
    [javaSnapshotSelect, desktopSnapshotSelect, '快照存在性检查'],
    [javaSnapshotInsert, desktopSnapshotInsert, '快照 INSERT'],
  ]) {
    const columnsOf = sql => [...sql.matchAll(/"(\w+)"/g)].map(match => match[1]).filter(name => name !== 'main')
    const desktopColumns = [...desktopSql.matchAll(/(\w+)/g)].map(match => match[1]).filter(name => ['db_info', 'field_name', 'field_value'].includes(name))
    assert.deepEqual(columnsOf(javaSql), [...new Set(desktopColumns)], `${label} 的表/列名与 dbHelper.ts 那一句对不上`)
    assert.equal((javaSql.match(/\?/g) ?? []).length, (desktopSql.match(/\?/g) ?? []).length, `${label} 的参数个数对不上`)
  }
  // 键名：与桌面 `QUEUE_RESTORE_SNAPSHOT_KEY` 逐字相同（键对不上 = 没有快照）。
  assert.match(dbHelperTs, /QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'/)
  assert.equal(
    getJava.match(/String\s+QUEUE_RESTORE_SNAPSHOT_KEY\s*=\s*"([^"]*)"/)[1],
    dbHelperTs.match(/QUEUE_RESTORE_SNAPSHOT_KEY = '([^']*)'/)[1],
    'db_info 的 field_name 必须与桌面逐字一致（这是一份跨 worker 的持久数据）',
  )

  // 桌子那五步的顺序（快照 INSERT → DELETE info → DELETE order → INSERT info → INSERT order）在源码里的形状。
  const code = stripJavaComments(getJava)
  const body = code.slice(
    code.indexOf('private static void overwriteDefaultQueue('),
    code.indexOf('private static String writeBackFailureMessage('),
  )
  // ⚠️ 允许 `execSQL(` 与语句常量之间有空白：快照那一句的参数较长，Java 侧换行了。
  const sequence = [...body.matchAll(/execSQL\(\s*(SQL_[A-Z_]+)/g)].map(match => match[1])
  assert.deepEqual(sequence, [
    'SQL_INSERT_QUEUE_RESTORE_SNAPSHOT',
    'SQL_DELETE_MUSIC_INFO_BY_LIST_ID',
    'SQL_DELETE_MUSIC_ORDER_BY_LIST_ID',
    'SQL_INSERT_MUSIC_INFO',
    'SQL_INSERT_MUSIC_ORDER',
  ], '写回的语句顺序必须与 dbHelper.ts:337-349 一致（先条件插快照，再两张表全删，再按 order 逐条插）')
  // ⚠️ 快照那一句必须在**第一条 DELETE 之前**、且在条件里（"仅在不存在时"）。
  assert.ok(
    body.indexOf('execSQL(SQL_INSERT_QUEUE_RESTORE_SNAPSHOT') < body.indexOf('execSQL(SQL_DELETE_MUSIC_INFO_BY_LIST_ID'),
    '快照必须在两条 DELETE **之前**插入：它记的是合并前的身份（放到后面记的就是合并后的了）',
  )
  assert.match(body, /if \(!hasQueueRestoreSnapshot\(db\)\) \{\s*db\.execSQL\(\s*SQL_INSERT_QUEUE_RESTORE_SNAPSHOT,/)
  // 存在性检查走的是 rawQuery + moveToFirst（只判行在不在，与桌面 `!await getPlaybackQueueRestoreSnapshot()` 同形）。
  assert.match(code, /db\.rawQuery\(\s*SQL_SELECT_QUEUE_RESTORE_SNAPSHOT,\s*new String\[\] \{ QUEUE_RESTORE_SNAPSHOT_KEY \}\s*\)/)
  assert.match(code, /return cursor\.moveToFirst\(\);/)
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
 *   <li>{@code db_info} 的**第三张表**（{@code field_name} / {@code field_value}）与那一句
 *       {@code SELECT "field_value" FROM "main"."db_info" WHERE "field_name"=?}
 *       —— 第七刀-B 的条件插入要读它（只判行在不在，见 Java 的 {@code hasQueueRestoreSnapshot}）；</li>
 *   <li>五条写语句（DELETE 两张表的 listId / INSERT 两条记录 / INSERT db_info 快照），并记下顺序；</li>
 *   <li>事务：{@code beginTransaction} 拍快照、{@code setTransactionSuccessful} 标记、
 *       {@code endTransaction} 未标记则回滚（与 SQLite 的语义一致）；事务之间**串行**（真 SQLite
 *       的主连接也是同一时刻只跑一个事务）。⚠️ 事务快照**包含第三张表** —— 这正是"快照那一行
 *       也必须跟着回滚"能被本文件证明的原因；</li>
 *   <li>失败注入：第 N 条写语句抛错（{@code failAt}）、提交阶段抛错（{@code failOnEndTransaction}）；</li>
 *   <li>并发闸门（{@code gateEnabled}）：那条 SELECT 会等第二个读者到齐（最多 750ms）——
 *       用来把"两次并发读都读到脏队列"这个交错**确定性地**造出来，见 JS 侧的并发用例。</li>
 * </ul>
 *
 * <p>⚠️ 它**不是** SQLite：列类型、绑定、NULL、并列排序、文件锁、{@code db_info."id"} 的自增
 * 全都没有真实现（这里只存 {@code field_name} / {@code field_value} 两列，不建模主键）。
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

    /** {@code db_info} 的一行（本文件只建模那两列；真表还有一个自增主键 {@code id}）。 */
    public static final class DbInfo {
        public final String fieldName;
        public final String fieldValue;

        DbInfo(String fieldName, String fieldValue) {
            this.fieldName = fieldName;
            this.fieldValue = fieldValue;
        }
    }

    public final List<Info> infos = new ArrayList<>();
    public final List<Order> orders = new ArrayList<>();
    public final List<DbInfo> dbInfos = new ArrayList<>();
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
    private List<DbInfo> txDbInfos = null;
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

    /** 预置一行 {@code db_info}（JS 侧用它造"库里已经有快照"的场景）。 */
    public void addDbInfo(String fieldName, String fieldValue) {
        synchronized (modelLock) { dbInfos.add(new DbInfo(fieldName, fieldValue)); }
    }

    public int modelCount() {
        synchronized (modelLock) { return infos.size(); }
    }

    /** {@code db_info} 的行数（第七刀-B：正常情况下是 0 或 1）。 */
    public int dbInfoCount() {
        synchronized (modelLock) { return dbInfos.size(); }
    }

    /** {@code field_name|field_value}（用来断言快照的内容，不去解析 JSON）。 */
    public List<String> dbInfoRows() {
        synchronized (modelLock) {
            List<String> rows = new ArrayList<>();
            for (DbInfo info : dbInfos) rows.add(info.fieldName + "|" + info.fieldValue);
            return rows;
        }
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
        if (sql.contains("FROM \"main\".\"db_info\"")) {
            // 第七刀-B 的快照存在性检查：只回答"有没有这一行"（列清单与 Java 的那句一致）。
            String fieldName = selectionArgs[0];
            List<String[]> rows = new ArrayList<>();
            synchronized (modelLock) {
                for (DbInfo info : dbInfos) {
                    if (info.fieldName.equals(fieldName)) rows.add(new String[] { info.fieldValue });
                }
            }
            return new FakeCursor(Arrays.asList("field_value"), rows);
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
        boolean dbInfoTable = normalized.contains("\"db_info\"");
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
                if (dbInfoTable) {
                    // 第七刀-B：INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (?, ?)
                    dbInfos.add(new DbInfo((String) bindArgs[0], (String) bindArgs[1]));
                    ops.add("ins-db-info:" + bindArgs[0]);
                } else if (orderTable) {
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
            // ⚠️ 事务快照**必须**包含 db_info：否则"合并失败 ⇒ 快照那一行也回滚"就证明不了
            // （真 SQLite 的事务覆盖同一连接上的所有表）。
            txDbInfos = new ArrayList<>(dbInfos);
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
            txDbInfos = null;
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
            dbInfos.clear();
            dbInfos.addAll(txDbInfos);
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
 *
 * ⚠️ 第十一刀：本替身的**每个 public 成员的签名都逐字核对过**真 org.json（含 {@code throws JSONException}）——
 * 出处是 {@code javap -classpath android-json-0.0.20131108.vaadin1.jar org.json.JSONObject}
 * （真 AOSP org.json 的编译产物）与 AOSP libcore main 的 {@code json/src/main/java/org/json/JSONObject.java}，
 * 两者一致。教训：**替身比真机宽松 = 系统性漏检**（另见 android-list-write-channels.test.cjs 里那条负向用例）。
 * 本类**故意不声明**生产代码没用到、且实现会变得可疑的成员（例如 {@code JSONObject(Map)}、{@code accumulate}）。
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

    /**
     * ⚠️ 第十一刀（替身签名审计）：这里原来叫 keySet()，返回 List&lt;String&gt; —— 那**不是**真 org.json 的成员
     * （AOSP main 里是 Set&lt;String&gt; keySet()，而且是 @SystemApi(client = MODULE_LIBRARIES)，
     * 普通应用拿不到；2013 年的那份 AOSP 里根本没有它）。一个"看起来像真 API"的名字 + 更宽松的返回类型，
     * 会让生产代码调用它时在本机编过、在真机上编不过 —— 正是"替身比真机宽松"那一类漏检。
     * 改成**明显是探针内部工具**的名字：生产代码不可能误用它。
     */
    public List<String> jsonKeySet() { return new ArrayList<>(values.keySet()); }

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
            } else if (key.equals("snapshot")) {
                // 预置一行 db_info（第七刀-B：造"库里已经有快照"的场景）。
                db.addDbInfo(parts[1], parts[2]);
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
        // 第七刀-B：db_info 的行数 + 每一行（field_name|field_value），以及快照那一条语句发了几次。
        report.append("dbInfoCount\t").append(db.dbInfoCount()).append('\n');
        for (String row : db.dbInfoRows()) report.append("dbInfoRow\t").append(row).append('\n');
        report.append("snapshotInserts\t").append(countInserts(db.ops, "ins-db-info:")).append('\n');
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
        builder.append("keys=").append(join(item.jsonKeySet(), ","));
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

    /** 数一数某类写语句发了几次（第七刀-B：快照那一条必须是 0 或 1）。 */
    private static int countInserts(List<String> ops, String prefix) {
        int count = 0;
        for (String op : ops) if (op.startsWith(prefix)) count++;
        return count;
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

test('JSON 替身负向验证：合并探针的六个受检异常入口必须拒绝未处理的调用方', { skip: SKIP_REASON }, () => {
  assertCheckedJsonSignatures(STUBS, [
    ['UncheckedObjectPut', 'new JSONObject().put("name", (Object) "value")'],
    ['UncheckedObjectConstructor', 'new JSONObject("{}")'],
    ['UncheckedObjectGet', 'new JSONObject().get("name")'],
    ['UncheckedObjectGetString', 'new JSONObject().getString("name")'],
    ['UncheckedArrayGet', 'new JSONArray().get(0)'],
    ['UncheckedArrayGetObject', 'new JSONArray().getJSONObject(0)'],
  ])
})

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
/** 场景文件的一行：snapshot（第七刀-B）—— 预置一行 db_info。 */
const snapshotLine = (fieldName, fieldValue) => ['snapshot', fieldName, fieldValue].join('\t')

/** 桌面 `QUEUE_RESTORE_SNAPSHOT_KEY`（`dbHelper.ts:24`）：用例里不重复写死，从源码里读。 */
const SNAPSHOT_KEY = dbHelperTs.match(/QUEUE_RESTORE_SNAPSHOT_KEY = '([^']*)'/)[1]

/**
 * 第七刀-B 的**期望快照文本**：桌面 `index.ts:198` 的
 * `targetList.map(({ id, name, singer }) => ({ id, name, singer }))` + `JSON.stringify(...)`。
 *
 * ⚠️ 入参必须是**去重前**的行（桌面那个 `targetList` 就是去重前读到的全部行）。
 */
const expectedSnapshot = rows => JSON.stringify(rows.map(({ id, name, singer }) => ({ id, name, singer })))

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
        path.join(javaDir, 'RainMusicListWriteLock.java'),
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

  // 2) 语句顺序 = dbHelper.ts:337-349（**先条件插快照** → 两张表全删 → 按 order 逐条插）。
  const expectedOps = [`ins-db-info:${SNAPSHOT_KEY}`, 'del-info', 'del-order']
  kept.forEach(music => expectedOps.push(`ins-info:${music.id}`, `ins-order:${music.id}`))
  assert.deepEqual(first(section, 'ops').split(','), expectedOps,
    '写语句的顺序/条数必须与 dbHelper.ts:337-349 一致（先条件插快照，再两张表全删，再逐条 INSERT info + INSERT order）')

  // 3) 一个事务、一次合并。
  assert.equal(first(section, 'txCount'), '1', '整段写回（含快照）必须只开一个事务')
  assert.equal(first(section, 'writeGroups'), '1')

  // 3b) 第七刀-B：**合并前**的快照 = 去重前的 (id, name, singer) 列表，**只插了一行**。
  assert.equal(first(section, 'snapshotInserts'), '1', '同一次合并里快照只许插一次')
  assert.equal(first(section, 'dbInfoCount'), '1', 'db_info 里只该有这一行快照')
  assert.deepEqual(lines(section, 'dbInfoRow'), [`${SNAPSHOT_KEY}|${expectedSnapshot(joined)}`],
    '快照内容必须是**合并前**的 (id, name, singer) 列表（桌面 index.ts:198），含那些马上被删掉的重复行')
  // 快照里**不许**出现 source / interval / meta（桌面那个 map 只挑三列），也不许出现 listId。
  const snapshotText = lines(section, 'dbInfoRow')[0].slice(SNAPSHOT_KEY.length + 1)
  assert.equal(snapshotText, expectedSnapshot(joined))
  assert.deepEqual(
    JSON.parse(snapshotText).map(record => Object.keys(record)),
    joined.map(() => ['id', 'name', 'singer']),
    '快照里每个元素只有 id / name / singer 三个键（顺序也是这三个）',
  )
  // 它与"返回给渲染层的那份"**不同**：去重前的 6 行 vs 去重后的 3 行。
  assert.equal(JSON.parse(snapshotText).length, joined.length)
  assert.notEqual(JSON.parse(snapshotText).length, kept.length)

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
  assert.match(warns[0], /db_info/, '必须点名 db_info 那份快照（它现在是这次事务的第一步）')
  assert.match(warns[0], /playback_queue_startup_restore/, '必须点名快照的键名')
  assert.match(warns[0], /只在 db_info 里还没有它时插一份/, '必须说清"仅在不存在时"这个条件')
  assert.match(warns[0], /queueStartupRestorePending/, '必须点名"没有那个进程内标志"这处差异')
  assert.ok(!/只读/.test(first(section, 'infoLog')), 'register 的日志不该还说"写回未做"')
  assert.match(first(section, 'infoLog'), /第七刀-A/)
  assert.match(first(section, 'infoLog'), /第七刀-B/)
  assert.ok(!/快照仍未做/.test(first(section, 'infoLog')), 'register 的日志不该还说"快照没做"')
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
  // 第七刀-B：非 default 连 db_info 都不许碰（快照只属于 default 的合并）。
  assert.equal(first(section, 'dbInfoCount'), '0')
  assert.equal(first(section, 'snapshotInserts'), '0')
  assert.deepEqual(lines(section, 'dbInfoRow'), [])
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

test('写回失败（第 4 条写语句就炸）⇒ 整条 ok:false：消息同时点名"读到 N 行成功"与"写回失败"，且事务回滚（**快照也一起回滚**）', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### write-fails',
    ...FAIL_INFOS.map(row => infoLine(...row)),
    ...FAIL_ORDERS.map(row => orderLine(...row)),
    'failKind\tnone',
    'failAt\t4', // 快照 INSERT(1) → del-info(2) → del-order(3) → 第一条 INSERT info(4) 抛错
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['write-fails']
  assert.equal(first(section, 'result'), 'error', '写回失败必须让整条调用失败（不许返回去重后的列表）')
  assert.equal(first(section, 'errorClass'), 'java.lang.IllegalStateException')
  const message = first(section, 'errorMessage')

  // 六件必须点名的事：读到 N 行成功 / 写回失败 / 已回滚 / 库仍是 N 行 / 快照那一句在回滚集合里 / 原始异常。
  assert.match(message, /读到 4 行成功/)
  assert.match(message, /写回失败/)
  assert.match(message, /已回滚/)
  assert.match(message, /库仍是写回前的 4 行/)
  assert.match(message, /注入的写失败/)
  assert.match(message, /不会\*\*吞掉写回错误/)
  // 第七刀-B：快照那一句已经发出（它在两条 DELETE 之前）⇒ 消息必须说它也在回滚集合里。
  assert.match(message, /快照 INSERT/)
  assert.match(message, new RegExp(SNAPSHOT_KEY))
  assert.ok(!/本次\*\*没有\*\*发出快照 INSERT/.test(message), '快照已经发过了，消息不许说没发')
  // 它**不许**被包成"读失败"（那正是第六刀当时不肯做写回的理由）。
  assert.ok(!message.includes('读 "my_list_music_info" 失败'), `写回失败不能被误报成读失败：${message}`)

  // 事务回滚：库里仍是写回前的 4 行，且顺序/内容一个字节都没变。
  assert.equal(first(section, 'modelCount'), '4')
  assert.deepEqual(
    lines(section, 'modelRow'),
    FAIL_INFOS.map(([id, , name, singer, source, interval, meta], index) =>
      [id, index, JSON.stringify(JSON.parse(meta)), name, singer, source, interval ?? '-'].join('|')),
  )
  // ⚠️ 第七刀-B 的关键：**不留脏快照**（快照 INSERT 明明已经发出去了，回滚必须把它一起撤掉）。
  assert.equal(first(section, 'snapshotInserts'), '1', '快照那一句确实发出去了（否则这条断言证明不了什么）')
  assert.equal(first(section, 'dbInfoCount'), '0', '合并失败 ⇒ 快照那一行必须跟着回滚，不留脏快照')
  assert.deepEqual(lines(section, 'dbInfoRow'), [])

  assert.equal(first(section, 'txCount'), '1', '失败路径也必须只开一个事务（那次事务负责回滚）')
  assert.deepEqual(lines(section, 'warn'), [], '失败不该同时又打一条"已写回"的 warn（那会让 logcat 说谎）')
})

test('快照那一句自己失败（第 1 条写语句就炸）⇒ 整次合并失败：行一行都没动、db_info 里也没有留下快照', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### snapshot-fails',
    ...FAIL_INFOS.map(row => infoLine(...row)),
    ...FAIL_ORDERS.map(row => orderLine(...row)),
    'failKind\tnone',
    'failAt\t1', // 第 1 条写语句就是快照 INSERT
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['snapshot-fails']
  assert.equal(first(section, 'result'), 'error',
    '快照插入失败必须让整次合并失败（同一事务 ⇒ 一起回滚；与桌面 dbHelper.ts:337-339 位置相同）')
  const message = first(section, 'errorMessage')
  assert.match(message, /读到 4 行成功/)
  assert.match(message, /写回失败/)
  assert.match(message, /已回滚/)
  assert.match(message, /库仍是写回前的 4 行/)
  assert.match(message, /注入的写失败/)
  // 失败发生在快照那一句上 ⇒ 消息必须如实说"本次没有发出快照 INSERT"，而不是硬说它在回滚集合里。
  assert.match(message, /本次\*\*没有\*\*发出快照 INSERT/)
  // 库：一行都没动（连 DELETE 都没轮到），db_info 里也没有快照。
  assert.equal(first(section, 'modelCount'), '4')
  assert.deepEqual(
    lines(section, 'modelRow'),
    FAIL_INFOS.map(([id, , name, singer, source, interval, meta], index) =>
      [id, index, JSON.stringify(JSON.parse(meta)), name, singer, source, interval ?? '-'].join('|')),
  )
  assert.equal(first(section, 'writeGroups'), '0', '连 del-info 都没发出去')
  assert.equal(first(section, 'dbInfoCount'), '0')
  assert.equal(first(section, 'snapshotInserts'), '0')
  assert.equal(first(section, 'txCount'), '1', '事务已经开了（快照那句就在里面），由它回滚')
  assert.deepEqual(lines(section, 'warn'), [])
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
  assert.ok(!/db_info 里也不会留下半份快照/.test(message), '提交阶段失败时同样不能声称"没有留下脏快照"')
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
    `ins-db-info:${SNAPSHOT_KEY}`,
    'del-info', 'del-order', 'ins-info:c-1', 'ins-order:c-1', 'ins-info:c-3', 'ins-order:c-3',
  ])
  assert.equal(first(section, 'modelCount'), '2')
  // 第七刀-B 的并发要求：同一次合并里快照只插一次（两把读被锁排成先后 ⇒ 后到的看见快照就跳过）。
  assert.equal(first(section, 'snapshotInserts'), '1', '并发下快照也只许插一行')
  assert.equal(first(section, 'dbInfoCount'), '1')
  // 写进去的是"第一次读到的合并前列表"（顺序 = 那一次 SELECT 的行序，含那条重复的 c-2）。
  assert.deepEqual(
    lines(section, 'dbInfoRow'),
    [`${SNAPSHOT_KEY}|${expectedSnapshot([
      { id: 'c-1', name: 'Song', singer: 'Singer' },
      { id: 'c-2', name: 'song', singer: 'singer' },
      { id: 'c-3', name: 'Other', singer: 'X' },
    ])}`],
  )
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
  assert.equal(first(section, 'dbInfoCount'), '0', '读失败时连快照都不该写（那一句在写回事务里）')
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
  // 第七刀-B：快照取的是"读到的行"（含被删掉的 n-2），**不是**合并后的那一行。
  assert.deepEqual(
    lines(section, 'dbInfoRow'),
    [`${SNAPSHOT_KEY}|${expectedSnapshot([
      { id: 'n-1', name: 'Song', singer: 'Singer' },
      { id: 'n-2', name: 'song', singer: 'singer' },
    ])}`],
    'NULL 列不影响快照：它是合并前的 (id,name,singer) 列表（两行都在）',
  )
  assert.equal(first(section, 'snapshotInserts'), '1')
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
  // 第七刀-B：180 行的语料上，快照也必须等于"去重前的 (id,name,singer) 列表"。
  // ⚠️ 这里比的是 **JSON 语义**（不是文本）：语料里有全角/中日文/不间断空格，JS 与 org.json 的
  // 转义取舍在文本层面不保证逐字节相同（见 Java 类注释「未验证」第 1 条）。
  assert.equal(first(section, 'snapshotInserts'), '1')
  assert.equal(first(section, 'dbInfoCount'), '1')
  const snapshotRow = lines(section, 'dbInfoRow')[0]
  assert.ok(snapshotRow.startsWith(`${SNAPSHOT_KEY}|`), snapshotRow)
  assert.deepEqual(
    JSON.parse(snapshotRow.slice(SNAPSHOT_KEY.length + 1)),
    JSON.parse(expectedSnapshot(joined)),
    '快照必须等于去重前的 (id,name,singer) 列表（顺序也算）',
  )
})

// ---------------------------------------------------------------------------
// 7. 第七刀-B：快照的"仅在不存在时"（条件的那一半）
// ---------------------------------------------------------------------------

/**
 * 这一组的语料与上面同一批失败用例（4 行 1 条重复），只多一件事：**预置一行 db_info**。
 *
 * 它要证明的是 {@code !hasQueueRestoreSnapshot(db)} 那个条件真的在生效：
 * 库里已经有快照 ⇒ **不再插**、也**不覆盖**（桌面 `dbHelper.ts:337` 的
 * `!await getPlaybackQueueRestoreSnapshot()`；本文件用"库里有没有"代替 `queueStartupRestorePending`）。
 */
test('db_info 里已经有快照 ⇒ 这次合并不插第二份、也不覆盖已有那一行（条件的那一半）', { skip: SKIP_REASON }, () => {
  const existing = JSON.stringify([{ id: 'old-1', name: 'Old', singer: 'Previous' }])
  const report = runScenarios([
    '### snapshot-exists',
    ...FAIL_INFOS.map(row => infoLine(...row)),
    ...FAIL_ORDERS.map(row => orderLine(...row)),
    snapshotLine(SNAPSHOT_KEY, existing),
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['snapshot-exists']
  assert.equal(first(section, 'result'), 'ok', `合并不该失败：${optionalFirst(section, 'errorMessage')}`)
  // 合并本身照旧发生（去重 + 写回），只是不再写快照。
  assert.equal(first(section, 'writeGroups'), '1')
  assert.equal(first(section, 'modelCount'), '3')
  assert.deepEqual(first(section, 'ops').split(','), [
    'del-info', 'del-order',
    'ins-info:f-1', 'ins-order:f-1', 'ins-info:f-3', 'ins-order:f-3', 'ins-info:f-4', 'ins-order:f-4',
  ], '已经有快照 ⇒ 写语句里**不该**有 ins-db-info')
  // 关键：快照还是原来那一行（既没重复、也没被这次合并的身份覆盖）。
  assert.equal(first(section, 'snapshotInserts'), '0')
  assert.equal(first(section, 'dbInfoCount'), '1')
  assert.deepEqual(lines(section, 'dbInfoRow'), [`${SNAPSHOT_KEY}|${existing}`])
})

test('db_info 里别的键（version 行）不算"已经有快照"⇒ 该插还是要插（条件是按 field_name 判的）', { skip: SKIP_REASON }, () => {
  const report = runScenarios([
    '### snapshot-other-key',
    ...FAIL_INFOS.map(row => infoLine(...row)),
    ...FAIL_ORDERS.map(row => orderLine(...row)),
    snapshotLine('version', '4'), // 真实的库里就有这一行（migrate.ts:86-108 读它）
    'failKind\tnone',
    'failAt\t0',
    'gate\tfalse',
    'listId\tdefault',
  ])
  const section = report['snapshot-other-key']
  assert.equal(first(section, 'result'), 'ok', `合并不该失败：${optionalFirst(section, 'errorMessage')}`)
  assert.equal(first(section, 'snapshotInserts'), '1', 'version 行不是快照 ⇒ 这一次必须插')
  assert.equal(first(section, 'dbInfoCount'), '2')
  assert.deepEqual(lines(section, 'dbInfoRow').sort(), [
    `${SNAPSHOT_KEY}|${expectedSnapshot(FAIL_INFOS.map(([id, , name, singer]) => ({ id, name, singer })))}`,
    'version|4',
  ].sort(), 'version 行必须原样留着，快照另起一行')
})
