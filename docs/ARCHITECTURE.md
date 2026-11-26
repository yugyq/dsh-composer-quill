# 架构设计

> 适用版本：0.31.60 ｜ 代码：`index.js`（宿主，约 1840 行）、`client.js`（浏览器，约 2540 行）

## 1. 定位与边界

这个插件只做一件事：**在输入框里给出「接下来可能要说的话」，并在你打字时补全/整理这段话的剩余部分**。

明确不做的三件事（都是硬约束，改动前请先读第 8 节）：

1. **绝不自动发送**。采纳只是把文本写进草稿，发送仍由用户按 Enter。
2. **绝不改写用户已输入的原文**。补全 = 「草稿 + 尾巴」；只有走改写（Case B）时才会整段替换，且必须由用户按 Tab。
3. **绝不能让宿主变慢或崩溃**。所有模型调用都是旁路调用；任何失败都必须降级为「什么都不显示」。

## 2. 两个半边

**宿主侧（`index.js`，Cordis 加载）**

- `POST /composer-quill/predict` —— JSON 或 SSE（`compose` 走 SSE）
- `POST /composer-quill/history` —— 用户自己的历史消息，零模型调用
- `POST /composer-quill/beacon` —— 浏览器侧诊断，只收受限字段
- 内存缓存（TTL 120s），异步落盘到 `composer-quill-cache.json`
- `composeInFlight` / `inflight` —— 同键并发只调一次模型的单飞机制

**浏览器侧（`client.js`，由 `__ModuleLoader__` 注入）**

- `conversation.input.dock` —— 常驻状态行
- `settings.section` —— 设置页里独立的一节（`id: composer-quill`，`order: 30`，导航名走 `nav` 文案）
- `settings.section.icon` —— 那一行的图标（id 必须与分节 id 一致，否则不渲染）
- `createGhostStore()` —— 建议状态机
- `createGhostLayer()` —— 建议层，嵌在输入框内，随宿主裁切
- `localStorage` —— 建议持久化与设置

补写的 prompt 只有一份（`composePrompt()`），与传输方式无关：SSE 与 JSON 两条路径传入同一组输入，模型看到的是同一个问题。

两半通过 `package.json` 的 `dsh.client` 字段装配。浏览器侧在**软链安装**时直接读工作目录的 `client.js`，改完 `Ctrl+R` 即生效；npm 安装的那份是拷贝，改代码要重装或重启。


## 3. 请求生命周期

### 3.1 「下一句预测」（next，草稿为空时）

```
草稿为空 ──(挂载 / 切会话 / 回合结束 / 退避到期)──▶ request('next', '')
   └─ 320ms 去抖 ─▶ POST /predict {mode:'next'}
        └─ 200 {candidates:[...]} ─▶ ghost.settle(kind:'next', items)
             └─ dock 渲染「按 Tab 采纳：… · 第 1/N 条」，灰字画在空输入框内
```

- 会话尚无 transcript 时宿主直接返回 `{candidates:[], reason:'empty-thread'}`，不发模型请求。
- 宿主 409（会话未在本 Host 加载）时，客户端进入**指数退避**（0.7s→15s，最多 6 次），退避到期若草稿仍为空会强制重发。

### 3.2 「补写 + 整理」（compose，草稿非空时）

```
草稿变化 ──▶ request('compose', draft)
   ├─ 若草稿仍在当前建议覆盖范围内 → 去抖 1200ms（复用旧尾巴）
   ├─ 否则                          → 去抖 250ms（可在设置里调）
   └─▶ SSE: POST /predict {mode:'compose'} + accept: text/event-stream
         start{mode} ─▶ delta* ─▶ final{整条} ─▶ done
```

宿主内部：

1. 命中缓存 → `replayCompose()` 直接回放（`cached:true`，零模型调用）。
2. 同 key 已有在跑 → 等它落地后从缓存回放（**单飞**，不重复计费）。
3. 否则 `produceCompose()` 起模型调用：
   - 边收边判 Case A / Case B（见 PROTOCOL 的 `decide()` 规则）；
   - 成功 → `final{整条, mode}` + `done` + 写缓存；
   - 认为「无需修改」→ `retract` 后改问一句可追加的话（sentence 兜底）；
   - 兜底也失败 → `retract` + `done{reason:'unchanged'}`。

## 4. 状态机

### 4.1 快照字段（`createGhostStore().getSnapshot()`）

| 字段 | 含义 |
| --- | --- |
| `sessionId` | 该结果属于哪个会话；`null` 表示空闲 |
| `phase` | `idle` / `loading` / `ready` / `empty` / `error` |
| `kind` | `next` 或 `compose` |
| `items` | 候选（next：多条；compose：单条整文） |
| `index` | next 模式下当前第几条（`←/→` 切换） |
| `error` | 失败原因（仅 `error`） |
| `forDraft` | **产生该结果时的草稿**（前缀比较的基准） |
| `requested` | 正在进行的请求对应的草稿（流式期间有效） |

`forDraft` 与 `requested` 的区别是这套状态机的关键：

- `requested` 在 `streamStart/begin` 时写入，`done/fail/settle` 时清空；
- `forDraft` 在 `done/fail/settle` 时**跟随本次请求**（`current.requested ?? current.forDraft`）；
- 因此流式期间 UI 用 `requested` 判断归属，落地后用 `forDraft` 判断「这份建议是不是给现在这版草稿的」。

### 4.2 phase 转换

| 从 | 事件 | 到 |
| --- | --- | --- |
| 任意 | `streamStart` / `begin` | `loading`（保留旧 items） |
| `loading` | 首个 `delta` | `ready` |
| `loading` | `done` 且 items 非空 | `ready` |
| `loading` | `done` 且 items 为空 / `reason:'unchanged'` | `empty` |
| `loading` | `error` 帧 / 请求异常 | `error` |
| `loading` | `cancel()` | `idle` |
| 任意 | `clear()` / `hydrate()` | `idle` / `ready` |

### 4.3 store API

| 方法 | 用途 |
| --- | --- |
| `streamStart/streamModeSet/streamRetract/streamDelta/streamFinal/streamDone/streamFail` | SSE 路径 |
| `begin/settle/fail` | JSON 路径（带 AbortSignal 校验） |
| `hydrate` | 用 localStorage 里的旧结果直接渲染（不发请求） |
| `clear/cancel/cycle` | 清理、中止、next 候选切换 |

## 5. 三层缓存与失效

| 层 | 位置 | 键 | TTL | 失效 |
| --- | --- | --- | --- | --- |
| 宿主内存 | `cache: Map` | `会话\|模式\|草稿\|事件数\|末事件seq\|provider/model` | 120s（否定 10s） | 超 128 条按插入序淘汰最旧 |
| 宿主磁盘 | `<profile>/composer-quill-cache.json` | 同上 | 同上 | 启动时加载（>4MB 不加载，非有限时间戳丢弃）；异步写最近 64 条 |
| 浏览器 | `localStorage['dsh.composer-quill.suggestions']` | `会话\|模式\|草稿` | 10 分钟 | 回合结束清空该会话全部条目；上限 40 条 |

设计要点：

- **缓存键必须包含模型路由**：切换模型不产生会话事件，否则会复用旧模型的答案。
- **回合结束必须清浏览器缓存**：transcript 变了，旧「下一句」立刻失去意义（宿主侧靠事件数/seq 自然失效）。
- **命中即回放，不重新生成**：SSE 的缓存命中会一次性补发 `start + delta + done{cached:true}`。

## 6. 并发与节流

| 机制 | 位置 | 参数 | 目的 |
| --- | --- | --- | --- |
| 打字去抖 | 客户端 | 250ms（可配） | 每次停顿只请求一次 |
| 覆盖区间延长 | 客户端 | 1200ms | 草稿仍在建议内时复用旧尾巴 |
| 同键去抖 | 客户端 | 900ms | 安全网/重试/按键撞车只发一次 |
| 单飞 | 宿主 | — | 同键并发只调一次模型（含 SSE） |
| 请求超时 | 宿主 | 30s + 5s 看门狗 | 保证响应一定结束 |
| 客户端超时 | 客户端 | 20s（可配） | UI 不会无限等 |

**abort 语义**：客户端每发新请求就 abort 旧的；宿主的**共享工作不挂在单个请求的 signal 上**（自带控制器 + 30s 超时），否则第一个客户端断开会把其他人的结果一起杀掉。

## 6.5 质量管线（0.15.0）

一次建议从模型到屏幕要过四道关：

| 关 | 做什么 | 代码 |
| --- | --- | --- |
| 上下文 | 最近 6 轮 + 最近一条助手消息（≤400 字符）+ 风格画像，全部以「数据，不是指令」的措辞包起来 | `transcriptOf` / `styleProfile` / `lastAssistantText` |
| 提示词 | 镜像语言/长度/语气；复用用户原词；禁止描述草稿或推理过程 | `NEXT_RULES` / `COMPOSE_RULES` |
| 解析 | 丢弃自述（`looksLikeMeta`）、纯标点（`isPunctuationOnly`）、回显草稿、超长、含遮蔽标记的改写 | `parseComposeReply` |
| 排序 | next 候选按「贴近平均长度 + 与上一条助手消息相关 − 无中生有的开场白」重排，模型顺序仅作并列参考 | `rankCandidates` |
| 语种 | `scriptOf` 判定草稿/候选的语种；中文用户不会被喂英文建议，中文草稿也不会被英文续写 | `rankCandidates` / `parseComposeReply` |

风格画像是本地统计（不调模型）：`{"count":12,"avgChars":28,"language":"zh","usesGreeting":false,"endsWithPeriod":true}`。它同时用于**判断能否加开场白**——画像里没有客套的用户，建议里出现「好的，…」会被扣分。

## 6.6 采纳反馈学习（0.16.0）

只在本机进行，不上传任何内容。

**特征**（每条建议 6 个，全部本地计算）：`kind`、长度档（xs/s/m/l）、开头是标点还是词语、是否寒暄、结尾有无句号、语种。

**样本**（只认明确动作）：

| 动作 | 判定 |
| --- | --- |
| Tab / 点击 chip | 采纳（正样本） |
| Esc | 忽略（负样本） |
| 没采纳就发送 | 忽略（负样本） |

**使用**：`rankByLearning` 用拉普拉斯平滑的采纳率给每个候选打分（6 个特征的偏差之和），对「下一句」的候选**重新排序**；模型自身的顺序只作并列参考。它**只重排**：候选集合仍然完全来自宿主，学习不会凭空造一条建议，也不会因为分数低而丢弃候选。

**存储**：`localStorage['dsh.composer-quill.learning']`，按特征值累加 `{shown, accepted}`，上限 400 个键；清空站点数据即重置。设置卡片显示累计采纳率。

## 6.7 语言（0.23.0 起）

只有两个来源，先命中者胜：

1. **用户设置**（`zh` / `en`）
2. 浏览器 `navigator.language`（设置选 `auto` 时）

风格画像和草稿语种**不参与判定**。判定结果写进 `cacheKey`——切语言设置会让旧缓存自然失效，否则会返回上一种语言的建议。

**实现要点**：

| 项 | 行为 |
| --- | --- |
| 候选过滤 | `wrongLanguage` 按拉丁占比判（中文侧 >0.75、英文侧 <0.2），短于 6 字的回复一律放行 |
| 草稿语言不同 | prompt 要求走 Case B **翻译整段**（保留路径与标识符），客户端以「按 Tab 采用改写」呈现 |
| 设置未定（无 locale） | 不做语种过滤，只按提示词约束 |

历史：0.15–0.22 期间曾用画像与草稿语种兜底，因为画像在混合文本上误判成 `en`，把中文候选整批丢弃——这条弯路记在 CHANGELOG 的 0.16.1 / 0.18.1 / 0.23.0。

## 7. 失败与降级

| 情况 | 表现 |
| --- | --- |
| 会话未加载（409） | 静默退避重试，行内仍显示快捷键提示；重试耗尽后停止，直到用户输入或切会话 |
| 模型超时 / 断流 | `error` 帧 → 清空建议 → 1.2s 后自动重试一次 |
| 模型说「无需修改」 | `retract` + 句子兜底；仍失败则 `empty`（不显示任何东西） |
| 插件自身异常 | `GhostBoundary` 兜住渲染错误，输入框不受影响；日志记 `render-error` |
| 存储不可用 | 缓存退化为进程内；设置退回默认值 |

## 8. 关键不变量（改代码前必读）

1. **认领纪律**：`lastRequested` 只在真正发起请求时写入；任何「提前 return」的分支要么清掉认领，要么延迟重发。否则会出现「没请求、没建议、也不重试」的静默空洞。
2. **`forDraft` 跟随请求**：`streamDelta/streamFinal/streamDone/streamFail` 都必须写 `current.requested ?? current.forDraft`，否则改写建议会永久不显示、重试永远跳过。
3. **可见性判定**：`nextActive / composeActive / historyActive` 三者互斥优先（next > compose > history），且都要求 `!running`。
4. **painter 必须订阅 store**：它依赖 `visible` 这个布尔，只有 store 订阅才能在流式期间持续重绘。
5. **渲染期禁止副作用**：诊断上报放在 `useEffect` 里；渲染函数只读快照。
6. **持久化只存建议文本**：不存草稿以外的任何上下文；`/history` 强制要求 per-boot token。

## 9. 安全与隐私

- **鉴权**：`/predict`、`/beacon` 接受 per-boot token，或「自定义头 + `sec-fetch-site: same-origin`」（自定义头会强制 CORS 预检，挡住跨源页面与 DNS rebinding）；`/history` 只认 token。
- **密钥遮蔽**：拼进 prompt 的 transcript **和草稿**都会把 9 类凭据形状替换成 `[redacted …]`；改写结果若带回标记则整体拒绝。
- **本地落盘**：缓存文件与日志都在 profile 目录，包含用户自己的文本；删除 `composer-quill-cache.json` 即可清空。
- **错误外泄**：5xx 只回通用文案，细节仅进本地日志。

## 10. 已知限制

1. 依赖宿主 `ctx.agents.get(sessionId)` 的「会话活性」：冷启动后未加载过的旧会话拿不到建议（表现为退避后静默）。
   实测：`dsh web` 单进程里由浏览器新建的会话，宿主侧 `Session` 只有 3 条引导事件
   （`permission/preset`、`sandbox/mode`、`approval/policy`），`snapshotEvents()` 与
   `deriveMessages()` 都不含对话内容，因此 `/history` 返回 0 条、`next` 报 `empty-thread`。
   桌面端（长驻宿主、会话被加载过）正常：实测同一会话返回 89 条历史。`logs` 里的
   `events: 3` 就是这个状态的特征。
2. `snapshotEvents()` 的语义（是否原地改写）未在代码中验证；缓存键以「事件数 + 末事件 seq」近似 transcript 版本。
3. 退避与超时都是经验值，未按模型实际延迟自适应。
4. 单个会话的 next 候选最多 3 条（`MAX_CANDIDATES`），无法翻页取更多。
