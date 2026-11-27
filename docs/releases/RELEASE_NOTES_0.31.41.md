# 0.31.41

场景套件有了重试，而且**重试本身会记账**——不记的话，抖动就变成了「重跑一下就好了」的自我安慰。

## 用法

```bash
npm run test:ui:retry                              # 最多 2 次，阈值 3
python dev/verify_with_retry.py --attempts 3 --threshold 2
```

## 判定规则

| 情况 | 退出码 | 输出 |
|---|---|---|
| 任何一次全绿 | 0 | 途中红的那几条记为「抖动」 |
| 每次都红 | 1 | 末尾打印最后一次输出的尾部 |
| 某场景累计抖动 ≥ 阈值 | 同上 | 单独列出「已经不是偶发」，并指向记账文件 |

## 账本

`dev/flake-ledger.json`，已 gitignore：

```json
{
  "runs": 3,
  "flakes": { "S32 灰字上报不再逐帧": 2 }
}
```

**只记次数、不记时间戳**——它要回答的是「这条到底抖了几次」，不是「什么时候抖的」。后者会诱使人去翻时间线，前者才会逼人去看那条断言本身是不是写得太紧（比如 S32 之前的 `≤ 4`）。

## 重试逻辑自己是验证过的

用桩脚本跑了三轮：

```
第 1 轮  1/2 → 2/2   抖动 · 抖动场景 第 1 次
第 2 轮  1/2 → 2/2   抖动 · 抖动场景 第 2 次  ⚠ 累计已达阈值
第 3 轮  1/2 → 2/2   ⚠ 以下场景反复抖动：抖动场景 累计 3 次
账本     {"runs": 3, "flakes": {"抖动场景": 3}}
```

不验证的话，这段代码最容易出的错是「第一次红也被当成失败」或「账本永远不涨」——两种都会让人误判。

## 严格模式保留

`npm run test:ui` 仍是跑一次、红就是红。重试入口是日常开发用的，避免每次都被同一条时序问题打断；发版前的最后一遍建议用严格模式。

## 测试

```
单测  109
场景  41/41
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [DEVELOPMENT](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/DEVELOPMENT.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
