# Rain Music 自定义源接口

自定义源是带说明头的 JavaScript 文件，在独立窗口执行。脚本通过全局对象访问宿主接口。**为兼容社区既有脚本，该全局对象同时以两个名字暴露：`lx` 与 `rain`**，两者是同一个接口对象，用哪个都可以。脚本不应依赖其他应用的私有设置键或文件目录。

说明头示例：

```js
/**
 * @name 我的音乐源
 * @description 返回由你提供的音乐服务地址
 * @author 开发者
 * @version 1.0.0
 */
```

使用全局对象（`lx` 或 `rain`，二者是同一个接口对象）的 `EVENT_NAMES` 中的事件常量，通过 `.on(...)` 注册请求处理，通过 `.send(EVENT_NAMES.inited, ...)` 声明支持的音乐平台、操作与音质。支持的操作为 `musicUrl`、`lyric`、`pic`。逐字歌词响应字段使用 `rainlyric`。

宿主还提供 `.request`、工具函数和更新提示事件；准确的参数结构以 `src/main/modules/userApi/renderer/preload.js`、`src/common/types/user_api.d.ts` 为准。Rain Music 不会全文替换用户源脚本。导入前应由源作者适配该接口；未适配的脚本会在初始化时报告错误。

**注意**：`lx` 是本项目为兼容社区既有自定义源脚本而保留的**接口名**，不是品牌残留 —— 社区脚本普遍读取 `globalThis.lx`，移除它会导致这些脚本初始化失败（`Cannot destructure property 'EVENT_NAMES' of 'globalThis.lx' as it is undefined`）。

备份使用 `.rainmc` 扩展名。设置与备份使用 Rain Music 的数据格式。其他应用的私有字段不会自动映射成 Rain Music 设置。
