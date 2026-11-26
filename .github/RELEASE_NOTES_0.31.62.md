# 0.31.62

0.31.61 装上去之后的第一批真实日志（9 条 `stream-end`）暴露了两处**观测**缺陷。功能没坏，是看错了。

## `paintedChars` 把同一条建议数了两遍

流式响应里 `final` 会重复整段文字，而 0.31.61 让 delta 和 `final` 都累加一遍。真实行：

```
paintedChars: 57   chars: 26
paintedChars: 64   chars: 25
```

9 条里 7 条是双倍。现在只累加「没被 delta 计过」的那部分，并有断言钉住：一条建议的字符只数一次。**0.31.61 的 `paintedChars` 不要拿来算长度，用 `chars`。**

## 压制状态从日志里看不见

一条被压住的改写和一条根本没到的改写，在界面上完全一样——而其中只有一种是 bug。`dock-state` 现在带 `suppressRewrites` 与 `ignoredStreak`，并且两者都进了去重键（不然状态变了也不会上报）。

判断「连续忽略三条」是不是压得太狠，从这一版起才有分母：`suppressed` 事件数对采纳数。

## 已经在真实流量里确认的两件事

| 路径 | n | 总耗时 p50 | 思考 | 状态 |
| --- | --- | --- | --- | --- |
| 短草稿（1–3 字） | 5 | **532 ms** | 0/5 | painted 3、cancelled 1、silent 1 |
| 主路径（≥4 字，面板最高） | 4 | **1928 ms** | 4/4（362–962 字） | painted 4 |

短草稿修复前是 1888 / 1919 / 2245 / 5257 ms 且带 497–1550 字思考，现在 532 / 796 / 1395 ms、思考恒 0。

## 测试

```
单测  148
场景  59/59
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
