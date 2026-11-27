# 0.31.42

`GhostDock` 里剩下的 effect 收掉了大半：**513 → 405 行**，只剩一个。

## 搬走的三块

| 动作 | 结果 |
|---|---|
| 安全网（1500ms 轮询）并入 `useGhostRequests` | 它本来就是请求调度的一部分，不该分开 |
| 初始化 beacon → `useMountBeacon` | 24 行，依赖 `[]` |
| 打字防抖 → `useTypingRequest` | 69 行，依赖数组 `[draft, enabled, sessionId, running]` 原样保留 |

## 会话边界那条没搬成

`useSessionBoundary`（67 行）写完了，单测也过，但**场景从第 13 条开始连挂 11 条**：

```
FAIL  S13 灰字与正文行盒对齐        align=None
FAIL  S14 本地历史补全毫秒级兜底    首个建议=None
...
FAIL  S25 最终仍能给出建议          phase=idle compose=0
```

同一份代码在**单开的页面**里完全正常——灰字、建议行都对（`'，找出报错的那几行。'`，宽 734px）。所以问题出在「跑过一串场景之后」的状态，不是渲染本身。

没有继续深挖的原因：它已经吃掉了这一轮的预算，而收益（再少 67 行）小于「带着一个只在长序列里出现的回归发版」。**已回退**，组件里保留原样。

这条记在这里，不再靠记忆：`docs/DOCK_SPLIT_PLAN.md` 里写明了「会话边界未搬」以及那个症状。

## 这一轮的自我修正

调试过程中我犯了两类错，都记下来：

1. **探针写在声明之前**：把 `report(...)` 插到 hook 的解构之前，制造了一个 `Cannot access 'report2' before initialization`，还一度以为是产品问题
2. **用错选择器**：灰字元素是 `[data-composer-quill="text"]`，我却一直查 `[data-composer-quill="ghost"]`，于是「灰字没画」的结论跟着错了两次

两次都是「先相信自己的复现工具」，而工具本身没验证过。

## 测试

```
单测  109
场景  41/41（连跑两次；用 test:ui:retry 跑也是 attempt 1 全绿）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [拆分方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/DOCK_SPLIT_PLAN.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
