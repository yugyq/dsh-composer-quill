# 请求闸门：转移表草稿

> **状态：已实施（0.31.33）。** `request()` 先问 `gateFor()`，再按返回的 `effects` 执行；顺序写法的闸门链已删除。
>
> 适用版本：0.31.60 ｜ `gateFor()` 与 `request()` 在同一文件，紧邻彼此

## 1. 为什么是「闸门表」而不是「状态机」

原本想写状态机，读完代码后改了主意：`request()` 里没有跨调用的状态迁移，只有**一次调用内的九道判定**。真正需要被叫出名字的是这些判定，不是状态。所以这张表的每一行 = 一道闸门，列 = 判定条件、事实来源、命中动作、副作用。

调用之间共享的事实（`lastCall`、`servedFromStore`、`lastRequested`、`retriedFor`…）继续留在各自的 ref 里；表只规定「谁先读、读到什么就停」。

## 2. 入口

```
request(mode, forDraft, force = false, delayOverride = null)
```

| 参数 | 含义 | 谁传 |
|---|---|---|
| `mode` | `'compose'` \| `'next'` | 五个发起方 |
| `forDraft` | 要预测的草稿；`null` 时取此刻输入框内容 | 打字防抖、安全网、手动；`next` 传 `''` |
| `force` | 跳过第 4、5 类闸门（去重与已答） | 回合结束、手动 |
| `delayOverride` | 覆盖排期延迟 | 打字防抖（被覆盖时传 1200） |

统一延迟：`delayOverride ?? (mode === 'next' ? NEXT_DEBOUNCE_MS(320) : debounceMs(默认 120))`。**每次调用先 `stopTimer()`**，即后到的排期取消先到的。

## 3. 闸门表（顺序即优先级）

| # | 闸门 | 判定（全部满足才拦） | 事实来源 | 命中动作 | 副作用 | 现状行 |
|---|---|---|---|---|---|---|
| **G1** | 未启用 | `!enabled` | `latest.current` | return | 无 | 1632 |
| **G1'** | 无会话 | `sessionId === null` | `latest.current` | return | 无 | 1632 |
| **G2** | 会话未加载（退避中） | `liveBlocked()` = `Date.now() < notLive.until` | `notLive` | return | 退避到期由 `markNotLive` 的定时器自行重发 | 1633 |
| **G3** | 存储刚答过 | 同 `mode｜draft` 且 `servedFromStore.at` 在 5s 内 | `servedFromStore` | `report('reuse','store')` + return | **不写 `lastCall`** | 1638–1643 |
| **G4a** | 900ms 去重 | `!force` 且同 `mode｜draft` 且 `lastCall.at` 在 900ms 内 | `lastCall` | `report('dedupe')`，按 `max(80, 900-Δ)` 重新 `request(...)` + return | **不改 `lastCall`**，重排一次可能再次被拦 | 1648–1656 |
| **G4b** | store 已有结果 | `mode==='compose'` 且 store 的 session/kind/forDraft 与之相同且相位是 `ready`/`empty` | `ghost.getSnapshot()` | `report('reuse',phase)` + return | **写 `lastCall`**（与 G3 不同） | 1657–1666 |
| **G4c** | 通过去重 | 其余 `!force` 情形 | — | 继续 | **写 `lastCall = {key, now}`** | 1667 |
| **G5a** | 回合进行中 | `running` | `latest.current` | return（`next` 与 `compose` 各自都判） | 无 | 1669, 1671 |
| **G5b** | 草稿太短 | `mode==='compose'` 且 `draftNow.trim().length < 1` | — | return | 无 | 1671 |
| **G5c** | 已按 Esc | `mode==='compose'` 且 `dismissedDraft === draftNow` | `dismissedDraft` | return | 无 | 1672 |
| **G5d** | 空输入框才有 `next` | `mode==='next'` 且 `!draftEmpty` | `latest.current` | return | 无 | 1669 |
| **G6** | 在飞请求已覆盖 | `phase==='loading'` 且 `inFlightCovers(requested, draftNow)` | `ghost.getSnapshot()` | `report('reuse','in-flight')` + return | 无 | 1675–1679 |
| **G7** | 放行 | 以上皆未命中 | — | 发送 | `compose`：写 `lastRequested`、`streamStart`；`next`：`begin` | 1685–1687, 1782 |

通过 G7 之后两条路径分叉（不在本表内，保持现状）：`compose` 走 SSE（`streamRoute` + rAF 合帧 + 空闲超时 `bump`），`next` 走 JSON（`callRoute` + 20s deadline）。两条都处理 409（→ `markNotLive`）与错误上报。

## 4. 发起方 → 参数映射（表的下半部分）

| 发起方 | 调用 | 会被哪些闸门拦 |
|---|---|---|
| 打字防抖 | `('compose', draft, false, covered ? 1200 : null)` | G1–G6 全部 |
| 安全网 | `('compose', text)` | 全部；且它自己先做了一遍前缀判断（G6 的近似） |
| 失败重试 | `('compose', draft)` | 全部 |
| 回合结束 | `('next', '', true)` | G1, G1', G2, G5a, G5d（跳过 G3/G4/G6） |
| 手动 | `('compose', live.draft)`（不改 force） | 全部；但它先写了 `lastRequested` |

**手动为什么不是 `force`**：写了 `lastRequested` 已经让安全网跳过，若再 `force` 就会绕过 G4b（store 已有结果）——手动反而更容易重复花钱。现状如此，建议保留。

## 5. 必须保留的五处怪癖

改写时最容易「顺手修掉」、但会改变行为的地方：

| # | 怪癖 | 为什么必须保留 |
|---|---|---|
| 1 | G3 不写 `lastCall`，G4b 写 | 前者是「存储刚答过」，写 `lastCall` 会让 5s 后的真请求被 900ms 去重再拖一次；后者刚刚确认了「已有结果」，写 `lastCall` 才有意义 |
| 2 | G4a 重排时把 `force` 原样传回 | 重排后若 `lastCall` 已在窗口外，会正常发出；若在窗口内会再重排一次——上限由 900ms 窗口自然收敛 |
| 3 | `lastRequested` 只在 `compose` 且通过 G7 后写 | 提前写会让安全网误以为「这个草稿问过了」，实测会把幽灵卡死（代码里有注释记录） |
| 4 | `next` 的判定用 `!draftEmpty`，`compose` 用 `trim().length < 1` | 前者是「输入框整体为空」，后者是「去掉空白后为空」；一个空格在两种模式下结论不同 |
| 5 | G4b 只对 `compose` 生效 | `next` 的结果由 store 的 `kind='next'` 承载，若也拦，回合结束的 `force` 就失去意义 |

## 6. 表里暴露的三处需要你拍板

| # | 问题 | 现状 | 我的建议 |
|---|---|---|---|
| A | G4a 与 G4b 顺序：先「刚发过」还是先「已有结果」 | 先去重（G4a），再查 store（G4b） | **保持**。去重是无成本的本地判断，store 查询要取快照 |
| B | G6 只对 `compose` 生效 | 是 | **保持**。`next` 没有「增量覆盖」的概念，`inFlightCovers` 的语义用不上 |
| C | 手动是否该 `force` | 否 | **保持否**，理由见上表 |

## 7. 迁移怎么验证「没变行为」

光靠现有 39 条场景不够——它们覆盖的是结果，不是判定顺序。建议加一层**判定快照测试**：

1. 把闸门链抽成纯函数 `gateFor({ mode, forDraft, force, now, live, lastCall, served, store, dismissed })`，返回 `{ verdict: 'send' | 'stop', gate: 'G3' | …, action?: … }`
2. 用现在的实现跑一组固定输入，**把返回的 `gate` 记下来存成快照**
3. 改写后逐条比对：同输入必须命中同一个闸门

这条测试的价值在于：它锁定的是**判定顺序**本身，而不是最终有没有发请求——顺序错了但结果碰巧相同时，它仍然会红。

## 8. 实施记录

1. ~~写 `gateFor()` + 快照测试~~ — 0.31.33，5 组断言锁住闸门顺序与副作用
2. ~~`request()` 改问 `gateFor`~~ — 0.31.33，闸门链换成 30 行接线
3. ~~把两条发送路径抽成函数~~ — 0.31.34，`request()` 从 183 降到 **63** 行（`composeStream` / `nextJson`）
4. ~~两条发送路径各抽成函数~~ — 0.31.34 完成，`request()` 现在是一个调度器
5. `dismissedDraft`、`switchDraft` 并入 `dockReducer`（与已迁移的三个闸门同一张表）
