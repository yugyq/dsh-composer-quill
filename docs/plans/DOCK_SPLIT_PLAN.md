# GhostDock 拆分方案（待确认）

> **状态：全部完成。** A+B+C 在 0.31.36、D+E 在 0.31.37、F 在 0.31.39、安全网/beacon/打字在 0.31.42、会话边界在 0.31.43。
> `GhostDock` 999 → **343 行**，组件内 **0 个 effect**（曾是 11 个）。

## 0. 先说结论：没有「视觉区块」可拆

`GhostDock` 现在 999 行（L1536–L2534），但它的**渲染只有 24 行**：

```
return h(React.Fragment, null,
  h('div', { 'data-composer-quill': 'dock' }, renderStatusChip({...})),
  h('span', { role: 'status', 'aria-live': 'polite' }, announcement))
```

一行状态条 + 一个视觉隐藏的播报区。状态条的四种形态早在 0.31.30 就抽成了 `renderStatusChip()`。

所以按视觉区块拆，最多能拆出「状态条」和「播报区」两个不到 10 行的东西——**真正的体积在逻辑里**：11 条 effect、20 个 ref、两条发送路径的调用、按键与画灰字的协调。

**建议改为按职责拆 hook**。下面按这个思路列。

## 1. 现状结构（行号为准）

| 区段 | 行 | 内容 |
|---|---|---|
| 接线与派生值 | 1536–1598 | props 解构、两个 store、`latest`、`draft`/`draftBase`/`sessionId`/`enabled`/`visible` 等派生 |
| 历史 | 1599–1647 | `fetchHistory` + 一个 effect（依赖 `[sessionId, historyEpoch]`） |
| 定时器与关闭 | 1648–1672 | `stopTimer`、`dismissAll` |
| 请求机器 | 1673–1906 | `requestRef`、`notLive`、`lastCall`、`servedFromStore`、`composeStream`、`nextJson`、`request` |
| 回合边界 | 1907–1975 | effect（`[sessionId, running, enabled, draftEmpty, request, dismissAll]`） |
| 打字防抖 | 1976–2043 | effect（`[draft, enabled, sessionId, running]`） |
| 安全网 | 2044–2078 | effect（`[ghost, request]`），3000ms 轮询 |
| 重试 | 2079–2098 | effect（`[state.phase, state.kind, state.forDraft, draft, …]`） |
| 卸载清理 | 2099–2160 | effect（`[stopTimer, ghost, ghostLayer]`） |
| 采纳 | 2161–2234 | `accept`、`acceptRef`、`paintData` |
| 画灰字 | 2235–2331 | effect + `paint()` 与 `fitToHeight`/`spacer` 几何 |
| 按键 | 2332–2426 | effect（`[visible, nextActive, items.length, ghost, ghostLayer, dismissAll]`）：Tab/Esc/方向键/组字/粘贴 |
| 播报 | 2427–2453 | `announcement` effect（500ms 尾随） |
| 学习与决策 | 2454–2510 | 接受率记录、`lastDecision` |
| 渲染 | 2511–2534 | 24 行 |

## 2. 候选拆分单元（按风险从低到高）

| # | 单元 | 行数 | 它读什么 | 要传的 props | 风险 | 备注 |
|---|---|---|---|---|---|---|
| **A** | `useDockAnnouncement` | ~27 | `statusText`、`failureText`、`pendingAny`、`running`、`t` | 5 个值，纯输入 | **低** | 只产出 `announcement` 一个字符串；无副作用外溢 |
| **B** | `useDockLearning` | ~57 | `items`、`current`、`accepted` 回调 | `kind`、`items`、`onAccepted` | **低** | 只碰 localStorage 与一个 ref |
| **C** | `useComposerHistory` | ~49 | `sessionId`、`historyEpoch` | `sessionId`、`ghost` | **低** | 一个 fetch + 一个 effect；`historyRef` 可一并搬走 |
| **D** | `useGhostPaint` | ~97 | `visible`、`state`、`ghostLayer`、`accept` | `visible`、`state`、`ghostLayer`、`proposal`、`draft` | **中** | 里面有几何计算（`fitToHeight`、spacer）；搬走时要带着 `paintData` 这个 ref |
| **E** | `useComposerKeys` | ~95 | `visible`、`accept`、`dismissAll`、`cycle`、`composing`、`sendDock` | 6–8 个回调 | **中** | 依赖 `accept`/`cycle` 的稳定身份；搬走后 `acceptRef` 要一起搬 |
| **F** | `useGhostRequests` | ~234 | 几乎全部 ref + `ghost` + `sendDock` + 三个 effect | `ghost`、`live` 读取器、`onNotLive`、`onFail` | **高** | 内含 `request`/`composeStream`/`nextJson` 与三个 effect；`latest.current` 的写法必须原样保留 |
| **G** | `useDockBooking`（已存在） | — | — | — | — | 0.31.31 已完成 |

第一批（A+B+C）实际结果：**999 → 918 行**，三个 hook 共 96 行。

预估 866 与实际的差别在于：hook 本身要带注释与签名，而被搬走的 effect 体比按区段粗算的短一些。

D+E 实际结果：918 → **762 行**（`useGhostPaint` 96 行、`useComposerKeys` 65 行）。

F 实际结果：762 → **513 行**（`useGhostRequests` 265 行，含两个发送路径、三个 effect、409 退避与重试预算）。

记账用的九个 ref（`timer`、`lastRequested`、`retriedFor`、`composing`、`notLive`、`servedFromStore`、`lastCall`、`historyRef`、`learnedShown`）**不进 hook**，由组件持有、以 `refs` 一个对象传入——它们在会话 effect、打字 effect、按键 hook 里都还要读写，两份就会互相看不见。

## 3. 三条必须遵守的约束

1. **effect 的依赖数组逐字照搬**。这 11 条的依赖里混着 `ghost`、`request`、`stopTimer` 这类对象/函数身份；换 hook 时若依赖变了，effect 会多跑或少跑，症状是「建议偶尔不出现」——场景测试不一定每次都抓到
2. **`latest.current` 的赋值时机不能动**。它是「回调读最新 props」的通道，赋值行必须在所有 effect 之前
3. **`dockBooking` 要作为参数往下传**，不能在子 hook 里各建一份。两份记账会让 `dismissed` 与 `painted` 互相看不见

## 4. 建议的推进顺序

```
第一批  A 播报 + B 学习 + C 历史     风险低，收益 133 行，一次发版
第二批  D 画灰字 + E 按键            风险中，收益 192 行
第三批  F 请求机器                   风险高，收益 234 行；这一批要单独发版并重点跑场景
```

每一批都独立可回滚、独立发版。第三批之前建议先补两条场景（「切会话后第一次请求」与「重试后立刻切会话」），因为目前这两个交叉点只有单测覆盖。

## 5. 需要你确认的两件事

1. **接受「按职责拆 hook」而不是「按视觉区块拆」吗？**（视觉区块只有 24 行，拆不出有意义的单元）
2. **从哪一批开始？** 我建议第一批（A+B+C），三块都是纯读、无外溢副作用，一次能搬走 133 行。
