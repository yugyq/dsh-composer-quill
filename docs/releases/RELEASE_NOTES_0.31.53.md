# 0.31.53

把上下文预算收成一组，并证明它真的管用。

## 之前是半成品

0.31.51 加的「收紧上下文」只改了默认值，三处调用点各自写死着自己的 `{ rows, chars }`：

```js
transcriptOf(events, { rows: 8,  chars: 2400 })   // 短稿
transcriptOf(events, { rows: 10, chars: 3200 })   // 主补写
transcriptOf(events, { rows: 10, chars: 3200 })   // 下一句
```

也就是说，`DSH_QUILL_CONTEXT=full` 这个回滚开关**在真正费 token 的地方是空的**。现在三处都读同一组 `CONTEXT_BUDGET`。

## 长会话实测

同一条草稿，对话从 2 轮加到 40 轮（每条约 420 字符）：

```
轮数   tight   full
 2      2883    3199
 6      2987    4612
12      2808    4433   ← 从这里开始封顶
24      2808    4433
40      2808    4433
```

12 轮之后两边封顶，差 **36%**（2808 对 4433）。

短对话几乎看不出差别——**行数上限先于字符上限生效**。所以这个改动只在长会话里可见，它不是「每次都省」，是「长会话的保险」，保证 prompt 不再随对话变长而无限增长。

顺带确认：`full` 模式也有 3200 字符的界，两条路都是有界的，区别只是界的宽窄。

## 其它

- README 与 DEVELOPMENT 的单测数从 124 更正为 125
- `dev/README` 新增「探针」一节，四个工具各一行

## 测试

```
单测  125（连跑三次全绿）
场景  49/49（两轮均首次通过，无抖动）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [方案与实测](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_TOKEN_BUDGET.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
