# 0.31.46

五件事，按性质分三段。

## 一、内部正确性（用户不可见）

**排期占位。** 打字防抖（120ms）与安全网轮询（1500ms）是两条独立时钟，之间只有两条软判据：`lastRequested`（请求真正发出后才写）和「屏幕上建议是否以草稿为前缀」。窗口期内安全网看不见已经排队的请求，就可能补发一次。

现在排期那一刻就写下 `compose|<草稿>` 占位（有效期 = 延迟 + 400ms），安全网先查它——这是事实，不是启发式。请求发出后清空，交给 900ms 的 `lastCall` 窗口接管。

顺带删掉 `request()` 开头一个空的 `if (mode === 'next') { }`，早前插诊断留下的。

## 二、两个能力拆成两个开关

`enabled` 拆为 `nextEnabled`（空输入框预测下一句）与 `composeEnabled`（打字时补写）。迁移：老的单一开关视为「两个都开」，旧键 `= '0'` 映射为两个都关。

`gateFor()` 新增 **G0**：模式自己的开关关了就停，日志里能看出是 G0。打字 / 重试 / 安全网只认 `composeEnabled`，回合边界与 `pendingNext` 只认 `nextEnabled`；两者都关才整块隐藏。

## 三、设置页重做 + `Alt+Tab` 出口

**独立分节。** 设置卡片从 `settings.general.item` 挪到 `settings.section`（`id: composer-quill`、`order: 30`、导航名走 `nav` 文案），并在 `settings.section.icon` 注册了一支羽毛笔图标。

`Ctrl+R` 后 `apply` beacon 的 `detail` 已带上 `"settings":"settings.section"`，导航里也确认排在最后。

**版式。** 原来一行横着堆六个控件，现在分五节：能力 / 行为 / 节奏 / 键盘 / 学习。标签在左、控件在右，数字框后面带 `ms`，整卡 `maxWidth: 520px`。开关统一换成 `role="switch"` + `aria-checked` 的按钮。

**`Alt+Tab`。** 保留 `Tab` 采纳，新增 `Alt+Tab` 不采纳、把焦点交还宿主。判定抽成纯函数 `isAcceptKey()`（只有裸 Tab 才采纳），只在设置页写明，状态行不加字。

## 测试

```
单测  110 → 114
场景  46 → 48
  S43  关掉补写后不再请求（打开后恢复）
  S44  Alt+Tab 不采纳
```

夹具修了两处：`setDraft` 之前只记录不改 DOM，导致「撤销是否生效」根本没法断言；`showSettings()` 重复挂载会在同一 host 上留下两棵 React 树，S43 因此改为直接写配置驱动。

## 一句更正

之前文档写着「客户端改动必须重启 DSH，刷新页面不够」。实测 `Ctrl+R` 就会重新读取软链目录里的 `client.js`，`apply` beacon 随即带上新字段。三处文档已改；判断在跑哪版别再只看 `build` —— 不抬版本号时新旧包报的是同一个字符串。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [键位方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_TAB_ESCAPE.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
