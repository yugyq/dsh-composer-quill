# 0.31.51

省 token 的一批改动，外加两个探针挖出来的 bug。

## 用量数据怎么说

`usage-call` 攒到 12 条后第一次看清现状：

```
reasoning   全是 0        → thinking 没开，原方案里「可能省十倍」那条作废
提示词      约 1800–2200 tokens
缓存命中    九成（命中时 input 只剩 200 左右）
```

## 改了什么

| 项 | 之前 | 现在 |
|---|---|---|
| 输出上限 | 一律 1200 | `next` 96 / `compose` 256 / `rewrite` 512 |
| 「只有一个候选」再问 | 无条件 | 该候选短于 12 字才问 |
| 「短稿兜底」 | 无条件 | 草稿 ≥4 字才问 |
| transcript | 9000 字符 | 1800 字符（`DSH_QUILL_CONTEXT=full` 回滚） |
| 单条消息 | 2200 字符 | 800 字符 |
| 安全网轮询 | 1500ms | 3000ms |

## 探针挖出来的两个 bug

**输出上限一直给 512。** 我把提示词长度当成了草稿长度，于是每次调用都判定成「长草稿」，所有档位形同虚设。

**`SKIP` 会拼进草稿。** 模型说「没什么可改」时返回 `SKIP`，却被当成可追加的尾巴：

```
帮我看下这个报错 SKIP.
```

现在 `SKIP / NOOP / none / unchanged / 不需要 / 无需修改` 在三处都被拦住——`parseComposeReply`、`parseSentence`，以及流式路径（原本会**先画到屏幕上**，解析器再拒绝）。

## 新增的两个探针

- `dev/probe-compose-calls.mjs`：脚本化 `ctx.llm` 驱动真实的 `produceCompose`，看调用次数、输出上限、提示词体积
- `dev/probe_client_requests.py`：在夹具里数一次打字停顿到底发几次请求

后者纠正了一个错判：日志里成对的 compose 调用是**两次独立请求**（继续打字或失败重试），不是宿主内部重发。

## 还没解开的

探针里草稿 ≥4 字时 `composeShortDraft` 总返回 true，主补写走不到；但真机出现 2000-token 的 compose 调用。下一轮给每次调用打标签查清。

## 测试

```
单测  125
场景  49/49
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_TOKEN_BUDGET.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
