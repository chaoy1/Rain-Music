package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;

import com.getcapacitor.Logger;

/**
 * Android 移植 · **P0-2 第四刀**：SQLite 落点（歌单 / 列表一族通道的数据文件）。
 *
 * <p>本文件只做四件事：<b>文件放哪</b>、<b>什么时候建表</b>、<b>版本怎么走</b>、
 * <b>连接与并发怎么管</b>。SQL 语句（哪条通道查哪张表）留在各自的通道文件里
 * （本刀是 {@link RainMusicListChannels#SQL_LIST_GET}），本文件只放 <b>schema</b>。
 *
 * <h2>为什么这一族通道是 SQLite，而 {@code winMain_get_data} 那一族是 SharedPreferences</h2>
 *
 * 落点约定（任务书裁定、P0-2 第三刀已按它落地）：<b>键值类走 SharedPreferences</b>
 * （一份 store 一个 key，{@code rain:store:<name>}，文件 {@code CapacitorStorage}），
 * <b>结构化数据（歌单 / 列表 / 歌词 / URL 缓存 / 下载 / 不喜欢）走 SQLite</b>。
 *
 * <p>歌单这一族在桌面上就是 SQLite：契约 {@code docs/android/ipc-contract.md:481}
 * 把 {@code player_list_*} 归在「列表与 DB」16 条里，桌面 handler {@code M:list:6}
 * 直接转发到 {@code global.rain.worker.dbService.getAllUserList()}
 * （{@code src/main/modules/commonRenderers/list/rendererEvent.ts:6-8}），
 * 而那个函数的落点是 {@code src/main/worker/dbService/modules/list/dbHelper.ts:42-51}
 * 的 {@code queryAllUserList()} → {@code statements.ts:14-21} 的 {@code SELECT … FROM "main"."my_list"}。
 * <b>这一族的落点确实是 SQLite</b>（与第三刀那条通道不同：那条通道在桌面上是 JSON 键值表，
 * 没有 SQL 落点，所以第三刀一行 SQL 都没有；这一刀有表、而且表在阶段 2a 里已经存在）。
 *
 * <h2>文件放哪</h2>
 *
 * <pre>
 * 桌面：{@code <RainDatas>/rain.data.db}         （{@code db.ts:22} = {@code path.join(rainDataPath, 'rain.data.db')}）
 * 本刀：{@code context.getDatabasePath("rain.data.db")}
 *       = {@code /data/data/com.rainmusic.mobile/databases/rain.data.db}（应用私有目录，无需任何权限）
 * </pre>
 *
 * <p><b>为什么用 {@code SQLiteOpenHelper} 默认的 databases 目录、而不是 {@code getFilesDir()}</b>：
 * <ol>
 *   <li>契约给 Android 的 SQLite 方案是 {@code @capacitor-community/sqlite}
 *       （{@code ipc-contract.md:719}、{@code native-bridge-needs.md:30,431}）。该插件建库时用的就是
 *       框架的 databases 目录（{@code context.getDatabasePath(name)}），<b>文件名相同 ⇒ 线 A 的 JS 驱动
 *       与这个 Java 通道打开的是同一个文件</b>，不需要迁移、也不会出现两份歌单；</li>
 *   <li>文件名与桌面保持同名（{@code rain.data.db}）：契约与阶段 2a 的文档里到处用这个名字指代这份数据
 *       （{@code db.ts:22}、{@code src/main/app.ts:254,276}），换名字只会制造第三种叫法；</li>
 *   <li>应用私有目录不需要任何存储权限，WebView 里的 JS 也看不到它
 *       （{@code web-runtime-blockers.md:932} 已经登记过"文件系统可见性与应用私有目录是两回事"），
 *       所以"渲染层直接开库"这条路本来就只可能走原生。</li>
 * </ol>
 *
 * <p>⚠️ <b>需要人复核的点（已列在汇报里）</b>：线 A 的 JS 驱动还没实现
 * （{@code src/main/worker/dbService/adapter/android.ts:53-58} 仍是 {@code throw}），
 * "插件也用 databases 目录 + 同名文件"是按其文档与 Android 惯例给出的判断，**本机无法验证
 * （插件未安装、无 SDK）**。若线 A 最终选用别的路径/文件名，两边就会各写一份歌单 —— 那时以线 A 为准，
 * 本文件只需改 {@link #DATABASE_NAME}（其余代码与表结构都不用动）。
 *
 * <h2>什么时候建表</h2>
 *
 * <p>{@code SQLiteOpenHelper} 在**数据库文件不存在**时调 {@link Helper#onCreate}：本刀在那里执行
 * {@code tables.ts} 的 <b>12 个条目逐字抄下来的 DDL</b>（9 张表 + 3 个索引）并写入
 * {@code db_info.version}，和桌面启动期的 {@code initTables}
 * （{@code db.ts:12-17} = {@code Array.from(tables.values()).join()} + 同一句 INSERT）**同形同序**。
 * 之后每次打开都只走 {@code getWritableDatabase()} 的缓存路径，不再建表。
 *
 * <p><b>为什么"读通道"会写库</b>：桌面上建表发生在**启动期**（{@code src/main/app.ts:276}
 * 的 {@code dbService.init()}），任何通道读之前表一定已经在了；Android 侧没有主进程、也没有线 A 的
 * 启动钩子，这份 schema 的**唯一**落点就是"第一个碰这个库的通道"。三条理由：
 * <ol>
 *   <li>与桌面同形：首装时桌面 {@code getAllUserList()} 返回的也是 {@code []}（表刚建、零行），
 *       所以本通道首装返回 {@code ok:true, []} 是**照着桌面抄的正确取值**，不是"假装没有歌单"；</li>
 *   <li>不建表的话，"库文件不存在"与"库在但表缺失"就变成两个必须分别处理的分支，
 *       而后者恰恰是本刀要求**报错**的那种状态（见 {@link #open}）；</li>
 *   <li>下一刀（写侧）必须有一张已经存在的表；把 bootstrap 放在读通道上，
 *       写刀就不用再重复一遍 schema。</li>
 * </ol>
 * 代价与边界都写清楚了：本通道**只在文件不存在时**写这一次（建表 + 一行 version），
 * 之后是纯读。若要求"读通道绝对不写库"，改法是"文件不存在 ⇒ 直接返回 {@code []}"，
 * 这是**需要人定的点**（见汇报）。
 *
 * <h2>版本与迁移</h2>
 *
 * <p>阶段 2a 有**两个**版本载体，本刀两个都对齐到 {@code DB_VERSION = '4'}：
 * <ul>
 *   <li><b>{@code db_info.version} 行</b>（JS 侧 {@code migrate.ts:86-108} 读的就是它，
 *       {@code DB_VERSION} 在 {@code tables.ts:231}）—— 本刀写入 {@code '4'}，
 *       于是线 A 的 {@code migrateData()} 打开这份库时读到 {@code '4'} ⇒ 直接 no-op（{@code migrate.ts:105-106}）；</li>
 *   <li><b>{@code SQLiteOpenHelper} 的 {@code user_version}</b>（框架自己的版本号）—— 同样是 {@code 4}
 *       （{@link #SCHEMA_VERSION} 由 {@link #SCHEMA_VERSION_TEXT} 解析而来，只有一个出处）。
 *       本机 CI 的 Android 侧只有这一个写者，所以这个数字不需要与桌面文件一致
 *       （桌面文件是 better-sqlite3 写的，{@code user_version} 是 0，两个平台的库文件**不会互相拷贝**）。</li>
 * </ul>
 *
 * <p><b>迁移策略：{@link Helper#onUpgrade} 直接抛错，不猜。</b>
 * 阶段 2a 的三段历史迁移（{@code migrate.ts:34-80}：补 {@code dislike_list} 表、删内置「我的收藏」的
 * {@code love} 行、把 {@code my_list.position} 规范化成 {@code 0..n-1}）针对的是**旧版桌面库文件**；
 * Android 上这份库只可能是本文件刚建的（版本 4），没有旧数据可迁。所以：
 * <ul>
 *   <li>{@code user_version} 一旦被人为抬高（有人在 {@link #SCHEMA_VERSION_TEXT} 上改了数字却没写迁移），
 *       打开时会**大声抛错**（{@code SQLiteException} → {@code ok:false}），而不是
 *       "静默按旧结构继续跑"或"把库删了重建"——后者等于无备份丢掉用户全部歌单；</li>
 *   <li>降级同理：{@code SQLiteOpenHelper.onDowngrade} 的框架默认实现就是抛
 *       {@code SQLiteException("Can't downgrade database from version X to Y")}，本文件**不覆写**它
 *       （不重复框架已经做对的事）。</li>
 * </ul>
 *
 * <h2>连接、事务、游标（P0-1 的 handler 跑在 2 线程池里，所以并发是真的）</h2>
 *
 * <ol>
 *   <li><b>连接</b>：{@link Helper} 是**进程级单例**（{@link #helper}），懒建在
 *       {@link #helper(Context)} 里、由 {@code static synchronized} 包住。
 *       <b>为什么必须是单例</b>：同一份库被两个 {@code SQLiteOpenHelper} 打开时，两个实例会各自
 *       走一遍 onCreate/onUpgrade 判定与连接缓存（Android 文档明确要求避免），而且
 *       {@code SQLiteOpenHelper.getWritableDatabase()} 的"检查版本 → 建表"这一段
 *       只有**同一个实例**才会互相串行化。helper 一旦建好就**永不关闭**：
 *       桌面同样把连接留到进程退出（{@code db.ts:72-73} 注册 {@code process.on('exit')}，
 *       而 WebView 里没有进程概念）。</li>
 *   <li><b>那个 {@code synchronized} 不是写锁</b>：它只护住"首次 new Helper"这一次，
 *       **任何 SQL 都不在它里面执行**（否则就变成了把整条读路径串行化）。
 *       写 {@code CapacitorStorage} 那份 SharedPreferences 的锁是另一把
 *       （{@link RainMusicStoreLock#WRITE_LOCK}，第三刀引入），两者毫无关系。</li>
 *   <li><b>本刀不需要任何锁 / 不需要额外 synchronized（只读）</b>，依据逐条：
 *       <ul>
 *         <li>本刀**没有任何 read-modify-write**：SQL 只有一条 {@code SELECT}。
 *             第三刀之所以必须共用一把锁，是因为它的写是"读整份文本 → 改一个键 → 写回整份"，
 *             并发的两次写会丢掉一次；这里不存在这种复合写；</li>
 *         <li>并发的两个 {@code SELECT} 之间**没有共享可变状态**：每次调用都新开一个
 *             {@code Cursor}（{@code rawQuery} 每次返回新对象），读完即关（见下），
 *             不持有任何跨调用的中间状态；</li>
 *         <li>{@code SQLiteDatabase} / {@code SQLiteOpenHelper} 自己就是线程安全的
 *             （框架内部同步 + 连接池），"谁先建库"由框架的锁决定，不需要我们再挡一层；</li>
 *         <li>跨连接（将来线 A 的 JS 驱动、下一刀的写通道）的串行化是 **SQLite 自己的事**
 *             （文件锁 / 事务 / busy 处理）——一把 Java 监视器**根本管不到**别的连接，
 *             加它只会给出"已经被保护了"的错觉。这与第三刀相反：那次保护的是
 *             "同一份 SharedPreferences 整份快照落盘"这种 SQLite 管不到的东西。</li>
 *       </ul></li>
 *   <li><b>事务</b>：单条 {@code SELECT} 在 SQLite 里本来就是隐式的读事务，读通道**不开显式事务**。
 *       唯一的写是建表那一次，{@link Helper#onCreate} 自己开了事务（见那里的注释）。</li>
 *   <li><b>游标</b>：调用方（{@link RainMusicListChannels}）在 {@code finally} 里 {@code close()}，
 *       两条路径（正常 / 抛错）都不漏。长命游标会让 Android 的连接池把写连接一直占着，
 *       所以"读完就关"是硬要求，不是风格问题。</li>
 *   <li><b>WAL 本刀不开</b>：桌面开了 {@code journal_mode = WAL}（{@code db.ts:52}），
 *       但 WAL 的意义是"读写并发"，而本刀只读；并且契约已把插件的 WAL 能力登记为**未核实**
 *       （{@code native-bridge-needs.md:433}），在这里单方面把库切成 WAL 会给线 A 埋一个
 *       没有证据的假设。留给写刀或线 A 决定（**需要人定的点**，见汇报）。</li>
 * </ol>
 *
 * <h2>不假装成功</h2>
 * {@link #open} 只做两件事，两件都会**抛错而不是返回空**：
 * <ol>
 *   <li>打不开（文件损坏 / 不是 SQLite 库 / 没有权限 / 迁移抛错）⇒
 *       {@code IllegalStateException}（带 {@code getDatabasePath()} 的绝对路径与原始 {@code SQLiteException}）；</li>
 *   <li>打开了但没有 {@link #TABLE_MY_LIST} ⇒ {@code IllegalStateException}，明确写"表缺失"。
 *       ⚠️ 这里**绝不**返回一个空库当成"用户没有歌单"：那会把"桥/库坏了"伪装成"歌单空了"。</li>
 * </ol>
 * 两种异常都从 handler 里抛出去，P0-1 会包成 {@code ok:false, code=IPC_HANDLER_FAILED}
 * （{@code RainMusicIpcPlugin.java:241-255}），渲染层那条 {@code invoke} 立刻 reject。
 *
 * <p><b>为什么只查 {@code my_list}，而不照抄桌面的 {@code verifyDB}（全表 DDL 比对）</b>：
 * 桌面 {@code verifyDB.ts:5-16} 会把 {@code sqlite_master.sql} 去掉空白/分号/注释后与
 * {@code tables.ts} <b>逐条</b>比对，不匹配就判定整库不可用（{@code db.ts:56-59}）——那是**启动期**
 * 对"自己刚建的文件"做的一次完整性闸门。读通道上做同样的事风险更大：
 * {@code sqlite_master.sql} 的文本由 SQLite 自己规范化（Android 与 better-sqlite3 的版本、
 * 建表语句的回写形式都可能不同），一次比对不一致就会把**好库**判成坏库、让整个歌单功能在真机上直接不可用。
 * 所以本刀只验证"我要读的那张表在不在"（便宜、无假阳性），其余交给后续的写刀/线 A
 * 在真正需要完整性闸门的地方做。这是**需要人复核的判断**，已列在汇报里。
 *
 * <h2>表结构从哪来（改它之前先读这一条）</h2>
 * 下面 12 个 {@code DDL_*} 常量是从 {@code src/main/worker/dbService/tables.ts} 的
 * {@code tables.set('…', `…`)} <b>逐字抄</b>的（含 {@code lyric} 里那句被注释掉的
 * {@code -- TODO "meta" TEXT NOT NULL,}），顺序也逐条一致（{@code Array.from(tables.values())} 的顺序）。
 * <b>表结构不许改</b>：{@code tables.ts} 是唯一出处，本文件是它的 Android 副本，
 * {@code tests/unit/android-list-channels.test.cjs} 会拿这份副本与 {@code tables.ts}
 * 做归一化后的逐字比对（12 条一条不多一条不少、顺序一致）——两边一旦漂移，那条用例会变红。
 *
 * <h2>依赖</h2>
 * 只用 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）与 Android 框架自带的
 * {@code android.database.sqlite}（{@code SQLiteDatabase} / {@code SQLiteOpenHelper} / {@code Cursor}）。
 * <b>没有新增任何 gradle 依赖</b>（任务书要求：零新增、用 {@code android.database.sqlite}），
 * 也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着 Android 框架 API 与仓库里的既有实现逐条核对的，只能由 CI
 * （{@code .github/workflows/build-android.yml} 的 {@code gradlew assembleDebug}）证伪。
 * 真机行为（文件落在 {@code getDatabasePath}、首次建表、并发读、
 * 与将来线 A 的 {@code @capacitor-community/sqlite} 是否确实打开同一个文件）**同样未在真机验证**。
 */
final class RainMusicDatabase {

    /**
     * 数据库文件名。与桌面 {@code db.ts:22} 的 {@code rain.data.db} **同名**
     * （理由见类注释「文件放哪」）；线 A 若另有选择，只改这一行。
     */
    static final String DATABASE_NAME = "rain.data.db";

    /** 歌单表（{@code tables.ts:128-138}）。本刀唯一读的表。 */
    static final String TABLE_MY_LIST = "my_list";

    /** 迁移元数据表（{@code tables.ts:120-127}）。桌面用它存 {@code version}（{@code db.ts:15}）。 */
    static final String TABLE_DB_INFO = "db_info";

    /** {@code db_info} 的两列（{@code db.ts:15} 的 INSERT 用的就是这两个名字）。 */
    static final String COLUMN_FIELD_NAME = "field_name";
    static final String COLUMN_FIELD_VALUE = "field_value";

    /** {@code version} 行的 {@code field_name} 值（{@code migrate.ts:86} 读的就是它）。 */
    static final String FIELD_VERSION = "version";
    /**
     * schema 版本，必须等于 {@code tables.ts:231} 的 {@code DB_VERSION}（= {@code '4'}）。
     * 单一出处：{@link #SCHEMA_VERSION} 由它解析而来，写进 {@code db_info.version} 的也是它。
     */
    static final String SCHEMA_VERSION_TEXT = "4";

    /**
     * {@code SQLiteOpenHelper} 的 {@code user_version}。与 {@link #SCHEMA_VERSION_TEXT} 同一个数，
     * 但载体不同（见类注释「版本与迁移」）。抬高它的人**必须同时写 {@code onUpgrade}**，否则打开即抛错。
     */
    private static final int SCHEMA_VERSION = Integer.parseInt(SCHEMA_VERSION_TEXT);

    private static final String TAG = "RainMusicDb";

    // ------------------------------------------------------------------ schema（逐字抄 tables.ts）

    /** {@code tables.set('db_info', …)}（{@code tables.ts:120-127}）。 */
    private static final String DDL_DB_INFO = """
        CREATE TABLE "db_info" (
          "id" INTEGER NOT NULL UNIQUE,
          "field_name" TEXT,
          "field_value" TEXT,
          PRIMARY KEY("id" AUTOINCREMENT)
        );
        """;

    /** {@code tables.set('my_list', …)}（{@code tables.ts:128-138}）。 {@code position} 是用户自建歌单的顺序。 */
    private static final String DDL_MY_LIST = """
        CREATE TABLE "my_list" (
          "id" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "source" TEXT,
          "sourceListId" TEXT,
          "position" INTEGER NOT NULL,
          "locationUpdateTime" INTEGER,
          PRIMARY KEY("id")
        );
        """;

    /** {@code tables.set('my_list_music_info', …)}（{@code tables.ts:139-150}）。 */
    private static final String DDL_MY_LIST_MUSIC_INFO = """
        CREATE TABLE "my_list_music_info" (
          "id" TEXT NOT NULL,
          "listId" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "singer" TEXT NOT NULL,
          "source" TEXT NOT NULL,
          "interval" TEXT,
          "meta" TEXT NOT NULL,
          UNIQUE("id","listId")
        );
        """;

    /** {@code tables.set('index_my_list_music_info', …)}（{@code tables.ts:151-156}）。 */
    private static final String DDL_INDEX_MY_LIST_MUSIC_INFO = """
        CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
          "id",
          "listId"
        );
        """;

    /** {@code tables.set('my_list_music_info_order', …)}（{@code tables.ts:157-163}）。 */
    private static final String DDL_MY_LIST_MUSIC_INFO_ORDER = """
        CREATE TABLE "my_list_music_info_order" (
          "listId" TEXT NOT NULL,
          "musicInfoId" TEXT NOT NULL,
          "order" INTEGER NOT NULL
        );
        """;

    /** {@code tables.set('index_my_list_music_info_order', …)}（{@code tables.ts:164-169}）。 */
    private static final String DDL_INDEX_MY_LIST_MUSIC_INFO_ORDER = """
        CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
          "listId",
          "musicInfoId"
        );
        """;

    /** {@code tables.set('music_info_other_source', …)}（{@code tables.ts:170-181}）。 */
    private static final String DDL_MUSIC_INFO_OTHER_SOURCE = """
        CREATE TABLE "music_info_other_source" (
          "source_id" TEXT NOT NULL,
          "id" TEXT NOT NULL,
          "source" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "singer" TEXT NOT NULL,
          "meta" TEXT NOT NULL,
          "order" INTEGER NOT NULL,
          UNIQUE("source_id","id")
        );
        """;

    /** {@code tables.set('index_music_info_other_source', …)}（{@code tables.ts:182-187}）。 */
    private static final String DDL_INDEX_MUSIC_INFO_OTHER_SOURCE = """
        CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
          "source_id",
          "id"
        );
        """;

    /**
     * {@code tables.set('lyric', …)}（{@code tables.ts:188-196}）。
     * ⚠️ 开头那句 {@code -- TODO "meta" TEXT NOT NULL,} 是 {@code tables.ts} 里**本来就有**的注释行，
     * 逐字抄过来（不改表结构、也不"顺手"删掉它）：删了它，这份副本就不再是逐字副本。
     */
    private static final String DDL_LYRIC = """
        -- TODO  "meta" TEXT NOT NULL,
        CREATE TABLE "lyric" (
          "id" TEXT NOT NULL,
          "source" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "text" TEXT NOT NULL
        );
        """;

    /** {@code tables.set('music_url', …)}（{@code tables.ts:197-202}）。 */
    private static final String DDL_MUSIC_URL = """
        CREATE TABLE "music_url" (
          "id" TEXT NOT NULL,
          "url" TEXT NOT NULL
        );
        """;

    /** {@code tables.set('download_list', …)}（{@code tables.ts:203-220}）。 */
    private static final String DDL_DOWNLOAD_LIST = """
        CREATE TABLE "download_list" (
          "id" TEXT NOT NULL,
          "isComplate" INTEGER NOT NULL,
          "status" TEXT NOT NULL,
          "statusText" TEXT NOT NULL,
          "progress_downloaded" INTEGER NOT NULL,
          "progress_total" INTEGER NOT NULL,
          "url" TEXT,
          "quality" TEXT NOT NULL,
          "ext" TEXT NOT NULL,
          "fileName" TEXT NOT NULL,
          "filePath" TEXT NOT NULL,
          "musicInfo" TEXT NOT NULL,
          "position" INTEGER NOT NULL,
          PRIMARY KEY("id")
        );
        """;

    /** {@code tables.set('dislike_list', …)}（{@code tables.ts:221-227}）。 */
    private static final String DDL_DISLIKE_LIST = """
        CREATE TABLE "dislike_list" (
          "type" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "meta" TEXT
        );
        """;

    /**
     * 建库语句，顺序 = {@code tables.ts} 里 {@code tables.set} 的注册顺序
     * （= 桌面 {@code db.ts:13-14} 的 {@code Array.from(tables.values())}：
     * 9 张表 + 3 个索引，索引紧跟它索引的表）。
     *
     * <p>桌面用一次 {@code db.exec(多条语句)}，Android 的 {@code execSQL} 一次只吃一条 ——
     * 所以这里拆成一个数组逐条执行。**内容与顺序都不许动**（测试逐条比对）。
     */
    private static final String[] SCHEMA_STATEMENTS = {
        DDL_DB_INFO,
        DDL_MY_LIST,
        DDL_MY_LIST_MUSIC_INFO,
        DDL_INDEX_MY_LIST_MUSIC_INFO,
        DDL_MY_LIST_MUSIC_INFO_ORDER,
        DDL_INDEX_MY_LIST_MUSIC_INFO_ORDER,
        DDL_MUSIC_INFO_OTHER_SOURCE,
        DDL_INDEX_MUSIC_INFO_OTHER_SOURCE,
        DDL_LYRIC,
        DDL_MUSIC_URL,
        DDL_DOWNLOAD_LIST,
        DDL_DISLIKE_LIST,
    };

    /**
     * {@code version} 行（逐字对齐 {@code db.ts:15} 的
     * {@code INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '<DB_VERSION>')}；
     * 两个值改成绑定参数，免得再拼一次 SQL）。表名与两个列名写死在这里是**有意**的：
     * 它们必须与 {@code tables.ts:120-127} 的 {@code db_info} 逐字一致，
     * 而"工具常量"拼出来的字符串会让本机测试没法直接比对这一句。
     */
    private static final String SQL_INSERT_SCHEMA_VERSION =
        "INSERT INTO \"main\".\"db_info\" (\"field_name\", \"field_value\") VALUES (?, ?)";

    /** 表存在性检查（只读、便宜、不会误判好库 —— 见类注释「不假装成功」最后一段）。 */
    private static final String SQL_TABLE_EXISTS =
        "SELECT \"name\" FROM \"main\".sqlite_master WHERE \"type\"='table' AND \"name\"=?";

    // ------------------------------------------------------------------ 单例

    private static volatile Helper helper = null;

    private RainMusicDatabase() {}

    /**
     * 懒建进程级单例 helper。{@code synchronized} 只护住"第一次 new"这一次，
     * **任何 SQL 都不在这里面执行**（见类注释「连接、事务、游标」第 2 条）。
     */
    private static synchronized Helper helper(Context context) {
        if (helper == null) {
            Context appContext = context.getApplicationContext();
            helper = new Helper(appContext == null ? context : appContext);
        }
        return helper;
    }

    // ------------------------------------------------------------------ 打开

    /**
     * 打开数据库并确认本刀要读的表在。
     *
     * @return 可用的 {@link SQLiteDatabase}（进程级缓存，**不要 close**：桌面同样把连接留到进程退出）
     * @throws IllegalStateException 打不开（含首次建表失败 / 版本迁移抛错），或 {@link #TABLE_MY_LIST} 缺失。
     *                               两种情况都**不返回空**：那会把"库坏了"伪装成"用户没有歌单"。
     */
    static SQLiteDatabase open(Context context) {
        String path = databasePath(context);
        SQLiteDatabase db;
        try {
            // getWritableDatabase（而不是 getReadableDatabase）：首次打开要走 onCreate 建表，
            // 那是一次写。之后命中缓存，不再有写。
            db = helper(context).getWritableDatabase();
        } catch (SQLiteException ex) {
            throw new IllegalStateException(
                "打不开数据库 " + path + "：" + ex.getMessage() +
                "。本通道**不会**把它当成「用户没有歌单」返回空数组 —— 库坏了就是库坏了" +
                "（首次建表失败同样落在这里；见 RainMusicDatabase 的类注释「不假装成功」）。",
                ex
            );
        }
        requireTable(db, path, TABLE_MY_LIST);
        return db;
    }

    /** 数据库文件的绝对路径（只用于错误信息；真机上形如 {@code /data/data/<pkg>/databases/rain.data.db}）。 */
    static String databasePath(Context context) {
        try {
            return String.valueOf(context.getDatabasePath(DATABASE_NAME).getAbsolutePath());
        } catch (RuntimeException ex) {
            // getDatabasePath 在极端情况下（Context 已失效）也会抛；错误信息不该因为"报错时报错"而丢。
            return DATABASE_NAME;
        }
    }

    /**
     * 表必须存在。**缺失 = 失败**（不是"空库"）：
     * 这份库要么是本文件建的（那 12 个条目里一定有它），要么是别人写的/坏掉的 ——
     * 后者继续读下去只会得到"用户歌单空了"这种假象。
     */
    private static void requireTable(SQLiteDatabase db, String path, String table) {
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(SQL_TABLE_EXISTS, new String[] { table });
            if (!cursor.moveToFirst()) {
                throw new IllegalStateException(
                    "数据库 " + path + " 里没有表 \"" + table + "\"：这不是本应用建的库，或者它已经损坏。" +
                    "本通道**不会**返回空数组假装「用户没有歌单」（那会让「桥/库坏了」看起来像「歌单空了」）；" +
                    "期望的表结构出自 src/main/worker/dbService/tables.ts。"
                );
            }
        } catch (SQLiteException ex) {
            throw new IllegalStateException(
                "检查数据库 " + path + " 里的表 \"" + table + "\" 是否存在时失败：" + ex.getMessage(),
                ex
            );
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    // ------------------------------------------------------------------ helper

    /**
     * 进程内唯一的 {@code SQLiteOpenHelper}。
     *
     * <p>刻意**不覆写** {@code onDowngrade}：框架默认实现已经抛
     * {@code SQLiteException("Can't downgrade database from version X to Y")}，重复一遍只是噪音。
     */
    private static final class Helper extends SQLiteOpenHelper {

        Helper(Context context) {
            super(context, DATABASE_NAME, null, SCHEMA_VERSION);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            // 自己开事务，**不依赖** SQLiteOpenHelper 是否把 onCreate 包在事务里：
            // 这样"12 条 DDL + 一行 version"要么全成、要么整体回滚，而 user_version 由框架在
            // onCreate 返回之后才写 ⇒ 半途失败时它仍是 0，下次打开会重新走 onCreate，
            // 不会留下"表建了一半、版本却已经是 4"的死库（那样每次打开都会卡在
            // "table db_info already exists"）。
            db.beginTransaction();
            try {
                for (String statement : SCHEMA_STATEMENTS) {
                    db.execSQL(statement);
                }
                db.execSQL(SQL_INSERT_SCHEMA_VERSION, new Object[] { FIELD_VERSION, SCHEMA_VERSION_TEXT });
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            Logger.info(
                TAG,
                "首次打开：已建库 " + DATABASE_NAME + "（" + SCHEMA_STATEMENTS.length +
                " 条 schema 语句 = tables.ts 的 9 张表 + 3 个索引，顺序一致），并写入 " +
                TABLE_DB_INFO + "(" + COLUMN_FIELD_NAME + "," + COLUMN_FIELD_VALUE + ") 的 " +
                FIELD_VERSION + "='" + SCHEMA_VERSION_TEXT + "'"
            );
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            throw new SQLiteException(
                "数据库版本 " + oldVersion + " → " + newVersion + "：Android 侧**没有**迁移路径。" +
                "阶段 2a 的三段历史迁移（src/main/worker/dbService/migrate.ts:34-80）针对的是旧版桌面库文件，" +
                "而这份库只可能是本应用刚建的（版本 " + SCHEMA_VERSION_TEXT + "）。" +
                "抬高 SCHEMA_VERSION_TEXT 的人必须同时在这里写迁移 —— " +
                "本文件刻意**不**用「删库重建」蒙过去（那等于无备份丢掉用户全部歌单），也不静默按旧结构继续跑。"
            );
        }
    }
}
