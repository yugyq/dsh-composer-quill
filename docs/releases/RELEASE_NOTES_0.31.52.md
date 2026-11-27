# 0.31.52

修复「建议消失」。两个独立原因，各自都能单独让屏幕空着。

## 一、额度低于模型的实际输出

`next` 的实测输出是 166–254 tokens，而 0.31.51 里把上限压到了 **96**。回复在写出第一个候选之前就被截断，`next-empty` 记下 `rawLength=0`，界面上一片空白。

同一类请求相差 17 秒的两条日志，正好是改前改后：

```
09:25:44  next  out=96   → next-empty（rawLength=0）
09:26:09  next  out=196  → count=2
```

现在 `next` / `compose` 384、`rewrite` 768，都抬到实测峰值之上，仍远低于最初的 1200。

## 二、草稿分流写反了

原来 `>= 4` 字的草稿走的是短稿模板——那套模板只会「接一句」，不会改写。完整句子进去，模型无话可接，返回 `SKIP`，屏幕上什么都不显示。

现在按长度分流：

```
< 4 字        短稿模板（便宜，给不出就静默）
>= 4 字       主补写（能改写也能接尾巴）
              → 拿不到再走句尾兜底
```

## 附带：空回复可诊断

空回复现在单独记一行，带当时的额度与结束原因：

```json
{"event":"empty-reply","mode":"next","maxTokens":384,"finish":"length"}
```

下次「没建议」，从日志能直接分辨是额度不够，还是模型不愿答。

## 验证

```
单测  125（连跑三次，全绿）
场景  49/49（两轮，均第一次通过，无抖动）
探针  路由 / 请求数 / 重发 各跑两遍，逐项一致
```

真机日志里 `next` 已恢复出候选（`count=2`）。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [方案](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PLAN_TOKEN_BUDGET.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
