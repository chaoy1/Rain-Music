package com.rainmusic.mobile.ipc;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Android 移植 · **P0-2 第六刀**：默认播放队列去重键的 **Java 等价实现**（纯 JDK，无 Android 类型）。
 *
 * <p>这个文件存在的唯一理由：桌面用
 * {@code src/common/utils/playbackQueue.ts:4-8} 的 {@code getPlaybackQueueMusicKey()} 判断两首歌
 * "是不是同一首"，而 **Java 的两个直觉写法都与它不等价**：
 *
 * <table border="1">
 *   <caption>JS 与 Java 的三处差别（本文件逐条复刻 JS）</caption>
 *   <tr><th>步骤</th><th>桌面 JS</th><th>Java 的"直觉写法"为什么错</th><th>本文件</th></tr>
 *   <tr><td>规范化</td><td>{@code .normalize('NFKC')}</td>
 *       <td>不写就是没做（全角/半角、组合字符、兼容字符都不折叠）</td>
 *       <td>{@link Normalizer#normalize(CharSequence, Normalizer.Form)} + {@code Form.NFKC}</td></tr>
 *   <tr><td>去首尾空白</td><td>{@code .trim()}</td>
 *       <td>{@link String#trim()} **只吃 ≤ U+0020**：NBSP（U+00A0）、U+3000（表意空格）、
 *           U+2007（数字空格）、U+FEFF（BOM）都留在串里 ⇒ 同一首歌两种写法会被判成两首</td>
 *       <td>{@link #jsTrim(String)}：逐码位复刻 ECMAScript 的 <i>WhiteSpace + LineTerminator</i></td></tr>
 *   <tr><td>转小写</td><td>{@code .toLowerCase()}（无 locale 参数 ⇒ 与区域无关）</td>
 *       <td>{@link String#toLowerCase()} **吃默认 Locale**：土耳其语环境下 {@code "I"} → {@code "ı"}、
 *           {@code "İ"} → {@code "i"}，与 JS 的 {@code "i"} / {@code "i̇"} 不同 ⇒ 同一首歌在两种
 *           系统语言下会被判成不同</td>
 *       <td>{@link #jsLowerCase(String)} = {@code toLowerCase(Locale.ROOT)}</td></tr>
 * </table>
 *
 * <p><b>键本身也逐字复刻</b>：桌面的键是 {@code JSON.stringify(['song', name, singer])}
 * （两者都非空时）或 {@code JSON.stringify(['id', music.id])}（否则）。{@link #musicKey(String, String, String)}
 * 直接拼出**同一个字符串**（含 JSON 的转义规则），所以两边不只是"等价类相同"，而是**逐字节相同** ——
 * 这一点由 {@code tests/unit/android-playback-queue-key.test.cjs} 用真 JVM 跑出来比对。
 *
 * <h2>为什么这个文件里没有 Android / {@code org.json} 的类型</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），任何 import 了 {@code android.*} 的文件
 * 在这里都**编不过**，也就**跑不起来**。把这段纯字符串逻辑单独放一个只依赖 JDK 的类里，本机的
 * {@code javac} + {@code java}（JDK 20）就能**真的执行**它，并和 Node 里跑出的 JS 结果逐条对比 ——
 * 这是本刀唯一能拿到的"Java 真的这么算"的证据。{@link RainMusicListMusicGetChannels} 用到它，
 * 但本文件**不知道** SQLite 的存在。
 *
 * <h2>语义边界（照 JS 抄，一处不发明）</h2>
 * <ol>
 *   <li>{@code null} / {@code undefined} 的 name 或 singer ⇒ {@code ''}
 *       （JS 的 {@code music.name?.… ?? ''}），见 {@link #normalizeField(String)}；</li>
 *   <li>两者**都非空**才用 {@code song} 键；只要有一个是空串就退化成 {@code id} 键
 *       （JS 的 {@code name && singer}）—— 所以"有名字没歌手"的歌**不会**因为同名而被去重，
 *       这一条**必须**照抄，否则去重会比桌面更狠；</li>
 *   <li>{@code id} 为 {@code null} ⇒ 键是 {@code ["id",null]}（JS 的 {@code undefined}
 *       在 {@code JSON.stringify} 的数组里也变成 {@code null}）；</li>
 *   <li>'NFKC' → 'trim' → 'toLowerCase' **这个顺序**也是照 JS 的链式调用抄的
 *       （先折叠兼容字符，再去空白，最后转小写）—— 顺序换了结果可能不同
 *       （例如 U+0130 {@code İ}：NFKC 不动它，toLowerCase 之后是 {@code i + U+0307}）。</li>
 * </ol>
 *
 * <h2>已知的、**有意**保留的与 JS 的差别</h2>
 * <ol>
 *   <li><b>Java 的 {@code toLowerCase(Locale.ROOT)} 会在希腊语词尾做 Final_Sigma 条件映射</b>
 *       （{@code "ΑΣ"} → {@code "ας"}）。JS 的 {@code String.prototype.toLowerCase} 按
 *       ECMAScript 规定也走 Unicode 的默认大小写转换（含同一条 Final_Sigma 规则），本机实测一致；
 *       但两边的 Unicode 版本可能不同（JDK 与 V8 各自升级），极端新字符上可能出现差异。
 *       影响面：歌手名里的希腊字母大小写 —— 只会让去重**少**合一两首，不会凭空删歌。</li>
 *   <li><b>{@link Normalizer} 对孤立代理项（lone surrogate）不抛错</b>，原样返回；
 *       JS 的 {@code normalize} 同样不抛。本机已逐码位实测（见用例的 BMP 全量对比）。
 *       注意：这份数据来自 SQLite 的 TEXT（UTF-8），正常**不可能**有孤立代理项。</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * <b>只用 JDK</b>：{@code java.text.Normalizer}、{@code java.util.{ArrayList,HashSet,List,Locale,Set}。
 * 没有 {@code android.*}、没有 {@code org.json}、没有新增 gradle 依赖，也没有 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK，本文件**没有在 Android 运行时上跑过**：本机跑的是桌面 JDK 20
 * （{@code javac}/{@code java}），而真机是 ART + Android 自带的 ICU。
 * {@code java.text.Normalizer} 与 {@code Locale.ROOT} 的大小写表在两者上**可能**有版本差。
 * 已由 CI 的 {@code gradlew assembleDebug} 证伪编译；运行期差异只能靠真机日志发现。
 */
final class RainMusicPlaybackQueueKey {

    private RainMusicPlaybackQueueKey() {}

    /**
     * 桌面的 {@code getPlaybackQueueMusicKey()}（{@code playbackQueue.ts:4-8}）逐字复刻。
     *
     * @param id     音乐 id（{@code my_list_music_info."id"}，TEXT NOT NULL；可为 {@code null} 作防御）
     * @param name   曲名（{@code "name"}，可空）
     * @param singer 歌手（{@code "singer"}，可空）
     * @return 与 JS 的 {@code JSON.stringify([...])} **逐字节相同**的字符串
     */
    static String musicKey(String id, String name, String singer) {
        String normalizedName = normalizeField(name);
        String normalizedSinger = normalizeField(singer);
        // JS 的 `name && singer`：**两个都要非空**才用 song 键（空串在 JS 里是 falsy）。
        if (normalizedName.length() > 0 && normalizedSinger.length() > 0) {
            return "[\"song\"," + jsonString(normalizedName) + "," + jsonString(normalizedSinger) + "]";
        }
        return "[\"id\"," + jsonStringOrNull(id) + "]";
    }

    /** 桌面的 {@code music.name?.normalize('NFKC').trim().toLowerCase() ?? ''}。 */
    static String normalizeField(String value) {
        if (value == null) return "";
        // 顺序照 JS 的链式调用：normalize → trim → toLowerCase。
        return jsLowerCase(jsTrim(Normalizer.normalize(value, Normalizer.Form.NFKC)));
    }

    /**
     * {@link String#trim()} 的 JS 等价物。
     *
     * <p>JS 的 {@code String.prototype.trim} 去掉的是 ECMAScript 定义的
     * <b>WhiteSpace + LineTerminator</b>，与 {@link Character#isWhitespace(char)} **不是一回事**：
     * 后者**不含** NBSP（U+00A0）、U+2007、U+202F，却**含** U+001C–U+001F（信息分隔符）；
     * 而 JS 反过来。所以这里既不能调 {@code String.trim()}，也不能调
     * {@link Character#isWhitespace(char)}，只能把码位表写出来（{@link #isJsWhitespace(char)}）。
     */
    static String jsTrim(String value) {
        if (value == null) return "";
        int start = 0;
        int end = value.length();
        while (start < end && isJsWhitespace(value.charAt(start))) start++;
        while (end > start && isJsWhitespace(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    /**
     * ECMAScript 给 {@code trim()} 定义的空白集合，逐码位列出（共 25 个，全部在 BMP 内）：
     *
     * <pre>
     * WhiteSpace : TAB(0009) VT(000B) FF(000C) SP(0020) NBSP(00A0) ZWNBSP/BOM(FEFF)
     *              + Unicode 的 Zs 类：1680 2000–200A 202F 205F 3000
     * LineTerminator : LF(000A) CR(000D) LS(2028) PS(2029)
     * </pre>
     *
     * <p>⚠️ 这张表是 {@code tests/unit/android-playback-queue-key.test.cjs} 的一部分：
     * 那条用例会用 JS 自己的 {@code trim()} **枚举全部 65536 个 BMP 码位**算出 JS 的集合，
     * 再与这里的 {@code case} 标签逐个比对 —— 少一个/多一个都会变红。
     * <b>改这里之前先跑那条用例。</b>
     */
    static boolean isJsWhitespace(char c) {
        switch (c) {
            // ---- WhiteSpace ----
            case 0x0009: // TAB
            case 0x000B: // VT
            case 0x000C: // FF
            case 0x0020: // SP
            case 0x00A0: // NBSP：String.trim() 与 Character.isWhitespace() 都不吃它
            case 0x1680: // OGHAM SPACE MARK
            case 0x2000: // EN QUAD
            case 0x2001: // EM QUAD
            case 0x2002: // EN SPACE
            case 0x2003: // EM SPACE
            case 0x2004: // THREE-PER-EM SPACE
            case 0x2005: // FOUR-PER-EM SPACE
            case 0x2006: // SIX-PER-EM SPACE
            case 0x2007: // FIGURE SPACE：String.trim() 不吃
            case 0x2008: // PUNCTUATION SPACE
            case 0x2009: // THIN SPACE
            case 0x200A: // HAIR SPACE
            case 0x202F: // NARROW NO-BREAK SPACE：String.trim() 不吃
            case 0x205F: // MEDIUM MATHEMATICAL SPACE
            case 0x3000: // IDEOGRAPHIC SPACE：String.trim() 不吃
            case 0xFEFF: // ZWNBSP（BOM）：String.trim() 不吃
                // ---- LineTerminator ----
            case 0x000A: // LF
            case 0x000D: // CR
            case 0x2028: // LINE SEPARATOR
            case 0x2029: // PARAGRAPH SEPARATOR
                return true;
            default:
                return false;
        }
    }

    /**
     * {@code String.prototype.toLowerCase()} 的等价物。
     *
     * <p>⚠️ {@code Locale.ROOT} 是**必须**的：{@code toLowerCase()}（无参）取
     * {@code Locale.getDefault()}，在土耳其语系统上 {@code "I"} → {@code "ı"}（U+0131）、
     * {@code "İ"} → {@code "i"}，与 JS 的 {@code "i"} / {@code "i̇"}（i + U+0307）都不同 ——
     * 同一份播放队列在两种系统语言下会去重成不同结果。
     */
    static String jsLowerCase(String value) {
        if (value == null) return "";
        return value.toLowerCase(Locale.ROOT);
    }

    /**
     * {@code JSON.stringify(字符串)} 的等价实现（{@code null} → {@code null} 字面量）。
     *
     * <p>为什么要**逐字节**一样、而不只是"能用来做集合成员"：本机的差分用例拿 Java 的键与
     * Node 里 {@code JSON.stringify} 的结果做 {@code ===} 比对，逐字节相同才说明两边的键
     * 不只是"划分出同样的等价类"，而是**同一个字符串**（包括转义规则）。
     *
     * <p>转义规则照 ECMAScript 的 {@code QuoteJSONString}：
     * <ol>
     *   <li>{@code "} 与 {@code \} 加反斜杠；</li>
     *   <li>U+0008/0009/000A/000C/000D 用 {@code \b \t \n \f \r} 短写；</li>
     *   <li>其余 &lt; U+0020 的字符用 &#92;u00xx（**小写**十六进制）；</li>
     *   <li>孤立代理项用 &#92;udxxx（ES2019 的 well-formed JSON.stringify），
     *       成对的代理项按原样输出（那是正常的非 BMP 字符）。</li>
     * </ol>
     */
    static String jsonString(String value) {
        if (value == null) return "null";
        StringBuilder builder = new StringBuilder(value.length() + 2);
        builder.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"':
                    builder.append("\\\"");
                    break;
                case '\\':
                    builder.append("\\\\");
                    break;
                case '\b':
                    builder.append("\\b");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\f':
                    builder.append("\\f");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                default:
                    if (c < 0x20) {
                        appendUnicodeEscape(builder, c);
                    } else if (Character.isHighSurrogate(c) && i + 1 < value.length()
                        && Character.isLowSurrogate(value.charAt(i + 1))) {
                        // 正常的一对代理项 = 一个非 BMP 字符，原样输出（与 JSON.stringify 一致）。
                        builder.append(c).append(value.charAt(i + 1));
                        i++;
                    } else if (Character.isSurrogate(c)) {
                        // 孤立代理项：JSON.stringify 会写成「反斜杠 + udxxx」形式的转义（ES2019 起不产生非法 UTF-8 字节）。
                        appendUnicodeEscape(builder, c);
                    } else {
                        builder.append(c);
                    }
            }
        }
        return builder.append('"').toString();
    }

    /** 与 {@link #jsonString(String)} 的区别：{@code null} 也写成 JSON 的 {@code null}（数组元素语义）。 */
    private static String jsonStringOrNull(String value) {
        return value == null ? "null" : jsonString(value);
    }

    /** 手写 &#92;uXXXX 转义（小写 4 位十六进制）：不用 {@code String.format}，免得沾上 Locale。 */
    private static void appendUnicodeEscape(StringBuilder builder, char c) {
        builder.append("\\u");
        builder.append(HEX_DIGITS[(c >> 12) & 0xF]);
        builder.append(HEX_DIGITS[(c >> 8) & 0xF]);
        builder.append(HEX_DIGITS[(c >> 4) & 0xF]);
        builder.append(HEX_DIGITS[c & 0xF]);
    }

    private static final char[] HEX_DIGITS = { '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' };

    /**
     * 查询结果里"去重要用到的那三列"，只为了让 {@link #findDuplicates(List)} 能独立跑。
     *
     * <p>为什么不直接传 {@code Cursor}：那样本类就沾上 {@code android.database}，
     * 本机就编不过、跑不了（见类注释「为什么这个文件里没有 Android 类型」）。
     */
    static final class MusicRow {
        final String id;
        final String name;
        final String singer;

        MusicRow(String id, String name, String singer) {
            this.id = id;
            this.name = name;
            this.singer = singer;
        }

        /** 桌面 {@code getPlaybackQueueMusicKey(music)} 的那把键。 */
        String key() {
            return musicKey(id, name, singer);
        }
    }

    /**
     * 桌面的 {@code dedupePlaybackQueue()}（{@code playbackQueue.ts:10-22}）会**删掉**哪些行。
     *
     * <p>逐字照抄那个 {@code filter} 的判定顺序，两件事一件都不能少：
     * <ol>
     *   <li>先看 **id 集合**（{@code ids.has(music.id)}）—— 同一 id 只留第一条；</li>
     *   <li>再看 **键集合**（{@code keys.has(key)}）—— 同曲名同歌手只留第一条；</li>
     *   <li>被判为重复的行**不**加进任何一个集合（{@code return false} 在 {@code add} 之前）；
     *       所以三条同名记录只会删掉后两条，而不是连锁反应。</li>
     * </ol>
     *
     * @param rows SQL 结果顺序的行（顺序有意义：留下的是**第一条**）
     * @return 会被桌面删掉的那些行（顺序与原列表一致）；没有重复时是**空列表**，不是 {@code null}
     */
    static List<MusicRow> findDuplicates(List<MusicRow> rows) {
        List<MusicRow> duplicates = new ArrayList<>();
        if (rows == null) return duplicates;
        Set<String> ids = new HashSet<>();
        Set<String> keys = new HashSet<>();
        for (MusicRow row : rows) {
            String key = row.key();
            // ⚠️ 这里**不能**把判定改写成"先 add 再看返回值"：JS 的判定是 `ids.has(id) || keys.has(key)`，
            // 而 id 可能是 undefined / Java 侧是 null —— HashSet 允许 null 元素，行为一致。
            if (ids.contains(row.id) || keys.contains(key)) {
                duplicates.add(row);
                continue;
            }
            ids.add(row.id);
            keys.add(key);
        }
        return duplicates;
    }
}
