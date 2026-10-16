const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { test } = require('node:test')
const root = path.resolve(__dirname, '../..')

const read = file => fs.readFileSync(path.join(root, file))
const readText = file => read(file).toString('utf8')
const sha256 = file => crypto.createHash('sha256').update(read(file)).digest('hex')
const res = file => `android/app/src/main/res/${file}`

// PNG 的 IHDR 里直接写着宽高与颜色类型（宽 16..20、高 20..24、颜色类型 25），
// 不为了两句断言去引一个图像解码器。
const png = file => {
  const buffer = read(res(file))
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} 不是 PNG`)
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', `${file} 缺少 IHDR`)
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25], // 6 = RGBA（带 alpha）、2 = RGB
  }
}

// `npx cap add android` 铺出来的那套 Capacitor 默认素材的 sha256，取自未改动过的
// 脚手架提交 `846b3ffe`。它们**不该再出现**：这套图是白底圆角方块 + Capacitor 的 logo，
// 编译、单测、CI 全绿，装到手机上桌面图标和启动屏却是 Capacitor 的 —— 正是
// "只能在设备上看见"的那一类，所以这里把"默认图回来了"钉成红灯。
const SCAFFOLD_ART = {
  'mipmap-mdpi/ic_launcher.png': '27ed3603010ebc278f64f8645741ab132ff517abb5308eb9df6c8e42a48956b2',
  'mipmap-xxxhdpi/ic_launcher.png': '87cb2f2ffe992652bb4fa768c73719a37b5852ab17fbf8e170e888f7a42b0761',
  'mipmap-xxxhdpi/ic_launcher_round.png': 'ab93096331e7cd8ec379f73f1e9adcaaa9ee1115c9f4ff10411a811fb9700174',
  'mipmap-xxxhdpi/ic_launcher_foreground.png': 'bd24fd383253bf8d43f0a81f11c071d76d1d555114376dd647cd9fb38fa0a9da',
  'drawable/splash.png': '5cf98b4451bd99b20df26f9e608a46946118be6b0ae90762f9ca1786a30c76ff',
  'drawable-port-xxxhdpi/splash.png': '3db071a03b2f8ffe0dfd4170fc59842d53cd15bba5e88af59401d58efabf7827',
}

test('Android 的桌面名称与包标识是改名后的品牌，而且 manifest 用的就是这两个串', () => {
  // 桌面图标下面那行字就是 `app_name`。它**任何门禁都测不到**：编译通过、472 个单测全绿、
  // 9 个 UI 套件全绿，装到手机上却可能写着别的名字。`package_name` / `custom_url_scheme`
  // 是 Capacitor 的 deep-link 约定（`@string/package_name` 同样被 manifest 引用），一并钉死。
  const strings = readText(res('values/strings.xml'))
  const value = name => new RegExp(`<string name="${name}">([^<]*)</string>`).exec(strings)?.[1]
  assert.equal(value('app_name'), 'Rain Music')
  assert.equal(value('title_activity_main'), 'Rain Music')
  assert.equal(value('package_name'), 'com.rainmusic.mobile')
  assert.equal(value('custom_url_scheme'), 'com.rainmusic.mobile')

  // 而且 manifest 指向的必须是这两个串：否则字符串改了也不会显示出来（引用会静默失效）
  const manifest = readText('android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android:label="@string\/app_name"/)
  assert.match(manifest, /android:label="@string\/title_activity_main"/)
})

test('安装后的图标与启动图是 Rain Music 品牌素材，不是脚手架铺的 Capacitor 默认图', () => {
  // 三档尺寸表与 `cap add` 原产**逐一同尺寸**（见 scripts/gen-android-icons.py）：尺寸一变
  // 就是启动图被拉伸或缺边，而这类问题同样只在设备上看得见。
  const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
  const foreground = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
  const splash = {
    drawable: [480, 320],
    'drawable-port-mdpi': [320, 480],
    'drawable-port-hdpi': [480, 800],
    'drawable-port-xhdpi': [720, 1280],
    'drawable-port-xxhdpi': [960, 1600],
    'drawable-port-xxxhdpi': [1280, 1920],
    'drawable-land-mdpi': [480, 320],
    'drawable-land-hdpi': [800, 480],
    'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960],
    'drawable-land-xxxhdpi': [1920, 1280],
  }

  for (const [density, size] of Object.entries(legacy)) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const file = `mipmap-${density}/${name}`
      const { width, height, colorType } = png(file)
      assert.deepEqual([width, height], [size, size], `${file} 尺寸不对`)
      // 传统图标自带圆角/圆形轮廓，必须保留 alpha；丢了 alpha 就变成一张白底方块
      assert.equal(colorType, 6, `${file} 丢了 alpha 通道`)
    }
  }

  for (const [density, size] of Object.entries(foreground)) {
    const file = `mipmap-${density}/ic_launcher_foreground.png`
    const { width, height, colorType } = png(file)
    // 自适应图标前景是 108dp 画布：字形只占中间的安全区，其余必须透明，否则启动器不管
    // 裁成什么形状都会露出一个方块
    assert.deepEqual([width, height], [size, size], `${file} 尺寸不对`)
    assert.equal(colorType, 6, `${file} 必须是带 alpha 的图，否则自适应图标会出现方块底`)
  }

  for (const [folder, size] of Object.entries(splash)) {
    const file = `${folder}/splash.png`
    const { width, height, colorType } = png(file)
    assert.deepEqual([width, height], size, `${file} 尺寸不对`)
    assert.equal(colorType, 2, `${file} 应为不透明底色（RGB）`)
  }

  // 自适应图标的背景色：脚手架是 #FFFFFF，品牌是 #000000。这一条同时代表"上面那张
  // 前景图会被贴在黑底上"，也就是设备上真正看到的那个圆。
  assert.match(readText(res('values/ic_launcher_background.xml')), /<color name="ic_launcher_background">#000000<\/color>/)

  // 最后一道：脚手架默认素材一个都不许回来（`cap add` / `cap sync` 之后手滑还原最容易发生）
  for (const [file, hash] of Object.entries(SCAFFOLD_ART)) {
    assert.notEqual(sha256(res(file)), hash, `${file} 又是 Capacitor 的脚手架默认图了`)
  }
})

test('手写的 Android 源码与资源里不残留旧品牌名', () => {
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (/\.(xml|java)$/.test(entry.name)) files.push(child)
    }
  }
  walk('android/app/src/main/res')
  walk('android/app/src/main/java')
  files.push(
    'android/app/src/main/AndroidManifest.xml',
    'android/app/build.gradle',
    'android/variables.gradle',
    'capacitor.config.ts',
  )

  // 扫描面**由 git 界定，而不是由人去记**：`cap sync` 会在 `res/` 与 `assets/` 里生成
  // 产物（`android/.gitignore:96-101` 忽略 `assets/**`、`res/xml/config.xml`），它们只在
  // 开发机上存在。这一条是花了一次 CI 才换来的 —— 最初把 `assets/capacitor.config.json`
  // 与 `res/xml/config.xml` 都扫了进来：**本机全绿，CI 却 `# fail 1` + `ENOENT`**。
  // 顺带说明为什么 `assets/public/**` 里的 `lx.request` 不算品牌残留：那是自定义源脚本的
  // **对外 API 名**（worker-runtime.js 同时以 `lx` / `rain` 暴露同一个对象，改名会打断
  // 社区脚本），属兼容契约，且那份产物另有 `build-android.yml` 的同步产物守卫。
  const tracked = new Set(
    execFileSync('git', ['ls-files', 'android', 'capacitor.config.ts'], { cwd: root, encoding: 'utf8' })
      .split('\n').map(line => line.trim()).filter(Boolean),
  )
  const scanned = files.filter(file => tracked.has(file))

  // 过滤掉生成产物之后，**手写面必须仍然完整** —— 否则这条测试会在"没扫到东西"的情况下假绿
  assert.ok(scanned.length > 20, '受版本控制的手写面太窄了，说明目录结构变了')
  for (const must of [
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/res/values/strings.xml',
    'android/app/src/main/res/values/styles.xml',
    'capacitor.config.ts',
  ]) {
    assert.ok(scanned.includes(must), `${must} 不在扫描面里了`)
  }

  const LEGACY = /\bLX\b|lx-?music|lx music|落雪|龙溪|com\.lx/i
  const offenders = scanned.filter(file => LEGACY.test(readText(file)))
  assert.deepEqual(offenders, [])
})
