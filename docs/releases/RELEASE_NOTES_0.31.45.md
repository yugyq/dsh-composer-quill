# 0.31.45

「没有需要改的地方」以前根本不显示。

## 原来是什么样

`phase === 'empty'` 时，`statusText` 与 `failureText` 都是空，状态行落到兜底分支——显示的是按键提示（`Tab 采纳 · Esc 关闭 · Ctrl+Shift+Space 手动`）。

也就是说这个结论**从未出现在屏幕上**。`docs/REQUEST_TRIGGERS.md` 里把它记成「两个结论之间没有过渡」，实际是第一个结论本身就不存在。

## 现在

```
已补写 · 无待改项
```

显示 **2.5 秒**，然后回到按键提示。

显示条件有两个，缺一不可：**同一会话**、**同一草稿**（`draftBase` 是去掉尾部空白的版本，与失败行用的是同一套判定）。否则切会话或改了字之后，旧的结论会挂在屏幕上。

判定顺序现在是：

```
pending → error → empty → undo → suggestion → hint
```

全部由 `statusChipKind()` 一处决定，单测锁住。

## 那种跳变为什么本来就少见

安全网对同一草稿不会重复发问——`pending.phase !== 'idle' && pending.forDraft === text` 就直接跳过，而 `empty` 也是非 idle。能造成 `empty → error` 的只有两种情况：**改了草稿**，或者**手动重试**。

## 不给「重试」按钮

按约定：`empty` 是正常结论，加按钮等于暗示它可疑。要强制再来一次按 `Ctrl+Shift+Space`——这个快捷键一直可用。

## 测试

```
单测  110
场景  45 → 46
  S42  断言它出现，且 2.7 秒后消失并回到按键提示
```

`test:ui:retry` 首次全绿。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
