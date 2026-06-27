# 变更记录

> 每个版本一个 `# 版本号` 段落，下设 `### Feat(<范围>):` / `### Fix:` 子段。
> CI 发版时自动提取对应版本段落作为 GitHub Release 正文。

# 0.3.0

### Fix:
- 移除去水印功能（wm1 横幅裁切）：QuickJS-NG 沙箱里 jpeg 解码 ~5s/页，收益不抵代价。删除 `watermark.ts` / `wm1-template.ts`、`jpeg-js` 依赖与「去除横幅水印」设置项
- 清理无用文件：删除 `types/runtime-api.ts`、`types/runtime-api.typecheck.ts`（上游模板遗留，全项目未引用）

# 0.2.0

### Feat(去水印):
- wm1 横幅裁切：顶/底条带与模板匹配（带偏移容差，兼容略偏/略高如 202 的条带）；h>1200 时按内容高（h−1000）裁切
- 高度预判：仅 h>1005 的页全解码匹配，正常页直接跳过——规避 QuickJS-NG 沙箱里 jpeg 解码 ~5s/页的代价
- 纯白/损坏页与极小图（h<350）占位处理
- **默认关闭**（QJS 解码慢，设置里「去除横幅水印」开关启用）；纯 TS 无 WASM

### Feat(预取):
- 阅读时预取缓存后续页面，翻页直接命中（LRU，上限 15 张）
- 跨章节：本章剩余不足时续预取下一章开头
- 并发异步 I/O 预取（QuickJS-NG 无 Worker）

### Feat(繁简):
- 繁体转简体（宿主 bridge 内置 opencc，tw2s 台湾繁→简）：标题/章节名/作者/简介等
- 设置开关（默认开），结果缓存

### Feat(体验):
- 章节内重复页按 URL 去重（保留最早出现）

### Feat(基础):
- 基于 deretame/Breeze-plugin-baozimh 的完整抓取链（搜索/详情/章节/阅读）
- CI：PR 构建 + 合并 main 自动发版（tag = 版本号，正文读 CHANGELOG）
