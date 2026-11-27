# 方案：token 消耗面板

> **状态：已实施（0.31.49）。** 账本在 `~/.dsh/composer-quill-usage.json`，金额以人民币显示。

## 0. 事实（已核实）

`ctx.llm.stream(...)` 的流里有一个 `usage` chunk：

```ts
{ type: 'usage', usage: { inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? } }
```

插件的循环（`index.js` 约 1075 行）现在只认 `text-delta`、`block-end`、`finish`，**把 `usage` 跳过了**——所以至今没有任何用量数据。

## 1. 采集

在 chunk 循环里加一条：

```js
} else if (chunk?.type === 'usage') usage = chunk.usage
```

`runModel` 的返回值从 `{ text, route }` 变成 `{ text, route, usage }`。三处调用点（next / compose / 短句兜底）各自把 `usage` 交给累加器。

**失败与中止也要记一次**，但只记 `calls += 1`、用量记 0，并打标 `void: true`——否则面板上的「次数」会低于实际请求数，看起来像漏记。

## 2. 存储

独立文件 `~/.dsh/composer-quill-usage.json`（不并进现有的 cache 文件：一个是可丢弃的缓存，一个是账本）：

```json
{
  "version": 1,
  "lifetime": { "calls": 147, "void": 2, "input": 118000, "output": 7000,
                "cacheRead": 0, "cacheWrite": 0, "reasoning": 0 },
  "byMode": { "compose": { ... }, "next": { ... } },
  "days": { "2026-11-23": { "calls": 12, "input": 9600, "output": 600, ... } }
}
```

规则：

- `lifetime` 与 `byMode` 只增不删；`days` 只留最近 **30 天**，写入时裁掉更早的
- 写入采用 **临时文件 + rename**，避免进程被杀时留下半个 JSON
- 读失败（损坏 / 无权限）时从空账本开始，并记一条 `usage-store-reset` 日志，不静默丢
- 文件里**不出现会话 id、不出现草稿文本**

## 3. 本会话

会话级数字放内存，不进文件：`Map<sessionId, counters>`，切会话时不清（要能看「这个会话花了多少」）。进程重启即归零——这一点在面板上直接写明「本会话（重启后重新计数）」。

## 4. 面板

放在我们自己那个设置分节里，新增一节：

```
消耗
  今天      12 次 · 9.6k 输入 · 0.6k 输出
  本会话     3 次 · 2.4k 输入
  累计      147 次 · 118k 输入 · 7.0k 输出
  缓存读    1.2M（前缀缓存命中，按 provider 返回原样展示）
  未计      2 次（失败或中止，无用量返回）

  [重置累计]
```

- 数字用 `k` / `M` 缩写，超过 4 位才缩；悬停显示精确值（`title`）
- provider 没返回 `usage` 时，该行显示「本次未返回用量」，不显示 0
- 「重置累计」清空 `lifetime` / `byMode` / `days`，重置后立即刷新；不做二次确认（面板是只读展示 + 一个明确按钮，误触代价小）

## 5. 端点

沿用现有路由风格（`/history`、`/beacon`、`/predict`）：

```
GET  /composer-quill/usage   → { lifetime, byMode, today, session, void }
POST /composer-quill/usage   { reset: true } → { ok: true }
```

`preflight()` 复用现有的 token 校验与限流；POST 只接受 `reset`，其它字段忽略。

## 6. 明确不做

- 不上报任何数据到远端
- 不按会话落盘（只留内存）
- 不估算——拿不到 `usage` 就记「未计」，不猜

## 7. 测试

**单测**（纯函数 + 假存储）：

| 断言 | 内容 |
|---|---|
| 累加 | 两次 usage 合并正确；`byMode` 分开记 |
| 日切 | 跨零点写入两个 `day` 键 |
| 裁剪 | 31 天前的那天被删，`lifetime` 不受影响 |
| 空值 | `usage` 缺失时 `calls+1`、`void+1`、金额不变 |
| 重置 | 三个字段归零，文件仍是合法 JSON |
| 坏文件 | 内容写成 `{` 时从空账本开始并记日志 |
| 无文本 | 写出的 JSON 里不含会话 id 与草稿片段 |

**场景**：

| 编号 | 断言 |
|---|---|
| S45 | 打字触发一次 compose 后，面板上的「累计次数」增加 1 |
| S46 | 面板显示今天与累计两个数字，且不含 `NaN`/`undefined` |
| S47 | 点「重置累计」后数字归零，刷新面板仍为零（已落盘） |

## 8. 待你确认

1. **面板位置**：设置分节里加「消耗」一节（我倾向），还是单独一节？
2. **重置按钮**要不要二次确认
3. **缓存读**那一行是否要显示——它数字很大（百万级）但**不计费**，可能反而误导
4. 是否需要「按模式分开」（`next` / `compose` 各一行），还是只给总数
