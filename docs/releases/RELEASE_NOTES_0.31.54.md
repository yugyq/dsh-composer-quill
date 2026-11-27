# 0.31.54

四项：给续笔挑模型、挑思考强度，外加一个让 v4-pro 一句话也说不出来的坑。

## 一、可以给续笔单独指定模型（#4）

设置 → 续笔 → **模型**：跟随当前会话（默认，行为不变），或从 DSH 已配置的路由里挑一个。列表由宿主自己的注册表给出，不需要重填凭据。

会话跑高级模型、补全跑 Flash 这种搭配，现在可以了。

## 二、思考强度可调，默认关闭

设置 → 续笔 → **思考强度**：关闭（默认）/ 低 / 高 / 最高。

补全不需要深度思考，思考只会拖慢并烧预算。

## 三、v4-pro 选了之后什么都不出

现象：选了 deepseek-v4-pro，补写和建议全显示「无需补写」。

日志里原因很直白：

```
usage-call  model=deepseek-v4-pro  input=1052  output=384  reasoning=0
empty-reply mode=compose  maxTokens=384  finish=max-tokens
```

输出正好等于上限、`finish=max-tokens`、一个字没吐。384 个 token 全用在想，还没开口就撞墙——我们收到空回复，判成「没什么可改」。

`reasoning=0` 是假象：这个 provider 不单独上报思考 token，它们被算进 `output` 了。

现在每次调用都要 `reasoningEffort: off`；provider 不认这个字段就去掉重试；仍然空且撞上限，再用四倍预算试一次。

## 四、预算随档位缩放

档位一开始只是开关，预算没动，于是「高」和「最高」必然先撞墙一次——那次调用纯属浪费。

```
档位    next   compose  rewrite
off     384      384      768
low     576      576     1152
high    960      960     1920
max    1536     1536     3072
```

系数 1 / 1.5 / 2.5 / 4，封顶 4096。

## 测试

```
单测  132（三次全绿）
场景  55（两轮均首次通过，无抖动）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [协议](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PROTOCOL.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
