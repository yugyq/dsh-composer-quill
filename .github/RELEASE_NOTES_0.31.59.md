# 0.31.59

两个画笔侧加固，来自 [#5](https://github.com/yugyq/dsh-composer-quill/issues/5) 的报告。

## 画笔不该跨会话

`useGhostPaint` 拿不到 `sessionId`，所以切换会话本身从不会让图层失效——它只依赖 `visible` 翻面、或者 `dismissAll()` 被走到。报告里那条「上一个会话的灰字留在新输入框原点」正是这条路。

现在画笔记住自己上次画的是哪个会话，变了就先清图层再说。

## box 锚点不再只信 `draftEmpty`

宿主在 props 里说「草稿为空」时，那个借来的 Lexical 编辑器可能还显示着上一个会话的正文。只信 props 就会把灰字画在那段文字上面。现在锚点判断会先读一次编辑器，确认真的是空的。

## 两条场景守着

| 场景 | 断言 |
| --- | --- |
| S48 | 有灰字时切会话，120ms 后灰字必须为空 |
| S49 | 建议已画上后往编辑器里塞文字，灰字必须消失 |

## 顺带

S48 最初放在套件末尾，跑出来是假失败：`showSettings()` 会另起一个 React root，之后 `setSession` 不再生效（已知夹具缺陷）。移到设置类场景之前就好了。

## 测试

```
单测  136
场景  57/57
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [issue #5](https://github.com/yugyq/dsh-composer-quill/issues/5) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
