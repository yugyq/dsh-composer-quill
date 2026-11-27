# 0.31.30

E 组延后的两条。行为不变——这两条的验收标准就是「测试结果与改动前一致」。

## 请求头只有一份

`streamRoute` 与 `callRoute` 各自写了一遍「取 token → 拼 header → 带上 client 标记」，唯一差异是 SSE 那个 `accept`。现在合成 `requestHeaders(accept)`。

改动时踩到一个坑，记在这里：文件里还有第三份长得几乎一样的 header 代码，在 `report()` 里，那是给 beacon 用的、**刻意不带 token 之外的处理差异**。第一次改的时候把它一起替换了，单测立刻炸出来（beacon 上报会引用一个已删除的变量）。

## 两个长函数拆开

| 函数 | 之前 | 现在 | 拆出去的 |
|---|---|---|---|
| `produceCompose` | 145 行 | 117 行 | `composeShortDraft()` 31 行 |
| `computePrediction` | 148 行 | 125 行 | `computeShortPrediction()` 26 行 |

拆的是「两个字符的短草稿」那条分支：它有自己的完整语义（能补就补，不能就沉默），和后面的主流式路径没有共享状态。

中途也踩了一次：第一次替换时把 `if (长度 < MIN_TAIL_DRAFT_CHARS)` 这个条件丢了，于是所有补写都走了短草稿分支，回归测试里「模型说不需要改时回退到补一句」立刻变红。

## 组件侧

- `caretPlacement()` 从组件内部移到模块层，挨着 `caretAtEnd()`——它只依赖 `editorEl()`，组件里那些闭包变量一个都没用到
- 状态行从四层嵌套三元抽成 `renderStatusChip()`，待定 / 失败 / 建议 / 按键提示四态现在是四个 `if`

## 没做完的一条

**`GhostDock` 仍约 990 行。**

它的 30 多个 `useState` / `useRef` 与三条 effect 相互引用，按视觉区块切会让 props 线程穿过十几个值，还会切断 `accept` 和 `ghost` 之间的闭包关系。要拆得先补一层「dock 状态机」的抽象——那是独立的一轮工作，塞进这次结构清理只会把风险堆起来。这一条留着。

## 测试

单测 94、浏览器场景 39/39，与 0.31.29 完全一致。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
