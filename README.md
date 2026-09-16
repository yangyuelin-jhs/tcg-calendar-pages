# TCG 商品与赛事日历

这是由本机 TCG 日历工作台导出的 GitHub Pages 静态站点。

- 页面入口：`index.html`
- 数据快照：`data/calendar.json`
- 本地生成目录：`D:\CodexOutputs\tcg-calendar-publish`

更新方式：在 `D:\CodexOutputs\tcg-calendar-center` 运行 `发布到GitHub.cmd`。

## 人工修改标题和标签

网页中点击名称旁的铅笔编辑标题；人工标题优先于抓取和翻译结果。网页版编辑需连接 GitHub，本机页面使用本机授权。

直接在仓库修改时，请切换到 `calendar-tags` 分支，编辑 `data/user-tags.json` 中对应记录的 `customTitle`（人工显示标题）或 `tags`（标签）。不要修改 main 分支的生成快照来保存人工标题。

保存后其他页面每 1–2 分钟同步，也可点击页面的同步按钮立即更新。本地服务启动时自动同步；电脑关机不影响公开网页读取。只有主动恢复抓取标题或清空 customTitle 才取消人工标题。