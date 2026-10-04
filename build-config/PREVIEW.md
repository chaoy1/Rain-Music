# 预览构建（魔改调试用）

完全自包含的免安装预览版：**所有数据、日志、缓存都留在项目目录内**，不写注册表、
不建快捷方式、不注册 `rainmusic://` 协议，也不会干扰机器上已安装的官方版 Rain Music。

---

## 定制记录

| # | 定制内容 | 涉及文件 |
|---|---|---|
| 1 | **黑白主题应用图标**：16→512 PNG、`icon.ico`、`icon.icns`、托盘字形、任务栏按钮 | `resources/icons/*`、`src/static/images/tray/*`、`src/static/images/taskbar/*` |
| 2 | **新增黑白界面主题**：`mono`（黑白分明，浅色）、`mono_dark`（黑白夜行，深色）；原有 15 个主题全部保留 | `src/common/theme/createThemes.js` → `index.json` |
| 3 | **默认主题改为跟随系统的黑白**：`theme.id='auto'` + `lightId='mono'` + `darkId='mono_dark'` | `src/common/defaultSetting.ts`、`src/common/constants.ts`、`src/common/utils/migrateSetting.ts` |
| 4 | **托盘默认跟随系统**：默认值由 `0`（白字形）改为 `-1`，并按**系统**深色模式切黑白 | `src/common/defaultSetting.ts`、`src/main/modules/tray.ts` |
| 5 | **消除首次启动的 SqliteError 噪声**（上游原有：无条件 `fileMustExist: true` + catch 兜底） | `src/main/worker/dbService/db.ts` |
| 6 | **macOS 风格界面 + 磨砂玻璃**：Win11 原生 Acrylic 材质、交通灯按钮、侧边栏/工具栏重做、系统 UI 字体 | 见下方「macOS 风格」小节 |

图标与主题的原始资产备份在 `.design/backup/`，生成脚本与校对图在 `.design/`。

### macOS 风格与磨砂玻璃（定制 6）

**窗口层**（`src/main/modules/winMain/main.ts`）
- Win11（build ≥ 22000）启用 `backgroundMaterial: 'acrylic'`，由 DWM 真实模糊窗口背后内容
- ⚠️ `backgroundMaterial` **与透明窗口互斥**：必须 `transparent: false`，
  且 `backgroundColor` 显式设为 `'#00000000'`，否则材质不生效
- 绿色交通灯按钮需要真正最大化，故 `maximizable: true`
- 判断 build 号用 `os.release().split('.')[2]`，`getOSVersion()` 只返回首段 "10"，不够用

**层次结构（关键，踩过坑）**

正确的层次是：

```
壁纸层（重度模糊） → 窗口层材质 → 各面板「单层」半透明
```

- `#container` 必须**完全透明**。若在此再铺一层半透明底色，会与面板自身的
  半透明叠加成「两层滤色」，材质被冲淡两次，结果是一层发糊的灰而不是玻璃
- 面板**不要**再加 `backdrop-filter`：窗口层已做过真实模糊，再叠一层是双重模糊
- `#toolbar` / `#player` 位于 `#right` 内部，加 `backdrop-filter` 会把
  「应用自身滚动上来的内容」拖成脏带，而不是透出桌面 —— 保持透明即可

**⚠️ 内容区不透明度是最容易踩的坑**

`--color-main-background` 是窗口里**面积最大**的面板，它的不透明度直接决定
「看不看得出玻璃」。实测数据：

| 该值 | 内容区实测像素 | 观感 |
|---|---|---|
| 0.86 / 0.88 | `RGB(245,246,247)`，多处采样完全一致 | **一块不透明白，毫无玻璃感** |
| 0.55 | `(140,150,168)` / `(143,177,255)` / `(140,176,255)`，亮度 153/192/190 | 透出壁纸色块，磨砂玻璃成立 |

只把侧边栏做透明是不够的 —— 侧边栏只占窗口一小条，内容区占绝大部分面积。

**壁纸底层的由来**

Windows 的 DWM Acrylic（`backgroundMaterial`）观感偏弱，且受系统
「透明效果」开关影响，实测在部分机器上几乎看不出效果。因此改为
**应用自绘的壁纸模糊层**：

- 主进程 `src/main/utils/wallpaper.ts` 读注册表 `HKCU\Control Panel\Desktop\WallPaper`
- 经 `envParams.wallpaper` 传给渲染进程，`useApp` 转成 file URL 存入 `store.wallpaperUrl`
- `App.vue` 的 `#wallpaper-layer` 以 `blur(52px) saturate(150%)` 重度模糊后铺在最底层

重度模糊是关键：把壁纸糊成**柔和色块**而不是可辨认内容。这样面板即使只有
0.55 不透明度，透出来的也是干净色块 —— 而低透明度的**未模糊**面板会把背后
窗口的文字透出来，正是之前「显脏」的原因。

取不到壁纸路径时该层保持透明，界面回退为实底样式，不会显示异常。

**弹窗遮罩**
`#container` 平时透明，但弹窗打开时必须有底色遮罩，否则弹窗背后内容直接透过来，
观感极脏。故用状态选择器按需给 `#container` 铺底色：

```less
#root.show-modal > #container,
#view.show-modal > #container { background-color: var(--color-app-background); }
```

**玻璃变量**
`--color-glass-sidebar` / `--color-glass-bar` 定义在主题 `extInfo` 中（每主题可覆盖），
`index.less` 的 `:root` 只有兜底值。深色主题必须用深色玻璃值，否则会发灰。

**统一玻璃面（重要）**
窗口现在只有**一块**玻璃：`#container` 用 `--color-glass-sidebar` 铺底，
而 `#right`、`.aside`、`#toolbar`、`#player` 全部保持**透明**。
早期版本让侧边栏与内容区各自带底色，结果两侧出现明显分界线，不符合 macOS 的整体感。

alpha 实测标定：**0.55 时文字对比不足**（壁纸色块干扰阅读），
**0.72 是「看得出玻璃且文字清晰」的平衡点**。
经验：过低会「消失」，过高会盖死玻璃。

**窗口圆角**
`roundedCorners: true` + `hasShadow: true`，且 `transparent: false`。
⚠️ DWM 圆角在**透明窗口上不生效** —— 这是最终放弃 `backgroundMaterial: 'acrylic'`
的另一个原因（另一个原因见上文：Acrylic 观感偏弱且受系统设置影响）。

**交通灯**（`src/renderer/components/layout/Toolbar/TrafficLights.vue`）
- 12px 圆 / 8px 间距 / 距左 20px，与 macOS 实际规格一致
- 位于工具栏最左，**左侧不留任何其它图标**（macOS 就是这样）
- 红 = 退出应用（`quitApp`，符合 mac 直觉；注意这会绕过「关闭到托盘」）
- 黄 = 最小化
- 绿 = **进入 / 退出全屏**（`setFullScreen`）。macOS 上绿色按钮就是全屏；
  本窗口是固定尺寸无边框窗，最大化对它没有意义
- 窗口失焦时统一变灰，hover 时才显示内部符号 —— 均为 macOS 行为
- 侧边栏内容用 `padding-top: @height-toolbar` 下移，给交通灯让位（全屏时取消）

**首启动弹窗已删除**
按要求移除了 `PactModal`（使用须知）与 `ChangeLogModal`（更新日志）两个组件，
`App.vue` 不再挂载它们。

被删除的组件备份在 `.design/backup/removed-modals/`，需要恢复时放回
`src/renderer/components/layout/` 即可（该目录是 `require.context` 自动全局注册）。

主题相关的取值常量集中在 `src/common/constants.ts`：
`DEFAULT_THEME_ID` / `THEME_LIGHT_ID` / `THEME_DARK_ID`，以及用于迁移判断的
`LEGACY_DEFAULT_THEME_ID` / `LEGACY_DEFAULT_DARK_THEME_ID`。

### 主题相关注意事项

纯黑/纯白作为主色会让 `--color-primary-dark-*` 色阶**塌缩**（全部变成同一个值），
进而使导航选中态的竖条（原本取 `--color-primary-dark-200-alpha-700`）变成半透明色、
几乎不可见。因此：

- `NavBar.vue` 的选中竖条改为 `var(--color-nav-active-bar, <原值>)`，向后兼容
- 黑白主题通过 `--color-nav-active-bar` 显式指定**实色**纯黑/深灰
- 徽标同理改用浅色阶，避免与背景同色

修改主题后必须执行 `npm run build:theme` 重新生成 `index.json`。
`defaultSetting.ts` 的 `version` 需与 `migrateSetting.ts` 最后一个迁移块的目标版本一致，
否则该迁移会被 `compareVer` 跳过。

---

## 一、常用命令

```powershell
# 1) 构建（webpack 四目标 + electron-builder 免安装目录版）
npm run pack:preview

# 2) 部署到项目内的 preview\ 目录，并创建 portable 数据目录
powershell -NoProfile -ExecutionPolicy Bypass -File build-config\deploy-preview.ps1

# 3) 启动
powershell -NoProfile -ExecutionPolicy Bypass -File build-config\launch-preview.ps1
```

产物位置：`preview\rain-music-preview.exe`（约 224 MB，整个目录约 388 MB）
数据位置：`preview\portable\userData\`

也可以直接双击 `preview\rain-music-preview.exe`。功能完全一致，只是这种情况下
Electron 会在 `%APPDATA%\rain-music-preview` 留下一个**空目录**（见下文说明），
用 `launch-preview.ps1` 启动则连这个空目录都不会产生。

---

## 二、与正式版的隔离措施

| 项目 | 正式版 | 预览版 |
|---|---|---|
| `appId` | `com.rainmusic.desktop` | `com.rainmusic.desktop.preview` |
| `productName` / exe | `rain-music-desktop` | `rain-music-preview` |
| 数据目录 | `%APPDATA%\rain-music-desktop` | `preview\portable\userData`（跟随 exe） |
| 日志 | `%APPDATA%\rain-music-desktop\logs` | `preview\portable\userData\logs` |
| `rainmusic://` 协议 | 已注册 | **不注册**（打包阶段移除 `protocols`） |
| 开始菜单 / 桌面快捷方式 | 安装时创建 | 无（免安装目录版） |
| 单实例锁 | 独立 | 独立（userData 不同） |

因此预览版**可以与正式版同时运行**，互不抢占。

---

## 三、实现要点（改动清单）

### 构建配置

- `package.json` — 新增 `pack:preview` 脚本，注入
  `PREVIEW_BUILD=1` / `PREVIEW_NO_PROTOCOL=1` / `DISABLE_ESLINT=1`
- `build-config/build-pack.js` — 新增 `register-dir` 目标：只构建 Windows 目录版、
  剔除 `protocols`、替换 `appId`/`productName`、`npmRebuild: false`
- `build-config/*/webpack.config*.js` — 把 `PREVIEW_BUILD` / `PREVIEW_NO_PROTOCOL`
  注入 DefinePlugin；支持 `DISABLE_ESLINT=1` 跳过 lint

### 运行时（主进程）

- `src/main/utils/dataPath.ts` — **新增**。把 `appData` 与 `userData` 一并重定向到
  exe 同级的 `portable` 目录，并保留 `global.rainOldDataPath` 语义（供旧数据迁移）
- `src/main/index.ts` — 改为「先重定向、再动态 import 业务模块」的两段式入口
- `src/main/startApp.ts` — **新增**。原 `index.ts` 的初始化主体
- `src/main/utils/logInit.ts` — 显式把 electron-log 的日志路径固定到
  Electron 的 `userData` 下
- `src/main/utils/previewMode.ts` — **新增**。`isPreviewNoProtocol()`
- `src/main/app.ts` — 移除已被 `dataPath.ts` 取代的 `setUserDataPath()`

---

## 四、三个已知坑（都已踩过并修掉）

### 1. `--no-deeplink` 之类自定义命令行开关会被 Electron 拒绝

Electron/Chromium 在主进程 JS 执行**之前**就会拒绝无法识别的开关：

```
rain-music-preview.exe: bad option: --no-deeplink
```

进程直接退出。若确实需要运行时开关，必须先
`app.commandLine.appendSwitch()` 注册。本项目改用**构建期烧入的**
`PREVIEW_NO_PROTOCOL` 标志。

### 2. electron-log 绕过 Electron 的路径重定向

`electron-log/node` 使用的是 `NodeExternalApi`，它的 appData 直接取自
`process.env.APPDATA`，**完全无视** `app.setPath('appData')`。
若不显式设置 `log.transports.file.resolvePathFn`，日志会落在
`%APPDATA%\rain-music-preview`。

且必须在 `import('./startApp')` **之前**设置：`startApp` 的静态依赖链
（`app.ts` → `winMain`）在**模块加载阶段**就会写第一条日志，
而 electron-log 的 file transport 只解析一次路径并缓存。

### 3. Chromium 仍会预创建默认 userData 目录

即使重定向做得再早，Electron 自身的早期启动阶段仍会创建
默认的 `%APPDATA%\rain-music-preview`（空目录）。
用 `--user-data-dir` 这个 Chromium **原生识别**的开关即可彻底避免，
这也是 `launch-preview.ps1` 传参的原因。

---

## 五、环境注意事项

- 本机**没有 Visual Studio C++ 工具链**，因此依赖必须用
  `npm install --ignore-scripts` 安装（跳过 `node-gyp`）。
  所需的原生模块都自带预编译二进制：
  `better-sqlite3`（`prebuilds/win32-x64.node`）、`bufferutil`、`utf-8-validate`；
  `font-list` 在 Windows 上走 PowerShell/VBS，无需编译。
- 安装后需手动执行一次 `node node_modules/electron/install.js` 下载 Electron 二进制
  （建议设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。
- electron-builder 的 `npmRebuild` 必须关掉（已在 `register-dir` 目标中处理），
  否则它会尝试用 node-gyp 重编译原生模块而失败。
- 运行预览版前，当前 shell 里不能有 `ELECTRON_RUN_AS_NODE=1`
  （会让 exe 退化成纯 Node 运行时而拒绝所有 Chromium 开关）。
