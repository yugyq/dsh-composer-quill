# 0.31.27

仓库与包的卫生，没有行为改动。

## 包体小了四分之一

```
之前  21 个文件   327.7 KB
现在  19 个文件   249.7 KB
```

省下的 78 KB 来自两张旧截图——`composer.png` 与 `plugin-row.png`，那是改界面之前拍的，`screenshots.json` 一直指向它们。现在清单指向 README 用的同一组四张图：

- `real-tail`（补写）
- `real-next`（空输入框的下一句）
- `real-rewrite`（错字改写）
- `real-history`（历史补全）

## 清掉的东西

- `.github/RELEASE_DRAFT.md` —— 0.31.5 的发布草稿，早已发布，里面还链着已删除的截图
- 11 个一次性脚本与快照：`dev/_probe2.py`、`dev/fit_probe.py`、`dev/quality-*.json` 之类，都是当时为某一次排查写的

## 两处更正

**① 0.19.0 / 0.20.0 / 0.21.0 并不缺记录**

我先前把它们列进「CHANGELOG 缺条目」，其实是把 tag 名和 `###` 条目逐字比对造成的误判——旧版本是按 minor 分节记录的（`## 0.20.0`），这四者里只有 **0.30.1** 真的没有条目，已补。

**② `v0.31.2` 不是误建**

它指向 `chore: follow the account rename to yugyq`，是 npm 自动发布之前手工打的标签，同批还有 0.14 到 0.31.1。保持原样。

## 文档对齐

`dev/README.md` 与 `docs/DEVELOPMENT.md` 里删掉了已不存在的 `quality_probe.py`，场景数从 22 改成 36——那个数字停在几个月前。

## 测试

单测 87、浏览器场景 36/36，均无变化。

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
