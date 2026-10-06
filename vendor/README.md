# vendor/

本目录存放**本地化（vendored）的第三方依赖副本**。

## 为什么有这些副本

本项目原先以 GitHub 短链形式安装以下 5 个第三方包（引用的是打包者账号下的 fork，
并以 commit SHA 锁定）。为了让仓库不再依赖外部账号，同时**不改变任何运行时行为**，
这 5 个包已按 `node_modules` 中实际安装的内容原样复制到本目录，
`package.json` 改为引用 `file:vendor/<包名>`。

## 清单

| 目录 | 版本 |
| --- | --- |
| `electron-devtools-installer/` | 0.0.0-development |
| `eslint-formatter-friendly/` | 5.0.0 |
| `spinnies/` | 0.5.1 |
| `webpack-hot-middleware/` | 2.25.0 |
| `needle/` | 3.2.0 |

## 注意事项

- 复制时**未包含各包自身的嵌套 `node_modules`**：npm 会依据各包 `package.json` 里声明的
  `dependencies` 正常解析安装。
- 各包 `package.json` 中的 **`devDependencies` 已被移除**。因为 npm 会把指向目录的
  `file:` 依赖当作本地链接包，连同它的 devDependencies 一起安装；而这些测试/构建工具
  （mocha、chai、webpack、eslint 等）在“使用”该库时完全不需要，会让每次 `npm install`
  多装约 23 MB / 2400 个文件。移除后仅剩运行时依赖（约 418 KB）。
  这 5 个包均**没有** `preinstall` / `install` / `postinstall` / `prepare` 之类的安装钩子，
  因此移除是安全的。
- 这些是第三方代码，版权归各自作者所有，请勿在此目录内做业务改动；
  如需升级，应从对应包的上游重新获取后整体替换，并重新执行上述裁剪。
- 由于使用 `file:` 引用，npm 会在 `node_modules/<包名>` 建立指向本目录的符号链接；
  Webpack 与 ESLint 均可正常解析。
- 源码 lint 在构建前统一执行，第三方副本由 `.eslintignore` 排除。
