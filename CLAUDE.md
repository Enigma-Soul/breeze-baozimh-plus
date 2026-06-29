# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## 项目概述

Breeze 漫画阅读器的第三方插件「包子漫画 Plus」。Breeze 插件运行在 **QuickJS-NG 沙箱**（非 Node/浏览器），打包成单文件 `.cjs` bundle 加载。基于 deretame/Breeze-plugin-baozimh 抓取链，增加预取缓存等功能。

## 常用命令

```bash
pnpm dev          # 开发服务器：rspack watch + HTTP(7878)，提供 bundle 和 /log 端点
pnpm build        # 生产构建：typecheck → 版本同步 → manifest → rspack → brotli
pnpm typecheck    # tsc --noEmit（调试期验证用这个，别跑 build——会和 dev server 抢 dist/）
```

- **调试期不要同时跑 `pnpm dev` 和 `pnpm build`**：两者都写 `dist/`，会互相覆盖导致 sha 错乱、宿主缓存冲突。
- 本地测试脚本在 `scripts/`（已 gitignore，含机器相关路径），验证预取逻辑。

## 架构

入口 `src/index.ts` → `export default` 导出 API 表（键名 = Breeze 调用的 fnPath）。

| 模块 | 职责 |
|------|------|
| `baozimh-core.ts` | 抓取链（搜索/详情/章节/阅读），HTML 解析用 cheerio；从 deretame 样例移植 |
| `prefetch.ts` | 图片预取缓存（LRU cap 15，跨章节，并发异步去重） |
| `index.ts` | 编排层：包装 core 函数，注入去重 + 预取上下文 |

**数据流**：`getReadSnapshot/getChapter` 返回页面列表 → `fetchImageBytes(url)` 下载图片。预取层在后台并发下载后续页面。

**版本管理**：`src/get-info.ts` 的 `version` 字段是版本号唯一来源；`pnpm build` 的 `generate-version.ts` 会同步到 `package.json`。`manifest.json` 由构建自动生成，**已纳入版本控制**（Breeze-plugin-list 收录脚本读取默认分支根目录 `HEAD:manifest.json`）；改 `src/get-info.ts` 后必须本地 `pnpm build` 同步 `manifest.json` 一并提交，CI 会校验漂移。

## QuickJS-NG 沙箱硬约束（踩过的坑）

这些限制非显而易见，违反会导致 bundle 加载失败或功能不可用：

1. **无 WebAssembly** → Pyodide/ONNX/WASM 库全不可用，必须纯 TS。
2. **无 `**` 运算符** → 用 `Math.pow()`。swc `target: "es2019"` 会保留 `**`（ES2016），但 QJS 解析器不接受它，报 "expecting ';'"。
3. **无 Worker** → 不能多线程，并发只能用异步 I/O（Promise）。
4. **不要设 Breeze「调试日志地址」** → 宿主会给 bundle 包一层日志捕获代码，导致 QJS 解析/注册失败（expecting ';' / bundle not found）。需要日志时用插件内部 `fetch` 自报到 dev server `/log`。
5. **swc-loader `exclude: /node_modules/`** → 依赖的 JS 不被转译，原样进 bundle。注意依赖里的现代语法。

可用语法（实测）：async/await、对象展开 `{...x}`、optional catch `catch {}`、模板串、`for...of`。`??`/`?.` 会被 swc 降级。

## PR 规则

**分支模型**：`feat/* → develop（强制 PR、禁强推）→ main（仅 CI ff 推送，禁人工直推）`。所有更新新建 `feat/*` 分支提 PR 到 develop；develop 合并后 CI 自动 fast-forward 推送到 main 并发版。禁止直接推 develop / main。

**一切 PR 都必须改版本号与 CHANGELOG：**

1. `src/get-info.ts` 的 `version` 字段 bump（x.y.z 语义化）
2. `CHANGELOG.md` 顶部新增 `# 版本号` 段落（`### Feat(<范围>):` / `### Fix:` 子段）
3. CI 发版时自动提取 CHANGELOG 对应版本段落作为 Release 正文；tag = 版本号，重复则跳过

## CI（.github/workflows/build-release.yml）

- **PR 到 develop**：`pnpm build` + manifest 漂移校验（get-info.ts 与 manifest.json 不同步则 fail）
- **push 到 develop**（feat PR 合并）：build → fast-forward 推 `develop → main`（`git push origin HEAD:main`，用 `GITHUB_TOKEN`）→ tag 不存在则 `gh release create`（挂 bundle + manifest + .br）

> main 由 CI 推送，不走 PR。`GITHUB_TOKEN` 推送不递归触发 workflow，故推 main 与发版在同一 job 内完成。分支保护：develop 可严格保护（强制 PR + 禁强推）；main 因 `github-actions[bot]` 无法进入 restrict/bypass 列表，GITHUB_TOKEN 方案下只能弱保护（靠「develop 受控 + main=develop ff」保证来源），GitHub 层硬约束「只 CI 推 main」需改用 App token。**先合并首个 PR 让 CI 跑通 ff 推 main，再加保护规则**，否则 bot 推不动会卡死。
>
> **⚠️ 硬约束：main 只能由 CI 的 ff 推送更新，严禁任何人工 commit / 强推 / 绕过 CI 的推送。** main 一旦出现 develop 之外的 commit（如 merge commit），就不再是 develop 后代，CI 的 `git push HEAD:main` 会因 non-fast-forward 失败、发版链卡死（历史教训：早期 PR→main 的 merge commit 曾致此，靠 force 对齐才修复）。所有内容一律走 `feat/* → develop`。
>
> **分支保护配置（手动在 GitHub UI）**：develop — Require PR + status check 选 `build` + 禁强推（protected 默认生效）；main — **不要**开 Require PR / Restrict pushes（否则 GITHUB_TOKEN 推不动），实质靠「仓库仅你 + 仅 CI 推 main + main=develop ff」约定保护。develop 保护随时可加；main 保持弱保护。要 GitHub 层硬约束「只 CI 推 main」，改用 Repository Ruleset 的 bypass list 挂 GitHub App + CI 换 App token。
