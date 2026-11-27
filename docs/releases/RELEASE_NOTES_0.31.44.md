# 0.31.44

两项「出错之后的抓手」：采纳可撤销、失败可重试。

## 采纳可撤销

采纳成功后，状态行变成 `已采纳 · 撤销`。点击或回车 → 草稿回到采纳前。**8 秒后**、**用户再输入任何字符**、**切换会话**，任一发生即消失。

撤销优先走**原生撤销栈**：

```js
if (offer.path === 'insert') {
  try { document.execCommand('undo') } catch {}
  if (domDraft() === offer.before) return finish()
}
```

`insertText` 写进去的内容本就在栈上，让编辑器自己回退最干净。走完比对一次草稿，若没回到原样（或本来就是 `setDraft` 写入的——它不在栈上），用记住的草稿 `setDraft` 兜底。**两条路都不成时保留按钮**，不做假撤销。

撤销后会清 `lastRequested`。它记的是「最近一次真正发出请求的草稿」，采纳时被设成采纳后的文本；撤销让草稿回到采纳前，清空它，安全网才会为撤销后的草稿重新取建议。

## 失败可重试

`dock-error` 从只读 `span` 变成按钮：

```
建议失败：model call failed · 重试
```

点击对当前草稿重新发一次 `compose`，`force=true` 跳过 900ms 去重与「store 已有结果」两道闸门——用户明确要求重来。但仍受启用状态、409 退避、回合进行中三道约束。

点击同时清 `retriedFor`：否则「手动重试又失败」之后，自动重试的额度已经被第一次失败用掉，行为会显得忽好忽坏。回合进行中按钮禁用。

## 状态行的顺序被写死了

抽了纯函数 `statusChipKind()`：

```
pending → error → undo → suggestion → hint
```

一条断言锁住五个分支。之前这顺序散在四层嵌套三元里，加一个状态就得重新读一遍。

## 测试

```
单测  109 → 110
场景  41 → 45
  S38  采纳后出现「撤销」，点击后草稿回到采纳前
  S39  采纳后再打字，撤销入口消失且不回退用户写的字
  S40  失败行是 BUTTON，点击后 compose 1→2
  S41  连点两次只多发一次（compose 2→3）
```

## 顺带修了夹具

harness 的 `setDraft` 原来只记录、不改 DOM——这让「撤销到底有没有生效」根本无法断言（S38 第一次跑就是绿的假象）。现在它会真的替换编辑器内容；改完后 41 条旧场景仍全绿。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [方案文档](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_UNDO_AND_RETRY.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
