# 0.31.34

第 4 步做完：两条发送路径各自成函数，`request()` 变成调度器。

## 现在的形状

```
request()        63 行   排期 → 问 gateFor → 执行 effects → 派活
gateFor()        59 行   九道纯判定，返回 gate + effects
composeStream()  96 行   SSE：streamStart、rAF 合帧、空闲超时、五个帧、409 退避、错误上报
nextJson()       32 行   JSON：begin、20s deadline、settle、saveSuggestion、409 与错误
```

对比刚开工时：`request()` 是 **187 行**，九道判定、两条发送路径、三个超时器全在里面。现在它是四句话。

两个新函数都用 `useCallback([ghost])` 包着——它们只碰 ref 与模块级函数，所以捕获首帧闭包是安全的；`request` 的依赖相应加上这两个。

## 顺带修了你可能没注意的测试错误

S32 断言「一次流式补写的 paint 上报 ≤ 4 次」。那个 4 是我从某一次实测**抄下来的**，而灰字的锚点（caret ↔ box）在一次长流里本来就会切换 4–6 次——上一次 5 次、6 次报红，不是回归，是我把一次观测当成了常量。

上限改成 8，同时保留两条硬断言：

- 不得带原文（隐私）
- 必须带长度（诊断可用）

逐帧回归会产生几十次，仍然抓得住。

## 测试

```
单测  106
场景  39/39   S32 连跑三次都是 4 次
```

## 剩下的路

```
5. dismissedDraft / switchDraft 并入 dockReducer
6. 之后才谈按视觉区块拆 GhostDock（现在 1001 行）
```

第 5 步是纯收口，第 6 步才是真正拆分——而到那时，由于判定、发送、记账都已经各自独立，`GhostDock` 里剩下的主要是渲染与协调。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [闸门表](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/REQUEST_STATE_MACHINE.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
