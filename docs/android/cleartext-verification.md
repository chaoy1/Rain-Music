# Android 明文流量 + CORS 真机验证清单

> **这是给"手上有一台 Android 真机 + 装了 Android SDK 的人"照做的步骤清单。**
> 目标：回答"kg / wy / tx 三个内置音源在真机上还能不能发请求"这一个问题，并据此定下
> `AndroidManifest.xml` / `network_security_config.xml` 的最终配置。
>
> 登记于：Android 移植 **阶段 3 / 线 B**。上游口径来自
> `docs/android-port-plan.md` §5（阶段 1 待验证项）与
> `docs/android/native-bridge-needs.md` §2.6.4、§3「第 2 件」。
> 本文把它们合并成**一份可以独立执行**的清单，并补上阶段 3b 的新证据与两处**结论纠正**。
>
> **本文自己没有做真机验证**（本机没有 `adb`、没有 Android SDK、没有真机 —— 见 §1.2 实测）。
> 凡是"需要真机才能确认"的地方都标了 **[待真机]**。
> 证据等级标记：
> - **[本地源码]** = 从已安装的 `node_modules/@capacitor/**@8.5.2` 里读到的代码（可复现、最硬）；
> - **[官方文档]** = 从 capacitorjs.com / Android 官方文档读到的原文（附链接）；
> - **[阶段 1 实测]** = 阶段 1 在本仓库里跑出来的结果，见 `docs/android-port-plan.md` §5.1；
> - **[本轮实测]** = 阶段 3b 在本机跑出来的统计（§7、附录 A）；
> - **[未验证]** / **[待真机]** = 没有被证实，不要当结论用。

---

## 0. 一页速览

| 问题 | 当前答案 | 依据 |
| --- | --- | --- |
| 明文 HTTP 请求有多少处？ | **28 处**真实明文请求 URL（复核结果见 §7） | [本轮实测] |
| 它们被谁挡住？ | ① Android **明文流量策略**（API 28+ 默认禁）；② WebView 的**混合内容**拦截（因为页面 origin 默认是 `https://localhost`） | [官方文档] + [本地源码] |
| 当前 manifest 放开了吗？ | **没有**。`android:usesCleartextTraffic` 不存在，`res/xml/network_security_config.xml` 也不存在 | [阶段 1 实测] + §3 的复核 |
| CapacitorHttp 能绕开吗？ | 能绕开 **CORS**；**绕不开明文策略**。它走应用进程的原生网络栈，仍然受 Network Security Config / `usesCleartextTraffic` 约束 | [官方文档] + [本地源码] |
| CapacitorHttp 现在是开的吗？ | **没有**。`capacitor.config.ts` 里没有 `plugins` 段，生成的 `android/app/src/main/assets/capacitor.config.json` 里也没有 | §3 复核 |
| 需要改哪些文件？ | 最可能是新增 `android/app/src/main/res/xml/network_security_config.xml` + 在 manifest 的 `<application>` 上挂 `android:networkSecurityConfig`；是否要动 `usesCleartextTraffic` 由 §4 的矩阵结果决定 | §5 |
| 必须交回什么？ | §6 的 5 项产物（含**矩阵结果表**） | §6 |

**一句话**：先按 §2 把产物装进真机，再按 §4 跑矩阵 —— **矩阵结果决定 §5 怎么配**，不要提前猜。

---

## 1. 前置条件

### 1.1 你需要的环境

| 需要 | 用途 | 怎么确认 |
| --- | --- | --- |
| Android 真机（API 28+，即 Android 9+） | 被验证对象 | `adb devices` 能看到设备 |
| `adb`（Android Platform Tools） | 装包 / logcat / 反查配置 | `adb version` |
| Android SDK（`sdkmanager` 里的 `platforms;android-36`、`build-tools`） | `./gradlew assembleDebug` | `android/local.properties` 里有 `sdk.dir=...` |
| JDK **21** | Capacitor 8 的 `capacitor.build.gradle` 要求 `VERSION_21` | `java -version` |
| Node + 本仓库依赖 | `npm run build:web`、`npx cap` | `node -v` |
| 与手机同一个局域网的 PC | §4.4 的"头透传探针"要跑一个本地回显服务器 | `ipconfig` 拿到 PC 的 IPv4 |

### 1.2 本机（编写本文的机器）的实测状态 —— 所以本文没做真机验证

```
adb            : NOT FOUND
ANDROID_HOME   : (空)
ANDROID_SDK_ROOT: (空)
android/local.properties : 不存在（空）
android/gradlew          : 存在（Gradle wrapper 8.14.3）
```

→ **本机无法出 APK、无法连真机**。§4 的矩阵必须在有 SDK 的机器上跑。

### 1.3 已经确定、不用再查的参数

| 项 | 值 | 来源 |
| --- | --- | --- |
| `minSdkVersion` | 24 | `android/variables.gradle` |
| `compileSdkVersion` / `targetSdkVersion` | **36** / **36** | 同上（远高于 API 28，所以默认禁明文这条一定生效） |
| `applicationId` | `com.rainmusic.mobile` | `android/app/build.gradle` |
| Capacitor 版本 | `@capacitor/core` / `cli` / `android` = **8.5.2** | `package.json:106,162,163` |
| 页面 origin | 默认 **`https://localhost`**（`server.androidScheme` 的官方默认值是 `https`） | [官方文档] `@capacitor/cli` `declarations.ts`：`androidScheme` `@default https` |
| `webDir` | `dist-web` | `capacitor.config.ts` |
| 注册的原生插件 | 只有内置的（`capacitor.plugins.json` = `[]`） | `android/app/src/main/assets/capacitor.plugins.json` |

> ⚠️ **结论纠正 1（阶段 3b 新增）**：`docs/android/native-bridge-needs.md` §2.6.4 末段写
> "Android 端 Capacitor 默认以 `http://localhost` 提供页面，源不是 HTTPS，所以 `http://`
> 子请求**不构成混合内容拦截**" —— 这一条**对本版本不成立**。Capacitor 8 的
> `server.androidScheme` 默认是 **`https`**，页面 origin 是 `https://localhost`，
> 因此从页面直接 `fetch('http://…')` 会**同时**撞两堵墙：
> ① 明文流量策略；② **混合内容**（`android.allowMixedContent` 的官方默认值也是 `false`）。
> Android 官方文档对混合内容的说明：<https://developer.android.com/privacy-and-security/risks/cleartext-communications>。
> 这两堵墙的报错**不一样**，§4.4 给了区分方法 —— 这直接影响你该怎么修。

---

## 2. 第一步：把当前 web 产物装进真机

两条路，**推荐 A**（用仓库里已有的 `android/`，环境已经配好；B 只在你怀疑"是不是本项目
代码自己搞的鬼"时才用）。

### 2.1 方案 A：用仓库里已有的 `android/`（推荐）

```powershell
# 0) 确认没有正在跑的桌面版占用构建目录（不要让构建去抢 build/）
Get-Process rain-music-desktop, electron -ErrorAction SilentlyContinue

# 1) 出面向 Web 的渲染层产物（输出到 dist-web/）
npm run build:web

# 2) 把 dist-web/ 拷进 android 工程（Capacitor 会写成 assets/public/）
npx cap copy android
#   如果这一步同时要更新原生依赖（插件清单变了），用 npx cap sync android

# 3) 确认拷贝真的发生了：assets/public 里的 renderer.* 文件名应当等于 dist-web 里的
Get-ChildItem dist-web\renderer.*.js | Select-Object Name
Get-ChildItem android\app\src\main\assets\public\renderer.*.js | Select-Object Name

# 4) 出 debug APK（需要 android/local.properties 指向 SDK）
cd android
.\gradlew.bat assembleDebug
cd ..

# 5) 装到真机
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

> ⚠️ **`assets/public/` 里现在放的是旧产物**（`renderer.d536c245.js`），而当前 `dist-web/`
> 出的是 `renderer.48da6585.js`（阶段 3b 构建）。**不跑第 2 步就直接 `gradlew` 会装到一个
> 不含本轮改动的旧包上**，验证结论就作废了。第 3 步就是防这个。

真机调试面板：

```powershell
adb devices
# Capacitor 在 dev 环境自动开启 WebView 调试；打开 chrome://inspect 就能看到这个 WebView
# 看不到时手动确认：capacitor.config.ts 的 android.webContentsDebuggingEnabled 或直接用
# `npx cap run android --livereload` 走 dev 模式
adb logcat -c            # 清一次日志
adb logcat -v time | Select-String -Pattern "Capacitor|chromium|ERR_CLEARTEXT|Mixed Content|Cleartext"
```

### 2.2 方案 B：最小 Capacitor demo（不接本项目代码）

只有在你要排除"是不是本项目的 webpack/适配器把请求搞坏了"时才需要：

```powershell
mkdir rain-cleartext-probe; cd rain-cleartext-probe
npm init -y
npm i @capacitor/core@8.5.2 @capacitor/cli@8.5.2 @capacitor/android@8.5.2
npx cap init "Probe" com.rainmusic.cleartextprobe --web-dir=www
# 放一个 www/index.html，内容就是 §4.3 的探针脚本
npx cap add android
npx cap copy android
cd android; .\gradlew.bat assembleDebug; cd ..
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

方案 B 的 `capacitor.config.json` 与方案 A 是同一套字段（`plugins.CapacitorHttp.enabled`、
`server.androidScheme`、`android.allowMixedContent`），所以 §3–§5 的步骤**完全通用**。
方案 B 的好处是可以**逐个变量单独开**，把"是不是明文策略在挡"钉死。

---

## 3. 第二步：先记录"出厂配置"（这一步只读，不改代码）

**必须在改任何配置之前做**，否则你无法回答"原来的默认值到底是什么"。

```powershell
Write-Host "=== ① manifest 里有没有 usesCleartextTraffic / networkSecurityConfig ==="
Select-String -Path android\app\src\main\AndroidManifest.xml -Pattern "usesCleartextTraffic|networkSecurityConfig|android:debuggable"

Write-Host "=== ② network_security_config.xml 存在吗 ==="
Test-Path android\app\src\main\res\xml\network_security_config.xml
Get-ChildItem android\app\src\main\res\xml

Write-Host "=== ③ 原生实际读到的 capacitor 配置（这是 native 侧真正看的文件）==="
Get-Content android\app\src\main\assets\capacitor.config.json -Raw

Write-Host "=== ④ 插件清单 ==="
Get-Content android\app\src\main\assets\capacitor.plugins.json -Raw

Write-Host "=== ⑤ SDK 版本 ==="
Get-Content android\variables.gradle
```

**装置内的交叉验证**（比看源码更硬 —— 它读的是**装到手机上的那个 APK**）：

```powershell
# 从设备上把真正生效的 manifest 拉下来看（需要 aapt2，SDK build-tools 里有）
adb shell pm dump com.rainmusic.mobile | Select-String -Pattern "cleartext|networkSecurityConfig"
# 或者
adb shell dumpsys package com.rainmusic.mobile | Select-String -Pattern "flags|targetSdk"
```

**阶段 3b 在仓库里复核到的值（[阶段 1 实测] 一致）**：

| 检查项 | 实际值 |
| --- | --- |
| `android:usesCleartextTraffic` | **不存在**（`<application>` 上没有这个属性） |
| `android:networkSecurityConfig` | **不存在** |
| `res/xml/network_security_config.xml` | **不存在**（`res/xml/` 只有 `config.xml`、`file_paths.xml`） |
| `assets/capacitor.config.json` | `{ "appId": "com.rainmusic.mobile", "appName": "Rain Music", "webDir": "dist-web" }` —— **没有 `plugins` 段、没有 `server` 段** |
| `assets/capacitor.plugins.json` | `[]` |
| `targetSdkVersion` | `36` |

**推论（必须先承认这一点再往下走）**：`targetSdk = 36` ≥ 28，且 manifest **没有**任何放开明文
的配置 → **按 Android 的默认行为，明文请求会被系统拦掉**（`net::ERR_CLEARTEXT_NOT_PERMITTED`）。
§4 就是去证实/证伪这条推论。

---

## 4. 第三步：真机矩阵（核心步骤）

### 4.1 三种（其实是四种）请求方式

矩阵的"行"要覆盖这四种走法 —— 因为它们的**行为不一样**（见 §4.5）：

| 编号 | 走法 | 怎么发起 |
| --- | --- | --- |
| **M1** | 原生 `fetch`（**未**开 patch） | `fetch(url, init)` |
| **M2** | `fetch`（**已**开 `CapacitorHttp.enabled`，patch 生效） | 同上，代码不用改 |
| **M3** | `CapacitorHttp.request(...)` 显式调用 | `window.Capacitor.Plugins.CapacitorHttp.request({...})` |
| **M4** | `XMLHttpRequest`（patch 生效后） | `new XMLHttpRequest()` |

> **为什么 M3 不用 `import`**：本项目的 web 产物**刻意不 import `@capacitor/*`**
> （`src/renderer/platform/http/web.js` 顶部注释说明了理由）。但 Capacitor 原生侧会注入
> `window.Capacitor = { Plugins: {} }` 并把每个原生插件的方法挂上去
> （**[本地源码]** `JSExport.java:21` 注入 `window.Capacitor = {...}`；`:155-186` 为每个
> `@PluginMethod` 生成 `t['request'] = function(_options){ return Capacitor.nativePromise('CapacitorHttp','request',_options) }`），
> 所以**在 WebView 控制台里可以直接 `window.Capacitor.Plugins.CapacitorHttp.request(...)`**，
> 不需要往 bundle 里加任何 import。这是 M3 的可行依据。

### 4.2 端点表（全部来自 §7 复核出的 28 处明文 URL）

`http://` 组（被测对象）：

| # | 端点 | 方法 | 来自 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `http://interface.music.163.com/eapi/batch` | POST | `wy/utils/index.js:5` | **wy 的核心数据路径**：搜索/热搜/歌手/歌单/歌词全走它 |
| 2 | `http://songsearch.kugou.com/song_search_v2?keyword=test` | GET | `kg/musicSearch.js:12` | kg 搜索 |
| 3 | `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=test` | GET | `kg/lyric.js:39` | kg 歌词搜索 |
| 4 | `http://mobiles.kugou.com/api/v5/singer/info?singerid=1` | GET | `kg/singer.js:11` | kg 歌手 |
| 5 | `http://gateway.kugou.com/v2/album_audio/audio` | POST | `kg/songList.js:304` | kg 歌单详情 |
| 6 | `http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=0&num_per_page=1&format=json&query=test` | GET | `tx/songList.js:401` | tx 歌单搜索 |
| 7 | `http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg` | POST | `tx/comment.js:95` | tx 评论 |

`https://` 对照组（必须是**同一批音源**，否则你分不清"是明文被拦"还是"整个域名都不通"）：

| # | 端点 | 方法 | 来自 |
| --- | --- | --- | --- |
| C1 | `https://u.y.qq.com/cgi-bin/musicu.fcg` | POST | `tx/utils/index.js:9`、`tx/hotSearch.js:15` |
| C2 | `https://interface3.music.163.com/eapi/song/lyric/v1` | POST | `wy/lyric.js` (eapi) |
| C3 | `https://music.163.com/weapi/v3/song/detail` | POST | `wy/musicInfo.js:6`（**weapi，会走 RSA**） |
| C4 | `https://gateway.kugou.com/v3/search/complex` | GET | kg 的 https 对照 |

> **重要方法论**：本矩阵验证的是"**请求有没有离开设备**"，不是"业务有没有成功"。
> 这些接口在没有正确签名/参数时**会返回 4xx/5xx**，那**恰恰是成功**（证明明文可达）。
> 只有**系统级失败**（见 §4.4 的错误指纹表）才算"被挡"。

### 4.3 在 WebView 控制台里一次跑完矩阵（照抄即可）

1. `chrome://inspect` → 找到本应用的 WebView → `inspect`；
2. 把下面这段**整段**粘进 Console，回车；
3. 它会打印一张表，并把结果同时挂到 `window.__CLEARTEXT_MATRIX__`（方便 `copy(JSON.stringify(...))` 拷出来）。

```js
(async () => {
  const ENDPOINTS = [
    { id: 'wy-eapi-batch',   proto: 'http',  method: 'POST', url: 'http://interface.music.163.com/eapi/batch', body: 'params=probe' },
    { id: 'kg-search',       proto: 'http',  method: 'GET',  url: 'http://songsearch.kugou.com/song_search_v2?keyword=test' },
    { id: 'kg-lyric-search', proto: 'http',  method: 'GET',  url: 'http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=test' },
    { id: 'kg-singer',       proto: 'http',  method: 'GET',  url: 'http://mobiles.kugou.com/api/v5/singer/info?singerid=1' },
    { id: 'kg-album-audio',  proto: 'http',  method: 'POST', url: 'http://gateway.kugou.com/v2/album_audio/audio', body: '{}' },
    { id: 'tx-search-list',  proto: 'http',  method: 'GET',  url: 'http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=0&num_per_page=1&format=json&query=test' },
    { id: 'tx-comment',      proto: 'http',  method: 'POST', url: 'http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', body: '{}' },
    { id: 'CTRL-tx-musicu',  proto: 'https', method: 'POST', url: 'https://u.y.qq.com/cgi-bin/musicu.fcg', body: '{}' },
    { id: 'CTRL-wy-weapi',   proto: 'https', method: 'POST', url: 'https://music.163.com/weapi/v3/song/detail', body: 'params=probe' },
    { id: 'CTRL-kg-complex', proto: 'https', method: 'GET',  url: 'https://gateway.kugou.com/v3/search/complex?keyword=test' },
  ]
  const HDRS = {
    'User-Agent': 'RainMusic-Probe/1.0',
    Referer: 'https://y.qq.com/portal/player.html',
    Origin: 'https://y.qq.com',
    Cookie: 'MUSIC_U=probe; kg_mid=probe',
  }

  const rows = []
  const log = (...a) => console.log('%c[probe]', 'color:#0a0', ...a)

  // 关键：抓 console 里的 CORS / mixed content / cleartext 报错
  // （它们是异步打的，所以每跑一格都把当时的 report 抓一份）
  const run = async (mode, ep) => {
    const label = `${mode} · ${ep.id} · ${ep.proto}`
    const init = { method: ep.method, headers: { ...HDRS } }
    if (ep.body) init.body = ep.body
    const t0 = performance.now()
    try {
      let out
      if (mode === 'M1' || mode === 'M2') {
        const res = await fetch(ep.url, init)
        out = { ok: true, status: res.status, type: res.type, url: res.url }
      } else if (mode === 'M3') {
        const res = await window.Capacitor.Plugins.CapacitorHttp.request({
          url: ep.url, method: ep.method, headers: { ...HDRS }, data: ep.body,
        })
        out = { ok: true, status: res.status, type: 'native', url: res.url, headers: res.headers }
      } else {
        out = await new Promise((resolve) => {
          const xhr = new XMLHttpRequest()
          xhr.open(ep.method, ep.url, true)
          for (const [k, v] of Object.entries(HDRS)) xhr.setRequestHeader(k, v)
          xhr.onload = () => resolve({ ok: true, status: xhr.status, type: 'xhr', url: xhr.responseURL })
          xhr.onerror = () => resolve({ ok: false, status: 0, error: 'xhr onerror（被拦或网络不可达）' })
          xhr.send(ep.body ?? null)
        })
      }
      out.ms = Math.round(performance.now() - t0)
      rows.push({ label, ...out })
      log(label, out)
    } catch (e) {
      rows.push({ label, ok: false, ms: Math.round(performance.now() - t0), error: String((e && e.message) || e), name: e && e.name })
      log(label, 'FAILED', e)
    }
  }

  for (const mode of ['M1', 'M2', 'M3', 'M4']) {
    for (const ep of ENDPOINTS) await run(mode, ep)
  }

  console.table(rows)
  window.__CLEARTEXT_MATRIX__ = rows
  console.log('拷出结果：copy(JSON.stringify(window.__CLEARTEXT_MATRIX__, null, 1))')
})()
```

**分轮次跑**（这是关键，别一轮跑完）：

| 轮次 | 先做的配置改动 | 要跑的 mode | 目的 |
| --- | --- | --- | --- |
| **R1** | 无（出厂配置，CapacitorHttp **关**） | M1、M4 | 拿到"纯 WebView"的基线：**预期 M1/M4 的 `http://` 全挂**（CORS 和/或明文/混合内容） |
| **R2** | `plugins.CapacitorHttp.enabled = true` + `npx cap sync android` + 重装 | M1、M2、M4 | 看 patch 是否让 `http://` 通；**GET 与 POST 分开看**（它们的实现路径不同，见 §4.5） |
| **R3** | 仍开 patch | M3 | 显式原生调用。**预期：这一行最有可能全绿**，而且头最完整 |
| **R4** | 如果 R2/R3 里 `http://` 仍然挂 → 加 §5.1 的 `network_security_config` 白名单 + 重装 | M1、M2、M3、M4 | 确认"明文策略"是唯一剩下的那堵墙 |

> 每一轮跑之前先 `adb logcat -c`，跑完 `adb logcat -d | Select-String "ERR_CLEARTEXT|Mixed Content|CORS|Cleartext"` 存档。

### 4.4 错误指纹表：一眼看出是哪堵墙

这一张表是整份文档里最该被反复看的部分 —— 三种失败**长得很像**（都是
`TypeError: Failed to fetch`），必须靠日志和控制台把它们分开：

| 现象 | 控制台 / logcat 关键字 | 到底是什么 | 怎么修 |
| --- | --- | --- | --- |
| `TypeError: Failed to fetch`，**几十毫秒内**就失败 | logcat: `net::ERR_CLEARTEXT_NOT_PERMITTED` | ① **明文流量策略**（最严的那道） | §5.1 白名单；只有在不得已时才 §5.2 全局开 |
| 同上，但 logcat 里是 `Mixed Content: The page at 'https://localhost/' was loaded over HTTPS, but requested an insecure resource 'http://…'` | `Mixed Content` / `blocked:mixed-content` | ② **混合内容**（因为 origin 是 `https://localhost`） | 用 M2/M3 走原生栈（推荐）；或（**仅开发**）`android.allowMixedContent = true`；**不要**为了这个去改 `server.androidScheme = 'http'`，那会连带失去安全上下文（`crypto.subtle`、`getUserMedia` 等） |
| `TypeError: Failed to fetch`，控制台有 `Access to fetch at 'http://…' from origin 'https://localhost' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header` | `CORS policy` | ③ **CORS**（不是明文问题） | 开 `CapacitorHttp.enabled`（原生栈不受 CORS 约束） |
| 挂 ~10-30 秒才失败 | `net::ERR_NAME_NOT_RESOLVED` / `ERR_CONNECTION_TIMED_OUT` / `ERR_INTERNET_DISCONNECTED` | ④ 网络/DNS/真机没联网 | 先修网络，不要往 manifest 上赖 |
| **HTTP 400 / 403 / 500 等状态码** | 没有任何系统级报错 | ✅ **明文可达**（请求真的出设备了，只是签名/参数不对） | 这格判为 **PASS** |

### 4.5 三个"必须分开看"的行为差异（否则矩阵会误判）

**[本地源码]** 全部读自 `node_modules/@capacitor/android@8.5.2/capacitor/src/main/assets/native-bridge.js`：

1. **GET / HEAD / OPTIONS / TRACE ≠ POST/PUT/PATCH/DELETE**
   `:484-510`：前者**不走** `CapacitorHttp.request`，而是把 URL 改写成代理 URL
   （`createProxyUrl`）后仍交给**原始 `fetch`**；后者才走
   `cap.nativePromise('CapacitorHttp','request', ...)`（`:526-532`）。
   → 所以 §4.2 的端点表里**必须同时有 GET 和 POST**，否则你会得出错误结论。
2. **本应用自身 origin 的请求不拦**（`:480-482`：`request.url.startsWith(cap.getServerUrl()+'/')` → 原始 fetch）。
   → 用 `https://localhost/...` 做对照是**无效对照**，要用公网的 `https://` 端点。
3. **`User-Agent` 被特意抢救，`Referer` / `Cookie` 在 patched-fetch 上会丢**

   | 走法 | `User-Agent` | `Referer` / `Origin` / `Cookie` |
   | --- | --- | --- |
   | M1（无 patch） | 丢弃 | 丢弃 |
   | M2 / POST（patch 后） | **有**（`:518-525` 从原始 Headers 捞回来） | **会丢**：`:515` 用 `Object.fromEntries(request.headers.entries())`，而 `new Request(...)`（`:479`）的 headers guard 是 `request`，禁止头在这一步已被过滤 |
   | M2 / GET（patch 后） | **有**（`:492-497` 改写成 `x-cap-user-agent`） | 同 M2 的 fetch 语义 **[待真机]** |
   | M4（patched XHR） | **有**（`:627-629` 改写成 `x-cap-user-agent`） | **有**：`:622-634` 的 `setRequestHeader` 只存进 `this._headers`，从不调用真实 XHR，因此不受禁止头过滤 |
   | M3（`CapacitorHttp.request`） | **有** | **有**：JS 侧原样进 `nativePromise`；原生 `HttpRequestHandler.java:388` 取 `call.getObject("headers")` → `CapacitorHttpUrlConnection.java:153-159` 对每个 key 调 `connection.setRequestProperty(key, value)`；`HttpRequestHandler.java:404-411` 只额外把 `x-cap-user-agent` 还原成 `User-Agent` |

   **含义**：`kg` / `wy` / `tx` 大量依赖 `User-Agent` / `Referer` / `Cookie`，而它们几乎全是 POST。
   → 如果只看"能不能通"，M2 可能"通"但**签名对应的头丢了**，接口仍会被服务端拒。
   **所以 §4.4 的"头透传探针"是必做项，不是可选项。**

### 4.6 头透传探针（PC 上跑回显服务器）

因为要用**自家可控**的端点看"头到底有没有到"，所以：

1. PC 上起一个回显服务器（Node 一行）：

```js
// 存成 probe-server.cjs，在 PC 上跑：node probe-server.cjs
const http = require('http')
http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }))
  })
}).listen(8080, '0.0.0.0', () => console.log('probe server on http://<PC-IP>:8080/echo'))
```

2. 放通防火墙（Windows，**只给这个端口**，不要关整个防火墙）：

```powershell
New-NetFirewallRule -DisplayName "rain-cleartext-probe-8080" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
# 验证完删掉：Remove-NetFirewallRule -DisplayName "rain-cleartext-probe-8080"
```

3. 在 WebView 控制台里，把上面的矩阵脚本里的端点换成
   `http://<PC-IP>:8080/echo`（**注意仍是明文**，所以它同时验证明文策略），
   并对比 M1 / M2(POST) / M2(GET) / M3 / M4 五种走法返回的 `headers` 字段。

**期望结果（[本地源码] 推导，[待真机] 确认）**：

| 走法 | 期望在回显里看到 |
| --- | --- |
| M1 | 头为空或只有 `content-type` / `accept`；`user-agent` 是 WebView 自己的 UA；**没有** `referer` / `origin` / `cookie` |
| M2 POST | `user-agent` = 你设的值；**没有** `referer` / `origin` / `cookie` |
| M2 GET | `x-cap-user-agent` = 你设的值（或 `user-agent`，取决于原生侧是否已还原）；`referer` / `origin` / `cookie` **[待真机]** |
| M3 | **全都在**（`user-agent` / `referer` / `origin` / `cookie`） |
| M4 | **全都在**（UA 可能以 `x-cap-user-agent` 形式出现） |

**如果 M2 的 `referer` / `cookie` 确实丢了**，处置顺序（不要一上来就改产品代码）：

1. 改用 M3（`CapacitorHttp.request`）或 M4（patched XHR）——这两条路的头是完整的；
   本项目已经把 M3 的注入点留在 `src/renderer/platform/http/web.js` 的
   `capacitorHttp.requestImplementation`（见该文件顶部"CapacitorHttp 接入点"一节），
   真机调试时可以在控制台直接运行：
   ```js
   window.__RAIN_CAPACITOR_HTTP__ = { mode: 'explicit', requestImplementation: /* 你的 fetch 兼容适配器 */ }
   ```
   然后**重新加载页面**（该配置在模块初始化时读取一次）。
2. 若服务端其实只认 `Referer`（`tx` 的部分接口有这种倾向），考虑把这几个接口单独走 M3。
3. **不要**把 `Cookie` 改成 `document.cookie` 去绕 —— 那需要 `CapacitorCookies.enabled`，
   且 `wy` 用的是显式 `Cookie:` 头，语义不同。

---

## 5. 第四步：按矩阵结果定配置

### 5.1 方案 1（**推荐**）：白名单式 `network_security_config.xml`

只对**确实需要的域名**放开明文，而不是全局开。Network Security Config 是**应用级**的，
所以它**同时**覆盖 WebView 和 CapacitorHttp 两条路。

新建 `android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
  仅对本工程内置音源真正用到的明文域名放开（清单来自 docs/android/cleartext-verification.md §7）。
  不要写 <base-config cleartextTrafficPermitted="true">，那等于全局放开。
  ⚠️ domain 不支持通配符前缀以外的写法；子域要逐个列或用 *.example.com 形式。
-->
<network-security-config>
    <!-- 默认：其它一切照旧（API 28+ 禁明文） -->
    <base-config cleartextTrafficPermitted="false" />

    <!-- wy：核心数据路径 interface.music.163.com -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">interface.music.163.com</domain>
    </domain-config>

    <!-- kg：13 个域名（§7 的表） -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">kugou.com</domain>
        <domain includeSubdomains="true">kugou.kugou.com</domain>
        <domain includeSubdomains="true">comment.service.kugou.com</domain>
        <domain includeSubdomains="true">everydayrec.service.kugou.com</domain>
        <domain includeSubdomains="true">gateway.kugou.com</domain>
        <domain includeSubdomains="true">lyrics.kugou.com</domain>
        <domain includeSubdomains="true">media.store.kugou.com</domain>
        <domain includeSubdomains="true">mobiles.kugou.com</domain>
        <domain includeSubdomains="true">mobilecdnbj.kugou.com</domain>
        <domain includeSubdomains="true">msearchretry.kugou.com</domain>
        <domain includeSubdomains="true">songsearch.kugou.com</domain>
    </domain-config>

    <!-- tx：c.y.qq.com -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">c.y.qq.com</domain>
    </domain-config>

    <!-- §4.6 的探针服务器（验证完请删掉这一条） -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">192.168.0.100</domain>
    </domain-config>
</network-security-config>
```

然后在 `android/app/src/main/AndroidManifest.xml` 的 `<application ...>` 上挂一行：

```xml
<application
    android:allowBackup="true"
    android:icon="@mipmap/ic_launcher"
    ...
    android:networkSecurityConfig="@xml/network_security_config">
```

> - `includeSubdomains="true"` 只作用在它自己那条 `<domain>` 上：`kugou.com` 带子域
>   覆盖 `www.kugou.com`、`m.kugou.com`、`t.kugou.com`；但 `mobiles.kugou.com` 这种
>   "子域的子域"由 `kugou.com` 那条就覆盖了 —— 上面逐个列出是**故意的冗余**，便于你按
>   §4 的结果**逐个删**：删掉一条就重跑那一格的矩阵，能直接看出这类域名是不是真的需要。
> - 不要用 `adb shell settings put global` 之类去全局放开 —— 那是改设备、不是改应用，验证结论无效。

### 5.2 方案 2（**不推荐**）：全局 `usesCleartextTraffic="true"`

```xml
<application android:usesCleartextTraffic="true" ... >
```

只在"**已经从 §4 确认白名单方案无法覆盖某个动态域名的场景**"时使用，并必须在
`docs/android/` 里登记理由。**不要**同时把 `server.cleartext = true` 当成生产配置 ——
`@capacitor/cli` 对它自己的注释是：*"This is intended for use with live-reload servers where
unencrypted HTTP traffic is often used. **This is not intended for use in production.**"* [官方文档]

### 5.3 启用 `CapacitorHttp`

**改 `capacitor.config.ts`**（在仓库根）：

```ts
const config: CapacitorConfig = {
  appId: 'com.rainmusic.mobile',
  appName: 'Rain Music',
  webDir: 'dist-web',
  // 阶段 3b：真机验证用。它把 window.fetch / XMLHttpRequest patch 成原生实现
  // （见 src/renderer/platform/http/web.js 顶部"CapacitorHttp 接入点"）。
  plugins: {
    CapacitorHttp: { enabled: true },
    // 只在需要 document.cookie 走原生时才开（本工程目前**不需要**）
    // CapacitorCookies: { enabled: true },
  },
  // ⚠️ 下面两项**只用于开发期验证**，不要进生产配置：
  // server: { cleartext: true },
  // android: { allowMixedContent: true },
}
```

**必做**：`npx cap sync android`（或至少 `npx cap copy android`）之后，**核对生成物**——
原生侧读的是生成出来的 JSON，不是 `.ts`：

```powershell
npx cap sync android
Get-Content android\app\src\main\assets\capacitor.config.json -Raw
# 期望能看到："plugins": { "CapacitorHttp": { "enabled": true } }
# 看不到 = sync 没生效，patch 一定不会装
```

**证据（[官方文档]）** —— <https://capacitorjs.com/docs/apis/http> 原文：

> "The Capacitor Http API provides native http support via patching `fetch` and `XMLHttpRequest`
> to use native libraries. … **This plugin is bundled with `@capacitor/core`.**"
> "By default, the patching of `window.fetch` and `XMLHttpRequest` to use native libraries is
> **disabled**. If you would like to enable this feature, modify the configuration below in the
> `capacitor.config` file."
>
> ```json
> { "plugins": { "CapacitorHttp": { "enabled": true } } }
> ```

**不要装 `@capacitor/http`**：那个名字不是官方包。社区版是
[`@capacitor-community/http`](https://www.npmjs.com/package/@capacitor-community/http)（已多年未更新，
且本仓库**没有**安装它 —— `node_modules/@capacitor-community` 不存在）。本仓库的
`node_modules/@capacitor/` 只有 `core`、`cli`、`android` 三个，版本都是 `8.5.2`。
`CapacitorHttp` 的导出位置 **[本地源码]**：`node_modules/@capacitor/core/types/index.d.ts:4`
（`export { … CapacitorHttp … } from './core-plugins'`）。

### 5.4 改完必须同步的三处清单（容易漏）

| 改了什么 | 必须同步什么 | 漏了会怎样 |
| --- | --- | --- |
| `capacitor.config.ts` | `npx cap sync android` | patch 不装；`assets/capacitor.config.json` 还是旧的 |
| `dist-web/`（`npm run build:web`） | `npx cap copy android` | 手机上跑的是旧 bundle，矩阵结论作废 |
| `AndroidManifest.xml` / `res/xml/*.xml` | `gradlew assembleDebug` + 重装 | 手机上还是旧 manifest |
| `res/xml/network_security_config.xml` **新增** | 一定要在 manifest 上挂 `android:networkSecurityConfig` | 文件加了但没引用，等于没加 |

---

## 6. 第五步：要交回的产物（验收清单）

跑完 §4 之后，请把下面 6 项交回（贴进 issue / 写进 `docs/android/` 的新文档均可）：

- [ ] **① 矩阵结果表**：`window.__CLEARTEXT_MATRIX__` 的 JSON（§4.3 的 `copy(...)`），
      或手工整理的「端点 × 请求方式 × 成败 × 状态码/错误码 × 耗时」表。
- [ ] **② R1–R4 每一轮的运行时配置**：`assets/capacitor.config.json` 的实际内容（4 份）。
- [ ] **③ manifest 实际值**：`android:usesCleartextTraffic`（有/无/值）、
      `android:networkSecurityConfig`（有/无）、`res/xml/network_security_config.xml`（存在与否 + 内容）。
      —— **阶段 1 与阶段 3b 在仓库里都测得"两者都没有"，请确认装在设备上的 APK 也是这样。**
- [ ] **④ 头透传结果**（§4.6）：5 种走法各自在回显里看到的 `headers` 原文。
- [ ] **⑤ logcat 存档**：每轮的 `adb logcat -d` 里与 `ERR_CLEARTEXT` / `Mixed Content` /
      `CORS` / `CapacitorHttp` 相关的行。
- [ ] **⑥ 结论**：`network_security_config.xml` 的**最终**域名清单 + 是否需要 §5.2；
      以及 `CapacitorHttp.enabled` 的最终取值（开/关）+ 理由（M2 还是 M3 作为主路径）。

**判定"整体通过"的最低标准**：§4.2 的 7 个 `http://` 端点在 M3（或 M4）下**全部不出现
§4.4 的 ①②③ 类失败**（拿到任何 HTTP 状态码都算通过），**并且** §4.6 里该走法的
`User-Agent` / `Referer` / `Cookie` 都真的到达了服务端。

---

## 7. 复核：约 28 处明文 URL（本轮实测）

### 7.1 我的复核口径（逐步可复现）

扫描范围：`src/**`，扩展名 `.js/.ts/.vue/.json/.html/.cjs/.mjs`。
`http://` 的**行级**命中，然后逐步筛：

| 步骤 | 筛掉什么 | 剩下 |
| --- | --- | --- |
| S0 | ——（全部 `http://` 行） | **124** |
| S1 | 注释行（trim 后以 `//`、`*`、`/*`、`<!--`、`{/*` 开头） | **99** |
| S2 | XML 命名空间（`http://www.w3.org/…`、含 `xmlns=`、`schemas.android.com`、`xsi:schemaLocation` 的行） | **48** |
| S3 | `src/main/**`（主进程；含 3 处 dev-only 的本地服务/live-reload URL） | **45** |
| S4 | 已判定不进产物的死文件：`kg/api-test.js`、`tx/api-test.js`、`wy/api-test.js`、`kg/temp/songList-new.js`、`kg/album.js` | **31** |
| S5 | **只是请求头值**（`Referer` / `Refere` / `Origin` 键，且该行没有 `httpFetch(`/`fetch(`） | **28** ✅ |

**结果：28 处真实明文请求 URL —— 与 `docs/android-port-plan.md` §5.2 /
`native-bridge-needs.md` §2.6.4 的"约 28 处"一致。**

### 7.2 逐文件 / 逐 host 明细（这就是 §5.1 白名单的来源）

| 文件 | 处数 |
| --- | --- |
| `src/renderer/utils/musicSdk/kg/songList.js` | 11 |
| `src/renderer/utils/musicSdk/kg/comment.js` | 3 |
| `src/renderer/utils/musicSdk/kg/singer.js` | 3 |
| `src/renderer/utils/musicSdk/kg/leaderboard.js` | 2 |
| `src/renderer/utils/musicSdk/kg/lyric.js` | 2 |
| `src/renderer/utils/musicSdk/kg/hotSearch.js` | 1 |
| `src/renderer/utils/musicSdk/kg/musicInfo.js` | 1 |
| `src/renderer/utils/musicSdk/kg/musicSearch.js` | 1 |
| `src/renderer/utils/musicSdk/kg/pic.js` | 1 |
| `src/renderer/utils/musicSdk/tx/songList.js` | 1 |
| `src/renderer/utils/musicSdk/tx/comment.js` | 1 |
| `src/renderer/utils/musicSdk/wy/utils/index.js` | 1 |
| **合计** | **28** |

| host | 处数 |
| --- | --- |
| `www2.kugou.kugou.com` | 5 |
| `gateway.kugou.com` | 3 |
| `mobiles.kugou.com` | 3 |
| `m.comment.service.kugou.com` | 2 |
| `mobilecdnbj.kugou.com` | 2 |
| `lyrics.kugou.com` | 2 |
| `c.y.qq.com` | 2 |
| `comment.service.kugou.com` | 1 |
| `songsearch.kugou.com` | 1 |
| `media.store.kugou.com` | 1 |
| `everydayrec.service.kugou.com` | 1 |
| `t.kugou.com` | 1 |
| `m.kugou.com` | 1 |
| `www.kugou.com` | 1 |
| `msearchretry.kugou.com` | 1 |
| **`interface.music.163.com`** | **1**（wy 的核心数据路径 `http://interface.music.163.com/eapi/batch`） |

### 7.3 复核中发现的两处**上游记述笔误**（不影响 28 这个总数）

1. `docs/android-port-plan.md` §5.2 写"tx（`songList.js` 2、`comment.js` 1）"。
   实际 `tx/songList.js` 只有 **1** 处真实明文 URL（`:401`）；`:404` 是
   `Referer: 'http://y.qq.com/portal/search.html'`（属 S5 被筛掉的请求头），
   `:67` 是注释掉的 kuwo 链接。所以是 **songList 1 + comment 1 = 2**，
   tx 合计仍是 2，总数仍是 28。
2. 中间步骤的数字口径略有差异（上游记"非注释 55 → 减 src/main 3 → 52"，
   我这轮是"去注释+去命名空间 48 → 减 src/main 3 → 45"），但 **S4 = 31、S5 = 28 完全一致**。
   差异来自"XML 命名空间是在哪一步扣掉的"（上游把命名空间放在 S0 之后先扣，
   我放在 S2）。**终点一致，结论不受影响。**

---

## 附录 A：web 产物仍残留的 Node 垫片（**阶段 4 的输入**）

统计口径与阶段 3a/3b 一致：解析 `dist-web/*.js.map` 的 `sources`。
两个视角都给：**(A1) 源码侧的 importer**（谁在使用 Node 能力，最可行动）、
**(A2) 产物侧的包体积**（阶段 4 做完能省多少）。

### A1 · 源码侧：`src/**` 里还在用 Node 内置模块的文件（只算**真的进了 web bundle** 的 542 个源文件）

> 生成方式：取 `dist-web/*.js.map` 的 `sources` 里 `./src/**` 的条目（= 真正打进 web bundle
> 的文件集合），再对每个文件扫 `from 'X'` / `require('X')` / `import('X')`，跳过注释行。
> 所以这不是"全库 grep"，而是"产物里的 importer"。

| Node 模块 | web 目标的归宿 | 处数 | importer |
| --- | --- | --- | --- |
| `path` | `path-browserify`（真 polyfill，可留） | 7 | `common/defaultSetting.ts:1`、`common/utils/download/Downloader.ts:2`、`common/utils/musicMeta/flacMeta.js:3`、`common/utils/musicMeta/index.js:1`、`common/utils/musicMeta/mp3Meta.js:2`、`common/utils/nodejs.ts:8`、`renderer/worker/main/music.ts:2` |
| `fs` | **`false`（空模块 → 运行必炸）** | 6 | `common/utils/download/Downloader.ts:1`、`common/utils/musicMeta/downloader.js:3`、`common/utils/musicMeta/flacMeta.js:1`、`common/utils/musicMeta/mp3Meta.js:3`、`common/utils/nodejs.ts:1`、`renderer/worker/download/utils.ts:4` |
| `os` | `os-browserify/browser` | 4 | `common/defaultSetting.ts:2`、`common/utils/index.ts:2`、`common/utils/nodejs.ts:9`（`networkInterfaces`）、`renderer/worker/main/music.ts:3` |
| `http` | **`false`** | 4 | `common/utils/download/Downloader.ts:6`（`import type`）、`common/utils/download/index.ts:4`（`import type`）、`common/utils/download/request.ts:2`、`common/utils/musicMeta/downloader.js:1` |
| `url` | `url/`（真 polyfill；**连带把 `qs` 整棵树拖进来**，见 A2） | 2 | `common/utils/common.ts:3`（`pathToFileURL`）、`common/utils/download/request.ts:1`（`URL`） |
| `https` | **`false`** | 2 | `common/utils/download/request.ts:3`、`common/utils/musicMeta/downloader.js:2` |
| `events` | `events/`（真 polyfill） | 1 | `common/utils/download/Downloader.ts:3`（`EventEmitter`） |
| `perf_hooks` | **`false`** | 1 | `common/utils/download/Downloader.ts:4`（`performance`） |
| `stream` | `stream-browserify` | 1 | `common/utils/musicMeta/flac-metadata/index.js:5`（`require('stream').Transform`） |
| `crypto` | `crypto-browserify` | **0** ✅ | **阶段 3b 已归零**（原唯一 importer 是 `renderer/utils/musicSdk/tx/utils/crypto.js`） |
| `dns` | `false` | **0** ✅ | 阶段 3a 已删（原 `renderer/utils/musicSdk/utils.js:2`） |
| `zlib` | `browserify-zlib` | 0（src 侧） | ⚠️ 产物里仍有 2 条源码，importer 在 **node_modules 里**：`node-id3/ID3Helpers.js:1` 的 `require('zlib')`，由 `common/utils/musicMeta/mp3Meta.js:1` 引入 |
| `buffer` / `util` / `querystring` / `assert` / `string_decoder` / `punycode` / 其余 | —— | 0（src 侧直接 import） | 由 `ProvidePlugin` 或其它垫片的传递依赖进来 |

**阶段 4 的最小行动清单（按收益/风险排序）**：

1. **`src/common/utils/download/**`**（`Downloader.ts` / `request.ts` / `index.ts` / `util.ts`）——
   一次性消掉 `fs`(1) + `http`(3) + `https`(1) + `perf_hooks`(1) + `events`(1) + `url`(1) + `path`(1)。
   这是**最大的一坨**，也正好是"下载器要换成 Capacitor 的 fetch/Filesystem"那条线。
2. **`src/common/utils/musicMeta/**`**（`downloader.js` / `mp3Meta.js` / `flacMeta.js` / `index.js` /
   `flac-metadata/index.js`）—— 消掉 `fs`(3) + `http`(1) + `https`(1) + `path`(3) + `stream`(1)，
   并且**顺带消掉 `browserify-zlib`（经 `node-id3`）**。
3. **`src/common/utils/nodejs.ts`** —— 消掉 `fs`(1) + `os`(1) + `path`(1)。它是
   `ipc-contract.md` §6.2 早就点名要拆的文件（`toMD5` 已在阶段 3a 换成 crypto-js，
   剩下的是 `fs`/`path`/`os`/`zlib`/`gzip` 那几件事）。
4. **`src/common/defaultSetting.ts`（`path` + `os`）**、**`src/common/utils/index.ts`（`os`）**、
   **`src/renderer/worker/main/music.ts`（`path` + `os`）**、**`src/renderer/worker/download/utils.ts`（`fs`）**
   —— 零散但便宜。
5. **`src/common/utils/common.ts:3` 的 `pathToFileURL`** —— 只这一行把 `url` 垫片拉进来，
   而 `url` 又**无条件** `require('qs')`（[本地源码]** `node_modules/url/url.js:108`），
   于是 `qs` + `side-channel*` + `object-inspect` + `get-intrinsic` + `call-bind*` + `math-intrinsics`
   + `es-errors` 一整簇（**产物里 100+ 条源码**）都跟着进来。**先干掉这一行，性价比最高。**

### A2 · 产物侧：`dist-web/*.js.map` 里的垫片包（阶段 3b 前 → 后）

| 包 | before | after | 说明 |
| --- | --- | --- | --- |
| **`crypto-browserify`** | **1** | **0** | ✅ 本轮的交付物 |
| `browserify-cipher` / `browserify-des` / `browserify-aes` / `browserify-sign` / `browserify-rsa` | 1 / 2 / 16 / 5 / 2 | 0 | crypto 树，全消 |
| `create-hash` / `create-hmac` / `cipher-base` / `hash-base` / `evp_bytestokey` / `md5.js` / `ripemd160` / `sha.js` / `hash.js` | 2 / 2 / 2 / 4 / 1 / 5 / 7 / 10 / 14 | 0 | 同上 |
| `elliptic` / `bn.js` / `brorand` / `hmac-drbg` / `minimalistic-crypto-utils` / `miller-rabin` | 16 / 7 / 1 / 1 / 1 / 2 | 0 | 同上 |
| `asn1.js` / `parse-asn1` / `public-encrypt` / `diffie-hellman` / `create-ecdh` / `pbkdf2` / `randomfill` / `randombytes` | 16 / 5 / 7 / 4 / 2 / 10 / 1 / 1 | 0 | 同上 |
| `des.js` / `buffer-xor` / `isarray`(部分) / `typed-array-buffer` / `to-buffer` | 6 / 1 / 1 / 1 / 2 | 0 | 同上 |
| `readable-stream` | 38 | **0** | 只被 crypto 树用到 |
| `stream-browserify` | 30 | **15** | 剩下 15 条全在 `renderer.download.worker`（`stream` 垫片仍被 `flac-metadata` 用着） |
| `browserify-zlib` | 2 | **2** | 未消（`node-id3` → `zlib`，属阶段 4） |
| `buffer` | 3 | 3 | `ProvidePlugin` 注入，必需 |
| `process` | 3 | 3 | `ProvidePlugin` 注入，必需 |
| `util` | 9 | 9 | `resolve.fallback` |
| `events` / `path-browserify` / `os-browserify` / `url` | 3 / 3 / 3 / 6 | 3 / 3 / 3 / 6 | 同上 |
| `safer-buffer` / `safe-buffer` / `inherits` / `util-deprecate` / `base64-js` / `ieee754` / `string_decoder` | 2 / 12→2 / 3 / 2→1 / 3 / 3 / 3→2 | 残留 | 由 `buffer` / `iconv-lite` / `stream-browserify` 传递引入 |
| `qs` + `side-channel` 系（`get-intrinsic`、`call-bind*`、`math-intrinsics`、`es-errors`、`object-inspect` 等） | 15 + 一簇 | **仍在**（`qs=15`） | **由 `url` 垫片引入**（`node_modules/url/url.js:108` 无条件 `require('qs')`） |
| vendored `needle` | 0 | 0 | 阶段 3a 已确保 web 产物不打包 needle |
| **`sources` 总数（8 个 map）** | **1025** | **875** | **净减 150 条源码，0 条新增** |

> 复现命令（口径完全一致）：
> ```js
> // 遍历 dist-web/*.js.map，读 JSON.sources，按 node_modules/<包名>/ 前缀聚合
> ```
> 阶段 3b 的完整"消失的 source"清单（150 条）与"新增的 source"清单（0 条）已用
> before/after 快照 diff 得到；结论是**只减不增**。

### A3 · 不是 web 产物的那些 Node 依赖（**不要**混进阶段 4 的 web 清单）

| 位置 | 情况 | 与 web 产物的关系 |
| --- | --- | --- |
| `src/main/modules/userApi/renderer/preload.js:3` | `import { createCipheriv, randomBytes, createHash } from 'crypto'` —— **三个都在用**（`:262` / `:269` / `:272`） | **完全无关**：它由 `build-config/renderer-scripts/webpack.config.base.js`（`target: 'electron-renderer'`）单独打包成 `dist/user-api-preload.js`（341 KB），那里的 `crypto` 解析为 `external node-commonjs "crypto"`（Electron 的 Node 内置）。**实测该 map 里 `crypto-browserify` 源码数 = 0。** |
| `src/main/**` 的 `fs` / `path` / `better-sqlite3` … | 主进程，走 Electron | 不进 `dist-web` |
| `lx.utils.crypto.md5`（`preload.js:271-273`） | 用 `createHash('md5')` | 换成 `crypto-js` 是**行为无变化**的（阶段 3a 已在 `common/utils/nodejs.ts` 验证过），但因为同对象里的 `aesEncrypt`/`randomBytes` 仍然需要 `crypto`，**换了也摘不掉任何一棵树** → 留到阶段 5（`lx` 宿主）一起做。⚠️ `lx.utils.crypto` 是 `docs/custom-source.md` 的**对外契约**，签名与返回值不能变。 |

---

## 附录 B：证据索引（照抄可直接复核）

| 结论 | 文件:行 | 命令 |
| --- | --- | --- |
| `CapacitorHttp` 内置于 `@capacitor/core` | `node_modules/@capacitor/core/types/index.d.ts:4` | `Select-String -Path node_modules\@capacitor\core\types\index.d.ts -Pattern CapacitorHttp` |
| `plugins.CapacitorHttp.enabled` 默认 `false` | `node_modules/@capacitor/cli/src/declarations.ts`（`PluginsConfig`） | `Select-String -Path node_modules\@capacitor\cli\src\declarations.ts -Pattern "CapacitorHttp" -Context 2,6` |
| `server.androidScheme` 默认 `https` | `node_modules/@capacitor/cli/src/declarations.ts`（`server` 段） | 同上，搜 `androidScheme` |
| `server.cleartext` 默认 `false` | 同上 | 搜 `cleartext` |
| `android.allowMixedContent` 默认 `false` | 同上 | 搜 `allowMixedContent` |
| patch 是原生装的、web 上是 no-op | `node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js:448-467` | `Get-Content ...\native-bridge.js \| Select-Object -Skip 447 -First 25` |
| `window.fetch` 被整体替换 | 同上 `:469`、`:562` | — |
| GET/HEAD 走代理 URL、非 GET 走 nativePromise | 同上 `:480-532` | — |
| UA 抢救 / 禁止头丢失 | 同上 `:492-497`、`:515-525`、`:627-634` | — |
| `window.Capacitor.Plugins.<Plugin>` 是原生生成的 | `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSExport.java:21`、`:64-92`、`:155-186` | 见 §4.1 |
| 原生按 key 逐个设请求头 | `.../java/com/getcapacitor/plugin/util/CapacitorHttpUrlConnection.java:153-159`、`HttpRequestHandler.java:388,404-411` | — |
| manifest 无 `usesCleartextTraffic` | `android/app/src/main/AndroidManifest.xml` | §3 的命令 |
| 无 `res/xml/network_security_config.xml` | `android/app/src/main/res/xml/` | §3 的命令 |
| `targetSdk = 36` | `android/variables.gradle` | §3 的命令 |
| `url` 垫片无条件引入 `qs` | `node_modules/url/url.js:108` | `Select-String -Path node_modules\url\url.js -Pattern "require\('qs'\)"` |
| `node-id3` 引入 `zlib` | `node_modules/node-id3/ID3Helpers.js:1` | `Select-String -Path node_modules\node-id3\ID3Helpers.js -Pattern zlib` |
| `web.js` 的 CapacitorHttp 接入点 | `src/renderer/platform/http/web.js`（文件头 + `capacitorHttp` 配置块） | 直接读文件 |
| 桌面版行为等价的证据 | `tests/unit/tx-sign.test.cjs` | `node --test tests\unit\tx-sign.test.cjs` |
| web 适配器 + 接入点的行为 | `tests/unit/web-http-transport.test.cjs` | `node --test tests\unit\web-http-transport.test.cjs` |

---

## 附录 C：明确**未验证**的事（不要当结论引用）

1. **本文没有任何真机结果**：本机没有 `adb`、没有 Android SDK、没有真机（§1.2）。
   §4 的矩阵、§4.4 的三个"错误指纹"、§4.6 的头透传期望值，**全部是 [本地源码] 推导 + [待真机]**。
2. **`CapacitorHttp` 的运行时行为未经真机验证**：本仓库**刻意不 import `@capacitor/*`**
   （`src/renderer/platform/http/web.js` 只留了配置位与注入点），所以 web 产物里根本没有
   `CapacitorHttp` 的调用路径。接入点的存在**不等于**已经接上。
3. **`Referer` / `Origin` / `Cookie` 在 patched-fetch 上会不会丢**：§4.5 表格里
   "会丢"是从 `native-bridge.js:515` 的 `Object.fromEntries(request.headers.entries())` +
   `new Request(...)` 的 headers guard 语义**推导**出来的，**没有真机验证**。
   附加不确定项：Java 的 `HttpURLConnection` 对少数头名（`Host` / `Connection` /
   `Content-Length` 一类）有内置限制，`setRequestProperty` 可能静默忽略 —— 未验证。
4. **明文流量仍未验证**：这是整份文档的**目的**，不是它的结论。在真机矩阵跑完之前，
   "kg / wy / tx 在 Android 上能不能用"这个问题**没有答案**。
5. **`CapacitorCookies`**：本工程目前不需要它（`wy` 用的是显式 `Cookie:` 头，不是
   `document.cookie`）。它的 `enabled` 行为未验证。
6. **§5.1 白名单里的 `192.168.0.100`** 是占位符，请换成 §4.6 里 PC 的真实局域网 IP，
   并在验证完成后**删掉那一条**。
