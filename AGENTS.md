# AGENTS.md

给在本仓库里动手的 agent 的硬规矩。背景与理由见 `docs/DEVELOPMENT.md`。

## 先查文档，再改代码

遇到「这不应该发生」的时刻，第一轮不要写代码：先查那个原语本身的语义——浏览器 API、框架生命周期、协议层的规定、别人踩过的同类坑。结论写进提交信息或 CHANGELOG 时带上出处，让「查过」和「猜的」能分辨。三个交过学费的例子在 `docs/DEVELOPMENT.md` 的 4.2 节（keepalive 丢请求、`useEffect` 里调 hook、迟到的帧属于谁）。

能测量就直接测量——本仓库大量结论来自日志与探针；但「语义层面的为什么」优先找文档，而不是改一版跑一遍去试。

## 改完必须重建

- 改 `client/`：`npm run build:client`，否则 `check:client` 会红（`client.js` 是九个源文件的拼接产物）。
- 改 `dev/harness/src.js`：`node dev/harness/build.mjs`，否则浏览器跑的还是旧 bundle——这会让「反正通过了」变成假象。

## 每个修复都要有能失败的证据

新增行为必须配一条会红的检查（单测或浏览器场景），并做一次变异反证：把修复改回去，那条检查必须变红。没有失败用例钉着的代码不留（`0.33.5` 里删掉的 `MutationObserver` 就是这么删的）。

## 发版

见 `docs/DEVELOPMENT.md` 第 5 节。推之前跑全量：`npm test`、`npm run test:ui`、`npx tsc -p tsconfig.json`、`npm run check:client`。只为测试改动不单独发版本号。
