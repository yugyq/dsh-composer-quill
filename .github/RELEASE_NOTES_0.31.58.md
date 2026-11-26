# 0.31.58

用量账本不再会被清零。这是 0.31.57 引入的回归——发现时，它已经吃掉了一台机器上的 364 次记录。

## 出了什么事

0.31.57 把四个状态文件统一到「跟着 `DSH_HOME` 走」，但**两个进程可以各读各的目录、写同一个计数器**：一个在环境变量设好之前启动、读到空账本，另一个读到完整账本。谁最后 flush，谁覆盖。

```
原账本   364 次
被覆盖   5 次
恢复后   299 次（从 live 日志重建）
找不回   65 次（在 usage-call 埋点之前，日志里没有痕迹）
```

## 现在的三道闸门

**① 写入前先看盘上有什么。** `flushUsage` 读一遍目标文件，如果它的 `lifetime.calls` 比内存里的大，就不写，改为把盘上的合并进内存，并记一行 `usage-ledger-kept`。

**② 加载时合并所有可能的位置。** 状态目录、`DSH_HOME`、`DSH_PROFILE_DIR`、家目录、家目录下的 `.dsh`，逐个读，按字段取较大值。

**③ 合并出更多历史就立刻落盘**，否则多出来的那部分只活在内存里，下一次崩溃又会丢。

顺带修掉一个同类问题：环境变量**设成空字符串**时被当成目录，`join('', name)` 会写到进程的工作目录去。现在空值按「没有设置」处理。

## 如果你已经被 0.31.57 影响

升级并重启后，插件会自动合并能找到的最大账本。若面板上的数字仍比预期小，用 live 日志重建：

```bash
node dev/rebuild-usage.mjs          # 试算
node dev/rebuild-usage.mjs --write  # 写入（会先备份）
```

它只统计真实模型名，会跳过测试套件写进日志的那些假模型。

## 测试

```
单测  136（三次全绿，新增「小账本不能覆盖大账本」）
场景  55/55（三轮，零抖动）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [重建工具](https://github.com/yugyq/dsh-composer-quill/blob/main/dev/rebuild-usage.mjs) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
