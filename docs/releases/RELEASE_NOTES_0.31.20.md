# 0.31.20

两个安全问题，代码审查发现的，不是运行中出的事故。都在宿主侧，升级后即时生效。

## 一、`/predict` 的免 token 分支挡不住 DNS rebinding

`authorized()` 除了校验 token，还给了一条「证明自己是同源浏览器」的捷径：只要带 `x-composer-quill-client: 1`、`sec-fetch-site: same-origin`、JSON 内容类型，就放行。当时的设计认为这些头能挡住跨站请求。

挡不住 rebinding。被 rebind 的页面本身就来自那个主机名，浏览器认为它是同源，`sec-fetch-site` 会诚实地写下 `same-origin`，自定义头也不需要预检。于是任意本机进程、以及被 rebind 的页面，都能在不带 token 的情况下调用 `/predict`，消耗你的模型额度；如果知道 `sessionId`，还能拿到带着会话上下文的建议。

现在这条捷径额外要求 `Host` 落在 `127.x` / `localhost` / `[::1]`。rebinding 之后 `Host` 仍然是攻击者的域名，因此被拦下。带 token 的请求完全不受影响；`/history` 本来就只认 token，没有变化。

## 二、摘要路径没做遮蔽

`transcriptOf` 的每一行都过了 `maskSecrets`，但另外两条路径漏了：

- `sessionDigest()`——最近三条用户消息和开场请求，原样缩短后拼进 prompt
- `lastAssistantText()`——上一条助手回复，同样原样

结果是：你最近粘贴过密钥的那条消息，在摘要里会以明文发给模型，而同一段文字在 transcript 里是被替换成 `[redacted …]` 的。README 里那句「上下文出机器前先遮蔽凭据」在实现上不成立。两处现在都过了同一套遮蔽。

## 影响范围

- 需要攻击者已经能在你的机器上运行进程，或者能在浏览器里打开一个由他自己控制的页面——不是公网可达的漏洞
- 会话历史接口一直只认 token，因此历史内容没有暴露
- 诊断日志从来只写在本机 `~/.dsh/`

## 升级

```bash
dsh plugin --profile desktop add dsh-composer-quill@0.31.20
```

或者直接装 npm 上的最新版。装完重启 DSH，不是刷新页面。

## 其他

单测从 67 增到 72，新增的 5 项分别守着这两处：rebinding 的 `Host` 拦截、loopback 放行、`isLoopbackHost` 的四种写法，以及摘要与助手回复的遮蔽。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
