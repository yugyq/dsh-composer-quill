# 0.31.40

[#3](https://github.com/yugyq/dsh-composer-quill/issues/3)「切入新会话时发出两次 next 请求」——**不是重复请求，是夹具的测量错误。**

## 打标方式把 history 算成了 next

harness 里这样记每个请求：

```js
mode: body.mode ?? (url.includes('beacon') ? 'beacon' : 'next')
```

`/history` 的请求体里没有 `mode`，于是落进了 `next` 那一支。每个新会话实际发出的是「一次 next + 一次 history 读取」，却被记成两次 next。

## 两处埋点都指向同一结论

为了定位，我先后在 `request()` 入口和 `nextJson()` 入口埋了诊断：

```
nextJson 调用：  s-second  mode=next kind=next draft=""
网络 next：      s-second
                 s-second      ← 其中一条其实是 /history
```

`nextJson` 每个新会话只走一次。插件在这条路径上没有重复。

## 改了什么

| 位置 | 改动 |
|---|---|
| `dev/harness/src.js` | `/history` 记为 `history`，不再冒充 `next` |
| S36 | 从「基线 2」改成「期望 1」，并额外断言每个新会话恰有一次 history 读取 |
| `client.js` | 两处临时诊断已全部移除（与 0.31.39 相比无行为差异） |

S36 现在的输出：

```
每个新会话的 next 次数={s-second: 1, s-third: 1}
history 读取={s-second: 1, s-third: 1}
```

## 教训

上一轮我把「2 次」当成了产品缺陷，写成基线断言并附上三个猜测的来源。真去埋点才发现：**那两条里有一条根本不是 next**。

夹具的错误会被当成产品行为固化下来——所以这种「看起来像 bug 的测量结果」，必须先埋点确认，再决定是修产品还是修夹具。这条写进了 issue 的关闭说明。

## 测试

```
单测  109
场景  41/41（连跑两次）
```

---

[#3 关闭说明](https://github.com/yugyq/dsh-composer-quill/issues/3) ｜ [CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
