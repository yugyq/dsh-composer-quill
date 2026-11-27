# 续笔 0.31.19

续笔是 DSH 的输入框补全插件。一个回合结束后，它会猜你接下来想问什么；你打字停下来时，它把后半句接上。

![空输入框时的「下一句」建议](https://raw.githubusercontent.com/yugyq/dsh-composer-quill/main/docs/assets/real-next.png)

## 能做什么

回合结束后给出几条「下一句」，用左右方向键切换。

打字停顿一下，它就把后半句补出来；你继续打字，它跟着收窄到只剩最后几个字。

草稿里有错别字、标点不对，或者一句话塞了好几件事，它会给出整理后的整段，采用即替换。

你以前说过类似的话时，它直接从本地历史里匹配，不走模型，毫秒级返回。

## 这一版的改动

较长的建议以前会被切断，或者画到输入框外面，输入框在窗口底部时就完全看不见。现在它会换行，输入框临时长高最多两行；换行后的每一行都从左边开始，不再跟着光标缩进。建议继续变长时，输入框会再长高一些；实在放不下才用省略号结尾，按 `Tab` 采用的仍是完整内容。

![补写后的建议：深色是已输入的内容，浅色是接上的后半句](https://raw.githubusercontent.com/yugyq/dsh-composer-quill/main/docs/assets/real-tail.png)

另外，模型响应的上限从 500 token 提高到 1200。用推理模型时，思考过程可能把 500 用完，这一轮就什么建议都没有。

## 按键

`Tab` 采用当前建议；左右方向键切换候选；`Esc` 关掉这次的建议；`Ctrl+Shift+Space` 手动请求一条。

## 安装

```
dsh plugin --profile desktop add dsh-composer-quill
```

或从仓库安装：

```
dsh plugin --profile desktop add github:yugyq/dsh-composer-quill
```

安装后重启 DSH 生效。插件使用你已在 DSH 里配置好的模型，不需要另外填写密钥。

## 已知问题

宿主尚未加载会话内容时没有上下文，「下一句」和历史补全无从判断，补写仍然可用。

只写了一两个字的草稿缺少可续写的内容，结果多半是猜测。

建议最多显示三行，更长的部分会被省略，输入框本身也只长到那里。

单测 67 项、浏览器场景 32 项均通过，场景覆盖快速连打、停顿、取消、切换会话和长文本排版。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [架构](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/ARCHITECTURE.md) ｜ [协议](https://github.com/yugyq/dsh-composer-quill/blob/main/docs/PROTOCOL.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)

