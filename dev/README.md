## 已查清：跨用例的「旧草稿 + 新尾巴」

现象是 `trailing newline` 那条断言拿到 `items=["帮我把这段日志，请附上完整日志。"]`——草稿前缀来自别的用例，尾巴是本用例的流式返回。

**根因：等待条件写错了。**

```js
for (let i = 0; i < 40; i += 1) {
  await wait(50)
  if (face.ghost.getSnapshot().phase === 'ready') break   // ← 太松
}
```

`phase === 'ready'` 说明「store 里有东西」，不说明「是本用例的东西」。前面几个用例的请求还在陆续到达，其中一个先把 store 写成 ready，循环立刻 break，随后断言读到的就是那条遗留结果。

现在等的是自己的会话：

```js
const now = face.ghost.getSnapshot()
if (now.phase === 'ready' && now.sessionId === 's-nl') break
```

并加了一条 `assert.equal(snapshot.sessionId, 's-nl')`，下次再串台会直接说是谁的。

排查时逐个排除过：`__predictRoute` 重复设置（否，两个版本都是 `set`）、`effectQueue` 残留（清成 0 照样失败）、在途请求写回（让假 fetch 认 `init.signal` 后照样失败）、`clear()` 暂存泄漏（已补，仍失败）。真正定位靠的是把 `streamStart` 入参打出来——日志里能看到 `s-chip`、`s-inflight` 这两个**更早的**会话在断言之前依次开会话。

教训：测试里「等到某个状态」要等到**属于本次的那个状态**，光看状态名不够。

## 前缀缓存的结论

dev/probes/cache-probe.mjs 与 dev/probes/verify-cache.mjs 用真实模型量过：**同内容、只换顺序**，命中率差别极大。

\\n布局                      prompt  命中  未命中
草稿在前（改前）             814     0    814
草稿在后（改后）             817   512    305
\\n
改后第一次仍为 0（缓存冷），之后每次命中 512；用真实 builder 复测 5 次，第一次之后命中率 67%。

规则：**唯一会变的那块（草稿）永远放最后**，前面保持稳定。以后往提示词里加东西，加在草稿之前。

## 提示词 A/B 的结论

dev/probes/ab-prompt.mjs 用真实模型跑过一轮（每档 3 次 × 5 个场景）：

| 改动 | 结论 |
| --- | --- |
| ① 规则去重 | **回退**。两轮独立采样里，去重版在 Case 正确率与「带具体主语」上都低于经典版 |
| ④ 数据块用统一抬头 + 短标签 | 保留。语义相同，省 ~100 字符，实测中性 |
| ② 删掉下一句的少样本例子 | 不做。有例子/无例子各 3 次，都是 3 条有效中文候选，看不出差别 |
| ③ 长度改成从风格档案取 | 不做。与「该翻译时没翻译」的错误同时出现 |
| ⑤ 加「别复述助手上一句」 | 不做。复述率没有下降 |

样本只有 15 次/档，**噪声很大**：同一变体两次跑，空回复率一次 20% 一次 0%。所以只回退了方向一致的那一项。

## 探针

三个小工具，用来在**不连真机**的情况下看清行为。它们不是测试，不会进 CI。

| 文件 | 看什么 |
| --- | --- |
| `probe-compose-calls.mjs` | 用脚本化的 `ctx.llm` 驱动真实的 `produceCompose`：一次补写发几次调用、每次的输出上限、提示词多大 |
| `probe-short-draft.mjs` | 同上，但带一段 15 轮的长对话，覆盖 2/3/4/10 字草稿与尾巴/改写/SKIP 三种回答 |
| `probe_client_requests.py` | 在夹具里数一次打字停顿到底发几次请求（不是宿主内部重发） |
| `probe_retrigger.py` | 三条重发路径：建议出现后再打字、模型说无改动后静置、首次失败后的自动重试 |

```bash
node dev/probes/probe-short-draft.mjs
python dev/probes/probe_client_requests.py
```

用处：上一轮「建议消失」就是 `probe-short-draft.mjs` 里 2 字草稿走错路径暴露出来的。

# dev/ — 开发与验证工具

这个目录**不随插件发布**（`package.json` 的 `files` 未包含它），只用于本地开发与验证。

```
dev/
├── harness/          浏览器模拟器：在真实 DOM 里跑 client.js，不发任何网络请求
│   ├── src.js        模拟器本体（假 DSH：composer 结构、假 fetch、演示脚本）
│   ├── index.html    承载页面（加载 bundle.js）
│   ├── bundle.js     构建产物（.gitignore 忽略，需本地构建）
│   └── package.json  react / react-dom / esbuild
├── tools/            build-client.mjs（client/ → client.js）、日志汇总、账本重建
├── probes/           一次性探针：真实模型或模拟器，不连 CI
├── verify/           Playwright：verify_daily.py（模拟器场景）、真机脚本、重试器
└── audit/            对抗性审计脚本
```

## 模拟器

```powershell
cd dev/harness
npm install                      # 首次：react / react-dom / esbuild
node node_modules/esbuild/bin/esbuild src.js --bundle --format=iife --target=chrome120 --outfile=bundle.js

cd ..
npm run test:ui                  # 64 个场景，全绿即通过（或 python dev/verify/verify_daily.py）
```

模拟器页面通过 `file://` 打开，`src.js` 里 `await import('../../client.js')` 直接引用**插件产物**；`client.js` 由 `client/` 源文件拼接生成（仓库根 `npm run build:client`），所以既改 `client/` 又改 `client.js` 之后都要重新构建 bundle，否则跑的是旧代码（这是本仓库最容易踩的坑）。

页面暴露的调试接口：`window.__harness`（`type` / `typeLive` / `key` / `press` / `rec` / `snapshot` / `store` / `accept` / `setComposeMode` / `setSession`）。

## 真机脚本

都需要一个运行中的实例 URL（`dsh web: http://127.0.0.1:PORT/?token=…`）：

```powershell
python dev/verify/verify_fresh_start.py "http://127.0.0.1:PORT/?token=…"
python dev/verify/verify_emptyline.py  "http://127.0.0.1:PORT/?token=…"
```

| 脚本 | 验证点 |
| --- | --- |
| `verify_daily.py` | 64 个行为场景（模拟器，不需要实例） |
| `verify_harness.py` | 模拟器自身的冒烟检查 |
| `verify_fresh_start.py` | 刚启动时状态行可用、不卡「补写中」 |
| `verify_emptyline.py` | 空行（`<br>` 之后）灰字锚点 |
| `verify_align*.py` | 灰字与正文行盒的像素对齐 |
| `verify_caret_geom.py` | 光标几何测量 |
| `verify_clear_rearm.py` | 采纳后清空是否重新弹出 |
| `verify_reuse_reload.py` | 刷新后是否复用已存建议（0 请求） |
| `verify_no_storm.py` / `verify_covered.py` | 请求次数（无取消风暴 / 覆盖区间零调用） |
| `verify_single_char.py` | 单字草稿即触发 |
| `verify_word_real.py` | Tab 整条采纳 |
| `verify_after_turn.py` | 回合结束后出现「下一句」 |
| `verify_dock_persist.py` | 状态行常驻与高度一致 |
| `verify_settings_ui.py` | 设置卡片渲染与持久化 |
| `verify_stream_real.py` / `verify_stream_repaint.py` | 流式首字延迟 / 灰字随流增长 |
| `verify_history_*.py` | 历史补全（真实会话 / 指定会话） |
| `verify_review_real.py` | 审查后的综合回归 |

脚本都会在结束时打印 PASS/FAIL 并截图（PNG 落在仓库根目录，已被 `.gitignore` 排除）。
