# 0.31.33

`request()` 不再自己写闸门链，改为问一个纯函数。行为不变——这一条的验收标准就是「测试结果与 0.31.32 一致」。

## 闸门表变成了代码

```js
gateFor({ mode, forDraft, force, now, live, blockedUntil, served, lastCall, stored, dismissed })
  → { verdict: 'send' | 'stop', gate: 'G1'…'G7', draftNow, key, effects }
```

副作用单独列在 `effects` 里，因为「先判谁」和「顺手做了什么」是两件事：

| effect | 谁产生 |
|---|---|
| `mark-last-call` | G4b、G4c（含被 G5 拦下的情况） |
| `reschedule` | G4a（900ms 去重，按 `max(80, 900-Δ)` 重排） |
| `report` | G3、G4a、G4b、G6 |

`request()` 现在是一次取 `now` + 一份 store 快照 → 问 `gateFor` → 按 `effects` 执行 → 只 `send` 才继续。判定链删掉，函数从 **187 降到 183 行**。

预期是降到 90 行，实际没有——省掉的是判定（约 50 行），而两条发送路径仍占 130 行。那个 90 要等发送路径各自抽成函数。

## 两处保真修正，都是实测抓的

**① G1 的判法差一个字符**

我写的是 `live.enabled !== true`，原代码是 `!live.enabled`。配置里它是布尔值，所以测不出来；但只要哪天传进 `1` 或 `'yes'`，两者就分叉。已改回逐字一致。

**② `now` 取了两次，导致请求躲过去重**

第一版在应用 `mark-last-call` 时又调了一次 `Date.now()`。几毫秒的漂移足够让后续请求躲过 900ms 窗口：

```
改动前  S32 灰字上报 4 次
第一版  S32 灰字上报 6 次   ← 场景测试抓到
改回后  4 次（连跑三次一致）
```

这正是「用场景测试守行为、用单测守判定」的分工在起作用：单测只证明闸门顺序对，证明不了时间戳取了几次。

## 测试

```
单测  101 → 106   5 组闸门断言：顺序、被拦仍占位、reuse 的理由、去重重排、next/compose 对空输入框的分歧
场景  39/39       S32 连跑三次都是 4 次
```

## 文档

`docs/REQUEST_STATE_MACHINE.md` 从「草稿」改成「已实施」，并把实施记录写进去：哪一步做完、行数为什么没到 90、下一步是什么。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [闸门表](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/REQUEST_STATE_MACHINE.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
