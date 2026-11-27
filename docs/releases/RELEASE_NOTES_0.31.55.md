# 0.31.55

一处真 bug，一处日志改良，外加测试夹具的两项加固。

## 清空草稿后，底稿还留着

`clear()` 只把快照重置成 idle，模块级的流式暂存 `streamBase` / `acc` 原封不动。结果：把草稿清空之后，如果紧接着来一条结果，它会拼在**上一份草稿**上，屏幕出现「旧草稿 + 新尾巴」。

Esc、清空输入框、切换会话都会走 `clear()`，这条路径不算罕见。现在一并清掉。

## 历史补全的错误日志说不清是哪个会话

日志里 82 条 `history-error` 全是这样：

```json
{"event":"history-error","statusCode":409,"message":"Session is not live in this Host"}
```

`sessionId` 在 `try` 里声明，`catch` 里够不着，于是没有一条能指出是哪个会话——分不清「临时还没加载」和「这个会话永远加载不了」。现在带上了。

顺带把客户端的 409 重试从 6 次（700ms 起、最长 15s）减到 3 次（1s / 4s / 12s）。会变成 live 的会话一两秒就变了，多出来的三次几乎都是白问。

## 测试夹具

- 每个用例结束后重置 `effectQueue` 与存储，失败也重置
- 假 `fetch` 现在响应 `init.signal`，与真的一致

## 一个记着没解的

单测里有个跨用例的假失败：某个用例没等请求返回就结束，下一个用例会拼出「旧草稿 + 新尾巴」。

排除过路由重复设置、`effectQueue` 残留、在途请求写回、`clear()` 暂存泄漏——都不是。线上踩不到（通知回调都有 abort 门控，真 fetch 也随 abort 拒绝），所以不阻塞发布。排除表与「下一步该打印什么」记在 [dev/README.md](https://github.com/yugyq/dsh-composer-quill/blob/main/dev/README.md)。

## 测试

```
单测  132
场景  55
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
