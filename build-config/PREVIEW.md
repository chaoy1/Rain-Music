# 隔离预览构建

`npm run pack:preview` 构建 Windows x64 预览目录，使用独立的应用身份，关闭协议注册。
运行前在程序旁创建 `portable` 文件夹，或通过 `RAIN_DATA_DIR` 指定隔离数据目录。
构建输出默认位于 `build`，可通过 `RAIN_PACKAGE_OUTPUT` 改写。
预览构建不能替代正式版本的完整验证。开发与发布说明见 [开发文档](../docs/development.md)。
