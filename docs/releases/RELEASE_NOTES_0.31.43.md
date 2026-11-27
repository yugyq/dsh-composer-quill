# 0.31.43

最后一块：会话/回合边界的 effect 出壳。`GhostDock` **405 → 343 行**，组件内 **0 个 effect**（曾是 11 个）。

## 上一轮「搬不动」的原因查清了

0.31.42 里这个 hook 写完就回滚了。当时症状是「场景从第 13 条起连挂 11 条，单开页面却完全正常」，看起来像状态累积。

真因是一行：

```
ReferenceError: latest is not defined
```

effect 里读了 `latest`，而这个参数没传进 hook。

## 为什么看起来像「累积」

这个 effect 首次运行走的是 `prior === null` 分支——在碰到 `latest` 之前就 `return` 了。只有**第一次会话切换**之后才会读到它。

于是：前 12 条场景（不切会话）全绿，从第一条切会话的场景起全红。日期上像累积，实际是一次性的时序巧合。

## 怎么找到的

给场景脚本加了 `DSH_SCENARIO_LIMIT`：跑到第 N 条就停。

```bash
DSH_SCENARIO_LIMIT=14 python dev/verify_daily.py
```

两次二分就定位了：

```
limit=13 / 14   全绿
limit=16        出现 2 条 FAIL
```

然后用最小复现（打字 → 切会话 → 再打字）确认灰字消失，在浏览器控制台抓到那行 ReferenceError。

## 教训

**「只在长序列里出现」不等于「状态累积」。** 这次的信号来自场景顺序，根因是一个漏传的参数。二分比推理便宜得多——我上一轮花了整轮预算去猜「谁累积了什么」，这一轮两次子进程运行就结束了。

## 现在的结构

```
GhostDock          343 行   渲染 + 派生值 + 三个 handler（无 effect）
useGhostRequests   306 行   判定入口、两条发送路径、安全网、退避、重试
useSessionBoundary  74 行   回合边界与会话切换
useTypingRequest    69 行   打字防抖
useGhostPaint       99 行   灰字绘制与六个监听器
useComposerKeys     68 行   快捷键与六个监听器
useDockAnnouncement 23 行   播报
useDockStateReport  39 行   诊断
useComposerHistory  34 行   历史
useDockBooking      12 行   记账
gateFor             59 行   九道纯判定
```

四轮拆分：999 → 762 → 513 → 405 → **343**。

## 测试

```
单测  109
场景  41/41（连跑两次；test:ui:retry 首次全绿）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [拆分方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/DOCK_SPLIT_PLAN.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
