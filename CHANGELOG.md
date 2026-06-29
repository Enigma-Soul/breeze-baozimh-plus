# 变更记录

> 每个版本一个 `# 版本号` 段落，下设 `### Feat(<范围>):` / `### Fix:` 子段。
> CI 发版时自动提取对应版本段落作为 GitHub Release 正文。

# 0.5.1

### Chore(繁简):
- 移除插件内置繁体→简体转换：删除 `convert.ts` 与设置项「繁体转简体」（标题 / 章节名 / 作者 / 简介的 t2s）。繁简现统一由自建 baozimh-proxy 在代理模式处理；直连模式不再做繁简，精简宿主 opencc 依赖与插件体积

# 0.5.0

### Feat(proxy):
- 新增「包子漫画代理」数据源：经 Komga 兼容协议访问自建 baozimh-proxy（叠加去水印 / 繁简 / 空白页修复 / 预读）
- 设置页新增：数据来源切换（直接抓取 / 包子漫画代理，select）、代理服务器地址输入（text，支持 IPv6 `http://[::1]:8787`）、测试代理连接按钮（调 `/healthz`）
- Komga 模式跳过插件繁简（proxy 已 t2s）、禁跨章预取（proxy 自身预读覆盖）；图片下载复用现有预取链

# 0.4.1

### Docs:
- CLAUDE.md 固化分支流转硬约束：main 只能由 CI ff 推送，严禁手动改 main（否则制造分叉，`git push HEAD:main` non-fast-forward 失败、发版卡死）；补充分支保护配置指引（develop status check 选 `build`；main 不开 Require PR/Restrict）

### Chore(ci):
- 升级 actions 到 Node 24 runtime：actions/checkout@v7、setup-node@v6、pnpm/action-setup@v6（消除 Node.js 20 deprecation warning）

# 0.4.0

### Feat(ci):
- 分支流转工作流：`feat/* → develop（强制 PR、禁强推）→ main（仅 CI ff 推送）`。CI 触发改为 PR/push 到 develop：PR 阶段 build + manifest 漂移校验；push（合并后）build → `git push origin HEAD:main` fast-forward 推送 → 发版
- manifest.json 纳入版本控制（移出 .gitignore）：使 Breeze-plugin-list 收录脚本可读取默认分支根目录 `HEAD:manifest.json`，打通收录链路

### Chore:
- 仓库改名 `breeze-baozimh-plus → Breeze-plugin-baozimh-plus`（符合收录命名规范 `Breeze-plugin-*`），同步 home/updateUrl

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
