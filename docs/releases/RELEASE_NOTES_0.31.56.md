# 0.31.56

提示词里唯一会变的那块挪到最后，前缀缓存这才开始起作用。

## 问题

用户消息的第一块是草稿，而草稿每敲一个字就变。模型按**前缀**命中缓存，所以后面那一大段（transcript、digest、风格、助手上一句、语言指令）每次全部失效。

## 改法

把草稿挪到 user 消息的最后，前面保持稳定。**没有改任何规则措辞**，只换了顺序。短稿模板同样处理。

## 实测（真实模型，3 个场景 × 6 次连续调用）

```
                平均 prompt  命中率（首次后）  输入成本
短上下文  改前     901 tokens      14%         0.86 倍全价
          改后     901 tokens      76%         0.26 倍全价

长上下文  改前    1745 tokens      37%         0.63 倍全价
          改后    1745 tokens      88%         0.25 倍全价
```

命中价是未命中的 1/50，所以输入成本降了六七成。

## 延迟：没有改善

```
短上下文  首字延迟中位数  952 → 1049 ms
长上下文  首字延迟中位数  955 → 957 ms
```

这个量级下首字延迟由排队和网络决定（600–1500 ms 的抖动比 prefill 本身还大），900–1700 tokens 的 prefill 不是瓶颈。**这一版省的是钱，不是时间。**

## 以后的约定

往提示词里加东西，一律加在草稿**之前**。唯一的例外是草稿本身。

## 测试

```
单测  132
场景  55/55
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [测量工具](https://github.com/yugyq/dsh-composer-quill/blob/main/dev/measure-cache-latency.mjs) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
