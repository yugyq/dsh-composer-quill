# 0.31.39

拆分 `GhostDock` 的最后一批。`GhostDock` 762 → **513 行**，四批累计 **999 → 513**。

## 新单元

| 单元 | 行数 | 内容 |
|---|---|---|
| `useGhostRequests` | 265 | `request` / `composeStream` / `nextJson`、409 退避、每草稿一次的重试、安全网、卸载清理 |

## 关键设计：记账 ref 不进 hook

九个 ref——`timer`、`lastRequested`、`retriedFor`、`composing`、`notLive`、`servedFromStore`、`lastCall`、`historyRef`、`learnedShown`——**由组件持有**，以 `refs` 一个对象传入。

它们在会话切换 effect、打字 effect、按键 hook 里都还要读写。如果 hook 里各建一份，「切换会话后第一个草稿被当成已问过」这类 bug 只在特定操作序列下出现，而场景测试未必每次都抓到。

## 参数形状

第一版入参是 20 个平铺名字，拆完立刻觉得没法读。现在是 13 个 + 一个 `refs`：

```js
useGhostRequests({
  ghost, ghostLayer, latest, state, draft, enabled, running, sessionId,
  dockBooking, sendDock, report, stopTimer, domDraft, refs: dockRefs,
})
```

剩下 13 个里，8 个是每渲染变化的活值、5 个是服务。再包一层只会让「哪个值来自哪次渲染」变模糊——而重试 effect 的正确性正依赖那个区分。

## 三次返工，同一个错误

搬完依次报 `notLive` / `learnedShown` / `timer` / `historyRef` 未定义。每次都是「某个 ref 的归属没想清楚」。

现在的规则写在注释里：**凡是 hook 外还有一处读写的，一律不进 hook，改为入参**。

## 拆分到此为止

`GhostDock` 里还剩三个 effect——会话边界、打字防抖、初始化 beacon。它们与渲染和派生值耦合最紧，再拆的收益已经小于「每次都要重新验一遍 ref 归属」的成本。这条也写进了 `docs/DOCK_SPLIT_PLAN.md`。

## 测试

```
单测  109
场景  41/41（连跑两次，含 S36 的 next 次数基线 2 与 S37 的重试竞争）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [拆分方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/DOCK_SPLIT_PLAN.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
