# 补写请求的发起权

这份表回答一个问题：**谁有权发起一次模型调用**。

`client.js` 里目前有五个地方会调 `request()`，各自的守卫散落在 effect 里，靠注释和实测记忆维持一致。本文件列的是**现状 + 已定的三条决定**，改结构时以它为准，行为改变也要先改它。

> 适用版本：0.33.3
> 相关常量：`COMPOSE_DEBOUNCE_MS = 120`、`COVERED_DEBOUNCE_MS = 1200`、`RETRIGGER_INTERVAL_MS = 3000`、`CLIENT_TIMEOUT_MS = 20000`、`MIN_DRAFT_CHARS = 1`

## 五个发起方

| # | 发起方 | 触发时机 | 调用的形态 | 自身前置条件（代码实际写的） | 节流/延迟 |
|---|---|---|---|---|---|
| 1 | **打字防抖** | 草稿变化，或会话切换后草稿为空 | `request('compose', draft, false, covered ? 1200 : undefined)` / `request('next', '', true)` | `enabled`、`sessionId !== null`、`!running`、`mode !== 'manual'`、`draft.trim().length >= 1`、`dismissedDraft !== draft`；先试 `hydrateStored()`，命中即不发 | `debounceMs`（默认 120）；草稿仍在旧建议里时 1200 |
| 2 | **安全网** | 每 3000ms 轮询一次 | `request('compose', text)`（`force` 为 false） | 同上之外再加：`!composing`、`switchDraft` 已结算、`text !== lastRequested`、`dismissedDraft !== text`、store 未对本草稿处于非 idle、屏幕上建议不以本草稿为前缀 | 3000ms 轮询 |
| 3 | **失败重试** | store 进入 `phase==='error' && kind==='compose'` | `request('compose', draft)` | 额外：`state.forDraft === draft`、`retriedFor !== draft`；**每份草稿一次** | 1200ms 后发 |
| 4 | **会话切换 / 回合结束** | `running` 由真变假 | `request('next', '', true)` | `enabled`、`draftEmpty`、`mode !== 'manual'`；先 `hydrateStored('next','')` | 立即（`force` 跳过 900ms 去重） |
| 5 | **手动触发** | `Ctrl/Cmd+Shift+Space` | `request('compose', live.draft)` | `enabled`、`sessionId !== null`、`draft.trim().length >= 1`（**不看 `mode`**） | 立即，并先写 `lastRequested` |

## `request()` 内部的五道闸门（顺序即优先级）

| 顺序 | 闸门 | 何时拦下 |
|---|---|---|
| 1 | `enabled` / `sessionId` | 关闭或未挂载会话 |
| 2 | `liveBlocked()` | 宿主未加载会话（409）后退避中：700ms × 2ⁿ，上限 15s |
| 3 | `servedFromStore`（5s 内） | 同一 `mode|draft` 刚被存储回答过 |
| 4 | 900ms 去重（`force` 时跳过） | 同一 `mode|draft` 在 900ms 内已发过；到点自动补发，不丢 |
| 5 | store 已对本草稿有 `ready`/`empty` | 已有可用结果 |

## 发起方之间的互斥

| 关系 | 现状 |
|---|---|
| 打字防抖 ⟷ 安全网 | **互斥**。安全网看到屏幕上建议以本草稿为前缀就跳过（S18 量到过重复调用） |
| 打字防抖 ⟷ 重试 | 重试 effect 的依赖里含 `draft`：打一个字就清掉那个 1200ms 定时器，随后 `state.forDraft !== draft` 让它直接返回——**打字即取消这次重试** |
| 重试 ⟷ 会话切换 | 回合结束会 `retriedFor = null`，下一轮重新给一次额度 |
| 手动 ⟷ 其它 | 手动不受 `mode` 限制，也不受 `dismissedDraft` 限制（`Esc` 关掉后仍可手动要） |
| 手动 ⟷ 安全网 | 手动会先写 `lastRequested`，安全网随后跳过 |
| 会话切换 ⟷ 打字防抖 | 切换时草稿变空，打字 effect 先于会话 effect 运行，所以「清空」分支里先查存储 |

## 已定的三条（不再讨论）

| 决定 | 含义 | 落地方式 |
|---|---|---|
| **① 手动不消耗重试额度** | 手动触发失败后，自动重试仍然会给一次 | 手动分支不写 `retriedFor`；行为与 0.31.31 一致 |
| **② error 优先** | 同一草稿先失败、后得到「没什么可补」，屏幕上保留失败原因 | `streamDone` 在 `phase==='error'` 且 `reason==='unchanged'` 时直接返回；真实结果（ready）仍然会覆盖 error；有两条单测守着 |
| **③ 打字取消重试保持现状** | 用户一动手，那次待发的重试就作废——人的意图比机器的新 | 不改代码，只记录 |

## 手动失败要不要额外提示

**结论：不额外提示。** 理由：

- 由 ①，手动失败后自动重试仍会跑一次，用户在 1.2 秒内会看到状态从「建议失败」回到「补写中…」
- 由 ②，如果重试也失败，屏幕上会稳定显示「建议失败：<原因>」
- 若再叠一个「手动补写失败」的提示，1.2 秒内会连跳三种文案，噪音大于信息

现有的错误行已经覆盖了这条路径；真正缺失的是**区分失败来源**（手动/自动），而这对用户没有决策价值——他要的是「再试一次」，不是「哪条路径失败」。

## 尚未定的事

- `empty` 之后又采一次并失败，屏幕上从「没东西可补」跳成「建议失败」：按 ② 这是对的，但两次结论之间的转换没有任何过渡，用户可能没注意到
- 安全网 3000ms 与打字防抖 120ms 没有共同时间基准，靠 `lastRequested` 与「前缀覆盖」两条软判据合作，没有硬互斥锁
