# 0.31.35

第 5 步收口：`dismissedDraft` 与 `switchDraft` 并进 `dockReducer`。

## 记账从三个字段变成五个

| 字段 | 含义 |
|---|---|
| `painted` / `covered` | 这条建议是否已经画过 / 是否仍覆盖当前草稿 |
| `hadDraft` | 这个输入框里打过字 |
| `dismissed` | 用户按 `Esc` 关掉的是哪份草稿 |
| `switched` | 正在等待结算的会话切换 |

动作加了四个：`dismissed` / `undismissed` / `switch-started` / `switch-settled`。

旧的 `dismissedDraft` 与 `switchDraft` 两个 ref 已删除，19 处读写全部改走 reducer。

## 一个容易做错的区别

「清空输入框」和「回合结束」原来都会写 `hadDraft = false`，看起来是同一件事。但它们**不能合并**：

```
清空输入框  → 清掉 dismissed + hadDraft   （用户主动抹掉，重新开始）
回合结束    → 只清 hadDraft              （用户按过 Esc 的那份草稿，此刻依然拒绝）
```

如果顺手让「回合结束」也清 `dismissed`，那么用户按 `Esc` 拒绝过的建议会在每次回合结束后重新弹出来——这正是他按 `Esc` 想避免的。

所以两个动作分开：`cleared`（只清 typed）与 `composer-empty`（两个都清）。有单测守着这条区别。

## 测试

```
单测  106 → 109
  · 一次拒绝属于一份草稿，输入别的不会解除
  · 清空时两个标志一起清，但回合结束不碰 dismissed
  · 切换只结算一次
场景  39/39（连跑两次）
```

发布时 `git push main` 撞了一次 TLS EOF（今天第三次），重试即成功；tag 推送与 npm 发布未受影响。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
