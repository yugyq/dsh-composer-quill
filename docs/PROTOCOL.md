# 接口与流式协议

> 适用版本：0.33.5 ｜ 五条路由、两种响应形态（JSON / SSE）

## 1. 鉴权

每个路由都要求下列两种之一：

| 方式 | 条件 | 适用范围 |
| --- | --- | --- |
| `x-composer-quill-token: <token>` | 等于本次启动生成的 token（注入到页面全局 `__DSH_COMPOSER_QUILL_TOKEN__`） | 全部路由 |
| 同源证明 | `x-composer-quill-client: 1` **且** `sec-fetch-site: same-origin` **且** `content-type: application/json` **且** 非导航请求 | `/predict`、`/beacon`（**不含** `/history`） |

`/history` 是纯用户数据，只接受 token。自定义请求头的意义是：跨源请求会先触发 CORS 预检，而本服务从不批准预检，于是别的页面（含 DNS rebinding 场景）拿不到数据。

失败返回 `401`：

```json
{ "error": { "code": "unauthorized", "message": "route token is missing or stale" } }
```

## 2. `POST /composer-quill/predict`

### 2.1 请求

```json
{
  "sessionId": "session-…",
  "mode": "next" | "compose",
  "draft": "帮我看看",
  "attachments": [{ "kind": "image", "name": "shot.png", "bytes": 2048, "receiptId": "…", "status": "ready" }]
}
```

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 必填，DSH 会话 id |
| `mode` | `compose` 且 `draft` 非空 → 补写；否则按 `next` 处理（兼容旧客户端传入 `normalize`/`continuation`） |
| `draft` | 草稿，服务端截断到 6000 字符；`compose` 且为空返回 400 |
| `attachmentTotal` | 可选，整数。输入框里一共有几个附件——超过 8 条时，多出来的不描述，但这个数字进缓存键：删掉第 9 张图和删掉不存在的图不是同一个问题 |
| `attachments` | 可选，最多 8 条（第 9 条起不描述，但用 `attachmentTotal` 报出总数，好让模型知道自己少看了几个）。只有描述，没有字节：`kind`（`image`/`file`）、`name`（≤120 字符）、`bytes`、`receiptId`（浏览器上传后宿主给出的回执，≤200 字符）、`status`（`ready`/`uploading`/`error`/`missing`，说明回执为什么没有——上传中被等一等，被拒则要让用户重新添加）。宿主用回执换成 `ImageBlock` 或文件摘录；回执无效时模型会被告知「看不到」。`attachments` 参与缓存键：同一句话配不同图片是两个不同的问题 |

请求体上限 48 KB；超时 30 s。附件本身不经过这条路由——它由浏览器上传、宿主保管。

### 2.2 JSON 响应（`mode=next`，或未声明 `accept: text/event-stream`）

```json
{ "kind": "next", "candidates": ["…", "…"], "model": { "provider": "…", "model": "…" } }
```

可能出现的状态：

| 状态 | 结果 |
| --- | --- |
| 200 | 正常候选（最多 3 条，每条 ≤140 字符） |
| 200 + `{"candidates": [], "reason": "empty-thread"}` | 会话还没有任何对话，不发模型请求 |
| 200 + `{"candidates": [], "reason": "skipped"}` | 模型没给出可用候选 |

`compose` 走 JSON 时返回 `{kind:'compose', text, mode}`，`text` 是**整条建议**；`fallback:'sentence'` 表示这是句子兜底的结果。

### 2.3 SSE 响应（`mode=compose` 且 `accept: text/event-stream`）

```
event: start
data: {"mode":"append"}

event: delta
data: {"text":"整理成表格，"}

event: final
data: {"text":"帮我把这段日志整理成表格，并标出报错行。","mode":"append"}

event: done
data: {"mode":"append"}
```

#### 帧表

| 帧 | 载荷 | 语义 |
| --- | --- | --- |
| `start` | `{mode:'append'\|'full'}` | 后续 `delta` 是「追加到草稿」还是「整段替换」；可在 `final` 前**再次出现**以纠正模式 |
| `delta` | `{text}` | 增量文本；客户端可逐帧渲染 |
| `retract` | `{mode}` | 之前流出的增量作废（切到句子兜底、或兜底失败时） |
| `final` | `{text, mode}` | **权威整条建议**；覆盖此前所有增量 |
| `done` | `{mode}` / `{fallback:'sentence'}` / `{reason:'unchanged'}` / `{cached:true}` | 结束标志；`unchanged` 表示「这段草稿无需修改」 |
| `error` | `{message}` | 失败/取消；客户端应清空建议 |

#### 四种典型时序

**A. 正常追加**

```
start{append} → delta{…} ×N → final{整条, append} → done{mode:'append'}
```

**B. 整段改写（Case B）**

```
start{full} → delta{改写文本} ×N → final{整条, full} → done{mode:'full'}
```

> 若模型先在开头输出换行再输出 `REWRITE:`，`decide()` 曾把模式判成 append；现在会在 `final` 前补发 `start{mode:'full'}` 纠正。

**C. 句子兜底**

```
start{append} → delta{…} … → retract{append} → delta{一句可追加的话} → final{草稿+句子} → done{fallback:'sentence'}
```

**D. 命中缓存 / 无需修改**

```
start{…} → delta{…} → done{cached:true}              // 缓存命中，一次补齐
start{full} → done{reason:'unchanged', cached:true}  // 缓存里记着「无需修改」
```

### 2.4 状态码

| 码 | 含义 | 客户端处理 |
| --- | --- | --- |
| 200 | 成功（含 SSE 流） | — |
| 400 | 请求体非法 / `draft` 为空 | 视为失败，重试一次 |
| 401 | 鉴权失败 | 记 `not-live` 之外的失败；不重试 |
| 405 | 方法不是 POST | — |
| 409 | 会话未在本 Host 加载 / 无可用模型路由 | **退避重试**（1 s / 4 s / 12 s，最多 3 次） |
| 413 | body 超限 | 失败 |
| 499 | 请求被取消（客户端断开） | 忽略 |
| 500 / 504 | 模型失败 / 超时 | 失败 → 1.2 s 后自动重试一次 |

SSE 路径的状态码在 `flushHeaders()` 之前确定：会话不活会在发流之前就返回 409，而不是伪装成 200 + error 帧。

## 3. `POST /composer-quill/history`

```json
{ "sessionId": "session-…" }
```

响应：

```json
{ "items": [{ "text": "帮我把这段日志整理一下", "at": "2026-11-18T05:41:37.534Z" }] }
```

- 只返回 `user/message`，去重（保留最后一次出现的位置与时间），最多 200 条，单条截断到 600 字符。
- 不发模型调用；会话未加载 → 409；读取超时 30 s。
- 客户端进入会话时拉一次，回合结束后再拉一次（新消息可立即被历史补全命中）。

## 4. `POST /composer-quill/beacon`

浏览器侧诊断，字段受限（`event` ≤40 字符、`sessionId` ≤40 字符），仅写本地日志：

```json
{ "event": "dock-state", "sessionId": "session-…", "build": "0.31.19", "detail": "{…}" }
```

成功返回 `{ "ok": true }`；读取超时 30 s，405 时会带 `allow: POST`。

## 5. 客户端 → 宿主 的固定约定

所有调用都带：

```
content-type: application/json
x-composer-quill-client: 1
x-composer-quill-token: <token>     // 页面存在 token 时
```

`compose` 额外带 `accept: text/event-stream`；若宿主返回非 SSE（例如兼容旧版本），客户端按 JSON 解析（`json` 分支）。

## 6. 契约变更规则

1. **新增帧**必须让旧客户端「未知即忽略」，且不得改变已有帧的语义。
2. **`final` 永远是权威值**：客户端可以只用 delta 做预览，但最终显示必须来自 `final`。
3. **`done` 必须发**：客户端在流结束但没收到 `done` 时按失败处理（防止半截建议被当成结果）。
4. 状态码语义不得复用：409 专指「会话未就绪」，不要拿来表示模型错误。

## 5. `GET|POST /composer-quill/models`

给设置页的「模型」下拉用。读的是宿主自己的路由表，不调模型。

```json
{
  "providers": [
    { "id": "deepseek", "name": "DeepSeek", "models": [{ "id": "v4-flash", "name": "V4 Flash" }] }
  ],
  "fetchedAt": "2026-11-25T10:00:00.000Z"
}
```

- 每个 provider 单独 try/catch：一个 provider 的 `listModels` 抛错只让该条为空，不会让整个列表失败
- 结果缓存 60 秒；失败时清空缓存，下次重新读
- 请求体可以带同样的 `model` 字段：`{ "provider": "deepseek", "model": "v4-flash" }`，宿主会优先用它，字段不合法则忽略

