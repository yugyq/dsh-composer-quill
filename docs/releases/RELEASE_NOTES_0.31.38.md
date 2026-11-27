# 0.31.38

拆 F（请求机器）之前先补两条场景。其中一条抓到一个**既有缺陷**。

## S37：失败重试不能活过会话切换

让一次 compose 失败（此时重试定时器已挂上），立刻切会话并清空输入框，再等 2.2 秒，断言切换之后没有同一草稿的 compose 调用。

**绿。** 这条守的是「重试预算与会话边界」的竞争——`retriedFor` 在切换时被清空、而重试定时器可能还在飞。这正是 F 里状态最多的交叉点。

## S36：切会话的 next 调用次数 → 发现既有重复

原本想断言「切到新会话只问一次」。实测：

```
每个新会话的 next 次数 = {s-second: 2, s-third: 2}
```

**两个全新会话，每个都发出两次** `next` 请求；首次挂载也一样。这是既有行为，不是这次或上几轮引入的。

所以 S36 改成**基线断言**（每个新会话 2 次）。它的作用不是「证明正确」，而是「拆 F 时别把这个数字改掉」——真有谁修好了重复，它会变红提醒更新基线。

重复本身单独立了 [#3](https://github.com/yugyq/dsh-composer-quill/issues/3)，里面记了已观测到的事实（同 sessionId、同空草稿、`force=true` 跳过两道闸门）与三个尚未定位的可能来源。

## 为什么不顺手修

F 还没动。如果现在改请求路径，又同时要重建 hook，两边一起变的时候「行为是否一致」就没有判据了。先固化现状，再搬机器，最后单独修重复——顺序不能反。

## 测试

```
单测  109
场景  39 → 41（S36 基线、S37 竞争）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [#3 重复请求](https://github.com/yugyq/dsh-composer-quill/issues/3) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
