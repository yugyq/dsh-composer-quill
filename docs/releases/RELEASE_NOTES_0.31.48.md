# 0.31.48

把「按某个键离开输入框」整个撤掉。

## 为什么撤

两轮实测都失败了：

```
Alt+Tab   Windows 窗口管理器截获
Ctrl+Tab  Chromium 当标签切换吃掉
```

三次尝试里有两次是猜的。更要紧的是方法错了：**「夹具里能过」不能当作真机证据**——Playwright 通过 CDP 注入按键，绕过了操作系统，所以它看到的一直是 Trusted 事件。

## 这件事本身也不值得

建议可见时按 `Esc` 关掉，`Tab` 就回到宿主手里——这是 0.31.21 起就有的行为。为了一个边缘场景再引入一个组合键，性价比不成立。

## 撤掉了什么

| 内容 | 处理 |
|---|---|
| 设置页那行键盘说明 | 删掉，含 `settings.keyboard` 中英文案 |
| README 两处介绍 | 回退到「先按 `Esc` 关掉建议」 |
| `docs/PLAN_TAB_ESCAPE.md` | 删除 |
| 场景 S44 | 删除 |

## 保留了什么

`isAcceptKey()` 还在：只有裸 `Tab` 才采纳，任何修饰键都不拦截。它是既有行为的守门人（`Shift+Tab` 一直交还宿主），不是这次新加的东西。

## 测试

```
单测  114
场景  47（S44 移除）
```

---

[CHANGELOG](https://github.com/yugyq/dsh-composer-quill/blob/main/CHANGELOG.md) ｜ [npm](https://www.npmjs.com/package/dsh-composer-quill)
