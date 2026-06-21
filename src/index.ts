// 包子漫画 Plus —— 插件入口
//
// 在 deretame/Breeze-plugin-baozimh 抓取链基础上：
//   1. fetchImageBytes 下载图片后去水印（wm1 横幅裁切 + 空白/极小图处理，纯 TS）
//   2. 阅读时预取缓存后续页面（cap 15，跨章节并发补齐；QJS 无 Worker）
//   3. 繁体→简体（宿主 bridge opencc，tw2s）：标题/章节名/作者/简介等

import {
  fetchBytes,
  getChapter as coreGetChapter,
  getComicDetail as coreGetComicDetail,
  getPages as fetchChapterImageUrls,
  getReadSnapshot as coreGetReadSnapshot,
  searchComic as coreSearchComic,
} from "./baozimh-core";
import { isSimplified, setSimplified, t2s } from "./convert";
import { PLUGIN_ID } from "./common";
import { buildPluginInfo } from "./get-info";
import {
  clearCache,
  configureFetcher,
  getOrFetch,
  prefetchAhead,
  setChapterContext,
} from "./prefetch";
import { processImageBytes } from "./watermark";
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

// 去水印开关（默认关：QJS 里 jpeg 解码 ~5s/页，关掉保证流畅；需要时手动开）
let watermarkEnabled = false;

// 设置字段变更回调的入参（字段 key + 新值）
type SettingsChange = { key?: string; value?: unknown };

async function getInfo(): Promise<InfoContract> {
  return buildPluginInfo();
}

/** 下载并去水印：供当前页（直接 await）与预取层（并发）共用 */
async function downloadAndProcess(
  url: string,
): Promise<Uint8Array<ArrayBufferLike>> {
  const raw = await fetchBytes(url, {
    headers: { "x-rquickjs-host-offload-binary-v1": "1" },
    signal: AbortSignal.timeout(30000),
  });
  if (!watermarkEnabled) return raw;
  try {
    return processImageBytes(raw).bytes;
  } catch {
    return raw; // 处理异常 → 原样返回，不中断阅读
  }
}

// 把下载器注入预取层（预取与正式读取共用同一套下载+处理）
configureFetcher(downloadAndProcess);

// ---------------------------------------------------------------------------
// 繁体→简体（应用到响应里的文本字段）
// ---------------------------------------------------------------------------

async function convertSearch(
  res: SearchResultContract,
): Promise<SearchResultContract> {
  if (!isSimplified()) return res;
  await Promise.all(
    (res.items ?? []).map(async (it) => {
      it.title = await t2s(it.title);
      if (it.subtitle) it.subtitle = await t2s(it.subtitle);
    }),
  );
  return res;
}

async function convertDetail(
  res: ComicDetailContract,
): Promise<ComicDetailContract> {
  if (!isSimplified()) return res;
  const ci = res.data.normal.comicInfo;
  ci.title = await t2s(ci.title);
  if (ci.creator?.name) ci.creator.name = await t2s(ci.creator.name);
  if (ci.description) ci.description = await t2s(ci.description);
  await Promise.all(
    (ci.titleMeta ?? []).map(async (m) => (m.name = await t2s(m.name))),
  );
  await Promise.all(
    (ci.metadata ?? []).map(async (md) => {
      md.name = await t2s(md.name);
      await Promise.all(
        (md.value ?? []).map(async (v) => (v.name = await t2s(v.name))),
      );
    }),
  );
  await Promise.all(
    (res.data.normal.eps ?? []).map(async (ep) => (ep.name = await t2s(ep.name))),
  );
  return res;
}

type ChapterLike = {
  data: {
    comic?: { title?: string };
    chapter?: { name?: string };
    chapters?: Array<{ name?: string }>;
  };
};

async function convertChapterLike<T extends ChapterLike>(res: T): Promise<T> {
  if (!isSimplified()) return res;
  const d = res.data;
  if (d.comic?.title) d.comic.title = await t2s(d.comic.title);
  if (d.chapter?.name) d.chapter.name = await t2s(d.chapter.name);
  await Promise.all(
    (d.chapters ?? []).map(async (c) => (c.name = await t2s(c.name))),
  );
  return res;
}

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
): void {
  const pages = res?.data?.chapter?.pages;
  const urls = Array.isArray(pages) ? pages.map((p) => p.url) : [];
  setChapterContext(urls, pickNextChapterId(res ?? {}), fetchChapterImageUrls);
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
// API（包装 core：去重 + 预取上下文 + 繁简转换）
// ---------------------------------------------------------------------------

async function searchComic(
  payload: SearchComicPayload,
): Promise<SearchResultContract> {
  return convertSearch(await coreSearchComic(payload));
}

async function getComicDetail(payload: {
  comicId?: string;
}): Promise<ComicDetailContract> {
  return convertDetail(await coreGetComicDetail(payload));
}

async function getReadSnapshot(
  payload: ReadSnapshotPayload,
): Promise<ReadSnapshotContract> {
  const res = await coreGetReadSnapshot(payload);
  dedupeChapterPages(res);
  applyChapterContext(res);
  return convertChapterLike(res);
}

async function getChapter(payload: ChapterPayload): Promise<ChapterContentContract> {
  const res = await coreGetChapter(payload);
  dedupeChapterPages(res);
  applyChapterContext(res);
  return convertChapterLike(res);
}

/**
 * 下载图片并去水印；优先命中预取缓存，未命中则下载处理并触发后续预取。
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
    const bytes = await downloadAndProcess(targetUrl); // 兜底
    prefetchAhead(targetUrl);
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function onWatermarkChanged(
  payload: SettingsChange,
): Promise<Record<string, unknown>> {
  if (payload.key === "watermark.enabled") {
    watermarkEnabled = Boolean(payload.value);
    clearCache(); // 清空缓存使新设置立即生效
  }
  return {};
}

async function onSimplifiedChanged(
  payload: SettingsChange,
): Promise<Record<string, unknown>> {
  if (payload.key === "convert.simplified") setSimplified(Boolean(payload.value));
  return {};
}

async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          title: "阅读",
          fields: [
            {
              key: "watermark.enabled",
              kind: "switch",
              label: "去除横幅水印",
              fnPath: "onWatermarkChanged",
            },
            {
              key: "convert.simplified",
              kind: "switch",
              label: "繁体转简体（标题/章节名等）",
              fnPath: "onSimplifiedChanged",
            },
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      values: {
        "watermark.enabled": watermarkEnabled,
        "convert.simplified": isSimplified(),
      },
    },
  };
}

async function getCapabilitiesBundle(): Promise<CapabilitiesBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: { version: "1.0.0", type: "capabilities", actions: [] },
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
  onWatermarkChanged,
  onSimplifiedChanged,
};
