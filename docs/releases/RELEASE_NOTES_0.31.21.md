# 0.31.21

一次全面审查之后修掉的六处行为缺陷。都不是崩溃，但会让人用着觉得"它怎么又跑偏了"。

## 修了什么

**旧话题又冒出来** —— 相关性回填把旧行追加在 transcript 末尾。`NEXT_RULES` 告诉模型"按时间排序、最后两轮最重"，于是第 22 轮的内容被当成刚刚发生。现在每行记住自己的事件下标，按出现顺序排回去。

**JSON 语法被写进消息** —— 模型偶尔回 `{"text": "…"}`，冒号后没有空格的写法会绕过所有检查，按 Tab 就原样拼进草稿。现在先按整条消息解包，解不出就丢弃。

**半截 JSON 当成候选** —— 模型输出被截断时，`parseCandidates` 会退化成按行读，把 `{"candidates":["…` 这行原样显示成建议。现在以 `{` / `[` 开头但解析失败的一律作废。

**模型挂了却说"无需修改"** —— 单飞等待者拿到的是被吞掉的异常，缓存为空就发 `done{reason:'unchanged'}`。现在发 `error`，并记一条 `compose-stream-error`。

**缓存键里有明文草稿** —— 键会落到 `composer-quill-cache.json`（24 小时），粘过密钥就等于明文落盘。现在键用遮蔽后的草稿。

**Shift+Tab 被当成采纳** —— 只排除了 Alt/Ctrl/Meta，键盘用户按 Shift+Tab 无法反向离开输入框。现在直接放行给宿主。

## 测试

单测 72 → 76，浏览器场景 32 → 33。新增的四条守着上面四处宿主修复，S29 守 Shift+Tab。

## 仍然没修

光标停在句子中间时按 `Tab`，建议的后半句会被插进句子内部。修法试过又回滚了——守卫会让既有场景行为变化。已单独记录在 [#1](https://github.com/yugyq/dsh-composer-quill/issues/1)。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
