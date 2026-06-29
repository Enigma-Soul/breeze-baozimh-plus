// 包子漫画 Plus —— 插件入口
//
// 在 deretame/Breeze-plugin-baozimh 抓取链基础上：
//   阅读时预取缓存后续页面（cap 15，跨章节并发补齐；QJS 无 Worker）

import {
  fetchBytes,
  getChapter as coreGetChapter,
  getComicDetail as coreGetComicDetail,
  getPages as fetchChapterImageUrls,
  getReadSnapshot as coreGetReadSnapshot,
  searchComic as coreSearchComic,
} from "./baozimh-core";
import {
  komgaGetChapter,
  komgaGetComicDetail,
  komgaGetReadSnapshot,
  komgaSearch,
} from "./komga-client";
import {
  getProxyBaseUrl,
  getSourceMode,
  setProxyBaseUrl,
  setSourceMode,
} from "./source-config";
import { PLUGIN_ID } from "./common";
import { buildPluginInfo } from "./get-info";
import {
  configureFetcher,
  getOrFetch,
  prefetchAhead,
  setChapterContext,
} from "./prefetch";
import type {
  CapabilitiesBundleContract,
  ChapterContentContract,
  ChapterPage,
  ChapterPayload,
  ComicDetailContract,
  FetchImageBytesPayload,
  InfoContract,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  SearchComicPayload,
  SearchResultContract,
  SettingsBundleContract,
} from "../types/type";

// 设置字段变更回调的入参（字段 key + 新值）
type SettingsChange = { key?: string; value?: unknown };

async function getInfo(): Promise<InfoContract> {
  return buildPluginInfo();
}

/** 下载图片：供当前页（直接 await）与预取层（并发）共用 */
function downloadBytes(
  url: string,
): Promise<Uint8Array<ArrayBufferLike>> {
  return fetchBytes(url, {
    headers: { "x-rquickjs-host-offload-binary-v1": "1" },
    signal: AbortSignal.timeout(30000),
  });
}

// 把下载器注入预取层（预取与正式读取共用同一套下载）
configureFetcher(downloadBytes);

// ---------------------------------------------------------------------------
// 章节上下文 + 去重（供预取层跨章预取）
// ---------------------------------------------------------------------------

function pickNextChapterId(res: {
  data?: { chapter?: { id?: string }; chapters?: Array<{ id: string }> };
}): string | null {
  const nav = res?.data?.chapters;
  const curId = res?.data?.chapter?.id;
  if (!Array.isArray(nav) || !curId) return null;
  const i = nav.findIndex((c) => c.id === curId);
  if (i < 0 || i + 1 >= nav.length) return null;
  return nav[i + 1]!.id;
}

function applyChapterContext(
  res:
    | {
        data?: {
          chapter?: { id?: string; pages?: ChapterPage[] };
          chapters?: Array<{ id: string }>;
        };
      }
    | undefined,
  disableCrossChapter = false,
): void {
  const pages = res?.data?.chapter?.pages;
  const urls = Array.isArray(pages) ? pages.map((p) => p.url) : [];
  // Komga 模式禁跨章预取（proxy 自身有滑动窗口预读）；章内预取仍基于 urls 生效
  const nextId = disableCrossChapter ? null : pickNextChapterId(res ?? {});
  setChapterContext(urls, nextId, fetchChapterImageUrls);
}

/** 章节内页面按 URL 去重：保留最早出现，删除后续重复 */
function dedupeChapterPages(
  res: { data?: { chapter?: { pages?: ChapterPage[] } } } | undefined,
): void {
  const ch = res?.data?.chapter;
  if (!ch || !Array.isArray(ch.pages)) return;
  const seen = new Set<string>();
  const out: ChapterPage[] = [];
  for (const p of ch.pages) {
    const u = typeof p?.url === "string" ? p.url : "";
    if (!u || seen.has(u)) continue; // 空 url 或重复 → 跳过（保留最早）
    seen.add(u);
    out.push(p);
  }
  ch.pages = out;
}

// ---------------------------------------------------------------------------
// API（包装 core：去重 + 预取上下文；按数据来源分发直连 / 代理）
// ---------------------------------------------------------------------------

function isProxyMode(): boolean {
  return getSourceMode() === "proxy";
}

function searchComic(
  payload: SearchComicPayload,
): Promise<SearchResultContract> {
  return isProxyMode() ? komgaSearch(payload) : coreSearchComic(payload);
}

function getComicDetail(payload: {
  comicId?: string;
}): Promise<ComicDetailContract> {
  return isProxyMode()
    ? komgaGetComicDetail(payload)
    : coreGetComicDetail(payload);
}

async function getReadSnapshot(
  payload: ReadSnapshotPayload,
): Promise<ReadSnapshotContract> {
  const proxy = isProxyMode();
  const res = proxy
    ? await komgaGetReadSnapshot(payload)
    : await coreGetReadSnapshot(payload);
  dedupeChapterPages(res);
  applyChapterContext(res, proxy);
  return res;
}

async function getChapter(payload: ChapterPayload): Promise<ChapterContentContract> {
  const proxy = isProxyMode();
  const res = proxy ? await komgaGetChapter(payload) : await coreGetChapter(payload);
  dedupeChapterPages(res);
  applyChapterContext(res, proxy);
  return res;
}

/**
 * 下载图片；优先命中预取缓存，未命中则下载并触发后续预取。
 * 缓存/预取层异常时降级为直接下载，绝不中断阅读。
 */
async function fetchImageBytes({
  url = "",
}: FetchImageBytesPayload = {}): Promise<Uint8Array<ArrayBufferLike>> {
  const targetUrl = String(url).trim();
  if (!targetUrl) throw new Error("url 不能为空");
  try {
    const bytes = await getOrFetch(targetUrl);
    prefetchAhead(targetUrl); // 非阻塞：并发预取后续页（跨章节）
    return bytes;
  } catch {
    const bytes = await downloadBytes(targetUrl); // 兜底
    prefetchAhead(targetUrl);
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function onSourceModeChanged(
  payload: SettingsChange,
): Promise<Record<string, unknown>> {
  if (payload.key === "source.mode") {
    setSourceMode(payload.value === "proxy" ? "proxy" : "direct");
  }
  return {};
}

async function onProxyBaseUrlChanged(
  payload: SettingsChange,
): Promise<Record<string, unknown>> {
  if (payload.key === "proxy.baseUrl") setProxyBaseUrl(String(payload.value ?? ""));
  return {};
}

/** 测试代理连接：调 proxy /healthz；失败抛错（最大化可见），成功返回状态摘要 */
async function onTestProxyConnection(): Promise<Record<string, unknown>> {
  const base = getProxyBaseUrl();
  if (!base) throw new Error("请先填写代理服务器地址");
  const res = await fetch(`${base}/healthz`, {
    signal: AbortSignal.timeout(5000),
  }).catch((e: unknown) => {
    throw new Error(`无法连接代理 ${base}：${String((e as Error)?.message ?? e)}`);
  });
  if (!res.ok) throw new Error(`代理响应异常 ${res.status}：${base}`);
  let info: { status?: string; lama_ready?: boolean; t2s_enabled?: boolean } = {};
  try {
    info = (await res.json()) as typeof info;
  } catch {
    /* 非 JSON 忽略 */
  }
  if (info.status !== "ok") throw new Error(`代理状态异常：${base}`);
  return {
    ok: true,
    message: `连接正常（去水印：${info.lama_ready ? "就绪" : "降级"}，繁简：${info.t2s_enabled ? "开" : "关"}）`,
  };
}

async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          title: "数据来源",
          fields: [
            {
              key: "source.mode",
              kind: "select",
              label: "数据来源",
              fnPath: "onSourceModeChanged",
              options: [
                { label: "包子漫画官网", value: "direct" },
                { label: "Enigma-Soul/baozimh-proxy", value: "proxy" },
              ],
            },
            {
              key: "proxy.baseUrl",
              kind: "text",
              label: "代理服务器地址（http://IP:8787，IPv6 用 http://[::1]:8787）",
              fnPath: "onProxyBaseUrlChanged",
            },
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      values: {
        "source.mode": getSourceMode(),
        "proxy.baseUrl": getProxyBaseUrl(),
      },
    },
  };
}

async function getCapabilitiesBundle(): Promise<CapabilitiesBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "capabilities",
      actions: [
        {
          key: "testProxy",
          title: "测试代理连接",
          fnPath: "onTestProxyConnection",
        },
      ],
    },
    data: {},
  };
}

export default {
  getInfo,
  searchComic,
  getComicDetail,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,
  getSettingsBundle,
  getCapabilitiesBundle,
  onSourceModeChanged,
  onProxyBaseUrlChanged,
  onTestProxyConnection,
};
