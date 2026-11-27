# 0.31.37

拆分 `GhostDock` 的第二批：画灰字与按键各自成 hook。行为不变。

## 两个 hook

| hook | 行数 | 搬走了什么 |
|---|---|---|
| `useGhostPaint` | 96 | `overlayBlocking()`（灰字不许画到对话框上）、`paint()`（caret / box / 不画三选一）、结构键与 paint 上报、六个监听器的挂与卸 |
| `useComposerKeys` | 65 | `inEditor` 判定、IME 组字抑制、`Ctrl+Shift+Space`、Enter / Esc / Tab / 方向键、六个监听器的挂与卸 |

`GhostDock` **918 → 762 行**，三批累计 **999 → 762**。

## 依赖数组一字未动

```
useGhostPaint    [visible, ghost, ghostLayer]
useComposerKeys  [visible, nextActive, items.length, ghost, ghostLayer, dismissAll]
```

这两条最容易被「顺手整理」掉，而它们决定监听器何时重挂——不重挂的症状是「Tab 偶尔失灵」，且只在特定操作序列下出现。

首帧捕获之所以安全，是因为搬进去的东西身份都稳定：`paintData`、`dockBooking`、`acceptRef`、`latest`、`lastRequested` 是 ref；`sendDock` 是 `useReducer` 的 dispatch；`request` 是 `useCallback([stopTimer, ghost, composeStream, nextJson])`；`report` 是模块函数。

## 测试

```
单测  109
场景  39/39（连跑两次）
```

## 只剩最后一批

```
F  请求机器  234 行   request / composeStream / nextJson + 四个 effect
```

按计划，F 之前要先补两条场景——「切会话后第一次请求」与「重试后立刻切会话」。这两个交叉点现在只有单测覆盖，而它们是 F 里状态最多的地方。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [拆分方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/DOCK_SPLIT_PLAN.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
