# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## 项目概述

Breeze 漫画阅读器的第三方插件「包子漫画 Plus」。Breeze 插件运行在 **QuickJS-NG 沙箱**（非 Node/浏览器），打包成单文件 `.cjs` bundle 加载。基于 deretame/Breeze-plugin-baozimh 抓取链，增加去水印、预取缓存、繁简转换等功能。

## 常用命令

```bash
pnpm dev          # 开发服务器：rspack watch + HTTP(7878)，提供 bundle 和 /log 端点
pnpm build        # 生产构建：typecheck → 版本同步 → manifest → rspack → brotli
pnpm typecheck    # tsc --noEmit（调试期验证用这个，别跑 build——会和 dev server 抢 dist/）
```

- **调试期不要同时跑 `pnpm dev` 和 `pnpm build`**：两者都写 `dist/`，会互相覆盖导致 sha 错乱、宿主缓存冲突。
- 本地测试脚本在 `scripts/`（已 gitignore，含机器相关路径），验证 wm1 算法对齐 Python 参考实现。

## 架构

入口 `src/index.ts` → `export default` 导出 API 表（键名 = Breeze 调用的 fnPath）。

| 模块 | 职责 |
|------|------|
| `baozimh-core.ts` | 抓取链（搜索/详情/章节/阅读），HTML 解析用 cheerio；从 deretame 样例移植 |
| `watermark.ts` | wm1 去水印：高度预判 → jpeg 解码 → 模板匹配 → 裁切/占位 |
| `prefetch.ts` | 图片预取缓存（LRU cap 15，跨章节，并发异步去重） |
| `convert.ts` | 繁→简（宿主 bridge opencc，tw2s） |
| `index.ts` | 编排层：包装 core 函数，注入去重 + 预取上下文 + 繁简转换 |

**数据流**：`getReadSnapshot/getChapter` 返回页面列表 → `fetchImageBytes(url)` 下载图片（→ 去水印处理 → 返回字节）。预取层在后台并发下载后续页面。

**版本管理**：`src/get-info.ts` 的 `version` 字段是版本号唯一来源；`pnpm build` 的 `generate-version.ts` 会同步到 `package.json`。`manifest.json` 由构建自动生成（已 gitignore）。

## QuickJS-NG 沙箱硬约束（踩过的坑）

这些限制非显而易见，违反会导致 bundle 加载失败或功能不可用：

1. **无 WebAssembly** → Pyodide/ONNX/WASM 库全不可用，必须纯 TS。
2. **无 `**` 运算符** → 用 `Math.pow()`。swc `target: "es2019"` 会保留 `**`（ES2016），但 QJS 解析器不接受它，报 "expecting ';'"。
3. **无 Worker** → 不能多线程，并发只能用异步 I/O（Promise）。
4. **不要设 Breeze「调试日志地址」** → 宿主会给 bundle 包一层日志捕获代码，导致 QJS 解析/注册失败（expecting ';' / bundle not found）。需要日志时用插件内部 `fetch` 自报到 dev server `/log`。
5. **jpeg-js 解码极慢** → QJS 里 ~5s/页（V8 的 ~50 倍）。wm1 去水印需要解码，故**默认关闭**（设置开关「去除横幅水印」启用）。
6. **swc-loader `exclude: /node_modules/`** → 依赖的 JS 不被转译，原样进 bundle。注意依赖里的现代语法。

可用语法（实测）：async/await、对象展开 `{...x}`、optional catch `catch {}`、模板串、`for...of`。`??`/`?.` 会被 swc 降级。

## PR 规则

**一切 PR 都必须改版本号与 CHANGELOG：**

1. `src/get-info.ts` 的 `version` 字段 bump（x.y.z 语义化）
2. `CHANGELOG.md` 顶部新增 `# 版本号` 段落（`### Feat(<范围>):` / `### Fix:` 子段）
3. CI 发版时自动提取 CHANGELOG 对应版本段落作为 Release 正文；tag = 版本号，重复则跳过

## CI（.github/workflows/build-release.yml）

- **PR 到 main**：只跑 `pnpm build` 检查（不发版）
- **push 到 main**（PR 合并）：build → 读版本号 → tag 不存在则 `gh release create`（挂 bundle + manifest + .br）

## wm1 去水印算法（watermark.ts）

- **高度预判**（`readJpegHeight` 只读 JPEG 头）：h < 350 丢弃、350 ≤ h ≤ 1005 直通、h > 1005 全解码匹配
- **偏移匹配**（`detectSide`）：顶/底各试 5 格偏移取最小差（兼容略偏/略高如 202 的条带）
- **动态裁切**：h > 1200 时裁 h−1000（内容恒 ~1000），否则裁固定 200
- 模板（wm1.png 1280×200）转 JPEG base64 内嵌于 `src/wm1-template.ts`
