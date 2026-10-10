package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Logger;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Map;

/**
 * Android 移植 · **P0-2 第二刀 + 第三刀**：渲染层 {@code DATA} store 的**读/写两条通道**。
 *
 * <pre>
 * winMain_get_data    invoke, args=[path]         → any | null   （契约 docs/android/ipc-contract.md:197 ＝ 第二刀）
 * winMain_save_data   send,   args=[{path, data}] → void         （契约 docs/android/ipc-contract.md:198 ＝ 第三刀）
 * </pre>
 *
 * 别的通道（{@code player_list_*} / {@code dislike_*} …）一条不做。
 *
 * <p>⚠️ 第二刀只落了读通道，Android 上**没有任何写入方** ⇒ 首装只能读到 {@code null}；
 * 第三刀补上写入方。两条通道共用**同一份** Preferences 文件（{@code CapacitorStorage}）与
 * **同一把**写锁（{@link RainMusicStoreLock#WRITE_LOCK}，第三刀把第一刀的锁改成它的别名）。
 *
 * <h2>形状（抄契约，没有自己发明）</h2>
 *
 * 契约行 {@code ipc-contract.md:197}：
 * <ul>
 *   <li>渲染层封装 9 处：{@code getPlayInfo} {@code R:ipc:140}、{@code getSearchHistoryList} {@code :151}、
 *       {@code getListPositionInfo} {@code :162}、{@code getListPrevSelectId} {@code :173}、
 *       {@code getListUpdateInfo} {@code :184}、{@code getLeaderboardSetting} {@code :194}、
 *       {@code getSongListSetting} {@code :203}、{@code getSearchSetting} {@code :212}、
 *       {@code getViewPrevState} {@code :221}；</li>
 *   <li>主进程 handler {@code M:data:7} = {@code src/main/modules/winMain/rendererEvent/data.ts:7-25}
 *       （{@code mainHandle} ⇒ 渲染层是 {@code rendererInvoke}，异步请求/应答）；</li>
 *   <li>参数 → 返回：{@code path: DATA_KEYS} → {@code any | null}。</li>
 * </ul>
 *
 * 参数只有一个：{@code args[0]} = 键名（{@code rendererInvoke(channel, DATA_KEYS.x)} ⇒
 * {@code args = [path]}，见 {@code src/common/rendererIpc.ts:29-31} 与
 * {@code src/common/platform/ipcBridge/capacitor.js:585-613}）。**不做 DATA_KEYS 白名单校验** ——
 * 桌面也不校验（同一个 store 里还住着 {@code winLegacyMessageShown} 这种不在 DATA_KEYS 里的键，
 * {@code src/main/utils/winLegacy.ts:11}），加白名单只会制造一处桌面没有的失败。
 *
 * <h2>落点：这是**键值存储**，不是 SQL —— 本文件一行 SQL 都没有（含理由）</h2>
 *
 * 桌面侧它的落点是 {@code getStore(STORE_NAMES.DATA)} ⇒ {@code <RainDatas>/data.json}
 * （{@code rendererEvent/data.ts:8}、{@code src/main/platform/storage/core.ts}），也就是一份
 * **JSON 键值表**，跟 {@code src/main/worker/dbService/**}（better-sqlite3）没有关系：
 * {@code M:data:7} 里**只有 {@code playInfo} 分支**会碰 dbService（{@code data.ts:11-24}），
 * 那一步是"播放队列恢复校正"，不是"读数据"。
 *
 * 因此本通道**没有 SQL 落点**，也不该硬造一个：
 * <ol>
 *   <li>阶段 2a 的表结构在 {@code src/main/worker/dbService/tables.ts:121-232}，一共 9 张表
 *       （{@code db_info} / {@code my_list} / {@code my_list_music_info} / {@code my_list_music_info_order} /
 *       {@code music_info_other_source} / {@code lyric} / {@code music_url} / {@code download_list} /
 *       {@code dislike_list}），**没有任何 kv 表** —— 所以"表结构照 tables.ts 逐字对齐"在这条通道上
 *       无表可对；</li>
 *   <li>契约对这条通道给的 Android 方案就是键值：{@code ipc-contract.md:515}
 *       "`@capacitor/preferences`（键值）或 SQLite 表"、{@code :722}
 *       "键值存储 … `@capacitor/preferences` … 也可直接落在 SQLite 里"；</li>
 *   <li>阶段 2b 的结论（{@code docs/android/storage-adapter.md:223-232} §3.2）明确选了
 *       {@code @capacitor/preferences}，并且**明确要求 {@code playInfo} 的恢复校正逻辑留在"主进程"侧**
 *       （Android 上根本没有主进程，见下面「语义差异 2」）；</li>
 *   <li>P0-2 第一刀（{@code RainMusicAppSettingChannels.java}）已经把**同一个 {@code rain:store:} 命名空间**
 *       落在 {@code CapacitorStorage} 这份 SharedPreferences 上，本文件必须与它对齐，否则同一套 store
 *       会在两个地方各写各的。</li>
 * </ol>
 *
 * <p><b>所以落点就是第一刀的落点：SharedPreferences 文件 {@code CapacitorStorage}（= {@code @capacitor/preferences}
 * 的默认 group），键 {@code rain:store:data}，值 = 整份 store 的 JSON 文本</b>
 * （{@code 'rain:store:' + desc.name}，{@code src/main/platform/storage/adapter.android.ts:95}；
 * {@code STORE_NAMES.DATA = 'data'}，{@code src/common/constants.ts:10}）。键名不带 DATA_KEYS ——
 * 一份 store 一个 key，与 {@code adapter.android.ts} 的读/写逐字一致，P0-3 接 Preferences 时不需要迁移。
 * ⚠️ 阶段 2b §3.2 曾建议"每个 {@code DATA_KEYS} 一个 key（{@code rain:data:playInfo}）"以降低写放大，
 * 但**已经落地的骨架**（{@code adapter.android.ts:95}）是"一份 store 一个 key"；两边只能选一个，
 * 本刀选已落地的那一个（写放大是写入方的事，且写入方就是同一份骨架）。这是**需要人来定的点**，
 * 已在汇报里列出。
 *
 * <h2>并发：读通道不需要锁，写通道必须与设置通道**共用同一把锁**</h2>
 *
 * P0-1 的 handler 跑在 {@link RainMusicIpcPlugin} 自己的 2 线程池里，所以并发是真的。
 *
 * <p><b>{@code winMain_get_data}（第二刀）**只读**，因此不需要锁：</b>
 * <ol>
 *   <li>**没有 SQLite** ⇒ 没有连接 / 事务 / busy / {@code database is locked} 这一类问题
 *       （本通道不开库、不建表、不持连接）；</li>
 *   <li>整个 handler 只做一次 {@code SharedPreferences.getString()}。它取回的是一个**不可变字符串
 *       快照**，随后在锁外解析 —— 不存在"读到半截文本"的中间态；
 *       {@code SharedPreferencesImpl.commitToMemory()} 在实例锁内把新值放进内存 map，
 *       读方只会看到**旧的整份**或**新的整份**；</li>
 *   <li>{@code Context.getSharedPreferences(name, …)} 在同一进程内对同一文件名返回**同一个实例**
 *       （{@code ContextImpl} 的进程级缓存）⇒ 不会出现"两个内存副本各看到各的旧值"，P0-3 用
 *       {@code @capacitor/preferences}（默认 group 就是这份文件）写进去的数据，这里立刻读得到；</li>
 *   <li>**本通道没有 read-modify-write**，所以哪怕它与写入方并发也不会互相覆盖。</li>
 * </ol>
 *
 * <p><b>{@code winMain_save_data}（第三刀）是 read-modify-write</b>（读整份文本 → 改一个键 → 写回整份文本），
 * 因此**必须串行化**：两个并发写会丢掉其中一个（桌面不会遇到：Electron 主进程单线程 +
 * {@code Store.set()} 同步写）。它用的是 {@code synchronized (}{@link RainMusicStoreLock#WRITE_LOCK}{@code )} ——
 * **与第一刀的设置通道同一个锁对象**（第一刀的 {@code WRITE_LOCK} 现在是本对象的别名）。
 * 为什么"各自一把锁"不够、依据是什么、这把锁管不到什么，全部写在 {@link RainMusicStoreLock} 的类注释里。
 *
 * <h2>写通道 {@code winMain_save_data}（第三刀）的形状与语义</h2>
 *
 * 契约行 {@code ipc-contract.md:198}（降级方案另见 {@code :516}）：
 * <ul>
 *   <li>渲染层封装 9 处，**全部是 {@code rendererSend}**（不是 invoke）：{@code savePlayInfo}
 *       {@code R:ipc:136}、{@code saveSearchHistoryList} {@code :147}、{@code saveListPositionInfo}
 *       {@code :158}、{@code saveListPrevSelectId} {@code :169}、{@code saveListUpdateInfo} {@code :180}、
 *       {@code saveLeaderboardSetting} {@code :191}、{@code saveSongListSetting} {@code :200}、
 *       {@code saveSearchSetting} {@code :209}、{@code saveViewPrevState} {@code :218}；</li>
 *   <li>主进程 handler {@code M:data:30}（{@code mainOn} ⇒ 单向）=
 *       {@code src/main/modules/winMain/rendererEvent/data.ts:30-33}；</li>
 *   <li>参数 → 返回：{@code {path, data}} → {@code void}（本通道返回 {@code null}）。</li>
 * </ul>
 *
 * <p>参数形状只有一个：{@code args[0]} = {@code {path, data}}。{@code rendererSend(channel, params)}
 * ⇒ {@code args = [params]}（{@code capacitor.js} 的 {@code bridge.send} 用 {@code normalizeArgs} 把变参
 * 收成数组，而 {@code rendererSend(name, params)} 只传一个参数）—— **不是** {@code args = [path, data]}。
 * 写错这一处，真机上每一条 save 都会变成"参数必须是对象"，而那是一条**单向**通道，渲染层看不见报错。
 *
 * <p><b>三个关键语义（每条都对齐桌面，且都有明确的失败表现）</b>：
 * <ol>
 *   <li><b>store 还没写过 ⇒ 从空 store 开始</b>（写出一份只含这一个键的 JSON）。
 *       桌面 {@code getStore()} 在文件不存在时就是 {@code {}}（{@code core.ts:66-68} 的
 *       {@code existsSync ? parse : {}}），两边同形。这不是"猜"：首装 {@code save_data}
 *       必须能成功，否则 Android 第一次写永远失败；</li>
 *   <li><b>只改这一个键，别的键原样留着</b>：先读回整份文本 → 解析 → {@code put(path, data)} →
 *       写回整份。桌面 {@code Store.set()} 改的是内存里的整份对象再落盘整份（{@code core.ts:79-82}），
 *       本通道每一步都对齐它；**唯一差别**是桌面那份对象在内存里缓存着，本通道每次都从
 *       Preferences 重新读 —— 后者反而不会被别的写者（P0-3 的 {@code Preferences.set}）写陈旧；</li>
 *   <li><b>{@code data} 为 JSON {@code null} 是"写一个 null 值"，不是"删掉这个键"</b>：
 *       渲染层 {@code saveListPrevSelectId(listPosition: string | null)}（{@code R:ipc:169}）
 *       的签名允许 null，桌面写出来就是 {@code "listPrevSelectId": null}。
 *       {@code org.json} 的坑在 {@code put(name, null)} 会**删键**、{@code put(name, JSONObject.NULL)}
 *       才存 JSON null（第一刀 {@code jsonValue()} 的同一处理，官方文档原文见那个文件的注释）。
 *       所以 {@code data} 字段**必须显式存在**：{@code {path:'x', data:null}} 是合法的"写 null"，
 *       而 {@code {path:'x'}}（字段缺失）= 参数不对，**抛错**。为什么不把"缺失"也当 null 写下来：
 *       桌面在 {@code data === undefined} 时 {@code JSON.stringify} 会把这个键从文件里**抹掉**，
 *       与"写 null"不是一回事；参数过 JSON 序列化后两者不再可区分（{@code undefined} 在
 *       {@code JSON.stringify} 里直接消失），所以这里**拒绝**而不是猜一个。</li>
 * </ol>
 *
 * <p><b>本通道不广播任何东西</b>（成功也不广播）：契约 {@code :198} 的返回值是 {@code void}、
 * 桌面 {@code data.ts:30-33} 一个事件都不发。⚠️ 特别注意**不要**顺手在这里广播
 * {@code winMain_on_config_change} —— 那是设置通道（{@code config_v2}）的事，
 * 渲染层会据此把差异合并进 appSetting（{@code useEventListener.ts:115-119}）。
 *
 * <h2>不假装成功（逐条）</h2>
 * <ul>
 *   <li>{@code args} 为空 / {@code args[0]} 不是**非空字符串** ⇒ 抛错（调用方看到 {@code ok:false} 的 reject，
 *       不是静默 null）。桌面这里会把 {@code undefined} 丢给 {@code store.get()}，行为未定义；
 *       本通道选择"大声报错"；</li>
 *   <li>{@code rain:store:data} 的文本存在但**不是合法 JSON 对象** ⇒ 抛错。**绝不返回 null / {} / []** ——
 *       那会把"数据坏了"伪装成"首次启动"（第一刀在坏 JSON 上就是拒绝这么做的，
 *       {@code RainMusicAppSettingChannels.java:79-81,279-290}）。本通道是只读的，所以它连"覆盖坏数据"
 *       这个选项都没有；</li>
 *   <li>拿不到 {@code Context} ⇒ 抛错，而不是读出一个空 store 当成"没有数据"；</li>
 *   <li>**键不存在 / 从未写过 store ⇒ 返回 null，这是正确的答案而不是失败**：桌面同样读不出来
 *       （{@code store.get()} 给 {@code undefined}），而 JSON 里没有 {@code undefined}，
 *       桥的应答只能是 {@code null}。9 个调用方**全部**有兜底：{@code src/renderer/utils/ipc.ts:198,207,216,225}
 *       的 {@code ?? {...DEFAULT_SETTING.x}}、{@code src/renderer/store/search/action.ts:23} 的 {@code ?? []}、
 *       {@code src/renderer/utils/data.ts:49,82,100} 的 {@code ?? {}} / {@code ?? LIST_IDS.DEFAULT}、
 *       {@code src/renderer/core/useApp/useDataInit.ts:19} 的 {@code info?.listId}、
 *       {@code src/renderer/core/useApp/index.ts:151} 的 {@code invokeWithFallback(…, () => null)}。</li>
 * </ul>
 *
 * <p><b>写通道（第三刀）不假装成功的地方，逐条：</b>
 * <ul>
 *   <li>{@code args} 为空 / {@code args[0]} 不是对象 / 缺 {@code path} / {@code path} 不是非空字符串 /
 *       缺 {@code data} 字段 ⇒ 抛错。**不写任何东西**，也不会"写一个 null 蒙过去"；</li>
 *   <li>store 文本存在但不是合法 JSON 对象 ⇒ 抛错，**绝不覆盖**（用的就是读通道那个
 *       {@code parseStoreText()}）。这里与桌面**有意不同**：桌面 {@code getStore()} 会把坏文件改名成
 *       {@code .bak}、弹框、再用空 store 重建（{@code core.ts:139-157}），也就是"先留底、再覆盖"。
 *       Android 侧**没有留底这一步**（Preferences 没有"改名"，{@code adapter.android.ts:144-155} 的
 *       {@code backupSync} 是有意的空实现），所以覆盖就等于**无备份地丢用户数据** ——
 *       宁可这一次写失败，让 logcat 和调用方把问题摆出来；</li>
 *   <li>{@code SharedPreferences.commit()} 返回 false（写没落盘）⇒ 抛错。**不假装成功**：
 *       不广播（本通道本来就不广播）、也不把内存里的值当成"已保存"（{@code commit()} 与
 *       {@code apply()} 的区别正在这里：前者同步写完并回报结果，后者只保证"稍后写"）；</li>
 *   <li>拿不到 {@code Context} ⇒ 抛错（与读通道同一句 {@code requireContext()}）。</li>
 * </ul>
 *
 * <p>⚠️ <b>{@code ok:false} 到底能不能被渲染层看见？</b>这条通道在渲染层是 {@code rendererSend}
 * （{@code kind:"send"}，单向），而 P0-1 的 {@code RainMusicIpcPlugin.runHandler()} 对
 * {@code !expectsResponse} 那一支**只把异常写进 logcat、不回应答**（{@code RainMusicIpcPlugin.java:241-247}）。
 * 也就是说：本文件把失败**抛出去**（而不是吞掉）之后，{@code ok:false} 只有在"有人把它当 invoke 调"时
 * 才到得了渲染层；按现在的渲染层代码，这条通道失败的可观测面是 **logcat**。
 * 要不要让 send 通道的失败也能在渲染层看见（那要改 P0-1 的传输层，会让所有 send 通道在失败时
 * 多收一条"未知 id 的应答"的 {@code console.error}）**超出本刀范围，是需要人定的点**，已列在汇报里；
 * 本刀的选择是"抛出去 + 打日志"，绝不吞。
 *
 * <p>三种状态**分别**的表现（这是本通道最容易被写错的一处）：
 *
 * <table border="1">
 *   <caption>空 / 坏 / 缺表</caption>
 *   <tr><th>状态</th><th>本通道</th><th>理由</th></tr>
 *   <tr><td>存储**空**（从没写过 {@code rain:store:data}，或 store 里没有这个键）</td>
 *       <td>resolve {@code null}（不是 reject，也不是 {@code []} / {@code {}}）</td>
 *       <td>与桌面首启一致；调用方自己的默认值接手</td></tr>
 *   <tr><td>存储**坏**（文本不是合法 JSON 对象）</td>
 *       <td>reject {@code ok:false, code=IPC_HANDLER_FAILED}，且**不覆盖**</td>
 *       <td>"坏了"不能伪装成"空的"；这是第一刀立的规矩</td></tr>
 *   <tr><td>**表缺失**（SQLite 语境）</td>
 *       <td>不适用 —— 本通道不建表、不查表</td>
 *       <td>若将来有人把落点改成 SQLite 表（线 A），**"表不存在"必须报错**，
 *           不能当成"空库"返回 null；这条写在这里，免得那一天被顺手写成"空"</td></tr>
 * </table>
 *
 * <h2>与桌面的语义差异（逐条，含理由）</h2>
 * <ol>
 *   <li><b>{@code undefined} vs {@code null}</b>：桌面 {@code store.get(path)} 在键不存在时给
 *       {@code undefined}；本通道只能给 JSON {@code null}（桥的应答要过 JSON 序列化，
 *       {@code RainMusicIpcPlugin.respondOk} 把 null 映射成 {@code JSObject.NULL}）。上面列出的
 *       9 个调用方用的都是 {@code ??} / 可选链，两种值等价；**没有任何调用方区分它们**。
 *       这也是本通道**不需要**改 JS 的原因。</li>
 *   <li><b>{@code playInfo} 不做"播放队列恢复校正"</b>：桌面 {@code M:data:11-24} 在
 *       {@code listId == LIST_IDS.DEFAULT && index >= 0} 时会
 *       {@code await dbService.resolvePlaybackQueueRestoreIndex(...)} → 可能返回 {@code null}，
 *       或按 {@code getListMusics(DEFAULT)} 算出新 index 后**回写 store**，再
 *       {@code await dbService.completePlaybackQueueRestore()}。Android 上这条链**没有可用的落点**：
 *       {@code global.rain.worker.dbService} 是**主进程**里的 SQLite worker（{@code src/main/event/ListEvent.ts:40}
 *       等 40 余处都是这么用的），而 Android 侧根本没有主进程，线 A 的 Android 驱动
 *       （{@code src/main/worker/dbService/adapter/android.ts:53-58}）到现在仍是
 *       {@code throw new Error('… not implemented yet')}。所以本通道**原样返回存储值**，
 *       并打一条 {@code Logger.warn} 点名"校正没有做" —— **不是静默跳过**。
 *       为什么"原样返回"不算假装成功：桌面自己在 {@code listId != DEFAULT || index < 0} 时
 *       也是原样返回（{@code data.ts:11-14}），而且调用方对 index 有自己的守卫
 *       （{@code useDataInit.ts:19-21}：{@code !info?.listId || info.index < 0} 与
 *       {@code !list[info.index]} 都会放弃恢复），越界索引不会变成"恢复错歌"。</li>
 *   <li><b>损坏恢复</b>：桌面把坏 JSON 改名成 {@code .bak} 并弹框，然后继续跑
 *       （{@code storage-adapter.md:183}）；本通道**只读**，既不改名也不覆盖，直接 reject。
 *       理由同上表：把"坏"标出来，比替用户"修好"更不容易把数据搞丢。</li>
 *   <li><b>参数校验</b>：桌面不校验（{@code store.get(undefined)} 的行为未定义）；本通道
 *       对空参数/非字符串**抛错**。理由：这是一条真机上"错了就永远静默"的通道，
 *       宁可让调用方看见一次 reject。</li>
 *   <li><b>文本格式</b>：桌面写的是 {@code JSON.stringify(store, null, '\t')}（tab 缩进），
 *       P0-3 落到 Preferences 的文本由 JS 侧 {@code stringify()} 决定。本通道只把它当 JSON 解析，
 *       格式差异（只影响人肉 diff）不构成语义差异。
 *       写通道同理：{@code org.json} 只能输出紧凑文本（{@code JSONObject.toString()}，没有 tab 缩进），
 *       与桌面那份 tab 缩进不同；两边都只把这段文本当 JSON 解析（阶段 2b 的 {@code parseStore}
 *       只做 {@code JSON.parse}），唯一受影响的是人肉 diff 文件。</li>
 *   <li><b>第二刀时没有写入方</b>（第三刀已补）：第二刀落地时 Android 上**没有任何写入方**，
 *       除非 P0-3 或别的通道写进去，读通道会一直返回 {@code null} —— 那是"诚实但暂时读不到东西"，
 *       不是失败。第三刀补上 {@code winMain_save_data}（{@code M:data:30}，{@code mainOn} 单向），
 *       两条通道共用同一份 Preferences 与同一把锁。</li>
 *   <li><b>{@code playInfo} 的写分支不做"播放队列恢复收尾"</b>：桌面 {@code data.ts:32} 在
 *       {@code path == playInfo && (data.listId != 'default' || data.musicId)} 时会
 *       {@code await dbService.completePlaybackQueueRestore()}。Android 上没有 dbService
 *       （同上一条「语义差异 2」），**这一步没有执行**，本文件会打一条 {@code Logger.info} 点名它
 *       —— **不静默跳过**。它与读侧的差别值得写清楚：读侧的"恢复校正"会**改变返回值**
 *       （所以那边是 {@code Logger.warn} 的实质缺口）；写侧这个调用是"通知 SQLite 层收尾"，
 *       Android 侧**根本没有那份状态可收尾**，属于结构性 no-op，所以信息级别降为 {@code info}
 *       （不为每 2 秒一次的 {@code savePlayInfo} 刷 warn）；</li>
 *   <li><b>store 的内存缓存</b>：桌面 {@code Store} 把整份对象缓存在内存里、再整份落盘
 *       （{@code core.ts:52-82}），本通道每次都从 Preferences 重新读整份文本。
 *       差别只在"谁能看到谁的写"：这里靠 SharedPreferences 的进程级单实例 +
 *       {@code commit()} 的同步 {@code commitToMemory()}，所以"写完立刻读"
 *       （{@code save*} 之后马上 {@code get_data}）在本通道上是**一致的**；</li>
 *   <li><b>写序</b>：桌面 {@code Store.set()} 是同步原子写（临时文件 + rename），
 *       调用顺序 == 落盘顺序。本通道用 {@link RainMusicStoreLock#WRITE_LOCK} 把"读-改-写"整段
 *       串行化，并且用**同步的** {@code commit()}（不是 {@code apply()}），因此"落盘完成"先于"handler 返回"
 *       —— 契约 {@code :516} 那句"Android 侧要保证写序（队列化）"由此满足。
 *       ⚠️ 它与阶段 2b 的 {@code enqueueWrite}（{@code adapter.android.ts:165}）是**两把互不相识的锁**：
 *       真机接线（P0-3）时同一条 store 路径只能有一个写者，否则那把锁挡不住本文件这把锁
 *       （**需要人定的点**，见汇报）；</li>
 * </ol>
 *
 * <h2>依赖</h2>
 * 只用到 {@code :capacitor-android}（{@code com.getcapacitor.Logger}）、Android 框架自带的
 * {@code android.content.*} 与 {@code org.json}、JDK 的 {@code java.util.List}，
 * 以及同包的 {@link RainMusicStoreLock}（纯 {@code java.lang.Object}，见它的类注释）。
 * **没有新增任何 gradle 依赖**，也没有引入 Kotlin。
 *
 * <h2>未验证（不要当成已验证）</h2>
 * 本机没有 Android SDK（{@code docs/android-port-plan.md} §0），本文件**未经真实编译**：
 * 语法与 API 用法是对着本机读到的 {@code @capacitor/android@8.5.2} 源码 + Android 框架 API 逐条核对的，
 * 只能由 CI（{@code .github/workflows/build-android.yml} 的 {@code gradlew assembleDebug}）证伪；
 * 真机行为（Preferences 落盘、与 P0-3 的 {@code @capacitor/preferences} 是否读写同一份数据、
 * {@code commit()} 的返回值、事件时机）同样**未在真机上验证**。
 * 另外，{@link RainMusicStoreLock} 里那条"整份 map 快照乱序落盘"的判断**不是本机能证伪的东西**
 * （它需要真机上的并发时序），CI 也覆盖不到 —— 它是一条按"宁严勿宽"落地的工程判断。
 */
public final class RainMusicDataChannels {

    /**
     * `winMain_get_data`：键名 `get_data`（{@code src/common/ipcNames.ts} 的
     * {@code WIN_MAIN_RENDERER_EVENT_NAME.get_data}）+ 模块前缀 `winMain`
     * （生成规则见 {@code src/common/ipcNames.ts:171-176}）。
     */
    public static final String CHANNEL_GET_DATA = "winMain_get_data";

    /**
     * `winMain_save_data`：键名 `save_data`（{@code src/common/ipcNames.ts:89} 的
     * {@code WIN_MAIN_RENDERER_EVENT_NAME.save_data}）+ 模块前缀 `winMain`（同上）。
     */
    public static final String CHANNEL_SAVE_DATA = "winMain_save_data";

    /**
     * SharedPreferences 文件名 = `@capacitor/preferences` 的默认 group。
     * 与第一刀 {@link RainMusicAppSettingChannels#PREFERENCES_FILE} 必须是同一个文件
     * （同一套 store 命名空间，理由见类注释）。
     */
    public static final String PREFERENCES_FILE = "CapacitorStorage";

    /**
     * store 的落点键，与阶段 2b 的 `preferencesKey()` 逐字一致：
     * {@code 'rain:store:' + desc.name}（`adapter.android.ts:95`），
     * 其中 `STORE_NAMES.DATA = 'data'`（{@code src/common/constants.ts:10}）。
     */
    public static final String STORE_KEY = "rain:store:data";

    /**
     * `playInfo` 的键名（`DATA_KEYS.playInfo`，{@code src/common/constants.ts:39}）。
     * 单独提出来是因为**只有这个键**在桌面上有额外语义（读侧"播放队列恢复校正"、
     * 写侧"`completePlaybackQueueRestore()` 收尾"），而这里两条都明确不做 ——
     * 见类注释「语义差异 2」与「语义差异 7」。
     */
    public static final String DATA_KEY_PLAY_INFO = "playInfo";

    /**
     * `save_data` 参数里的两个字段名（契约 `ipc-contract.md:198` 的 `{path, data}`）。
     */
    private static final String FIELD_PATH = "path";
    private static final String FIELD_DATA = "data";

    /** `playInfo` 身体里的两个字段（只用来判断桌面写侧会不会去调 dbService，见类注释「语义差异 7」）。 */
    private static final String FIELD_LIST_ID = "listId";
    private static final String FIELD_MUSIC_ID = "musicId";

    /**
     * `LIST_IDS.DEFAULT = 'default'`（{@code src/common/constants.ts:24}）。
     * 只用于判断桌面写侧**会不会**去调 {@code completePlaybackQueueRestore()}（{@code data.ts:32}），
     * 从而决定那条 {@code Logger.info} 值不值得打 —— 本通道自己不做任何 list 语义。
     */
    private static final String LIST_ID_DEFAULT = "default";

    private static final String TAG = "RainMusicData";

    private RainMusicDataChannels() {}

    /**
     * 注册这两条通道。**在 {@link RainMusicIpcPlugin#load()} 里调用**（与 P0-1 的 `setEmitter`、
     * 第一刀的 `RainMusicAppSettingChannels.register` 同一处）。漏调 = 真机上
     * {@code IPC_CHANNEL_UNSUPPORTED}，不会静默。
     *
     * <p>与第一刀一样传插件实例而不是 Context：{@code Context} 留到**每次调用时**再取，
     * 这样 {@code load()} 阶段拿不到 Activity 也不会让建桥失败；取不到时 handler 大声抛错。
     */
    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) {
            throw new IllegalArgumentException("RainMusicDataChannels.register 需要一个插件实例");
        }
        RainMusicIpcHandlers.register(CHANNEL_GET_DATA, (args, ctx) -> getData(requireContext(plugin), args));
        RainMusicIpcHandlers.register(CHANNEL_SAVE_DATA, (args, ctx) -> saveData(requireContext(plugin), args));
        Logger.info(
            TAG,
            "P0-2 第二刀 + 第三刀：已注册 " + CHANNEL_GET_DATA + " / " + CHANNEL_SAVE_DATA +
            "（落点 " + PREFERENCES_FILE + " → " + STORE_KEY + "，读 + 写；写侧与 " +
            "RainMusicAppSettingChannels 共用同一把锁）"
        );
    }

    // ------------------------------------------------------------------ 读通道（第二刀）

    /**
     * `winMain_get_data`：读 store 里的一个键。
     *
     * @param args {@code args[0]} = 键名（非空字符串）
     * @return 存储值原样返回；**键不存在 / 还没写过 store** 时返回 {@code null}
     *         （与桌面"读不出来"一致，见类注释的三种状态表）
     * @throws IllegalArgumentException 参数不是非空字符串
     * @throws IllegalStateException    store 文本存在但不是合法 JSON 对象（**不覆盖**）
     */
    private static Object getData(Context context, List<Object> args) {
        String path = readPath(args);
        String text = preferences(context).getString(STORE_KEY, null);

        if (text == null) {
            // 与桌面首启同形：store 还没落过盘 ⇒ 任何一个键都读不出来。这不是错误。
            Logger.warn(
                TAG,
                CHANNEL_GET_DATA + "(\"" + path + "\")：Preferences 里还没有 " + STORE_KEY +
                "（首次启动，或还没有任何写入方）→ 返回 null；默认值由渲染层兜底" +
                "（src/renderer/utils/ipc.ts:198,207,216,225 等的 `??`）"
            );
            return null;
        }

        JSONObject store = parseStoreText(text);
        Object value = store.opt(path);
        if (value == null) {
            Logger.info(TAG, CHANNEL_GET_DATA + "：store 里没有键 \"" + path + "\" → 返回 null");
            return null;
        }

        if (DATA_KEY_PLAY_INFO.equals(path)) {
            // 桌面在这一支会做「播放队列恢复校正」（可能改 index / 回写 / 返回 null）。
            // Android 上没有可用的 dbService（线 A 的 Android 驱动仍未实现）⇒ 原样返回，
            // 并且**大声**说明这一点（不静默）。理由与调用方的守卫见类注释「语义差异 2」。
            Logger.warn(
                TAG,
                CHANNEL_GET_DATA + "(\"" + DATA_KEY_PLAY_INFO + "\")：已按原样返回存储值；" +
                "桌面版的「播放队列恢复校正」**没有执行**" +
                "（src/main/modules/winMain/rendererEvent/data.ts:11-24 依赖主进程的 dbService，" +
                "Android 侧无主进程、线 A 的 SQLite 驱动也未实现）" +
                "。调用方对越界 index 有自己的守卫（src/renderer/core/useApp/useDataInit.ts:19-21）。"
            );
        }
        return value;
    }

    // ------------------------------------------------------------------ 写通道（第三刀）

    /**
     * `winMain_save_data`：写 store 里的一个键 —— **读整份文本 → 改这一个键 → 写回整份文本**，
     * 整段在 {@link RainMusicStoreLock#WRITE_LOCK} 内完成（为什么必须串行化、为什么与设置通道
     * 共用同一把锁，见类注释「并发」与 {@link RainMusicStoreLock}）。
     *
     * <p>参数形状：{@code args[0]} = {@code {path, data}}（契约 {@code ipc-contract.md:198}；
     * 渲染层 9 处全是 {@code rendererSend(channel, {path, data})} ⇒ {@code args = [{path, data}]}）。
     *
     * @return 固定 {@code null}（契约是 {@code void}；9 个调用方都是单向 {@code send}，不看返回值）
     * @throws IllegalArgumentException 参数不是对象 / 缺 {@code path} / {@code path} 不是非空字符串 /
     *                                  缺 {@code data} 字段（理由见类注释「写通道 3」）
     * @throws IllegalStateException    store 文本存在但不是合法 JSON 对象（**不覆盖**），
     *                                  或 {@code commit()} 返回 false（**不落盘就不假装成功**）
     */
    private static Object saveData(Context context, List<Object> args) throws JSONException {
        JSONObject payload = readSavePayload(args);
        String path = requirePath(payload);
        if (!payload.has(FIELD_DATA)) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 的参数缺少 `" + FIELD_DATA + "` 字段（收到的顶层键=" +
                String.valueOf(payload.names()) + "）。{" + FIELD_PATH + ":…," + FIELD_DATA +
                ":null} 是合法的「写一个 JSON null」（渲染层 saveListPrevSelectId 允许 null，R:ipc:169），" +
                "而字段缺失在桌面等价于 undefined ⇒ JSON.stringify 会把这个键从文件里**抹掉**，两者不是一回事；" +
                "参数过 JSON 序列化之后已经无法区分，所以这里**拒绝**而不是猜一个（见类注释「写通道 3」）。"
            );
        }
        Object value = jsonValue(payload.opt(FIELD_DATA));

        SharedPreferences prefs = preferences(context);
        synchronized (RainMusicStoreLock.WRITE_LOCK) {
            String text = prefs.getString(STORE_KEY, null);
            // 还没写过 ⇒ 从空 store 开始（与桌面 getStore() 的"文件不存在 ⇒ {}"同形，见类注释「写通道 1」）。
            JSONObject store = text == null ? new JSONObject() : parseStoreText(text);
            store.put(path, value);
            if (!prefs.edit().putString(STORE_KEY, store.toString()).commit()) {
                throw new IllegalStateException(
                    "写入 " + STORE_KEY + " 失败：SharedPreferences.commit() 返回 false（键 \"" + path +
                    "\" 的改动没有落盘）。⚠️ 注意 SharedPreferences 的内存 map 在写盘之前就已经更新" +
                    "（commitToMemory 先于 enqueueDiskWrite）⇒ 本进程后续 getString 会读到**新值**，" +
                    "而磁盘上仍是**旧文本**：这个差异必须让调用方看见，不能当成写成功。"
                );
            }
        }

        if (DATA_KEY_PLAY_INFO.equals(path) && desktopWouldFinishQueueRestore(value)) {
            // 桌面在这一支还会 await dbService.completePlaybackQueueRestore()（data.ts:32）。
            // Android 侧没有 dbService ⇒ **没有执行**；这不是"改返回值"的缺口，而是"没有那份状态可收尾"，
            // 所以用 info 而不是 warn（每 2 秒一次的 savePlayInfo 不该刷 warn）。见类注释「语义差异 7」。
            Logger.info(
                TAG,
                CHANNEL_SAVE_DATA + "(\"" + DATA_KEY_PLAY_INFO + "\")：已落盘；桌面版在同一支还会调 " +
                "dbService.completePlaybackQueueRestore()（src/main/modules/winMain/rendererEvent/data.ts:32），" +
                "本通道**没有调用** —— Android 侧没有主进程的 dbService，也就没有那份待收尾的恢复状态。"
            );
        }
        Logger.debug(
            TAG,
            CHANNEL_SAVE_DATA + "：已落盘键 \"" + path + "\"（" + PREFERENCES_FILE + " → " + STORE_KEY + "）"
        );
        return null;
    }

    // ------------------------------------------------------------------ 存储

    private static Context requireContext(RainMusicIpcPlugin plugin) {
        Context context = plugin.getContext();
        if (context == null) {
            throw new IllegalStateException(
                "拿不到 Context（插件还没挂上 Bridge/Activity）：无法读写 " + PREFERENCES_FILE + " 里的 " + STORE_KEY
            );
        }
        Context appContext = context.getApplicationContext();
        return appContext == null ? context : appContext;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE);
    }

    /**
     * 解析 store 文本；不是合法 JSON 对象就抛错。
     *
     * <p>**不返回** {@code null} / {@code {}} / {@code []}：那会把"数据坏了"伪装成"首次启动"。
     * 读通道用它 ⇒ 不覆盖坏数据（它只读）；写通道也用同一个它 ⇒ **同样不覆盖** ——
     * 桌面那条"先改名成 {@code .bak} 再重建"的路在 Android 上没有留底步骤
     * （{@code adapter.android.ts:144-155} 的 {@code backupSync} 是有意的空实现），
     * 覆盖就等于无备份地丢用户数据，见类注释「不假装成功」写通道第 2 条。
     */
    private static JSONObject parseStoreText(String text) {
        try {
            return new JSONObject(text);
        } catch (JSONException ex) {
            throw new IllegalStateException(
                STORE_KEY + " 里的文本不是合法的 JSON 对象（长度 " + text.length() + "）：" + ex.getMessage() +
                "。本次调用**不会覆盖它**，也**不会**返回 null / {} —— 那会把「存储坏了」伪装成「首次启动」。",
                ex
            );
        }
    }

    // ------------------------------------------------------------------ 参数

    /** 取 `args[0]` 作为键名；必须是**非空字符串**（理由见类注释「语义差异 4」）。 */
    private static String readPath(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_GET_DATA + " 需要一个字符串参数 path（DATA_KEYS.*，见 src/common/constants.ts:37-48），收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (!(first instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_GET_DATA + " 的参数必须是字符串，收到 " + first.getClass().getName() + "：" + describeArgs(args)
            );
        }
        String path = (String) first;
        if (path.length() == 0) {
            throw new IllegalArgumentException(CHANNEL_GET_DATA + " 的参数 path 不能是空字符串");
        }
        return path;
    }

    // ------------------------------------------------------------------ 写通道的参数

    /**
     * 取 `args[0]` 作为 `{path, data}` 对象（`save_data`）。与第一刀 `readPatch()` 同款：
     * {@code JSONObject} 直取（Capacitor 的 {@code JSObject} 是它的子类），{@code Map} 只作防御分支。
     */
    private static JSONObject readSavePayload(List<Object> args) {
        if (args == null || args.isEmpty() || args.get(0) == null) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 需要一个 {" + FIELD_PATH + ", " + FIELD_DATA + "} 对象参数，收到 " +
                describeArgs(args)
            );
        }
        Object first = args.get(0);
        if (first instanceof JSONObject) return (JSONObject) first;
        if (first instanceof Map) return new JSONObject((Map) first);
        throw new IllegalArgumentException(
            CHANNEL_SAVE_DATA + " 的参数必须是对象，收到 " + first.getClass().getName() + "：" + describeArgs(args) +
            "（契约是 args=[{" + FIELD_PATH + ", " + FIELD_DATA + "}]，**不是** args=[" +
            FIELD_PATH + ", " + FIELD_DATA + "]）"
        );
    }

    /** 取 `payload.path`；必须是**非空字符串**（理由见类注释「写通道」那一节）。 */
    private static String requirePath(JSONObject payload) {
        Object raw = payload.opt(FIELD_PATH);
        if (raw == null) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 的参数缺少 `" + FIELD_PATH + "` 字段（收到的顶层键=" +
                String.valueOf(payload.names()) + "）"
            );
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                CHANNEL_SAVE_DATA + " 的 `" + FIELD_PATH + "` 必须是字符串，收到 " + raw.getClass().getName()
            );
        }
        String path = (String) raw;
        if (path.length() == 0) {
            throw new IllegalArgumentException(CHANNEL_SAVE_DATA + " 的 `" + FIELD_PATH + "` 不能是空字符串");
        }
        return path;
    }

    /**
     * Java {@code null} → {@code JSONObject.NULL}。
     *
     * <p>为什么必要（与第一刀 `jsonValue()` 是同一件事）：{@code org.json} 的
     * {@code put(name, null)} 会**删掉这个键**，只有 {@code put(name, JSONObject.NULL)}
     * 才存下一个 JSON null —— 而 `save_data` 的 `data` 允许是 null
     * （渲染层 {@code saveListPrevSelectId(listPosition: string | null)}，{@code R:ipc:169}）。
     * 官方文档原文见 {@code RainMusicAppSettingChannels.jsonValue()} 的注释。
     */
    private static Object jsonValue(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    /**
     * 桌面在这个 `playInfo` 上**会不会**去调 {@code dbService.completePlaybackQueueRestore()}？
     *
     * <p>条件逐字抄 {@code data.ts:32}：{@code data?.listId != LIST_IDS.DEFAULT || data?.musicId}。
     * 只用来决定那条 {@code Logger.info} 值不值得打 —— **判断本身没有任何副作用**，
     * 而且判断错（少打一条 info）不影响写入结果：写入永远照常落盘。
     */
    private static boolean desktopWouldFinishQueueRestore(Object value) {
        if (!(value instanceof JSONObject)) return false;
        JSONObject data = (JSONObject) value;

        Object listId = data.opt(FIELD_LIST_ID);
        boolean otherList = !(listId instanceof String) || !LIST_ID_DEFAULT.equals(listId);

        Object musicId = data.opt(FIELD_MUSIC_ID);
        boolean hasMusicId = musicId != null && musicId != JSONObject.NULL && !"".equals(musicId);

        return otherList || hasMusicId;
    }

    /** 只打参数**类型**，不打内容（键名很短，但这条通道将来可能被人塞别的东西进来）。 */
    private static String describeArgs(List<Object> args) {
        if (args == null) return "null";
        StringBuilder builder = new StringBuilder("[");
        for (int i = 0; i < args.size(); i++) {
            if (i > 0) builder.append(", ");
            Object value = args.get(i);
            builder.append(value == null ? "null" : value.getClass().getSimpleName());
        }
        return builder.append("]").toString();
    }
}
