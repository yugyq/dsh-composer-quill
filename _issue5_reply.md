## 已修复，0.31.59

先说结论：你诊断的每一步都对，包括 `dismissAll()` 被跳过那条——**它在 0.31.58 里已经发布了**（`4631a35`，2026-11-26 14:30）。你写报告时 npm 上还是 0.31.56，所以装上 0.31.58 就能消掉主症状。

你提的两条「修复没覆盖」的加固，这一版也做了。

### ① 画笔现在有会话身份

`useGhostPaint` 拿不到 `sessionId`，因此切换会话本身从不会让图层失效——它只依赖 `visible` 翻面或 `dismissAll()` 被走到。现在它带上了：

```js
const paintedSession = React.useRef(sessionId)
React.useEffect(() => {
  if (paintedSession.current !== sessionId) {
    paintedSession.current = sessionId
    ghostLayer.clear()
    return undefined
  }
  …
}, [visible, ghost, ghostLayer, sessionId])
```

**先清图层，再考虑画**——不再依赖「`visible` 会不会翻面」这个前提。

### ② box 锚点不再只信 `draftEmpty`

你说得对：宿主那个 prop 在自己的状态里说「空」，而那个借来的 Lexical 编辑器可能还显示着上一个会话的正文。现在锚点判断前先读一次编辑器本身：

```js
const editorEmpty = (() => {
  const editor = editorEl()
  if (editor === null) return true
  const text = typeof editor.value === 'string' ? editor.value : (editor.textContent ?? '')
  return text.trim() === ''
})()
if (data.nextActive && editorEmpty) { /* 才画 box */ }
```

代价是每帧多一次 `textContent` 读取——paint 已经由 rAF 合帧，且只在有建议时跑，可以接受。

### 两条场景守着

| 场景 | 断言 |
| --- | --- |
| S48 | 有灰字时切会话，**120ms 后**灰字为空（不等 300ms、不等下一个渲染） |
| S49 | 建议已画上后，直接往编辑器里塞文字并触发重绘，灰字必须消失 |

S48 一开始放在 suite 末尾，跑出来是假失败：`showSettings()` 会另起一个 React root，之后的 `setSession` 不再生效。移到设置类场景之前就好了——这条也记在 `dev/README` 的已知夹具缺陷里。

```
单测  136
场景  57/57（新增两条）
```

如果你手上的版本仍是 0.31.56，先升到 0.31.58 即可；0.31.59 补的是上面两条加固。
