# 项目约定

这些约定仅适用于 `beergame-solo`，不安装或修改用户级 skill、设置或其他项目。

## 界面

使用本仓库提供的 taste skill：
- `../taste/.agents/skills/minimalist-ui/SKILL.md`
- `../taste/.agents/skills/redesign-existing-projects/SKILL.md`

以 minimalist-ui 的简约要求为准：暖白、深灰、少量淡绿；无渐变、重阴影、远程字体或 emoji。沿用原生 HTML / CSS / JavaScript，保证离线直接打开可玩。窄屏仅在全景图和表格内部滚动，页面不能横向溢出。

## 游戏逻辑

AI 只能使用本节点已经到达的需求、自身库存、缺货、运输在途和已订未发账本。不能读取未来需求或其他节点的隐蔽库存。需求展示、AI 观察和发货共用 `currentDemand` 的提前期定义。不得强制最低订货量、重复计入缺货或漏记已订未发的货。

逻辑改动运行 `node tests/run-all.js`，AI 改动同时运行 `node tests/ai-regression.test.js`。界面改动运行 `node tests/check-upgrade.js`，查看生成的桌面及窄屏截图。
