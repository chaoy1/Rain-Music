# Rain Music 自定义源接口

自定义源是带说明头的 JavaScript 文件，在独立窗口执行。脚本通过全局 `rain` 对象访问宿主接口；脚本不应依赖其他应用的全局对象、私有设置键或文件目录。

说明头示例：

```js
/**
 * @name 我的音乐源
 * @description 返回由你提供的音乐服务地址
 * @author 开发者
 * @version 1.0.0
 */
```

使用 `rain.EVENT_NAMES` 中的事件常量，通过 `rain.on(...)` 注册请求处理，通过 `rain.send(rain.EVENT_NAMES.inited, ...)` 声明支持的音乐平台、操作与音质。支持的操作为 `musicUrl`、`lyric`、`pic`。逐字歌词响应字段使用 `rainlyric`。

宿主还提供 `rain.request`、工具函数和更新提示事件；准确的参数结构以 `src/main/modules/userApi/renderer/preload.js`、`src/common/types/user_api.d.ts` 为准。Rain Music 不会全文替换用户源脚本。导入前应由源作者适配该接口；未适配的脚本会在初始化时报告错误。

备份使用 `.rainmc` 扩展名。设置与备份使用 Rain Music 的数据格式。其他应用的私有字段不会自动映射成 Rain Music 设置。
