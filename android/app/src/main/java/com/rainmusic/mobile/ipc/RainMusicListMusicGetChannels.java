package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.Logger;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

/**
 * Reads song records and repairs duplicate default-queue identities atomically.
 * While startup restoration is pending, repair records the pre-merge identities in
 * db_info in the same transaction. RainMusicDataChannels persists the resolved
 * position before acknowledging that snapshot. Completion suppresses future
 * startup snapshots for this process; dirty queue repair remains enabled.
 * Default reads and all list mutations share RainMusicListWriteLock.LOCK.
 */
public final class RainMusicListMusicGetChannels {

    /**
     * {@code player_list_music_get}：键名 {@code list_music_get}
     * （{@code src/common/ipcNames.ts:37} 的 {@code PLAYER_EVENT_NAME.list_music_get}）
     * + 模块前缀 {@code player}（生成规则 {@code ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_MUSIC_GET = "player_list_music_get";

    /**
     * 读某个歌单里的歌曲。逐字抄 {@code src/main/worker/dbService/modules/list/statements.ts:68-78} 的
     * {@code createMusicInfoQueryStatement()}，只把具名参数 {@code @listId} 换成位置参数 {@code ?}
     * （出现**两次**，绑定顺序见 {@link #readListMusics(Context, String, boolean)}）。
     *
     * <p>列清单、表名写法（{@code my_list_music_info mInfo} 无 {@code "main".} 前缀）、
     * {@code LEFT JOIN} 的 {@code ON mInfo.id=O.musicInfoId AND O.listId=?}、
     * {@code WHERE mInfo.listId=?}、以及那句 {@code ORDER BY O."order" ASC} 一字不改。
     * <b>没有</b> {@code DISTINCT} / {@code LIMIT} / rowid 兜底（见类注释「SQL」）。
     */
    static final String SQL_MUSIC_BY_LIST_ID = """
        SELECT mInfo."id", mInfo."name", mInfo."singer", mInfo."source", mInfo."interval", mInfo."meta"
        FROM my_list_music_info mInfo
        LEFT JOIN my_list_music_info_order O
        ON mInfo.id=O.musicInfoId AND O.listId=?
        WHERE mInfo.listId=?
        ORDER BY O."order" ASC
        """;

    /**
     * 写回第 1 步：删掉这个歌单在 {@code my_list_music_info} 里的**全部**行。
     * 逐字抄 {@code statements.ts:117-120} 的 {@code createMusicInfoDeleteByListIdStatement()}
     * （{@code DELETE FROM "main"."my_list_music_info" WHERE "listId"=?}）。
     */
    static final String SQL_DELETE_MUSIC_INFO_BY_LIST_ID = """
        DELETE FROM "main"."my_list_music_info" WHERE "listId"=?
        """;

    /**
     * 写回第 2 步：删掉这个歌单在 {@code my_list_music_info_order} 里的**全部**行。
     * 逐字抄 {@code statements.ts:190-193} 的 {@code createMusicInfoOrderDeleteByListIdStatement()}。
     */
    static final String SQL_DELETE_MUSIC_ORDER_BY_LIST_ID = """
        DELETE FROM "main"."my_list_music_info_order" WHERE "listId"=?
        """;

    /**
     * 写回第 3 步之一：插回**存活**的每一行。逐字抄 {@code statements.ts:84-89} 的
     * {@code createMusicInfoInsertStatement()}，列清单与列顺序（{@code id, listId, name, singer,
     * source, interval, meta}）一字不改 —— 绑定数组必须按这个顺序给。
     */
    static final String SQL_INSERT_MUSIC_INFO = """
        INSERT INTO "main"."my_list_music_info" ("id", "listId", "name", "singer", "source", "interval", "meta")
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """;

    /**
     * 写回第 3 步之二：给每一行插一条顺序记录。逐字抄 {@code statements.ts:170-175} 的
     * {@code createMusicInfoOrderInsertStatement()}（{@code listId, musicInfoId, order}）。
     */
    static final String SQL_INSERT_MUSIC_ORDER = """
        INSERT INTO "main"."my_list_music_info_order" ("listId", "musicInfoId", "order")
        VALUES (?, ?, ?)
        """;

    /**
     * 写回**第 0 步之一**（第七刀-B）：查"这份快照是否已经在 {@code db_info} 里"。
     * 抄 {@code dbHelper.ts:28} 的 {@code getPlaybackQueueRestoreSnapshot} 那一句
     * （{@code SELECT field_value FROM db_info WHERE field_name = ?}），列/表与
     * {@code tables.ts:120-127} 的 {@code db_info} 对齐、与同包的
     * {@code RainMusicDatabase.SQL_INSERT_SCHEMA_VERSION} 用同一套限定符与引号写法。
     *
     * <p>⚠️ 本文件**只判行在不在**，**不**把 {@code field_value} 解析成 JSON ——
     * 理由与差异见类注释「快照」（桌面会解析并校验，坏值让整次合并失败）。
     */
    static final String SQL_SELECT_QUEUE_RESTORE_SNAPSHOT = """
        SELECT "field_value" FROM "main"."db_info" WHERE "field_name"=?
        """;

    /**
     * 写回**第 0 步之二**（第七刀-B）：插入"合并前身份快照"那一行。
     * 抄 {@code dbHelper.ts:338} 的 {@code INSERT INTO db_info (field_name, field_value) VALUES (?, ?)}。
     *
     * <p>列清单（{@code "field_name"}、{@code "field_value"}）与列顺序逐字对齐
     * {@code tables.ts:120-127} 的 {@code db_info}；**不碰**自增主键 {@code "id"}（与桌面一样让库自己填）。
     */
    static final String SQL_INSERT_QUEUE_RESTORE_SNAPSHOT = """
        INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (?, ?)
        """;

    /** {@code player_list_music_get} 的参数名（契约 :107：{@code listId: string}，裸字符串）。 */
    private static final String FIELD_LIST_ID = "listId";

    /**
     * 默认播放队列的 id（{@code src/common/constants.ts} 的 {@code LIST_IDS.DEFAULT === 'default'};
     * 与 {@code RainMusicDataChannels} 的同名常量同一个值）。
     *
     * <p>为什么这条通道需要知道它：桌面**只**在 {@code default} 上去重（含写回），
     * 所以"合并 + 写库"这件事只可能发生在它身上。
     */
    private static final String LIST_ID_DEFAULT = "default";

    /** {@code my_list_music_info} 的列名（{@code tables.ts:139-150}），与 SQL 的列清单一一对应。 */
    private static final String COLUMN_ID = "id";
    private static final String COLUMN_NAME = "name";
    private static final String COLUMN_SINGER = "singer";
    private static final String COLUMN_SOURCE = "source";
    private static final String COLUMN_INTERVAL = "interval";
    private static final String COLUMN_META = "meta";

    /**
     * {@code my_list_music_info_order}（{@code tables.ts:157-163}）—— 本通道只用在
     * 写回语句、{@code LEFT JOIN} 与日志消息里。
     *
     * <p>它**故意**是本地常量：{@link RainMusicDatabase} 里没有这张表的公开常量，而本仓库的规矩是
     * **老文件冻结**（第四 / 第五 / 第六刀的文件各管各的）。{@code RainMusicDatabase} 里那张表的 DDL
     * （{@code DDL_MY_LIST_MUSIC_INFO_ORDER}）才是结构的唯一出处，这里只放名字。
     */
    private static final String TABLE_MY_LIST_MUSIC_INFO_ORDER = "my_list_music_info_order";

    /**
     * 合并前身份快照在 {@code db_info} 里的 {@code field_name}。**逐字**抄
     * {@code dbHelper.ts:24} 的 {@code QUEUE_RESTORE_SNAPSHOT_KEY = 'playback_queue_startup_restore'}
     * —— 键名对不上就等于"没有快照"，而这是一份**跨 worker** 的持久数据。
     *
     * <p>它不引用 {@link RainMusicDatabase} 的常量：那个类里没有这个键（只有 {@code version}）。
     */
    private static final String QUEUE_RESTORE_SNAPSHOT_KEY = "playback_queue_startup_restore";

    /**
     * {@code db_info} 的两个列名（{@code tables.ts:120-127}）**只出现在上面那句 SQL 的文本里**，
     * 刻意不做成常量：{@link RainMusicDatabase} 里已有一份（{@code COLUMN_FIELD_NAME} /
     * {@code COLUMN_FIELD_VALUE}，同一个值），而"工具常量拼出来的 SQL"会让本机用例没法直接比对这一句
     * （同库 {@code SQL_INSERT_SCHEMA_VERSION} 的注释里写着同一条理由）。
     */

    /**
     * {@code default} 去重写回的锁别名（理由见类注释「并发」）。
     *
     * <p>它保护的是 {@link #getListMusics} 里 {@code default} 分支的**整段**
     * "SELECT → 判重 → DELETE ×2 → INSERT ×2N → setTransactionSuccessful"，
     * 不保护非 default 的读（那些没有 read-modify-write）。monitor 与歌曲新增及歌单写通道共用，
     * 避免合并读到旧快照后覆盖刚插入的歌，或在歌单删除后把旧歌曲写回。
     * ⚠️ 它与 {@link RainMusicStoreLock#WRITE_LOCK}（SharedPreferences）**没有**任何关系。
     */
    private static final Object DEFAULT_QUEUE_MERGE_LOCK = RainMusicListWriteLock.LOCK;
    private static boolean queueStartupRestorePending = true;
    static void finishStartupRestore() { queueStartupRestorePending = false; }
    static JSONArray defaultQueue(Context context) {
        return (JSONArray) getListMusics(context, Collections.singletonList("default"));
    }

    /**
     * 合并成功那条警告的节流窗口（毫秒）。取 60 秒：队列修好之后就不会再进这一支
     * （下一次读没有重复），这个窗口只在"还有别的写者反复把队列弄脏"时起作用。
     */
    private static final long QUEUE_MERGED_WARN_WINDOW_MS = 60_000L;

    /**
     * "已去重并写回"那条警告的节流闸门（{@link RainMusicLogThrottle} 是线程安全的）。
     *
     * <p>签名 = {@code listId | 行数 | 重复数 | 前几条重复的键}（见 {@link #queueMergedSignature}）。
     */
    private static final RainMusicLogThrottle QUEUE_MERGED_WARN =
        new RainMusicLogThrottle(QUEUE_MERGED_WARN_WINDOW_MS);

    /**
     * "meta 列是 NULL"那条警告的节流闸门 —— 与上面那条**分开**计数：两件事互不相干，
     * 共用一个闸门会让后发生的那件事被前一件的窗口吃掉。
     *
     * <p>为什么要节流：{@code meta} 是 {@code TEXT NOT NULL}，出现 NULL 说明那一行被写坏了；
     * 坏行**每次读都会命中**，不节流就是每次读都刷一条。
     */
    private static final RainMusicLogThrottle META_NULL_WARN =
        new RainMusicLogThrottle(QUEUE_MERGED_WARN_WINDOW_MS);

    /** 警告里最多列几条重复样例（再多就把 logcat 淹了）。 */
    private static final int QUEUE_MERGED_WARN_EXAMPLES = 3;
    /** 警告里每个字段最长打多少字符（人名/曲名可能极长，logcat 一条有上限）。 */
    private static final int QUEUE_MERGED_WARN_FIELD_LIMIT = 40;

    private static final String TAG = "RainMusicListMusicGet";

    private RainMusicListMusicGetChannels() {}

    /**
     * 注册这一条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 {@code setEmitter}、
     * 第一刀到第六刀的 {@code register} 同一处、同一时序理由：必须在渲染层第一次 invoke 之前完成，
     * 否则真机上就是 {@code IPC_CHANNEL_UNSUPPORTED}）。
     *
     * <p>与前面几刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicListMusicGetChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_MUSIC_GET, (args, ctx) -> getListMusics(requireContext(plugin), args));
        // ⚠️ 这里**只打表名**、不调 getDatabasePath()：load() 阶段 Context 可能还没有
        // （所以 Context 一律留到 handler 调用时再取）。绝对路径由 open() 在真机上打进错误信息。
        Logger.info(
            TAG,
            "P0-2 第七刀-A + 第七刀-B（快照）：已注册 " + CHANNEL_MUSIC_GET + "（落点 " + RainMusicDatabase.DATABASE_NAME +
            " 的 \"" + RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + "\" 表 LEFT JOIN \"" +
            TABLE_MY_LIST_MUSIC_INFO_ORDER + "\" 表，schema 版本 " +
            RainMusicDatabase.SCHEMA_VERSION_TEXT + "；\"" + LIST_ID_DEFAULT +
            "\" 检出重复时会在**同一个事务**里去重写回（第一步 = 条件插入 \"" + QUEUE_RESTORE_SNAPSHOT_KEY +
            "\" 合并前身份快照，然后 DELETE ×2 + INSERT ×2N），其它 listId 一律纯读；" +
            "playInfo 的身份恢复、持久确认与快照清理由 RainMusicDataChannels 完成）"
        );
    }

    // ------------------------------------------------------------------ 通道实现

    /**
     * {@code player_list_music_get}：读某个歌单里的歌曲（含 {@code meta} 的对象化），
     * 并在 {@code default} 上做去重合并 + 单事务写回。
     *
     * @param args {@code args[0]} = {@code listId}（裸字符串，**不是** {@code {listId}}，契约 :107）
     * @return 一个 {@link JSONArray}，元素形状 = {@code Rain.Music.MusicInfo}
     *         （{@code id/name/singer/source/interval/meta} 六个键，{@code meta} 是**对象**）；
     *         这个歌单是空的（或没有这个歌单）时是**空数组**（那才是"空"的正确取值）；
     *         {@code default} 上有重复并写回成功时，是**去重后的**那一份（与桌面 :201 同形）
     * @throws IllegalArgumentException 参数不是字符串 / 缺参数
     * @throws IllegalStateException    库打不开 / 表缺失 / 查询失败 / meta 坏 / **写回失败**
     *                                  （全都不返回"看起来成功"的东西）
     */
    private static Object getListMusics(Context context, List<Object> args) {
        String listId = readBareString(args, CHANNEL_MUSIC_GET);

        if (listId == null) {
            // 桌面把 null 绑成 SQL NULL ⇒ `WHERE mInfo.listId=NULL` 恒不成立 ⇒ []。
            // 这里直接给同一个值，不去绑 NULL（Android 的 String[] 绑定不接受 null 元素，
            // 理由与第五刀 RainMusicListMusicChannels 的 readBareString 注释同款）。
            Logger.debug(
                TAG,
                CHANNEL_MUSIC_GET + "：listId 是 null ⇒ 直接返回 []" +
                "（与桌面把 null 绑成 SQL NULL 的结果逐字等价；本通道不把 null 当参数错误）"
            );
            return new JSONArray();
        }

        if (!LIST_ID_DEFAULT.equals(listId)) {
            // 普通歌单 / temp：与第六刀**逐字相同**的纯读路径 —— 不进锁、不判重、一条写语句都不发。
            return readListMusics(context, listId, false);
        }

        // default：整段 read-modify-write 在这把专用锁里（见类注释「并发」）。
        // 临界区必须从 SELECT 之前开始，否则两次并发读会各自读到脏队列、各自写一遍。
        synchronized (DEFAULT_QUEUE_MERGE_LOCK) {
            return readListMusics(context, listId, true);
        }
    }

    /**
     * 读一个歌单的全部行，并按需在 {@code default} 上做去重写回。
     *
     * @param mergeDefaultQueue {@code true} ⇒ 读完之后判重、必要时在**同一个事务**里写回
     *                          （第一步 = 条件插入合并前快照），并返回去重后的列表；
     *                          {@code false} ⇒ 纯读（第六刀的行为）
     */
    private static Object readListMusics(Context context, String listId, boolean mergeDefaultQueue) {
        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO);
        List<MusicInfoRow> rows = new ArrayList<>();
        JSONArray musics;
        JSONArray merged = null;
        Set<RainMusicPlaybackQueueKey.MusicRow> dropped = null;
        String restoreSnapshotText = null;
        int duplicateCount = 0;
        Cursor cursor = null;
        try {
            // 绑定顺序 = SQL 里 ? 出现的顺序：先 `ON … O.listId=?`，后 `WHERE mInfo.listId=?`。
            // 两处是**同一个值**（桌面那句 SQL 两处都是 @listId）。
            cursor = db.rawQuery(SQL_MUSIC_BY_LIST_ID, new String[] { listId, listId });

            int idIndex = cursor.getColumnIndexOrThrow(COLUMN_ID);
            int nameIndex = cursor.getColumnIndexOrThrow(COLUMN_NAME);
            int singerIndex = cursor.getColumnIndexOrThrow(COLUMN_SINGER);
            int sourceIndex = cursor.getColumnIndexOrThrow(COLUMN_SOURCE);
            int intervalIndex = cursor.getColumnIndexOrThrow(COLUMN_INTERVAL);
            int metaIndex = cursor.getColumnIndexOrThrow(COLUMN_META);

            while (cursor.moveToNext()) {
                String id = cursor.getString(idIndex);
                rows.add(new MusicInfoRow(
                    id,
                    cursor.getString(nameIndex),
                    cursor.getString(singerIndex),
                    cursor.getString(sourceIndex),
                    // interval 是 string | null（src/common/types/music.d.ts:45）：NULL 要原样留着，
                    // 组装 JSON 时写成 JSON null、写回时绑成 SQL NULL。
                    cursor.getString(intervalIndex),
                    // ⚠️ 每一行都解析（含即将被删掉的重复行）：桌面的 JSON.parse 也是先对**所有**行
                    // 做完 map 才去重的，见类注释「meta」最后一段。
                    parseMeta(id, cursor.getString(metaIndex))
                ));
            }

            musics = toJsonArray(rows, null);

            if (mergeDefaultQueue) {
                List<RainMusicPlaybackQueueKey.MusicRow> keyRows = new ArrayList<>(rows.size());
                for (MusicInfoRow row : rows) keyRows.add(row.keyRow);
                List<RainMusicPlaybackQueueKey.MusicRow> duplicates =
                    RainMusicPlaybackQueueKey.findDuplicates(keyRows);
                if (!duplicates.isEmpty()) {
                    // findDuplicates 返回的是 rows 里**同一个引用** ⇒ 用身份集合筛掉被删的行
                    // （MusicRow 没有 equals，也不该为这件事去改那个类）。
                    dropped = Collections.newSetFromMap(
                        new IdentityHashMap<RainMusicPlaybackQueueKey.MusicRow, Boolean>()
                    );
                    dropped.addAll(duplicates);
                    duplicateCount = duplicates.size();
                    // 合并**前**的身份快照：桌面 index.ts:198 的 targetList.map(({id,name,singer}) => …)
                    // —— targetList 就是刚刚读到的**全部**行（含马上要被删掉的重复行）。
                    // 采集在这里、**插入**在事务里（见 overwriteDefaultQueue）：与桌面
                    // "先造数组、再进 overwriteMusicInfo 的事务"同形。
                    // ⚠️ 组装失败算**读**失败（它就在这个 try 里）：桌面那句 map/JSON.stringify 也在
                    // getListMusics 里、抛出去同样是"这一次读失败"，两边同形。
                    restoreSnapshotText = toRestoreSnapshotText(rows);
                    // 去重后的那一份也在这里组装（仍在"读"这一段的 try 里）：
                    // 组装失败算读失败，而**写回**的失败绝不能落到这个 catch 里
                    // （那会把"写回失败"误报成"读失败"，见 writeBackFailureMessage）。
                    merged = toJsonArray(rows, dropped);
                }
            }
        } catch (IllegalStateException ex) {
            // 目前这一支只可能来自 parseMeta（消息里已经点名是哪首歌、meta 长什么样），
            // 再包一层"读 my_list_music_info 失败"只会把真正的原因埋掉。
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException(
                readFailureMessage(SQL_MUSIC_BY_LIST_ID, ex) +
                "本通道**不会**返回空数组假装「这个歌单是空的」。",
                ex
            );
        } finally {
            if (cursor != null) cursor.close();
        }

        if (dropped == null) {
            // 没有重复（或非 default）⇒ 一条写语句都不发。这正是第六刀的行为。
            return musics;
        }

        // 写回。它**不在**上面那个 try 里：失败必须以"写回失败"的面目抛出去，而不是被
        // readFailureMessage 包成"读失败"。
        List<MusicInfoRow> kept = new ArrayList<>(rows.size() - duplicateCount);
        for (MusicInfoRow row : rows) {
            if (!dropped.contains(row.keyRow)) kept.add(row);
        }
        overwriteDefaultQueue(db, listId, kept, rows.size(), duplicateCount, restoreSnapshotText);

        // 写回**成功之后**才说话（失败会抛出去，由那条异常点名两半）。
        warnQueueMerged(listId, rows.size(), kept.size(), dropped);

        // 返回去重后的那一份（桌面 :201 的 targetList = merged）。
        return merged;
    }

    // ------------------------------------------------------------------ 写回（第七刀-A + 第七刀-B 的快照）

    /**
     * 把去重后的列表写回库：桌面 {@code dbHelper.ts:337-349} 的**四步**，全部在同一个事务里。
     *
     * <pre>
     * beginTransaction()
     *   if (!hasQueueRestoreSnapshot(db))                                     ← 条件（:337 的后半句）
     *     INSERT INTO db_info (field_name, field_value)                       ← :338
     *       VALUES ('playback_queue_startup_restore', 合并前的 (id,name,singer) 列表)
     *   DELETE FROM "main"."my_list_music_info"       WHERE "listId"=?         ← :340
     *   DELETE FROM "main"."my_list_music_info_ORDER" WHERE "listId"=?         ← :341
     *   for (order = 0 …) { INSERT info; INSERT order }                        ← :342-349
     * setTransactionSuccessful()
     * endTransaction()          ← 未标记成功 ⇒ 整体回滚（快照那一行也一起回滚）
     * </pre>
     *
     * <p>快照那一步在两条 DELETE **之前**：它记的是**合并前**的状态
     * （内容由 {@link #toRestoreSnapshotText(List)} 在进事务之前从刚读到的 {@code rows} 采集）。
     * 只在本进程启动恢复仍待确认且 db_info 没有快照时插入。
     *
     * @param restoreSnapshotText 合并前的 {@code (id, name, singer)} 列表的 JSON 文本；
     *                            调用方在 {@code duplicates} 非空时必定给出（非 null）
     * @throws IllegalStateException 任何一步失败（含快照那一句、含 {@code endTransaction()} 的提交失败）。
     *                               消息由 {@link #writeBackFailureMessage} 组装，同时点名两半
     */
    private static void overwriteDefaultQueue(
        SQLiteDatabase db,
        String listId,
        List<MusicInfoRow> kept,
        int readCount,
        int duplicateCount,
        String restoreSnapshotText
    ) {
        // 记"事务是否已经标记成功"：用于区分"回滚"（未标记成功时 endTransaction 一定回滚）
        // 与"提交阶段失败"（已标记成功之后 endTransaction 才抛）—— 后者本通道**不能**声称库还是 N 行。
        boolean commitStarted = false;
        // 快照那一行是否**已经写进事务**（用于让失败消息如实点名"回滚集合里有没有它"）。
        // ⚠️ 只在 execSQL 返回之后才置 true：它抛错时那一行并没有落进事务。
        boolean snapshotInserted = false;
        try {
            db.beginTransaction();
            try {
                // 第 0 步（第七刀-B）：条件插入"合并前身份快照"。
                // 必须在两条 DELETE **之前** —— 快照记的是合并前的行序与身份
                // （内容已经在锁内、进事务之前从刚读到的 rows 采集好，见 restoreSnapshotText）。
                if (queueStartupRestorePending && !hasQueueRestoreSnapshot(db)) {
                    db.execSQL(
                        SQL_INSERT_QUEUE_RESTORE_SNAPSHOT,
                        new Object[] { QUEUE_RESTORE_SNAPSHOT_KEY, restoreSnapshotText }
                    );
                    snapshotInserted = true;
                }
                db.execSQL(SQL_DELETE_MUSIC_INFO_BY_LIST_ID, new Object[] { listId });
                db.execSQL(SQL_DELETE_MUSIC_ORDER_BY_LIST_ID, new Object[] { listId });
                for (int order = 0; order < kept.size(); order++) {
                    MusicInfoRow row = kept.get(order);
                    db.execSQL(SQL_INSERT_MUSIC_INFO, row.insertArgs(listId));
                    // order = 去重后列表里的下标（桌面 toDBMusicInfo 的 `order: offset + index`，offset 默认 0）。
                    db.execSQL(SQL_INSERT_MUSIC_ORDER, new Object[] { listId, row.id, order });
                }
                db.setTransactionSuccessful();
                commitStarted = true;
            } finally {
                // 无论上面怎么退出：未 setTransactionSuccessful ⇒ 回滚；已标记 ⇒ 提交。
                db.endTransaction();
            }
        } catch (Exception ex) {
            throw new IllegalStateException(
                writeBackFailureMessage(
                    listId, readCount, kept.size(), duplicateCount, snapshotInserted, commitStarted, ex
                ),
                ex
            );
        }
    }

    /**
     * {@code db_info} 里是否**已经**有这份播放队列恢复快照（桌面 {@code dbHelper.ts:337} 的
     * {@code !await getPlaybackQueueRestoreSnapshot()} 那一半，也是
     * 启动恢复 pending 判定之外的持久快照存在性检查）。
     *
     * <p>只判"这一行在不在"：{@code moveToFirst()} 为真即可，**不读值、不解析**
     * （差异见类注释「快照」第 2 条）。游标在 {@code finally} 里关（与读歌单那条路径同一形状）。
     *
     * <p>它在**事务里**被调用（{@code overwriteDefaultQueue}）：桌面那一句也在
     * {@code db.transaction} 的函数体里。这样"查在不在 → 插"与 DELETE / INSERT 是同一个原子段，
     * 同一个进程里的并发合并被 {@link #DEFAULT_QUEUE_MERGE_LOCK} 排成先后两次 ⇒ 快照只插一次。
     *
     * @throws RuntimeException 查询本身失败（列漂移 / 表缺失 / 游标异常）——
     *                          与桌面一样**不吞**：它会让整次合并失败并一起回滚
     */
    private static boolean hasQueueRestoreSnapshot(SQLiteDatabase db) {
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(
                SQL_SELECT_QUEUE_RESTORE_SNAPSHOT,
                new String[] { QUEUE_RESTORE_SNAPSHOT_KEY }
            );
            return cursor.moveToFirst();
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /**
     * 把**合并前**读到的那些行采集成本次事务要写进 {@code db_info} 的快照文本。
     *
     * <p>形状逐字对齐桌面 {@code index.ts:198}：
     * {@code targetList.map(({ id, name, singer }) => ({ id, name, singer }))} ——
     * 一个**数组**，每个元素**只有这三个键**（不含 {@code source / interval / meta}），
     * 顺序 = 读到的行序，{@code id/name/singer} 都是字符串。桌面把它交给
     * {@code dbHelper.ts:338} 的 {@code JSON.stringify(...)}；这里用 {@code org.json} 的
     * {@link JSONArray#toString()} 得到同形状的文本。
     *
     * @param rows 这一次读到的**全部**行（含马上要被删掉的重复行）
     */
    private static String toRestoreSnapshotText(List<MusicInfoRow> rows) throws JSONException {
        JSONArray snapshot = new JSONArray();
        for (MusicInfoRow row : rows) snapshot.put(row.toSnapshotJson());
        return snapshot.toString();
    }

    /**
     * 写回失败的消息：把"读"和"写"两半分开点名（这是本刀敢做写回的前提，见类注释「失败语义」）。
     *
     * <p>它说的是六件事：读到 N 行**成功** / 写回**失败** / 已回滚 / 库仍是写回前的 N 行 /
     * **快照那一句在不在回滚集合里** / 原始异常。
     *
     * @param snapshotInserted 快照那一行是否真的发出去过（{@code true} ⇒ 它也在这次事务的回滚集合里）
     * @param commitStarted {@code true} ⇒ 失败发生在 {@code setTransactionSuccessful()} 之后的
     *                      {@code endTransaction()} 提交阶段：那时**不能**断言"库仍是 N 行"
     *                      （SQLite 提交失败时通常会回滚，但本通道不在错误路径上再发一次查询去"证明"它
     *                      —— 那会在报告错误时再抛一次）
     */
    private static String writeBackFailureMessage(
        String listId,
        int readCount,
        int keptCount,
        int duplicateCount,
        boolean snapshotInserted,
        boolean commitStarted,
        Exception ex
    ) {
        StringBuilder message = new StringBuilder();
        message.append(CHANNEL_MUSIC_GET).append("：默认播放队列的去重写回失败（\"")
            .append(FIELD_LIST_ID).append("\"=\"").append(listId).append("\"，落点 ")
            .append(RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO).append(" / ")
            .append(TABLE_MY_LIST_MUSIC_INFO_ORDER).append(" / ")
            .append(RainMusicDatabase.TABLE_DB_INFO).append("）。");
        message.append("**读到 ").append(readCount).append(" 行成功**（这一步没有出错；若读失败，")
            .append("走的是另一条消息、根本到不了这里），去重要删掉 ").append(duplicateCount)
            .append(" 条重复、留下 ").append(keptCount).append(" 条，但**写回失败**：")
            .append(describeException(ex)).append("。");
        if (commitStarted) {
            message.append("失败发生在 setTransactionSuccessful() 之后的 endTransaction() 提交阶段：")
                .append("事务**已标记成功**，本通道无法在不追加一次查询的前提下证明库的最终行数")
                .append("（SQLite 提交失败时通常会回滚，但这里不猜）。");
        } else {
            message.append("**已回滚**（未标记成功 ⇒ endTransaction 回滚）。这个事务里的写是：")
                .append(snapshotInserted
                    ? "db_info 的快照 INSERT（\"" + QUEUE_RESTORE_SNAPSHOT_KEY + "\"，在两条 DELETE 之前） + "
                    : "（本次**没有**发出快照 INSERT —— 要么 db_info 里已经有那份快照，要么失败发生在它之前）+ ")
                .append("DELETE ").append(RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO).append(" / DELETE ")
                .append(TABLE_MY_LIST_MUSIC_INFO_ORDER).append(" / INSERT ×2×").append(keptCount)
                .append("，**全部撤销** ⇒ **库仍是写回前的 ").append(readCount).append(" 行**，")
                .append("db_info 里也不会留下半份快照（桌面 tests/unit/playback-queue.test.cjs:212-220 证明同一条）。");
        }
        message.append("本通道**不会**吞掉写回错误、把「读到了但没修好」伪装成一次成功的读：")
            .append("整条调用以 ok:false 结束（IPC_HANDLER_FAILED），渲染层那条 invoke 直接 reject ⇒ ")
            .append("setMusicList 不被调用、不会缓存这份列表（桌面 src/renderer/store/list/listManage/")
            .append("rendererListManage.ts:73-74），下一次读会重新看到同样的重复。")
            .append("吞掉它会让渲染层缓存一份库里并不存在的列表，缓存与库**永久分叉**。");
        return message.toString();
    }

    // ------------------------------------------------------------------ meta

    /**
     * 把 {@code my_list_music_info."meta"}（TEXT）解析成 JSON —— 桌面那一句是
     * {@code meta: JSON.parse(info.meta)}（{@code modules/list/index.ts:192}）。
     *
     * @param musicId 只用于错误消息（点名是哪首歌的 meta 坏了）
     * @param text    库里的文本；{@code null}（列被写坏）⇒ JSON {@code null}
     *                （与 {@code JSON.parse(null)} 等价，见类注释的表）
     * @return 解析出来的 JSON 对象；列是 {@code NULL} 时返回 {@link JSONObject#NULL}
     * @throws IllegalStateException 不是合法 JSON，或者顶层不是对象（**不返回 null 蒙过去**）
     */
    private static Object parseMeta(String musicId, String text) {
        if (text == null) {
            // 与合并警告一样要节流：坏行每次读都会命中（见 META_NULL_WARN 的注释）。
            if (META_NULL_WARN.shouldLog(COLUMN_META + "-null|" + textOrNull(musicId), System.currentTimeMillis())) {
                Logger.warn(
                    TAG,
                    CHANNEL_MUSIC_GET + "：music id=\"" + textOrNull(musicId) + "\" 的 \"" + COLUMN_META +
                    "\" 列是 NULL（表结构是 TEXT NOT NULL，只可能是被人写坏的）。" +
                    "桌面此时是 JSON.parse(null) ⇒ null，本通道同样给 JSON null（不抛错，两边逐字等价）；" +
                    "写回时它会被序列化成 \"null\"（与桌面的 JSON.stringify(null) 一致）。" +
                    "本条警告节流 " + (QUEUE_MERGED_WARN.windowMs() / 1000) + " 秒一次。"
                );
            }
            return JSONObject.NULL;
        }
        try {
            return new JSONObject(text);
        } catch (JSONException ex) {
            throw new IllegalStateException(
                CHANNEL_MUSIC_GET + "：music id=\"" + textOrNull(musicId) + "\" 的 \"" + COLUMN_META +
                "\" 列不是合法的 JSON 对象（长度 " + text.length() + "，前 80 字符=" + preview(text) + "）：" +
                ex.getMessage() +
                "。桌面那一句是 JSON.parse(info.meta)，坏 meta 同样会让**整条读**失败 ⇒ 本通道照抛，" +
                "不会跳过这一行、也不会把它当成一次成功的读（跳过会让「歌单少了几首」看起来像正常结果）。",
                ex
            );
        }
    }

    // ------------------------------------------------------------------ 合并日志

    /**
     * 去重写回**成功之后**打一条点名警告（节流）。
     *
     * <p>第六刀那条"Android 本刀只读、不写回"的警告在这里被**替换**掉了：它现在会说谎
     * （库里已经不是脏的了）。这一条只陈述**已经发生的事**：检出 K 条重复、已去重并写回 N → M 行，
     * 并点名"本刀不含 db_info 快照"（那是唯一还没做的那半）。
     *
     * @param listId  调用方已经确认等于 {@code 'default'}（这里再判一次，防止将来被别处复用）
     * @param readCount  这一次读出来的行数
     * @param keptCount  去重后剩下的行数（= 写回后的行数）
     * @param dropped    会被删掉的那些行（`findDuplicates` 的结果，**同一个引用集合**）
     */
    private static void warnQueueMerged(
        String listId,
        int readCount,
        int keptCount,
        Set<RainMusicPlaybackQueueKey.MusicRow> dropped
    ) {
        if (!LIST_ID_DEFAULT.equals(listId)) return;
        if (dropped == null || dropped.isEmpty()) return;

        // 集合是无序的（IdentityHashMap）⇒ 按**读到的顺序**取样例本来更自然，但这里只需要一个稳定指纹：
        // 排序后取前几条即可（桶顺序对同一个输入稳定，但不同 JVM 不保证，所以显式排序）。
        List<RainMusicPlaybackQueueKey.MusicRow> duplicates = new ArrayList<>(dropped);
        duplicates.sort((left, right) -> left.key().compareTo(right.key()));

        String signature = queueMergedSignature(listId, readCount, duplicates);
        if (!QUEUE_MERGED_WARN.shouldLog(signature, System.currentTimeMillis())) return;

        Logger.warn(
            TAG,
            CHANNEL_MUSIC_GET + "：默认播放队列（\"" + FIELD_LIST_ID + "\"=\"" + LIST_ID_DEFAULT + "\"）里有 " +
            duplicates.size() + " 条重复（共 " + readCount + " 行）：" + describeDuplicates(duplicates) +
            "。已按桌面的规则去重（src/common/utils/playbackQueue.ts:10-22，保留第一条完整记录、不跨源合并 meta）" +
            "并在**同一个事务**里写回：" + readCount + " → " + keptCount + " 行" +
            "（四步对齐 src/main/worker/dbService/modules/list/dbHelper.ts:337-349：第一步 = **条件**插入" +
            " \"" + QUEUE_RESTORE_SNAPSHOT_KEY + "\" 快照（内容 = 合并前的 (id,name,singer) 列表，" +
            "只在 db_info 里还没有它时插一份），然后 DELETE " +
            RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + " / DELETE " + TABLE_MY_LIST_MUSIC_INFO_ORDER +
            " / INSERT ×2×" + keptCount + "）。启动恢复期间 queueStartupRestorePending 为 true，" +
            "只在 db_info 里还没有它时插一份；Preferences 持久确认后删除快照并关闭本进程的启动快照。" +
            "后续重复记录仍然去重写回。本条警告节流 " + (QUEUE_MERGED_WARN.windowMs() / 1000) + " 秒一次。"
        );
    }

    /**
     * 警告的指纹：{@code listId | 行数 | 重复数 | 前 N 条重复的键}。
     *
     * <p>为什么这么取：同一个脏状态被反复命中时签名不变 ⇒ 被节流器挡住；
     * 行数变了、重复数变了、或者换了一批重复的歌 ⇒ 签名变化 ⇒ 立刻再报一条
     * （新的脏状态是新消息，不该被上一个窗口吃掉）。
     */
    private static String queueMergedSignature(
        String listId,
        int total,
        List<RainMusicPlaybackQueueKey.MusicRow> duplicates
    ) {
        StringBuilder builder = new StringBuilder();
        builder.append(listId).append('|').append(total).append('|').append(duplicates.size());
        int examples = Math.min(QUEUE_MERGED_WARN_EXAMPLES, duplicates.size());
        for (int i = 0; i < examples; i++) {
            builder.append('|').append(duplicates.get(i).key());
        }
        return builder.toString();
    }

    /** 最多列 {@link #QUEUE_MERGED_WARN_EXAMPLES} 条重复样例（每条只打 id / name / singer）。 */
    private static String describeDuplicates(List<RainMusicPlaybackQueueKey.MusicRow> duplicates) {
        StringBuilder builder = new StringBuilder();
        int examples = Math.min(QUEUE_MERGED_WARN_EXAMPLES, duplicates.size());
        for (int i = 0; i < examples; i++) {
            if (i > 0) builder.append("；");
            RainMusicPlaybackQueueKey.MusicRow row = duplicates.get(i);
            builder.append("id=").append(quote(row.id))
                .append(" name=").append(quote(row.name))
                .append(" singer=").append(quote(row.singer));
        }
        if (duplicates.size() > examples) {
            builder.append("；…还有 ").append(duplicates.size() - examples).append(" 条");
        }
        return builder.toString();
    }

    /** 日志里的一个字符串字段：{@code null} 打成 {@code null}，过长则截断（logcat 一条有上限）。 */
    private static String quote(String value) {
        if (value == null) return "null";
        return "\"" + (value.length() > QUEUE_MERGED_WARN_FIELD_LIMIT
            ? value.substring(0, QUEUE_MERGED_WARN_FIELD_LIMIT) + "…"
            : value) + "\"";
    }

    private static String textOrNull(String value) {
        return value == null ? "null" : value;
    }

    /** 只用于错误消息的极短预览，且把换行压平（否则 logcat 里一条错误会散成好几行）。 */
    private static String preview(String text) {
        String flat = text.replaceAll("\\s+", " ");
        String quoted = "\"" + (flat.length() > 80 ? flat.substring(0, 80) + "…" : flat) + "\"";
        return quoted;
    }

    /** 原始异常的名字 + 消息（消息可能是 {@code null}）—— 写回失败的消息里必须带上它。 */
    private static String describeException(Exception ex) {
        String message = ex.getMessage();
        return message == null ? ex.getClass().getName() : ex.getClass().getName() + "：" + message;
    }

    // ------------------------------------------------------------------ 一行的模型

    /**
     * 这一次读出来的**一行**：既给它算去重键（{@link #keyRow}），也给它组装 JSON 与写回的值。
     *
     * <p>为什么不用 {@link RainMusicPlaybackQueueKey.MusicRow} 直接当行模型：那个类只装
     * {@code id / name / singer}（去重键需要的三列），而写回需要**整条记录**
     * （{@code source / interval / meta}）—— 桌面的 {@code toDBMusicInfo(merged, listId)} 也是整条写回。
     * 这里组合而不是继承：{@code MusicRow} 是 {@code final}，而且改它就要动
     * {@link RainMusicPlaybackQueueKey}（那个类有真 JVM 的差分用例守着，本刀不动它）。
     */
    private static final class MusicInfoRow {

        final String id;
        final String name;
        final String singer;
        final String source;
        /** {@code interval} 列（{@code string | null}）；写回时 {@code null} ⇒ SQL NULL。 */
        final String interval;
        /** 解析后的 {@code meta}（{@link JSONObject} 或 {@link JSONObject#NULL}；**绝不**是 Java null）。 */
        final Object meta;
        /** 去重键用的三列（与 {@code findDuplicates} 的入参是同一批对象，身份判定依赖这一点）。 */
        final RainMusicPlaybackQueueKey.MusicRow keyRow;

        MusicInfoRow(String id, String name, String singer, String source, String interval, Object meta) {
            this.id = id;
            this.name = name;
            this.singer = singer;
            this.source = source;
            this.interval = interval;
            this.meta = meta;
            this.keyRow = new RainMusicPlaybackQueueKey.MusicRow(id, name, singer);
        }

        /** 桌面的 {@code index.ts:185-194} 那张 map：六个键，**没有** listId / order。 */
        JSONObject toJson() throws JSONException {
            JSONObject item = new JSONObject();
            item.put(COLUMN_ID, jsonValue(id));
            item.put(COLUMN_NAME, jsonValue(name));
            item.put(COLUMN_SINGER, jsonValue(singer));
            item.put(COLUMN_SOURCE, jsonValue(source));
            // interval 是 string | null（src/common/types/music.d.ts:45）：NULL 必须写成 JSON null。
            item.put(COLUMN_INTERVAL, jsonValue(interval));
            // meta 必须是**对象**（桌面那一句是 JSON.parse，见类注释「meta」）。
            item.put(COLUMN_META, meta);
            return item;
        }

        /**
         * 快照里的一个元素：桌面 {@code index.ts:198} 的 {@code ({ id, name, singer }) => ({ id, name, singer })}。
         *
         * <p><b>只有这三个键</b>（与 {@link #toJson()} 的六个键**不同**：{@code source / interval / meta}
         * 不进快照 —— 桌面那个 map 就是只挑三列），顺序也是 {@code id, name, singer}。
         */
        JSONObject toSnapshotJson() throws JSONException {
            JSONObject item = new JSONObject();
            item.put(COLUMN_ID, jsonValue(id));
            item.put(COLUMN_NAME, jsonValue(name));
            item.put(COLUMN_SINGER, jsonValue(singer));
            return item;
        }

        /**
         * 写回时用的 {@code meta} 文本 = 桌面 {@code toDBMusicInfo} 的 {@code JSON.stringify(info.meta)}。
         *
         * <p>{@code String.valueOf} 在两种形态上的行为正是要的：
         * {@link JSONObject} ⇒ 紧凑 JSON 文本；{@link JSONObject#NULL} ⇒ {@code "null"}
         * （与 JS 的 {@code JSON.stringify(null)} 一致）。⚠️ 与 JS 的差别见类注释「语义差异」第 3 条。
         */
        String metaText() {
            return String.valueOf(meta);
        }

        /**
         * {@code SQL_INSERT_MUSIC_INFO} 的绑定数组 —— 顺序必须与那句 SQL 的列清单一致：
         * {@code id, listId, name, singer, source, interval, meta}（{@code statements.ts:87-88}）。
         */
        Object[] insertArgs(String listId) {
            return new Object[] { id, listId, name, singer, source, interval, metaText() };
        }
    }

    /**
     * 把行组装成 JSON 数组；{@code dropped} 非空时跳过（身份判定）那些被去重删掉的行。
     *
     * @param dropped {@code null} ⇒ 全部保留（纯读）；否则只保留不在这个**身份**集合里的行
     */
    private static JSONArray toJsonArray(
        List<MusicInfoRow> rows,
        Set<RainMusicPlaybackQueueKey.MusicRow> dropped
    ) throws JSONException {
        JSONArray array = new JSONArray();
        for (MusicInfoRow row : rows) {
            if (dropped != null && dropped.contains(row.keyRow)) continue;
            array.put(row.toJson());
        }
        return array;
    }

    // ------------------------------------------------------------------ 参数

    /**
     * 取 {@code args[0]} 作为**裸字符串**（本通道的参数形状与第五刀的
     * {@code player_list_music_get_list_ids} 同款：桌面是 {@code async({ params: listId })}）。
     *
     * <p>缺参数 / 类型不对 ⇒ 抛错；{@code null} ⇒ 返回 {@code null}（由调用方短路成"空列表"）。
     * 与 {@link RainMusicListMusicChannels} 的同名方法逐句同形（每一刀一个文件，各自带一份，
     * 这是本仓库既有的做法：{@code requireContext} / {@code jsonValue} 也是这样重复的）。
     */
    private static String readBareString(List<Object> args, String channel) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                channel + " 需要一个字符串参数 listId，收到 " + describeArgs(args) +
                "（渲染层的调用形状见 src/renderer/store/list/listManage/rendererListManage.ts:73 的 " +
                "rendererInvoke(channel, listId) ⇒ 信封里 args=[listId]；契约 docs/android/ipc-contract.md:107）"
            );
        }
        Object first = args.get(0);
        if (first == JSONObject.NULL) return null;
        if (!(first instanceof String)) {
            throw new IllegalArgumentException(
                channel + " 的参数必须是字符串，收到 " + first.getClass().getName() + "：" + describeArgs(args) +
                "（桌面在缺键时抛 TypeError「不能绑定 undefined」，本通道把「不是字符串」也当成失败：" +
                "静默返回 [] 会让界面显示「这个歌单是空的」这种确定的错答案）"
            );
        }
        if (args.size() > 1) {
            // 桌面 {@code async({ params: listId })} 只读第一个参数；多传的忽略（不失败），与前面几刀同一取舍。
            Logger.debug(TAG, channel + "：收到 " + args.size() + " 个参数，只读 args[0]（桌面同样只读 params）");
        }
        return (String) first;
    }

    // ------------------------------------------------------------------ 工具

    /** 查询失败的统一消息（SQL 压成一行，方便在 logcat 里一眼看到是哪条语句）。 */
    private static String readFailureMessage(String sql, Exception ex) {
        return "读 \"" + RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO + "\" 失败（" +
            sql.trim().replaceAll("\\s+", " ") + "）：" + ex.getMessage() + "。";
    }

    /**
     * Java {@code null} → {@code JSONObject.NULL}。
     *
     * <p>为什么必要（与第一 / 三 / 四 / 五 / 六刀是同一件事）：{@code org.json} 的 {@code put(name, null)}
     * 会**删掉这个键**；而桌面 {@code index.ts:185-194} 构造的那个对象里，{@code interval} 是
     * {@code string | null}（{@code music.d.ts:45}），NULL 列必须原样写成 JSON {@code null}。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    /** 只打参数**类型**，不打内容（与第三 / 五 / 六刀 {@code describeArgs} 同款）。 */
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
