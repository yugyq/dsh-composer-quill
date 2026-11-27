# 0.31.25

三处日志噪音与资源清理，都是内部质量问题——用户不会直接看到，但它们决定了出问题时还能不能查。

## 灰字上报逐帧刷屏

`paint` beacon 的触发键里带了提案正文。流式补写时正文每来一个字就变一次，于是**一次打字几十个 POST、几十行日志**，`detail` 里还写着提案前 60 字——那是用户草稿的续写。

现在键只看结构（`kind | forDraft | anchor`），正文改成只上报长度。同一条场景实测从「每帧一次」降到 **4 次**。

## beacon 处理器没有 `finally`

每个 beacon 请求都会留下一个 30 秒定时器和一个 `close` 监听器。另外读超时会被报成「body 不是合法 JSON」——原因明明是超时。

现在补上了清理，并把「被中止」和「body 非法」分开：中止只记一条 `beacon-error`，不再回 400。

## `sessionId` 没截断

同一个 `trace` 里其它字段都截了（`event` 40、`keys` 200、`detail` 400、`build` 40），只有 `sessionId` 原样透传——48 KB 的 body 能写出一行 48 KB 的日志。

## 测试

场景 35 → 36，新增 S32：一次流式补写的 `paint` 上报不超过 4 次、不带正文、带长度。单测 83 项不变。

> 顺带说明：场景套件在机器负载高时会偶发 1–2 条超时（S6、S20 见过），重跑即过。这类 flaky 已记在待办里，尚未处理。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
