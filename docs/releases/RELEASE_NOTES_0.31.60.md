# 0.31.60

来自 [#6](https://github.com/yugyq/dsh-composer-quill/issues/6) 的两个 bug 加一处目录漂移。

## 热重载后所有路由 401

路由 token 原本在 `apply()` 里生成。插件被就地重装、更新、启用或禁用都会重新 apply 一次，token 随之更换；而 Desktop 的页面拿的是 Host 启动时收集的那份注入表，`Ctrl+R` 也只会把旧 token 再发一遍。于是换完插件，每个请求都是 401，直到整个应用重启。

现在 token **按进程生成一次**，存在 `process` 上：同一个进程里 apply 多少次都是同一个 token，重启才换新的——正好和 Desktop 重新收集注入表的时机一致。

**没有顺手放宽 `authorized()`。** 报告建议把「缺少 `sec-fetch-site`」当作同源，但本机进程同样能写那个自定义头，浏览器自己的 Fetch Metadata 才是区分「页面」和「本地进程」的东西。这条规则有测试钉着，保留。

## 自定义 provider 上补写恒失败

模型条目没有声明 `reasoningEfforts` 时，`dsh-llm` 会拒绝显式传入的强度：

```
provider "p" model "m" does not support reasoning effort "off"
```

这个拒绝**不是抛出的异常**，而是被 `adapterFailureChunk` 转成终结帧 `{ type: 'finish', reason: { kind: 'error', failure } }`。原来的重试只包住了会抛的那条路径，所以永远不触发——报告里的日志正是 21 次 `compose-stream-error`、0 次 `reasoning-off-rejected`。

现在按 `failure.code === 'UNSUPPORTED_REASONING_EFFORT'` 识别，摘掉强度重试一次，并记一行 `reasoning-off-rejected`。

## 状态目录在两次启动间漂移

没有环境变量时曾直接落到家目录，而文档写的是 `~/.dsh`——日志和缓存被劈成两处。现在优先用已存在的 `~/.dsh`。

## 测试

```
单测  141（新增三条）
场景  57/57
```

新增的三条：终结帧拒绝后仍能拿到正文；token 不随 apply 变化；没有浏览器信号时即使带自定义头也拒绝。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [issue #6](https://github.com/yugyq/dsh-composer-quill/issues/6) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
