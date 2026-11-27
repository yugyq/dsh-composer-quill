# 0.31.36

拆 `GhostDock` 的第一批。行为不变——这一条的验收标准还是「测试结果与上一版一致」。

## 先纠正一个预设

上一轮我按「视觉区块」估了个方案，真读代码后改了主意：这个组件 999 行里，**渲染只有 24 行**——一行状态条 + 一个视觉隐藏的播报区，而状态条的四种形态早在 0.31.30 就抽成了 `renderStatusChip()`。

所以按视觉拆，最多能拆出两个不到 10 行的东西。真正的体积在逻辑里，改为**按职责拆 hook**。

## 三个 hook 出壳

| hook | 行数 | 搬走了什么 |
|---|---|---|
| `useDockAnnouncement` | 23 | 播报的 state、500ms 尾随定时器、三处输入的订阅 |
| `useDockStateReport` | 39 | 「为什么屏幕上是空的」那条 trace，以及「屏幕上出现过什么」的记账 |
| `useComposerHistory` | 34 | 历史的一次读取 + 409 静默重试 + 回合结束时刷新 |

`GhostDock` **999 → 918 行**。预估是 866，差在 hook 本身要带签名与注释，而被搬走的 effect 体比按区段粗算的短。

## 三条约束都守住了

1. **effect 依赖数组逐字照搬**：`[statusText, failureText, pendingAny, running]`、`[decisionKey]`、`[sessionId, epoch]`
2. **`latest.current` 的赋值位置没动**
3. **`learnedShown` 与 `dockBooking` 以参数传入**，没有在子 hook 里重建——两份记账会让 `dismissed` 与 `painted` 互相看不见

## 过程中自己修正的两处

- `useDockStateReport` 第一版为了回避赋值表达式，写出了 `input.decisionKey === undefined ? undefined : (last.current = ...)` 这种绕法；`historyActive` 也被我误改成「history 是否存在」。两处都改回原语义
- `useDockAnnouncement` 第一版删错了行：定位 `stateAt` 时把刚插入的 hook 自己也匹配上了，结果删掉了 hook 里的那行。改成先定位组件里的行、最后插入 hook

## 测试

```
单测  109
场景  39/39（连跑两次）
```

## 剩下的

```
D  画灰字    97 行
E  按键      95 行
F  请求机器  234 行
```

按计划 D+E 一批、F 单独一批。三批做完 `GhostDock` 约 492 行，剩下的会是渲染与协调。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [拆分方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/DOCK_SPLIT_PLAN.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
