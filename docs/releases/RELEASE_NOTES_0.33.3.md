# 0.33.3 — 屏幕上剩下的那半句，也得能被 esc 关掉

issue #11 报了两件事：esc 清不掉残留的灰字；tab / esc / ctrl+shift+space 有时候整体失效。查下来是四条各自成立的缺口叠在一起——前两条让「清掉」根本没有发生，后两条让按键根本走不到插件。

## 四处行为变化

| 变化 | 改之前 | 改之后 |
| --- | --- | --- |
| 按 esc 的判据 | 只在「此刻屏幕上看得见建议」时才处理 | 「看得见」「还有层留在屏幕上」「还在等待或流式中」任一成立就处理 |
| 清理的范围 | 只清自己这个 dock 画的那一块 | 清完自己之后，扫掉文档里所有 `[data-composer-quill="layer"]` |
| 找哪个输入框 | `document.querySelector` 永远取第一个 | 焦点所在的 composer → 第一个有布局的 → 第一个 |
| 图层的数量 | 两个 dock 各画各的，谁也不管谁 | 每次真正绘制之前只留自己那一块 |

## 为什么会漏

`client/hooks.js` 的 esc 分支外面套着 `if (visible)`。残留灰字是上一个状态画上去的——按下那一刻 `visible` 恰好是假，于是连 `preventDefault` 都不做，按键谁也不管。

清理是分头做的：`ghost.clear(sessionId)` 在 store 属于别的会话时直接返回，`ghostLayer.clear()` 只拆自己的 host。被换掉的 dock 画下的那一层，两边都不认。全插件唯一能删别人节点的地方，只在 `mount()` 的一个循环里。

`editorEl()` 原来是 `document.querySelector('[data-composer-input]')`，永远第一个。`inEditor(document.activeElement)` 于是判定失败，插件的键盘处理整段失效，tab 退化成交给浏览器移焦点。

两个 dock 各有自己的图层，而 `render()` 在 host 仍然连着时不会重新挂载，所以没有任何东西要求「只留一块」。

## 两条约束

**清扫只能由活着的动作发起。** 第一版把清扫塞进 `layer.clear()`，结果被换掉的旧图层「再画一次」时顺手删掉了新图层的节点——S55 当场变红。现在只由 `mount()` 和 `dismissAll()` 发起。

**新场景不能插在中间。** S56–S58 最初放在 S6 之前，把后面 S48 的状态搅了：esc 之后 store 的 `sessionId` 变成 `null`，下一条 `next` 请求没有发起，S48 读到「切前为空」。它们现在排在场景列表最末尾，既有 67 条的执行顺序与相互状态原样保留。

## 新增的三条场景

| 场景 | 做法 | 判据 |
| --- | --- | --- |
| S56 | 在没有可见建议时插入一块残影，再按 esc | 残影 0、图层 ≤ 1 |
| S57 | 流式过程中插入第二块层，再打一个字 | 「再画之后」只剩 1；两个 dock 同时画也只留最新的那块 |
| S58 | 焦点放进第二个输入框，按 esc | 按键被接住、图层清零 |

三条都做过变异反证：把 esc 门控改回 `visible` → S56 红；去掉 `dismissAll` 里的 `sweep()` → S56 红；把 `editorEl()` 退回 `querySelector` → S58 红。

## 验证

- 单测 189（187 → 189：`pickEditor` 的六种输入、`closeOnEscape` 的六种状态）
- 浏览器场景 70/70（67 → 70）
- `npm run check:client` 通过
- 顺手删掉两处没有测试钉着的代码：`render()` 里的 `sweepOthers()`、以及被 `pickEditor` 等价覆盖的 `inAnyComposer`

## 升级

只改了浏览器端，`client.js` 重新拼接（九个源文件）。装好后按 `Ctrl+R` 即可，不必重启桌面应用。
