# 包子漫画 Plus

[![release](https://img.shields.io/github/v/release/Enigma-Soul/Breeze-plugin-baozimh-plus?label=release)](https://github.com/Enigma-Soul/Breeze-plugin-baozimh-plus/releases)
[![Breeze](https://img.shields.io/badge/for-Breeze-blue)](https://github.com/deretame/Breeze)

[Breeze](https://github.com/deretame/Breeze) 漫画阅读器的第三方插件。基于 [deretame/Breeze-plugin-baozimh](https://github.com/deretame/Breeze-plugin-baozimh) 的抓取链,增加**翻页预读缓存**,以及经 **Komga 兼容协议**接入自建 [baozimh-proxy](https://github.com/Enigma-Soul/baozimh-proxy) 的代理模式。

## 功能

- **翻页预读** — 阅读时后台预取后续页面,翻页直接命中(LRU 缓存,跨章节并发补齐;QuickJS-NG 无 Worker,并发靠异步 I/O)
- **包子漫画代理** — 经 Komga 兼容协议访问自建 baozimh-proxy,叠加去水印 / 繁简 / 空白页修复 / 异步预读
- **章节去重** — 章节内重复页按 URL 去重(保留最早出现)

## 包子漫画代理模式

> [!NOTE]
> 代理模式需要你自建并运行 [baozimh-proxy](https://github.com/Enigma-Soul/baozimh-proxy) 服务。

在插件设置里把「数据来源」切到 `Enigma-Soul/baozimh-proxy`,填上代理服务器地址(支持 IPv6,如 `http://[::1]:8787`),阅读时即经 Komga 协议从你的 proxy 取数。proxy 在阅读器与 baozimh.com 之间插入一层本地反代,叠加:

| 能力 | 说明 |
|------|------|
| 去水印 | wm1 条带裁切 + wm2/3 角标 LaMa 修复 |
| 繁简转换 | OpenCC `tw2s` |
| 空白页修复 | CDN 错误页重试 + 1px 过渡色兜底,保持页码连续 |
| 异步加速 | 并发回源 + 后台预读下一章 + LRU 缓存 |

代理模式下插件不再做跨章预取(proxy 自带预读覆盖),仅做章内预取缓存加速翻页。

## 安装

> [!TIP]
> 收录到 [Breeze-plugin-list](https://github.com/deretame/Breeze-plugin-list) 后,可在 Breeze 内直接搜索安装;在此之前用下面的网络安装。

在 Breeze「网络安装」里填入 bundle 地址:

```
https://github.com/Enigma-Soul/Breeze-plugin-baozimh-plus/releases/latest/download/baozimh-plus.bundle.cjs
```

## 配置

打开插件设置页:

- **数据来源** — `包子漫画官网`(直连抓取)/ `Enigma-Soul/baozimh-proxy`(代理)
- **代理服务器地址** — 代理模式用,如 `http://192.168.1.100:8787`;IPv6 用 `http://[::1]:8787`
- **测试代理连接** — 点击调用 proxy `/healthz` 验证可达(失败会抛错提示)

## 开发

需要 Node.js 与 [pnpm](https://pnpm.io)。

```bash
pnpm install
pnpm dev        # dev server:rspack watch + HTTP :7878,在 Breeze「网络安装」加载其 bundle 地址即可热更新调试
pnpm build      # 生产构建:typecheck → 同步版本 → 生成 manifest → rspack → brotli
pnpm typecheck  # 仅类型检查
```

> [!WARNING]
> 调试期不要同时跑 `pnpm dev` 和 `pnpm build`——两者都写 `dist/`,会互相覆盖。

## 架构

入口 `src/index.ts` 导出 API 表(键名 = Breeze 调用的 fnPath),按「数据来源」分发到直连或代理客户端。

| 模块 | 职责 |
|------|------|
| `baozimh-core.ts` | 直连抓取链(搜索 / 详情 / 章节 / 阅读),cheerio 解析 HTML |
| `komga-client.ts` | Komga 协议客户端(代理模式) |
| `source-config.ts` | 数据源模式 + 代理 baseUrl 存储 |
| `prefetch.ts` | 图片预取缓存(LRU cap 15,跨章并发去重) |
| `index.ts` | 编排层:分发、去重、预取上下文 |

> [!IMPORTANT]
> 插件运行在 **QuickJS-NG 沙箱**(非 Node / 浏览器),打包成单文件 `.cjs` bundle。硬约束:无 WebAssembly、无 `**` 运算符(用 `Math.pow`)、无 Worker(并发只能异步 I/O),必须纯 TS。

版本号唯一来源是 `src/get-info.ts` 的 `version` 字段;`pnpm build` 会同步到 `package.json` 与 `manifest.json`。改版本后须本地 build 一并提交 `manifest.json`(CI 会校验漂移)。

## 致谢

- 抓取链移植自 [deretame/Breeze-plugin-baozimh](https://github.com/deretame/Breeze-plugin-baozimh)
- 代理模式接入 [Enigma-Soul/baozimh-proxy](https://github.com/Enigma-Soul/baozimh-proxy)
- 运行在 [deretame/Breeze](https://github.com/deretame/Breeze) 阅读器

---

> 仅供个人学习使用,请遵守目标站点规则与版权。
