# 开发与发布

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/main` | Electron 主进程、窗口、数据库与 IPC |
| `src/renderer` | Vue 主界面、播放器、歌单与设置 |
| `src/renderer-lyric` | 桌面歌词界面 |
| `src/common`、`src/lang` | 类型、配置迁移、主题和翻译 |
| `build-config` | 编译与打包配置 |
| `tests/unit`、`tests/ui` | 逻辑回归和 Electron 交互回归 |
| `resources`、`doc/images` | 应用资源和公开截图 |
| `vendor`、`licenses` | 本地第三方依赖与许可证 |
| `dist`、`build` | 编译及打包产物，不提交 Git |
| `.design` | 本地验证截图、日志和历史方案，不提交 Git |

## 验证

使用 Node.js 22.15+，先执行 `npm ci`。
`npm run verify` 依次执行三套类型检查、单元测试和四个生产编译入口；构建包含源码 lint。
`npm run test:ui` 在 Electron 中检查设置、收藏、时间轴、桌面歌词和受限歌词接口。
测试使用隔离数据目录，结果和截图保存在 `.design`。
图形测试通过 `RAIN_NO_PROTOCOL_REGISTRATION=1` 跳过系统协议关联注册。

其他专项测试可在 `package.json` 的 `test:*` 脚本中查看。
图形测试与打包依次运行，避免原生模块被占用。

## 打包

`npm run pack:dir` 构建目录版；`npm run pack` 构建 Windows x64 安装程序。
打包后执行 `npm run test:package` 检查包内版本、编译文件、原生模块、许可证和实际启动。
macOS、Linux 和其他架构入口保留供开发者使用，v1.0.0 尚未验证这些平台。

默认下载匹配的 Electron 运行时。已安装运行时且下载端点不可用时，可在 PowerShell 中使用：

```powershell
$env:RAIN_ELECTRON_DIST = (Resolve-Path node_modules/electron/dist).Path
$env:RAIN_PACKAGE_OUTPUT = 'build/v1.0.0'
npm run pack:dir
Remove-Item Env:RAIN_ELECTRON_DIST, Env:RAIN_PACKAGE_OUTPUT
```

编译只清理 `dist`，保留 `build` 下的程序和便携数据。不要将打包目录用作唯一的数据备份。
打包依赖与 Electron ABI 匹配的 SQLite 预编译模块；不匹配时需要安装对应构建工具并重新编译。

## 版本与发布

1. 更新 `package.json`、锁文件根版本和 `CHANGELOG.md`，完成本地验证。
2. 提交并推送 `master`，创建并推送对应的 `v*` 注释标签。
3. GitHub Release 工作流验证标签与版本一致，完成检查后构建 Windows x64 目录版。
4. 工作流发布 ZIP、SHA-256 校验文件和对应 GitHub Release。

普通分支推送和 PR 执行 CI；不自动发布。发布无需仓库内保存令牌。
配置迁移版本用于兼容已有用户数据，不随应用版本重置。

## 当前边界

本版本验证目标是 Windows x64。在线音乐源依赖外部服务，交互回归使用隔离测试数据。
主界面仍依赖 Electron Node 集成；桌面歌词采用隔离、沙箱化的受限接口。
第三方许可证需随打包产物一起分发。

发布前的依赖审计记录见 [v1.0.0 验证说明](./release-v1.0.0.md)。开发工具链仍存在上游安全告警。
