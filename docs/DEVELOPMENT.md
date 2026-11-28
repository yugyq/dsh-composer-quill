# 开发与验证

> 适用版本：0.33.6 ｜ 宿主是手写 ESM，没有构建；浏览器端源码在 `client/`，由 `npm run build:client` 拼成 `client.js`


## 1. 目录结构

```
dsh-composer-quill/
├── index.js            宿主：五条路由、缓存、模型调用、SSE
├── client.js           浏览器产物（自动生成，不要手改）
├── client/             浏览器源码（八段，共用同一个闭包）
│   ├── wrapper.js      `__ModuleLoader__.load({...})` 外壳 + `/* @@CLIENT_BODY@@ */`
│   ├── prelude.js      常量、文案、token、HTTP 与 SSE 客户端
│   ├── store.js        快照 store、闸门、dock 记账、建议状态机
│   ├── config.js       设置、建议持久化、回合计数、采纳学习
│   ├── geometry.js     建议失效判断、DOM 草稿、光标/行盒测量
│   ├── ghost-layer.js  灰字层（`createGhostLayer`）
│   ├── hooks.js        九个 hook：记账、播报、历史、画灰字、按键、请求、会话边界、打字、beacon
│   ├── dock.js         GhostDock、用量面板、模型选择、设置卡片、图标
│   └── entry.js        slot 注册、`apply`、`__test` 导出
├── test/smoke-test.mjs 不依赖宿主的单元/集成测试（Node 直接跑）
├── cordis.patch.yml    把包插入 Cordis 启动图（用包名，不用相对路径）
├── package.json        dsh.bundle.patch / dsh.client 声明、engines 门禁
├── locale/{zh,en}.json 插件市场的标题与描述（UI 文案在 client/ 内联）
├── docs/               架构、协议、本文件
│   ├── plans/          已完成的拆分/预算方案（历史记录）
│   └── releases/       各版本的 release notes
├── dev/                开发工具（不随包发布）
│   ├── tools/          build-client.mjs（拼接产物）、summarize-log、rebuild-usage
│   ├── probes/         一次性探针（真实模型 / 模拟器），不进 CI
│   ├── verify/         Playwright 脚本：verify_daily.py、真机脚本、重试器
│   ├── audit/          对抗性审计脚本
│   └── harness/        浏览器模拟器（假 DSH + 假 fetch）
└── icon.svg
```

`client.js` 是产物：宿主只服务「一个包一个 bundle」，包内 chunk 是构建器协议，押在上面不划算；`dev/tools/build-client.mjs` 做纯拼接（八段共用同一个闭包，语义与拆之前逐字节一致）。改了 `client/` 必须：

```bash
npm run build:client     # 重写 client.js
npm run check:client     # 只检查是否同步（npm test 也会查）
```

验证工具在 `dev/` 下（不随包发布，详见 [dev/README.md](../dev/README.md)）：

```
dev/harness/         模拟器：src.js → esbuild → bundle.js（用 file:// 打开）
dev/verify/verify_daily.py  行为场景（模拟器驱动）
dev/verify/*.py      真机脚本：空行锚点、设置页、刷新复用、流式重绘……
```

## 2. 安装与运行

```powershell
# 链接进某个 profile（示例用 ghosttest）
# 指向你本机的 DSH 启动器（Windows 桌面预览版的默认位置如下，装到别处就改成你的路径）
$dsh = "$env:USERPROFILE\.dsh\desktop-preview-test\app\resources\runtime\cli\bin\dsh.cmd"
& $dsh profile add ghosttest            # 若无
& $dsh plugin add --link "C:\…\dsh-composer-quill" --profile ghosttest

# 启动一个隔离实例（不干扰桌面端）
& $dsh --profile ghosttest --port 0 --no-open
# 输出 dsh web: http://127.0.0.1:PORT/?token=…  → 用 Playwright 打开
```

**改完客户端代码：先 `npm run build:client`，再按 `Ctrl+R`**（profile 里是指向本仓库的软链时）。验证方法不是看 `build`——不抬版本号时新旧包报同一个字符串——而是看 `apply` beacon 的 `detail`：它带上这版注册的挂载点。

```powershell
Get-Content "$env:USERPROFILE\.dsh\composer-quill.log" -Tail 20 | Select-String '"build"'
```

日志的真实位置是状态目录：设了 profile 就在 `$env:DSH_PROFILE_DIR` 下（桌面端通常是 `~/.dsh/profiles/desktop`），否则是 `$env:DSH_HOME`，都没有时才是 `~/.dsh`。测试或诊断可以用 `DSH_COMPOSER_QUILL_STATE_DIR` 把它整个搬走。

### 2.1 日常调试：让桌面端直接吃本地目录

发版 → 安装 → 重启 的循环太慢。把桌面端那条依赖换成 `link:`，改完代码只要重启：

```powershell
& $dsh plugin --profile desktop add "C:\…\dsh-composer-quill"
# 依赖会变成 link:C:/…/dsh-composer-quill，node_modules 里是指向仓库的链接
```

之后：改代码 → `npm test`（或 `node test/smoke-test.mjs`）→ **`Ctrl+R`**。不用 `npm publish`，也不用重装。

两条纪律，都是踩过的坑：

- **切回 npm 版本前先移除插件**（`dsh plugin --profile desktop remove dsh-composer-quill`，且 DSH 已关闭）。直接 `add` 一个新版本号会让 pnpm 替换那个链接；上一次替换从链接穿进仓库，删掉了 `.git` 的 HEAD、config、index。切之前先确认 `git status` 干净、有远端或 bundle 备份。
- **不要手工 `New-Item -ItemType Junction` 造链接**。用 `dsh plugin add <目录>` 让 pnpm 自己建，它知道怎么安全地拆除。

`build` 字段这时反映的是工作区里 `client.js` 的 `BUILD` 常量——改版本号就能立刻确认加载的是不是新代码。

## 3. 三层测试

三个入口都在 `package.json` 里，不用记路径：

```bash
npm test                          # 单测
npm test -- --filter=cache        # 只跑名字匹配的用例
npm test -- --list                # 列出全部用例名（分组打印）
npm run test:ui                   # 浏览器模拟器
npm run test:all                  # 两个都跑
npm run test:log -- 1             # 汇总最近 1 小时的诊断日志
```

### 3.1 单测（`npm test`）

不依赖 DSH，直接用假的 `ctx` / 假 `res` 驱动真实代码。156 条用例分二十组（`npm test -- --list` 是权威清单，这里只列新增/关键的）：

- **host: pure helpers** — 解析器、`transcriptOf`、`sessionDigest`、语言闸、输入清洗、缓存开关
- **host: compose prompt / one question for both transports** — `composePlan()` 的判定；同一个草稿走 SSE 与走 JSON 时系统提示词、用户提示词、`maxTokens`、`reasoningEffort` 必须逐字相同；JSON 重试并入正在跑的流
- **host: routes and streaming** — 鉴权矩阵、SSE 帧时序、缓存命中、单飞、日志轮转、状态目录规则
- **client: factory, slots, requests** — 工厂与两个 slot、`followRemainder`、建议持久化、回合计数
- **client: audit findings** — 采纳反馈重排、切会话复用、abort 监听器泄漏等审计结论

每行结尾带耗时，失败会在最后汇总点名；`ALL CHECKS PASSED` 是唯一通过标志。

第一条用例会核对 `client.js` 是否与 `client/` 的拼接结果逐字节相同——手改产物或忘记 `npm run build:client` 都会在这里变红。

单测默认把状态文件钉在一个临时目录（`DSH_COMPOSER_QUILL_STATE_DIR`），不会写进你真实的 profile。

### 3.2 模拟器（`npm run test:ui`）

`dev/harness/` 在浏览器里模拟 DSH 的 composer（Lexical 风格的 `<p><span>` 结构 + 假 fetch）。改 `src.js` 后必须重建：

```bash
node dev/harness/build.mjs        # esbuild JS API，产出 dev/harness/bundle.js
```

75 条断言（S1–S63）覆盖：逐字输入、快速连打、Esc 抑制、失败重试、长草稿、切会话、超短草稿、空行锚点、历史补全、整条采纳、清空重弹、行常驻、覆盖区间零调用、流式增长、采纳反馈重排、切回会话复用，以及几条按真实使用节奏写的回归：

- **S23 快速连打期间的取消上限** — 打字速度超过模型首字节时，取消次数不得超过「时长 ÷ 重触发间隔 + 2」
- **S24 停手后灰字稳定** — 停手后必须出灰字，且 2.4 秒内既不消失也不再发请求
- **S25 模型比重触发还慢** — 取消仍然有界，且停手后最终一定能得到建议
- **S26 长灰字不溢出输入框** — 长尾巴会换行。建议层嵌在输入框内，可绘制范围取最近的会裁切祖先（滚动视口，或圆角卡片），不是编辑器本身：编辑器比可见卡片高，用它的底边等于没裁
- **S27 对话框打开时灰字不穿透** — 建议层嵌在输入框内部后，宿主的层叠顺序自然把它压在对话框下面；`[role=dialog]` 检测仍保留作兜底（灰字落在 body 上的旧路径）
- **S28 换行后回到行首** — 灰字从光标处开始，换行后必须回到内容左缘（整宽块 + 首行浮动占位实现），否则每行都挤在光标那一列
- **S50 忽略两次后不再画改写** — 连续忽略两条建议后只保留尾巴补全，整段改写暂停；采纳一次即恢复。轮询 `suppress()` 等 `on` 变真再打第三次，否则那条按旧计数发起的请求回来仍会画
- **S51 等待期只留草稿继续的那部分** — 打字把灰字的头一个字吃进草稿后，等待期画出的必须是余下部分；**S51b** 覆盖「旧答案接不上新草稿」的情形：等待期一个字都不许画
- **S51c 采纳插入的就是屏幕上那截** — DOM 比宿主状态新一帧时按 Tab，插入内容必须等于灰字里已经出现过的那截
- **S51d 工具条文案与灰字同一截** — 在帧边界读（`typeAheadWatched`），工具条「：」后的尾巴必须逐字等于灰字
- **S53 切会话掐掉在飞的补全请求** — 首字 2.5 秒的补写请求在飞时切会话：切换前后的 `aborts()` 差值必须 ≥1（不能只靠打字阶段本来就有的取消），且切后不得再为旧草稿发请求。这条钉的是 issue #7 的结果，不是某一行 `cancel()`
- **S54/S54b 宿主不知道编辑器改了字时按 Tab** — 用建议本身对齐，而不是用渲染期的尾巴对齐；**S54b** 走的是「只改 DOM、不发 input」的静默改法

假模型可以调慢，这是 S23–S25 的依据：

```js
h("setComposeTiming({ first: 3200, step: 300 })") // 首字节 3.2 秒的真实调用
h("aborts()")                                    // 被取消的请求数
h("resetMetrics()")                              // 清零计数
```

改动 `src.js` **或 `client.js`** 之后都要重建 bundle，否则跑的还是旧代码——这条踩过一次，现象是"修了却仍然失败"。

### 3.3 真机脚本（`python dev/verify/verify_*.py <url>`）

每个脚本自带断言与截图，按需跑：

| 脚本 | 验证点 |
| --- | --- |
| `verify_align[_cases].py` | 灰字与正文行盒的像素对齐 |
| `verify_emptyline.py` | 空行（`<br>` 之后）灰字锚点 |
| `verify_clear_rearm.py` | 采纳后清空是否重新弹出 |
| `verify_fresh_start.py` | 刚启动时行是否可用、会不会卡「补写中」 |
| `verify_reuse_reload.py` | 刷新后是否 0 请求复用已存建议 |
| `verify_no_storm.py` / `verify_covered.py` | 请求次数（无取消风暴、覆盖区间零调用） |
| `verify_settings_ui.py` | 设置卡片渲染与持久化 |
| `verify_stream_repaint.py` | 流式期间灰字是否增长（模型吐得快时不稳定，以 S19 为准） |

### 场景抖动怎么处理

场景套件依赖时序，机器负载高时会偶发 1–2 条超时。用带重试的入口跑：

```bash
npm run test:ui:retry          # 最多 2 次，抖动记入 dev/flake-ledger.json
python dev/verify/verify_with_retry.py --attempts 3 --threshold 2
```

判定规则：

- **任何一次全绿** → 退出码 0，途中的红灯记为「抖动」
- **每次都红** → 退出码 1，末尾打印最后一次的输出尾部
- 某场景**累计**抖动 ≥ 阈值（默认 3）→ 单独列出「已经不是偶发」，并指向记账文件

记账文件 `dev/flake-ledger.json` 是本地状态（已 gitignore），只记次数，不记时间戳——它要回答的问题是「这条到底抖了几次」，不是「什么时候抖的」。

严格模式仍然是 `npm run test:ui`（跑一次，红就是红）；重试入口用于日常开发，避免每次都被同一条时序问题打断。

### 设置页的挂载

设置卡片注册在 `settings.section`（不是 `settings.general.item`）：它是设置导航里独立的一节，
自带 `id` / `order` / `label`。夹具里 `showSettings()` 按这个名字找组件。

### 上下文预算与回滚

默认按「紧」预算跑：transcript 1800 字符、单条消息 800 字符、最多 6 行。

要回到旧行为（9000 / 2200 / 14），启动 DSH 前设一个环境变量：

```bash
DSH_QUILL_CONTEXT=full
```

这是这次省 token 改动的回滚开关——不需要改代码、不需要重新发布。代价只是长对话里能带的上文变少。

### 二分场景套件

只跑到第 N 条就停，用来定位「从某条开始才失败」的问题：

```bash
DSH_SCENARIO_LIMIT=14 python dev/verify/verify_daily.py
```

它会打印「已跑 14 条」，退出码 0。二分比读代码便宜得多。

## 4. 调试

### 4.1 日志

`<profile>/composer-quill.log`（超过 2 MB 轮转为 `.log.1`）。宿主事件：

| 事件 | 含义 |
| --- | --- |
| `request` | 客户端要什么（`pinnedModel`/`pinnedReasoning`，跟随会话时为空；`attachments` 与 `attachmentKinds` 是输入框里带的附件数与种类，`attachmentTotal` 是输入框里一共有几个（超过上限时比 `attachments` 大），只有描述没有字节） |
| `route-effective` | 实际跑的模型与强度，在解析处记录 |
| `stream` / `stream-end` | 一条流式响应的开始 / 唯一终态行（`status`: `painted` `silent` `cached` `unchanged` `cancelled` `error`，含 `path` `model` `effort` `paintedChars` `chars` `reasoning` `finish` `delivered` `attachments` `attachmentKinds`（还有 `attachmentsSeen`/`attachmentsUnseen`：发出几条、真正解析出几条）与总 `ms`）。短草稿走 `path: "short"`，它不发 delta，只发一帧 `final`——`delivered` 就是给这条路径用的 |
| `first-delta` | 首字到达，拆成 `queueMs`（请求进来到调模型）与 `modelMs`（调模型到首字）；`late: true` 表示这条请求早已收尾，首字属于仍在跑的模型调用，不能计入等待 |
| `result` | 非流式（下一句）结果 |
| `cancelled` | 请求被取消（客户端断开或新请求顶替） |
| `compose-abandoned` | 最后一个等待者走了，模型调用被停掉，不再为一个没人接收的答案计费 |
| `error` / `compose-stream-error` | 失败（含状态码与被遮蔽前的消息） |
| `history` / `history-error` | 历史拉取 |
| `not-live`（客户端上报） | 会话未在宿主加载 → 退避中 |
| `suppressed`（客户端上报） | 连续忽略后压住了一条整段改写 |
| `cache-restored` | 启动时从磁盘恢复了多少条缓存 |
| `cache-...` / `client-row` | 缓存与客户端包探测 |

**附件探针（要花真钱，不进 CI）**：`dev/probes/probe-attachments-live.mjs` 走插件自己的 `composeStream`，把真实图片与文件存进真实附件库，再打到真实模型上。它证明的是单测证明不了的那半步——图片块真的到了模型眼前：同一句草稿「这个截图里的数字是」，带图时补出 `7342`，不带图时只能写出「具体数值」；文件里的仓编号 `KX-7731` 只在带着文件时出现，不带文件时模型会编一个 `C-2024-0871`；读不出正文的二进制文件，模型会回「只能看到附件名称和大小」而不是编内容。跑法：`node dev/probes/probe-attachments-live.mjs`（需要 `~/.dsh/.credentials.yaml` 里的 `sk-…`，DSH 包不在默认位置时用 `DSH_PACKAGES` 指路）。两条正向臂各带一次重试：单条建议偶发地「hedge」过一次（四跑里见过一次文件臂失败），但反向臂只打一发——不带附件时那个值必须一直不出现，重试反而是放水。

**探针会话单独成文**：`sessionId` 以 `probe-` 开头的请求，事件写进同目录的 `composer-quill-probe.log`，并且不进用量账本（改为记一条 `probe-usage`）。原因很实在——一次压测在真实日志里留下 1697 条事件，把一整天真实输入的分布整个盖掉，事后又分不出谁是谁。所以自己写探针脚本时，把会话名起成 `probe-<用途>`，账本和日志两处就自动隔离；`dev/probes/` 里三个跑宿主代码的脚本还额外把 `DSH_COMPOSER_QUILL_STATE_DIR` 指向临时目录，连文件都不落。

浏览器事件（经 `/beacon` 落到同一文件）：`dock`（挂载时的 props 概况）、`dock-state`（每次判定变化，含 `phase/kind/items/nextActive/pendingCompose/pendingNext/draftEmpty/running`）、`paint`、`hydrated`、`reused`/`dedupe`/`covered`、`not-live`、`render-error`。

### 4.2 先在文档里找答案，再改代码

遇到「这不应该发生」的时刻，第一轮不要写代码，先查那个原语本身：浏览器 API 与框架生命周期的语义、协议层的规定、别人踩过的同一类坑。查到的结论写进提交信息或 CHANGELOG 时带上出处，让「我查过」和「我猜的」在仓库里能分辨。

本仓库交过学费的三次：

- **`fetch(..., { keepalive: true })` 在文档被替换时整批丢弃**——从「模块报了到、0.08 秒后 `/history` 就到了、但 `paint` 一条都没有」反推了两轮、75 条样本才敢下结论；这是规范里写明的行为，搜一次就到。
- **在 `useEffect` 回调里调 `useRef`**——触发 `Invalid hook call`，面板被错误边界接走，场景 74→23；Rules of Hooks 第一条就是它。
- **迟到的帧属于谁**——「请求身份」在请求层是老问题（latest-request-wins、请求 id 绑快照），在第四个同类 bug 之后才收敛成 `RequestId`；先看别人怎么解，第一个 bug 时就该收敛。

先查并不等于查完再动手：能测量就直接测量（本仓库大量结论来自日志与探针），但「语义层面的为什么」优先找文档，而不是靠改一版跑一遍去试。

### 4.3 常见症状 → 排查路径

| 症状 | 先看什么 |
| --- | --- |
| 行里只有快捷键提示 | `dock-state`：`items` 是否为 0、`running` 是否为 true、`draftEmpty` 是否符合预期 |
| 一直「补写中…」 | `phase` 是否卡在 `loading`；有没有 `error`；`pendingNext` 是否在 manual 模式 |
| 有请求但没结果 | `request` 之后有没有 `first-delta`；`error` 的状态码（409 = 会话没加载） |
| 灰字不增长 | 确认 `paint` 事件是否随 delta 出现（painter 是否订阅了 store） |
| 采纳后又请求一次 | 看 `dedupe`/`reuse` 是否命中；`lastRequested` 认领是否被提前清空 |
| 重启后建议没了 | `cache-restored` 的条目数、`composer-quill-cache.json` 是否可写 |
| `/history` 恒为 0、`next` 报 `empty-thread` | 看日志的 `events` 字段：等于 3（只有引导事件）= 宿主没持有该会话的 transcript，插件无能为力（见 ARCHITECTURE 已知限制 1） |

### 4.4 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_COMPOSER_QUILL_NO_CACHE=1` | 关闭宿主磁盘缓存（读与写都跳过）。单测默认开启，避免污染真实缓存 |
| `DSH_COMPOSER_QUILL_STATE_DIR` | 把日志/账本/缓存钉到一个目录（优先级最高）。单测默认指向临时目录 |
| `DSH_QUILL_CONTEXT=full` | 回到旧的大上下文预算（见 3.4） |

## 5. 发布清单

1. 改 `client/prelude.js` 的 `BUILD` 与 `package.json` 的 `version`（必须同步，`build` 是排障时的版本凭证），再 `npm run build:client`。
2. `npm test` 全绿（或 `node test/smoke-test.mjs`）。
3. `npm run test:ui` 全绿（改过 `client/` 先 `npm run build:client`；改过 `dev/harness/src.js` 会由脚本重建 bundle）。
4. 相关真机脚本跑一遍，确认没有回归。
5. 更新 `docs/` 与 `README.md` 的变更表。
6. 提醒使用者**彻底退出 DSH 再打开**。

## 6. 容易踩的坑

1. **按行号切代码会连声明一起删掉**——本仓库踩过一次（`retriedFor` 被误删导致 `ReferenceError`）。改完必须 `node --check` 并跑单测。
2. **CRLF**：脚本里做多行替换前先 `.replace(/\r\n/g, '\n')`，否则模式匹配不到。
3. **测试污染真实缓存**：宿主缓存会落盘，单测必须带 `DSH_COMPOSER_QUILL_NO_CACHE=1`。
4. **渲染期副作用**：任何 `fetch`/上报都要放 effect，否则并发渲染会重复发送。
5. **不要把共享工作绑在单个请求的 AbortSignal 上**：浏览器每次按键都会 abort 上一个流。
6. **`final` 是权威值**：客户端显示必须以它为准，不能用增量拼出来的文本。

## 可访问性

三条行为由测试守着：

- 播报只在结果落定时发生一次（500ms 尾随），不随流式增量逐帧刷新——`describeAnnouncement()` 有单测，S34 用 MutationObserver 数实际变化次数
- 设置卡片的四个控件都带 `aria-label`；S33 通过 `showSettings()` 挂载设置槽后逐个检查
- 建议显示时 `Tab` 被采纳占用；`Esc` 关掉后 `Tab` 交还宿主——S35 用**可信**键（`page.keyboard`）验证焦点真的移走，合成事件不触发焦点遍历

测试能证明的属性有限：读屏器实际怎么念、念得对不对，只能人耳确认。
