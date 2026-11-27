# 0.31.28

结构整理，不改行为。这一轮的范围比最初列的窄——没做的两条也写在这里。

## 做了什么

**三个路由的 method + auth 合成 `preflight()`**

同一段样板在 `handlePredict`、`handleHistory`、`handleBeacon` 里各写一遍。代价不是假设的：beacon 那次就漏了 `finally`，0.31.25 才补上。现在一次写对，`/history` 的「只认 token」作为参数保留，各自的 trace 标签不变。

**`transcriptOf` 的去重口径统一**

`chosen` 集合里存的是 `row()` 处理后的文本（缩短、遮蔽），回填候选却拿原始文本去比——同一行可能以两种形态各进一次。现在先归一化再比较。

**内层 `size` 改名 `mergedSize`**

它和外层「字节预算」的 `size` 同名，读代码容易看串。

**客户端文件头注释改回事实**

还写着「`position: fixed` 层挂在 body 上」，而实际从 0.31.19 起就是嵌在输入框里的绝对定位层了。

**删掉 86 行尾部空行**

`client.js` 2604 → 2518 行。

## 没做的两条

**① `callRoute` / `streamRoute` 的请求头合并**

两处各 5 行，差异只有一个 `accept`。收益小于回归面——这两条是全部网络路径的入口，为省 5 行去动它不划算。

**② 拆 `GhostDock`（约 970 行）与 `produceCompose` / `computePrediction`（各 150 余行）**

真正的大手术，得在功能稳定期单独做一轮，不适合塞在结构清理里。

## 测试

单测 87 → 91，新增四项 preflight 断言：非 POST 回 405、无 token 回 401、带 token 放行、token-only 路由忽略头部捷径。浏览器场景 36/36 不变。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
