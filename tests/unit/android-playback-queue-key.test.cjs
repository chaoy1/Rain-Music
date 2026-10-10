/**
 * Android 移植 · **P0-2 第六刀（`player_list_music_get`）的去重键等价性回归网**。
 *
 * 它守的是本刀最隐蔽的一个风险：**Java 的两个直觉写法与桌面的 JS 不等价** ——
 * `String.trim()` 只吃 ≤ U+0020（不吃 NBSP / U+3000 / U+2007 / U+FEFF），
 * 无参 `toLowerCase()` 吃默认 Locale（土耳其语环境下 `I` → `ı`）。
 * 键算错的后果：桌面会**按错的键去重并写回库**（丢歌）；本刀不写回，但**警告会说谎**
 * （该报的脏队列不报、或报了不该报的）。
 *
 * <h2>这个文件与其它 `android-*.test.cjs` 最大的不同</h2>
 * 别的 android 用例只能做**源码断言**（本机没有 Android SDK，跑不了 Java）。
 * 这里被守的那个类 {@code RainMusicPlaybackQueueKey.java} **故意只依赖 JDK**
 * （没有 `android.*`、没有 `org.json`），所以本机有 JDK 时可以：
 * <ol>
 *   <li>用真的 `javac` 把它编出来；</li>
 *   <li>用真的 `java` 跑一个探针类；</li>
 *   <li>把输出与 **Node 里跑真的 `src/common/utils/playbackQueue.ts`** 的结果逐字节比对。</li>
 * </ol>
 * 也就是"Java 真的会这么算"这件事在本机是**被执行验证**的，不是靠读代码猜的。
 * 没装 JDK 时这一组跳过（用例名里带 skip 原因），但**源码级**的断言照跑
 * （例如：Java 里那张空白码位表必须与 JS 自己 `trim()` 出来的集合逐个相同）。
 *
 * <h2>已知的、被这条用例**钉住**的差异：Unicode 版本</h2>
 * 逐码位比对全部 65536 个 BMP 码位后，确实存在极少数不一致 —— 全部是
 * "**JDK 的 Unicode 表比 V8/ICU 旧**"这一种形状（Java 原样返回，JS 有映射），
 * 例如 U+A7CB / U+1C89（Unicode 16 新增的拉丁字母）与 U+FA6C 等 CJK 兼容表意文字
 * （Unicode 15.1 起在 NFKC 下映射到扩展区）。用例把它们**逐个列出来**、并且只允许这一种形状，
 * 数量还有上限 —— 算法写错（例如用 `String.trim()`）时形状完全不同，会立刻变红。
 * 真机上的 `java.text.Normalizer` 走的是设备自带的 ICU，版本与桌面 JDK 又可能不同，
 * 影响面写在 {@code RainMusicPlaybackQueueKey} 的类注释里（只会让去重少合一两首，不会删歌）。
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

const keyJavaPath = path.join(ROOT, JAVA_REL_DIR, 'RainMusicPlaybackQueueKey.java')
const throttleJavaPath = path.join(ROOT, JAVA_REL_DIR, 'RainMusicLogThrottle.java')
const channelJavaPath = path.join(ROOT, JAVA_REL_DIR, 'RainMusicListMusicGetChannels.java')

const keyJava = fs.readFileSync(keyJavaPath, 'utf8')
const keyCode = keyJava.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 桌面那把键的**唯一出处**（本刀一行都没动它）。 */
const { getPlaybackQueueMusicKey, dedupePlaybackQueue } = load('src/common/utils/playbackQueue.ts', {}, {})

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 一个 UTF-16 串 → 4 位十六进制码元串（空串 → 空串）。Java 侧用同一个编码回传。 */
const toHexUnits = value => {
  let out = ''
  for (let i = 0; i < value.length; i++) out += value.charCodeAt(i).toString(16).padStart(4, '0')
  return out
}

const fromHexUnits = value => {
  assert.equal(value.length % 4, 0, `不是 4 的倍数：${JSON.stringify(value)}`)
  let out = ''
  for (let i = 0; i < value.length; i += 4) out += String.fromCharCode(parseInt(value.slice(i, i + 4), 16))
  return out
}

/**
 * 跑一个外部进程，把它的 stdout/stderr 落到**文件**再读回来。
 *
 * ⚠️ 刻意**不用** `stdio: 'pipe'`：DSH 的受限沙箱下 Node 拿不到命名管道（child_process 的
 * 默认管道会 EPERM），而"把 fd 指向一个普通文件"在任何模式下都能用。
 */
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
// 真 JVM 探针
// ---------------------------------------------------------------------------

/**
 * 探针类（写到临时目录，不进仓库）。
 *
 * 它**只**调用被守的那个类，自己不含任何判定逻辑 —— 判定全在 JS 侧的断言里，
 * 免得"期望值"被写进 Java 变成自己验证自己。
 *
 * 语料用**十六进制码元**编码（一行三个字段，`|` 分隔，`-` 表示 null），
 * 这样 cmd / PowerShell 的控制台代码页（本机是 GBK）不会破坏 NBSP / U+3000 这类字符，
 * 也不会把 `\r`、孤立代理项吃掉。
 */
const DRIVER_SOURCE = `package ${PACKAGE};

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;

/** 由 tests/unit/android-playback-queue-key.test.cjs 生成；只转发调用、不做判定。 */
public final class RainMusicKeyProbe {

    public static void main(String[] args) throws IOException {
        String mode = args[0];
        if (mode.equals("bmp")) {
            StringBuilder out = new StringBuilder();
            for (int c = 0; c <= 0xFFFF; c++) {
                String s = new String(new char[] { (char) c });
                out.append(hex(s)).append('\\t')
                    .append(hex(Normalizer.normalize(s, Normalizer.Form.NFKC))).append('\\t')
                    .append(hex(RainMusicPlaybackQueueKey.jsTrim(s))).append('\\t')
                    .append(hex(RainMusicPlaybackQueueKey.jsLowerCase(s))).append('\\n');
            }
            System.out.print(out);
            return;
        }
        if (mode.equals("whitespace")) {
            StringBuilder out = new StringBuilder();
            for (int c = 0; c <= 0xFFFF; c++) {
                if (RainMusicPlaybackQueueKey.isJsWhitespace((char) c)) {
                    out.append(hex(new String(new char[] { (char) c }))).append('\\n');
                }
            }
            System.out.print(out);
            return;
        }
        if (mode.equals("key") || mode.equals("dupes")) {
            List<RainMusicPlaybackQueueKey.MusicRow> rows = readRows(args[1]);
            StringBuilder out = new StringBuilder();
            if (mode.equals("key")) {
                for (RainMusicPlaybackQueueKey.MusicRow row : rows) {
                    out.append(hex(row.key())).append('\\n');
                }
            } else {
                List<RainMusicPlaybackQueueKey.MusicRow> duplicates =
                    RainMusicPlaybackQueueKey.findDuplicates(rows);
                for (int i = 0; i < duplicates.size(); i++) {
                    if (i > 0) out.append(',');
                    out.append(rows.indexOf(duplicates.get(i)));
                }
                out.append('\\n');
            }
            System.out.print(out);
            return;
        }
        if (mode.equals("throttle")) {
            long windowMs = Long.parseLong(args[1]);
            RainMusicLogThrottle throttle = new RainMusicLogThrottle(windowMs);
            StringBuilder out = new StringBuilder();
            for (String line : Files.readAllLines(Paths.get(args[2]), StandardCharsets.US_ASCII)) {
                if (line.isEmpty()) continue;
                int bar = line.indexOf('|');
                String signature = decode(line.substring(0, bar));
                long nowMs = Long.parseLong(line.substring(bar + 1));
                out.append(throttle.shouldLog(signature, nowMs) ? "true" : "false").append('\\n');
            }
            System.out.print(out);
            return;
        }
        throw new IllegalArgumentException(mode);
    }

    private static List<RainMusicPlaybackQueueKey.MusicRow> readRows(String file) throws IOException {
        List<RainMusicPlaybackQueueKey.MusicRow> rows = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(file), StandardCharsets.US_ASCII)) {
            if (line.isEmpty()) continue;
            int first = line.indexOf('|');
            int second = line.indexOf('|', first + 1);
            rows.add(new RainMusicPlaybackQueueKey.MusicRow(
                decode(line.substring(0, first)),
                decode(line.substring(first + 1, second)),
                decode(line.substring(second + 1))
            ));
        }
        return rows;
    }

    /** '-' = null；否则是 4 位十六进制码元串。 */
    private static String decode(String field) {
        if (field.equals("-")) return null;
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < field.length(); i += 4) {
            builder.append((char) Integer.parseInt(field.substring(i, i + 4), 16));
        }
        return builder.toString();
    }

    private static String hex(String value) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            String unit = Integer.toHexString(value.charAt(i));
            for (int pad = unit.length(); pad < 4; pad++) builder.append('0');
            builder.append(unit);
        }
        return builder.toString();
    }
}
`

const JAVAC_AVAILABLE = (() => {
  const result = spawnSync('javac', ['-version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()
const SKIP_REASON = JAVAC_AVAILABLE
  ? false
  : '本机没有可用的 javac（JDK）⇒ 这一组"真 JVM 跑 Java 逻辑"的用例无法执行（源码级断言照跑）'

const temporaryDirs = []
after(() => {
  for (const dir of temporaryDirs) fs.rmSync(dir, { recursive: true, force: true })
})

let jvm = null
/** 懒编译一次，之后复用（Node 的 test 是串行跑的，同一个文件里的用例共享它）。 */
const requireJvm = () => {
  if (jvm == null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-android-key-'))
    temporaryDirs.push(dir)
    const outDir = path.join(dir, 'out')
    const srcDir = path.join(dir, 'src', ...PACKAGE.split('.'))
    fs.mkdirSync(outDir, { recursive: true })
    fs.mkdirSync(srcDir, { recursive: true })
    const driverPath = path.join(srcDir, 'RainMusicKeyProbe.java')
    fs.writeFileSync(driverPath, DRIVER_SOURCE)
    const compiled = runToFile(
      'javac',
      ['-encoding', 'UTF-8', '-d', outDir, driverPath, keyJavaPath, throttleJavaPath],
      dir,
      path.join(dir, 'javac.log'),
    )
    jvm = { dir, outDir, compiled }
  }
  // javac **在**，却编不过 ⇒ 这是真失败（不是"环境不支持"），必须红。
  assert.equal(jvm.compiled.status, 0, `javac 编不过 RainMusicPlaybackQueueKey / RainMusicLogThrottle：\n${jvm.compiled.log}`)
  return jvm
}

/** 跑一次探针，返回按行拆开的 stdout。 */
const probe = (mode, args = []) => {
  const state = requireJvm()
  const logFile = path.join(state.dir, `run-${mode}.log`)
  const result = runToFile('java', ['-cp', state.outDir, `${PACKAGE}.RainMusicKeyProbe`, mode, ...args], state.dir, logFile)
  assert.equal(result.status, 0, `java 探针 ${mode} 退出码 ${result.status}：\n${result.log}`)
  return result.log.split('\n')
}

const writeCorpus = (name, lines) => {
  const state = requireJvm()
  const file = path.join(state.dir, name)
  fs.writeFileSync(file, lines.join('\n') + '\n', 'ascii')
  return file
}

// ---------------------------------------------------------------------------
// 1. JS 侧的"事实"：空白集合 / 键
// ---------------------------------------------------------------------------

/** 用 JS 自己的 `trim()` 枚举全部 BMP 码位算出来的空白集合（不是手抄的常量）。 */
const JS_WHITESPACE = (() => {
  const set = []
  for (let c = 0; c <= 0xffff; c++) if (String.fromCharCode(c).trim() === '') set.push(c)
  return set
})()

/** ECMAScript 规范里 WhiteSpace + LineTerminator 的**完整**列举（25 个）。手写，用来钉住上一条。 */
const EXPECTED_WHITESPACE = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]

test('JS 的 trim() 空白集合 == ECMAScript 规范列举的 25 个码位（剩下的断言都建立在它上面）', () => {
  assert.deepEqual(
    JS_WHITESPACE,
    EXPECTED_WHITESPACE,
    'Node 的 String.prototype.trim 行为变了 ⇒ 下面与 Java 的对照必须重新核对',
  )
  // 顺手钉住那几个"Java 直觉写法会漏掉"的成员（本刀注释里逐条点名过）。
  for (const codePoint of [0x00a0, 0x2007, 0x202f, 0x3000, 0xfeff]) {
    assert.ok(JS_WHITESPACE.includes(codePoint), `U+${codePoint.toString(16)} 必须是 JS 的空白`)
  }
  // 反向：这几个**不是**空白，不能被当成空白吃掉（写成"凡是 isSpaceChar 就 trim"就会过头）。
  for (const codePoint of [0x200b, 0x001c, 0x0085, 0x180e]) {
    assert.ok(!JS_WHITESPACE.includes(codePoint), `U+${codePoint.toString(16)} 不是 JS 的空白`)
  }
})

test('Java 源码里的空白码位表（isJsWhitespace 的 case 标签）与 JS 的集合逐个相同', () => {
  // 只看 isJsWhitespace 这一个方法体（别把文件里别的 0x 字面量捞进来）。
  const start = keyCode.indexOf('static boolean isJsWhitespace(char c)')
  assert.ok(start > -1, '找不到 isJsWhitespace（改名了？）')
  const end = keyCode.indexOf('\n    }', start)
  const body = keyCode.slice(start, end)
  const labels = [...body.matchAll(/case\s+0x([0-9a-fA-F]{4})\s*:/g)].map(match => parseInt(match[1], 16))
  assert.ok(labels.length > 0, '一个 case 标签都没解析出来？')
  assert.equal(new Set(labels).size, labels.length, 'case 标签有重复（Java 也编不过）')
  assert.deepEqual([...labels].sort((a, b) => a - b), EXPECTED_WHITESPACE,
    'Java 的空白表与 JS 的 trim() 不一致 —— 少一个/多一个都会让去重键与桌面不同')
  // 方法里不许出现"靠 Java 自带判定"的写法。
  assert.ok(!/Character\.isWhitespace|Character\.isSpaceChar/.test(body), '不许用 Java 自带的空白判定（集合不同）')
})

test('键的来源是桌面那一份实现（JS 侧唯一出处），且键的形状是 [song,name,singer] / [id,id]', () => {
  const queueTs = read('src/common/utils/playbackQueue.ts')
  assert.match(queueTs, /music\.name\?\.normalize\('NFKC'\)\.trim\(\)\.toLowerCase\(\) \?\? ''/)
  assert.match(queueTs, /return name && singer \? JSON\.stringify\(\['song', name, singer\]\) : JSON\.stringify\(\['id', music\.id\]\)/)

  assert.equal(getPlaybackQueueMusicKey({ id: 'm1', name: ' Song ', singer: ' A ' }), '["song","song","a"]')
  assert.equal(getPlaybackQueueMusicKey({ id: 'm1', name: '', singer: 'a' }), '["id","m1"]')
  assert.equal(getPlaybackQueueMusicKey({ id: 'm1', name: 'x', singer: '' }), '["id","m1"]')
  assert.equal(getPlaybackQueueMusicKey({ id: 'm1', name: null, singer: undefined }), '["id","m1"]')
  assert.equal(getPlaybackQueueMusicKey({ id: null, name: null, singer: null }), '["id",null]')
})

// ---------------------------------------------------------------------------
// 2. Java 侧的源码形状（不需要 JDK）
// ---------------------------------------------------------------------------

test('Java 的键实现必须逐条复刻 JS 的三步：NFKC → JS 的 trim → Locale.ROOT 的 toLowerCase', () => {
  assert.match(keyCode, /Normalizer\.normalize\(value, Normalizer\.Form\.NFKC\)/,
    '少了对 meta 的 NFKC 规范化 ⇒ 全角/兼容字符不会折叠')
  // ⚠️ 必须去掉注释再查：注释里**故意**写着 String.trim() 与无参 toLowerCase()（那是在讲为什么不能用）。
  assert.ok(!/\.trim\(\s*\)/.test(keyCode), '不许用 String.trim()（只吃 ≤ U+0020）')
  assert.ok(!/toLowerCase\(\s*\)/.test(keyCode), '不许用无参 toLowerCase()（吃默认 Locale，土耳其语会错）')
  assert.match(keyCode, /toLowerCase\(Locale\.ROOT\)/, '必须是 Locale.ROOT')
  // 步骤顺序：normalize → trim → toLowerCase（与 JS 的链式调用一致）。
  const normalizeField = keyCode.slice(
    keyCode.indexOf('static String normalizeField'),
    keyCode.indexOf('static String jsTrim'),
  )
  assert.match(normalizeField, /jsLowerCase\(jsTrim\(Normalizer\.normalize\(/)
  // 两个字段都要过这一套（name 与 singer），少一个就会用原始串做键。
  assert.match(keyCode, /String normalizedName = normalizeField\(name\)/)
  assert.match(keyCode, /String normalizedSinger = normalizeField\(singer\)/)
  // `name && singer` 两个都非空才用 song 键（JS 的 falsy 判定）。
  assert.match(keyCode, /normalizedName\.length\(\) > 0 && normalizedSinger\.length\(\) > 0/)
})

test('通道确实用的是这一份键（不是就地又写了一套）', () => {
  const channel = fs.readFileSync(channelJavaPath, 'utf8')
  assert.match(channel, /RainMusicPlaybackQueueKey\.findDuplicates\(/)
  assert.match(channel, /new RainMusicPlaybackQueueKey\.MusicRow\(/)
  // 通道**自己**不许出现任何"手搓的键"痕迹（否则就有第二份实现，漂移没人管）。
  const channelCode = channel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!/NFKC|toLowerCase/.test(channelCode), '通道里不许自己算键（NFKC / toLowerCase 只该在 RainMusicPlaybackQueueKey 里）')
  // 通道里唯一的 .trim() 是把 SQL 压成一行给错误消息用（与键无关）。
  assert.equal((channelCode.match(/\.trim\(\)/g) ?? []).length, 1, '通道里只应有一处 .trim()（readFailureMessage）')
  assert.match(channelCode, /sql\.trim\(\)\.replaceAll\(/)
})

// ---------------------------------------------------------------------------
// 3. 真 JVM：逐码位对照（空白 / NFKC / toLowerCase）
// ---------------------------------------------------------------------------

test('BMP 全量对照：Java 的 trim / NFKC / toLowerCase 与 JS 逐个码位一致（差异只允许"JDK 的 Unicode 更旧"）', { skip: SKIP_REASON }, () => {
  const lines = probe('bmp')
  assert.equal(lines.length, 0x10000 + 1, 'BMP 探针输出行数不对')

  const versionGaps = { nfkc: [], lower: [] }
  const whitespace = []
  for (let c = 0; c <= 0xffff; c++) {
    const [self, nfkc, trim, lower] = lines[c].replace(/\r$/, '').split('\t')
    const source = String.fromCharCode(c)
    assert.equal(self, toHexUnits(source), `探针第 ${c} 行不是 U+${c.toString(16)}`)

    if (source.trim() === '') whitespace.push(c)
    // trim：只允许"同一个集合"（集合已在上面与规范比对过）。
    assert.equal(fromHexUnits(trim), source.trim(), `trim 不一致：U+${c.toString(16).padStart(4, '0')}`)

    // NFKC / toLowerCase：允许的唯一差异是"Java 原样返回、JS 有映射"（Unicode 版本差）。
    for (const [field, actual, expected] of [
      ['nfkc', nfkc, toHexUnits(source.normalize('NFKC'))],
      ['lower', lower, toHexUnits(source.toLowerCase())],
    ]) {
      if (actual === expected) continue
      assert.equal(actual, self, `${field} 出现了"两边都映射但结果不同"：U+${c.toString(16).padStart(4, '0')}（这不是版本差，是算法差）`)
      assert.notEqual(expected, self, `${field} 差异形状不对：U+${c.toString(16).padStart(4, '0')}`)
      versionGaps[field].push(c)
    }
  }
  assert.deepEqual(whitespace, JS_WHITESPACE, 'Java 的 trim 空白集合与 JS 不同')

  // 版本差的数量上限：真出错（例如漏了 NFKC、用了 String.trim）时数量级完全不同。
  assert.ok(versionGaps.nfkc.length + versionGaps.lower.length <= 128,
    `Unicode 版本差太多（nfkc=${versionGaps.nfkc.length}, lower=${versionGaps.lower.length}）⇒ 更像算法差`)
  // 逐个点名（本机 JDK 20 vs Node 24 的实际差异，写在这里是为了"看得见"）。
  // eslint-disable-next-line no-console
  console.log(`[key-diff] JDK 比 V8 旧的码位：nfkc=${versionGaps.nfkc.map(hex4).join(',')} lower=${versionGaps.lower.map(hex4).join(',')}`)
})

/** U+XXXX 形式，给上面那条日志与下面的断言用。 */
function hex4(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

test('空白集合的 Java 运行时结果 == JS 的集合（探针直接问 isJsWhitespace）', { skip: SKIP_REASON }, () => {
  const set = probe('whitespace')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.length > 0)
    .map(line => parseInt(line, 16))
  assert.deepEqual(set, JS_WHITESPACE)
})

// ---------------------------------------------------------------------------
// 4. 真 JVM：键与去重的差分（含任务书点名的四个场景）
// ---------------------------------------------------------------------------

/** 任务书点名必须钉住的四个场景 + 一批"容易错"的字符。 */
const NAMED_CASES = [
  // [说明, name, singer]
  ['NBSP（U+00A0）在首尾：String.trim() 吃不到它，JS 的 trim() 吃得到', '\u00a0Song\u00a0', 'Singer'],
  ['U+3000（表意空格）在首尾：String.trim() 同样吃不到', '\u3000Song\u3000', '\u3000Singer\u3000'],
  ['首尾空白 + 中间多空格（中间的不许动）', '  Song  Name  ', '  The  Singer  '],
  ['土耳其语环境下的 I / İ / ı：无参 toLowerCase() 会算错', 'I', 'İ'],
  ['土耳其语环境下小写点 i 与无点 ı 不许被合并', 'i', 'ı'],
  ['NFKC：全角字母折叠成半角', 'Ｓｏｎｇ', 'Ｓｉｎｇｅｒ'],
  ['NFKC：连字 ﬁ 折叠成 fi', 'ﬁne', 'Singer'],
  ['NFKC：带圈数字 ①', '①Song', 'Singer'],
  ['名字与歌手只差大小写 ⇒ 同一首', 'SONG', 'singer'],
  ['名字空 ⇒ 退化成 id 键（JS 的 `name && singer`）', '', 'Singer'],
  ['歌手空 ⇒ 退化成 id 键', 'Song', ''],
  ['名字与歌手都是空白 ⇒ trim 之后都是空 ⇒ 退化成 id 键', '\u3000\u3000', '\u00a0'],
]

test('点名的四个场景 + 易错字符：Java 的键与 JS 的键逐字节相同', { skip: SKIP_REASON }, () => {
  const rows = NAMED_CASES.map(([, name, singer], index) => ({ id: `m-${index}`, name, singer }))
  const rowsHex = rows.map(row => [toHexUnits(row.id), toHexUnits(row.name), toHexUnits(row.singer)].join('|'))
  const actual = probe('key', [writeCorpus('corpus-named.txt', rowsHex)])
  for (let i = 0; i < rows.length; i++) {
    assert.equal(
      actual[i].replace(/\r$/, ''),
      toHexUnits(getPlaybackQueueMusicKey(rows[i])),
      `第 ${i} 条（${NAMED_CASES[i][0]}）的键不同：\n  Java=${fromHexUnits(actual[i].replace(/\r$/, ''))}\n  JS  =${getPlaybackQueueMusicKey(rows[i])}`,
    )
  }
  // 顺手把"这两条键相同 / 不同"的**意图**写死（差分只能证明两边一致，证明不了意图对）。
  assert.equal(
    getPlaybackQueueMusicKey({ id: 'a', name: '\u00a0Song\u00a0', singer: 'Singer' }),
    getPlaybackQueueMusicKey({ id: 'b', name: 'song', singer: 'singer' }),
    'NBSP 首尾 + 大小写差异必须算同一首（Java 侧由上面那条差分守着）',
  )
  assert.notEqual(
    getPlaybackQueueMusicKey({ id: 'a', name: 'i', singer: 'x' }),
    getPlaybackQueueMusicKey({ id: 'b', name: 'ı', singer: 'x' }),
    '土耳其语的点 i 与无点 ı 不是同一首',
  )
})

/** 确定性伪随机（不用 Math.random：失败要能原样重现）。 */
const makeRandom = seed => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const TRICKY_POOL = [
  '', ' ', '  ', '\t', '\n', '\r', '\u00a0', '\u3000', '\u2007', '\ufeff', '\u2028', '\u2029', '\u200b',
  'İ', 'ı', 'I', 'i', 'Σ', 'σ', 'ς', 'ß', 'ẞ', 'ﬁ', 'Ａ', 'ａ', '①', 'ＡＢ', '\u030a', 'Å',
  '"', '\\', '\u0001', '\u001f', '\b', '\f', 'Song', 'song', 'SONG', '🎵', '\ud83d\ude00', '\ud800', '\udfff',
  '歌手', '歌手 ', ' 歌手', '周杰倫', '周杰伦',
]

test('随机语料（确定性种子）300 组：Java 的键与 JS 的键逐字节相同（含转义、孤立代理项）', { skip: SKIP_REASON }, () => {
  const random = makeRandom(20240601)
  const rows = []
  for (let i = 0; i < 300; i++) {
    const pick = () => {
      const value = TRICKY_POOL[Math.floor(random() * TRICKY_POOL.length)]
      return value
    }
    rows.push({
      id: random() < 0.05 ? null : `${pick() === '' ? 'id' : pick()}#${i}`,
      name: random() < 0.08 ? null : pick(),
      singer: random() < 0.08 ? null : pick(),
    })
  }
  const lines = rows.map(row => [
    row.id === null ? '-' : toHexUnits(row.id),
    row.name === null ? '-' : toHexUnits(row.name),
    row.singer === null ? '-' : toHexUnits(row.singer),
  ].join('|'))
  const actual = probe('key', [writeCorpus('corpus-random.txt', lines)])
  for (let i = 0; i < rows.length; i++) {
    const expected = getPlaybackQueueMusicKey(rows[i])
    assert.equal(fromHexUnits(actual[i].replace(/\r$/, '')), expected, `第 ${i} 组的键不同：${JSON.stringify(rows[i])}`)
  }

  // 去重也做一遍：JS 的 dedupePlaybackQueue 会删掉哪些行 == Java 的 findDuplicates 删掉哪些行。
  const duplicateLines = rows.map(row => [
    row.id === null ? '-' : toHexUnits(row.id),
    row.name === null ? '-' : toHexUnits(row.name),
    row.singer === null ? '-' : toHexUnits(row.singer),
  ].join('|'))
  const dropped = probe('dupes', [writeCorpus('corpus-dupes.txt', duplicateLines)])[0].replace(/\r$/, '')
  const javaDropped = dropped === '' ? [] : dropped.split(',').map(Number)
  const kept = dedupePlaybackQueue(rows)
  const jsDropped = rows.map((_, index) => index).filter(index => !kept.includes(rows[index]))
  assert.deepEqual(javaDropped, jsDropped, 'Java 删掉的行与 JS 的 dedupePlaybackQueue 不同（"留下哪一条"也会因此不同）')
})

test('去重的边界：三条同名只删后两条、id 相同即使名字不同也只留第一条（与 JS 逐条对照）', { skip: SKIP_REASON }, () => {
  const rows = [
    { id: 'a', name: 'Same', singer: 'S' },
    { id: 'b', name: 'same', singer: 's' }, // 键相同 ⇒ 删
    { id: 'c', name: 'Same', singer: 'S' }, // 键相同 ⇒ 删
    { id: 'a', name: 'Other', singer: 'X' }, // id 重复 ⇒ 删
    { id: 'd', name: '', singer: 'S' }, // 空名字 ⇒ 用 id 键 ⇒ 留
    { id: 'd', name: 'Anything', singer: 'Y' }, // id 重复 ⇒ 删
    { id: 'e', name: 'New', singer: 'S' }, // 留
    { id: null, name: '', singer: '' }, // id=null 的 [id,null] 键 ⇒ 留
    { id: null, name: '', singer: '' }, // 键与 id 都重复 ⇒ 删
  ]
  const lines = rows.map(row => [
    row.id === null ? '-' : toHexUnits(row.id),
    toHexUnits(row.name),
    toHexUnits(row.singer),
  ].join('|'))
  const dropped = probe('dupes', [writeCorpus('corpus-order.txt', lines)])[0].replace(/\r$/, '')
  const javaDropped = dropped === '' ? [] : dropped.split(',').map(Number)
  const kept = dedupePlaybackQueue(rows)
  assert.deepEqual(javaDropped, rows.map((_, index) => index).filter(index => !kept.includes(rows[index])))
  assert.deepEqual(javaDropped, [1, 2, 3, 5, 8], '这一组是本用例自己设定的期望（不是从 JS 抄的）')
})

test('已知差异：JS 的 Set 区分 null 与 undefined（Java 侧两者都是 null）—— 因列是 NOT NULL 而不可达', () => {
  // ⚠️ 这一条**不是**差分，是把"唯一一处两边不严格等价"写下来并证明它不可达。
  // 注意键本身在两边的形状一致，所以只有"名字/歌手都非空、id 一个是 undefined 一个是 null"时才有差别。
  const js = dedupePlaybackQueue([
    { id: undefined, name: 'A1', singer: 'B' },
    { id: null, name: 'A2', singer: 'B' },
  ])
  assert.equal(js.length, 2, 'JS 认为 undefined 与 null 是两个不同的 id ⇒ 两条都留下')

  // Java 侧：`MusicRow.id` 都是 `null`，`HashSet<String>` 认为它们是同一个元素 ⇒ 第二条会被判成重复。
  // 这条差异**不可达**：id 来自 `my_list_music_info."id"`（`TEXT NOT NULL`），
  // `cursor.getString` 只会给 String 或 null，**永远不会有 undefined**。
  assert.match(read('src/main/worker/dbService/tables.ts'), /"id" TEXT NOT NULL/)
  assert.match(keyCode, /if \(ids\.contains\(row\.id\) \|\| keys\.contains\(key\)\)/)
  // 键本身在两者上一样（`?? ''` 与 `JSON.stringify` 都把 null / undefined 变成 null）。
  assert.equal(
    getPlaybackQueueMusicKey({ id: undefined, name: '', singer: '' }),
    getPlaybackQueueMusicKey({ id: null, name: '', singer: '' }),
  )
})

// ---------------------------------------------------------------------------
// 5. 真 JVM：节流闸门的行为（警告"别每次读都刷"靠它）
// ---------------------------------------------------------------------------

test('节流闸门：首次放行 / 窗口内拦掉 / 过窗口再放行 / 签名变了立刻放行 / null 签名拦掉', { skip: SKIP_REASON }, () => {
  const scenario = [
    ['a', 0], // 首次 ⇒ true
    ['a', 1], // 窗口内 ⇒ false
    ['a', 999], // 还差 1ms ⇒ false
    ['a', 1000], // 窗口正好到 ⇒ true
    ['b', 1001], // 换了签名 ⇒ true
    ['b', 1500], // 窗口内 ⇒ false
    ['-', 2000], // null 签名 ⇒ false（无从判断是不是同一件事）
    ['b', 0], // 时钟倒退 ⇒ false（宁可少说一句，不刷屏）
    ['b', 2000], // 还是窗口内（上次放行在 1001）⇒ false
    ['b', 2001], // 窗口到 ⇒ true
  ]
  const file = writeCorpus('throttle.txt', scenario.map(([signature, nowMs]) => `${signature === '-' ? '-' : toHexUnits(signature)}|${nowMs}`))
  const actual = probe('throttle', ['1000', file]).filter(line => line.length > 0).map(line => line.replace(/\r$/, '') === 'true')
  assert.deepEqual(actual, [true, false, false, true, true, false, false, false, false, true])

  // 窗口 0 = 每次放行（本刀不用它，但边界要被钉住）。
  const zero = probe('throttle', ['0', writeCorpus('throttle0.txt', [toHexUnits('a') + '|1', toHexUnits('a') + '|1'])])
  assert.deepEqual(zero.filter(line => line.length > 0).map(line => line.replace(/\r$/, '') === 'true'), [true, true])
})

