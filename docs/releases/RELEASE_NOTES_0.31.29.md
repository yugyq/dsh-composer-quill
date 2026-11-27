# 0.31.29

可访问性三条。

## 播报不再逐帧

`role="status"` 里原来直接放「当前建议文本」。流式补写时这句话每来一个字就变一次，屏幕阅读器会被连续打断——读到一半就被下一句覆盖。

现在改成 **500ms 尾随播报**：内容稳定下来才说，一条完整补写只播报一次。说什么由新的纯函数 `describeAnnouncement()` 决定，优先级是「失败原因 → 落定的建议 → 补写中」。

实测一条完整流式补写，播报只变化 **2 次**（进入「补写中」一次，落定一次）。

## 设置控件有了名字

两个下拉框与两个数字框原来只有旁边的裸 `span`，无障碍树里就是「无名下拉框」。现在都带 `aria-label`（右上角的开关本来就有）。

## `Esc` 之后 `Tab` 交还宿主

这条行为本来就在：建议显示时 `Tab` 被采纳占用，按 `Esc` 关掉后 `Tab` 恢复宿主行为。

问题是**之前那条断言是假的**——它用 `dispatchEvent(new KeyboardEvent('keydown'))` 触发 `Tab`，而合成事件不会让浏览器移动焦点，所以无论代码怎样它都「通过」。现在改用真实按键（`page.keyboard.press`），焦点确实移出了输入框。

## 测试

```
单测  91 → 94   describeAnnouncement 三项
场景  36 → 39   S33 控件命名 / S34 播报次数 / S35 Esc 释放 Tab
```

`docs/DEVELOPMENT.md` 新增「可访问性」一节，写清哪三条有测试守着，以及**测试证明不了什么**：读屏器实际怎么念、念得对不对，只能人耳确认。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
