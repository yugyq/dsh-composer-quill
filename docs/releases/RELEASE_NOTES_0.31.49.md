# 0.31.49

把「花了多少」变成看得见的数字。

## 采集

`ctx.llm.stream()` 的流里本来就有 `usage` chunk，插件一直在丢弃它。现在 `ask()` 收下并记账：

- 成功时记 `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`
- 失败或中止记一次 `calls + 1`、`void + 1`，不动 token 数

## 存储

`~/.dsh/composer-quill-usage.json`（与日志、缓存同目录）：

```json
{ "version": 1,
  "lifetime": { "calls", "void", "input", "output", "cacheRead", "costMicro", "uncosted" },
  "byMode": { "compose": {...}, "next": {...} },
  "byModel": { "deepseek-flash": {...} },
  "days": { "2026-11-23": {...} } }
```

`lifetime` / `byMode` / `byModel` 只增，`days` 只留 30 天。写入用临时文件 + rename，2 秒合并一次，插件 dispose 时强制落盘。文件里只有数字——没有会话 id，没有草稿文本。

## 金额

按官方价目表（2026-11-23 抓取）以**微美元整数**记账，在**调用发起时刻**结算。

峰时是 UTC 周一至周五 01:00–04:00 与 06:00–10:00；跨过峰谷边界的请求按开始时刻算，与账单口径一致。价格表以后改，旧账不动。

面板按 `cnyPerUsd: 7.1` 折算显示人民币。

## 面板

设置 → 续笔 → 「消耗」：

```
今天   1 次 · 1.8k 入 · 179 出 · ¥0.0028
累计   1 次 · 1.8k 入 · 179 出 · ¥0.0028

按价目 2026-11-23 · 节假日按工作日计价      [重置累计]
```

模型不在价目表里的调用单独计数「未计价」，不会显示成免费。设置页拿不到 `sessionId`，所以「本会话」那行不显示——而不是显示一个假的 0。

## 两种「没记到钱」的区别

| 字段 | 含义 |
|---|---|
| `void` | 没有拿到用量（失败或中止） |
| `uncosted` | 拿到了用量，但模型不在价目表里 |

自检时抓到过一个 bug：空用量的调用同时被算进两个计数，现在分开了，并有断言守着。

## 已知偏差

`TODO(holidays)`：官方把中国法定节假日算作谷时，现在按工作日峰谷判定，节假日会偏高。

## 测试

```
单测  122 → 124（金额按调用时刻计价、未知模型、void 与 uncosted 分离、¥ 格式化）
场景  47 → 49（S45 面板显示用量 / 重置归零）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_USAGE_PANEL.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
