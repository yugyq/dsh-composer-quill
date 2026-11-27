# 0.31.47

把 `Alt+Tab` 换成 `Ctrl+Tab`。

## 为什么

`Alt+Tab` 在 Windows 上由系统窗口管理器截获，**根本到不了页面**。

0.31.46 当初的依据来自夹具：Playwright 通过 CDP 直接注入按键，绕过了操作系统，所以看到的是 Trusted 事件。那份证据恰好证明不了它想证明的事——它证明了「代码不采纳 Alt+Tab」，没证明「用户按得出来」。

## 代码没动

`isAcceptKey()` 的判定一直是「任何修饰键 + Tab 都不采纳」：

```js
return event.shiftKey !== true && event.altKey !== true
    && event.ctrlKey !== true && event.metaKey !== true
```

所以 `Ctrl+Tab` 与 `Shift+Tab` 本来就不会被采纳、焦点会交还宿主。缺的只是把这件事说对。

## 改的是说明与测试

| 位置 | 现在写的 |
|---|---|
| 设置页 | `Tab 采纳；Ctrl+Tab 或 Shift+Tab 不采纳，把焦点交还宿主` |
| README | 原来写「先按 Esc 关掉建议」，改成两个方向的出口 |
| S44 | 按 `Control+Tab` 与 `Shift+Tab` 各一次，断言草稿不变、`inserted` / `setDraft` 均未调用 |

```
S44 Ctrl+Tab / Shift+Tab 不采纳  草稿 '这段日志' 未变: Control+Tab='这段日志' / Shift+Tab='这段日志'
```

规划文档 `docs/PLAN_TAB_ESCAPE.md` 里记下了这次判断失误的由来：**夹具里的 Trusted 按键不能当平台证据**。

## 测试

```
单测  114
场景  48/48
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [键位方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_TAB_ESCAPE.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
