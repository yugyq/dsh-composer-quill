# 0.31.23

光标停在句子中间时按 `Tab`，建议的后半句会被插进句子内部。这条修好了（[#1](https://github.com/yugyq/dsh-composer-quill/issues/1)）。

## 为什么会插错位置

建议的「尾巴」是按整段草稿的末尾算出来的，而插入走的是宿主的 `insertText`，插在当前光标处。两者只在光标位于末尾时才是同一个位置——光标停在句中时，尾巴就落进了句子里面。

## 现在怎么判断

采纳前先看光标在哪：

- **末尾**（后面没有字）→ 照旧插入，不加任何额外操作
- **句中** → 整段替换成「原草稿 + 尾巴」，原句一个字都不动，只是后面接上了建议
- **量不出来**（例如没有 selection）→ 当作末尾处理

第三条是刻意的：判断失误最多退化成修复前的行为，不会让 `Tab` 完全失效。

## 顺带修的一处测试

场景里有两处 `accept(true)`，那个参数其实是 `shiftKey`。Shift+Tab 从 0.31.21 起不再采纳建议，继续用 `true` 表达「能够采纳」是错的，改成 `accept()`。

## 测试

浏览器场景 33 → 34，新增 S30：把光标停在句中按 `Tab`，断言必须整段替换、且 `insertText` 没有被调用过——也就是尾巴**不可能**出现在句子中间。单测 81 项不变。

---

[#1 已关闭](https://github.com/yugyq/dsh-composer-quill/issues/1) ｜ [CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
