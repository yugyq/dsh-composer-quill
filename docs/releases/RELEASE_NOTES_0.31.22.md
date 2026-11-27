# 0.31.22

补写的 prompt 现在只有一份，与传输方式无关。

## 之前是什么样

同一个补写请求，走 SSE 和走 JSON，问模型的问题不一样：

| | SSE | JSON |
|---|---|---|
| 草稿 + 上下文 | 有 | 有 |
| conversation digest | 有 | 没有 |
| style profile | 有 | 没有 |
| 上一条助手回复 | 有 | 没有 |
| 跨语言翻译 | 有（指示用 `REWRITE:` 翻译） | 没有，只有一句「Write in Chinese」 |

还有一个更隐蔽的：JSON 侧算出了 `mustTranslateJson`，但从来没读过它；`languageName` 的三元把 `resolveLanguage` 返回的空串（`ja`、`de`、空 locale）折成了 `'Chinese'`，等于向模型谎称用户把语言设置成了中文。

结果是控制器换了传输方式，模型看到的问题就变了——同一段草稿，可能给出完全不同质量的建议。

## 现在

抽出 `composePrompt({ draft, context, digest, style, assistant, settingLanguage })`，两条路径都调它。顺带统一了两处仍然不一致的地方：

- **句兜底结果的 TTL**：SSE 缓存一天、JSON 只缓存 10 秒，同一个「已经挺好、只能加一句」的结果
- **回填上下文用的 focus**：SSE 按草稿挑旧行，JSON 按上一条助手回复挑，同一个会话会挑出不同的行

## 测试

单测 76 → 81，新增五项：完整内容（digest / style / 助手回复都在）、纯函数（同输入同输出）、未知语种不再谎称中文、跨语言走 `REWRITE:` 分支、超短草稿走「补完它」分支。浏览器场景 33/33 不变。

---

[#2 已关闭](https://github.com/yugyq/dsh-composer-quill/issues/2) ｜ [CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
