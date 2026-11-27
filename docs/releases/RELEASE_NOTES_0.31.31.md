# 0.31.31

拆 `GhostDock` 的第一步：把它的「草稿记账」收进一个纯 reducer。

## 为什么要先做这一步

这个组件有 25 个 `useRef`，其中一半是同一类东西——**对同一份草稿只做一次**的闸门：

```
「这条建议已经画过了」
「这条建议已经覆盖过当前草稿」
「用户在这个输入框里打过字」
```

它们散在 36 处读写。想按视觉区块拆分，第一件撞上的就是这些隐式约定：你不知道哪一行读的可能是三行前写的值。

现在这些变成一个纯函数：

```js
createDockBooking()            → { painted: '', covered: '', hadDraft: false }
dockReducer(booking, action)   → painted / covered / not-covered / typed / cleared
```

同值不动对象（`return booking`），所以不会因为无关的重复动作触发渲染。四条断言守着它：初始状态、同值幂等、`covered` 的清空、`typed`/`cleared` 成对翻转。

## 这一轮只迁移了三个

`paintedKey`、`lastCovered`、`hadDraft` 已改走 reducer。**请求相关的四个还没动**：`lastRequested`、`retriedFor`、`dismissedDraft`、`switchDraft`——它们和重试预算、会话切换的 effect 缠在一起，一次改完风险太高。

## 两个真实发现

**① ref 必须跟着 dispatch 走**

第一版只在渲染时同步 `current.current`。结果画灰字的 effect 在 dispatch 之后**立刻**读取，读到的是旧值，同一条建议多上报了一次——S32 的 paint 次数从 4 变成 5，测试当场抓住。

现在 dispatch 里同步更新 ref，渲染时再对齐一次。

**② 单测用的假 React 缺 `useReducer`**

fake React 只实现了 `useState` / `useRef` / `useEffect`，一引入 reducer 就有 5 条用例报「不是函数」。补上 `useReducer` 之后才跑得动——顺带说明这个 fixture 也需要跟着产品代码一起长。

## 测试

```
单测  94 → 99（5 项 booking 断言）
场景  39/39（S32 回到 4 次上报）
```

## 下一步

迁剩下四个闸门，然后把 `request()` 与三条 effect 收敛成显式状态机——那之后 990 行才真正有得拆。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
