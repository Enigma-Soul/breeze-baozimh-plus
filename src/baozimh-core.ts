import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import type {
  ChapterContentContract,
  ChapterPage,
  ChapterPayload,
  ChapterSummary,
  ComicDetailContract,
  FetchImageBytesPayload,
  FetchImageBytesResult,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  SearchComicPayload,
  SearchResultContract,
  StringMap,
} from "../types/type";
import { PLUGIN_ID } from "./common";

// 注意：Breeze 的 QuickJS-NG 沙箱无 `process`，不能读环境变量，域名直接硬编码
const DEFAULT_DOMAIN = "https://www.baozimh.com";
const USER_AGENT = "baozimh_android/1.0.31/gb/adset";
const APP_VERSION = "1.0.31";
const APP_ID = "cn.sts.xiaoyun.ordermeals";
const DEVICE_ID = "BE2A.250530.026.F3";
const DEVICE_CODE = "2c712c6ba4e95a9f4157f94e1794a86c";
const BYPASS_HOSTS = [
  "appgb-vdkr.baozimh.com",
  "appgb1-vdkr.baozimh.com",
  "appgb2-vdkr.baozimh.com",
  "app1-vdkr.baozimh.com",
  "app2-vdkr.baozimh.com",
];
const LAST_CHAPTER_MARK = "/last_chapter";

type SearchHit = {
  mangaPath: string;
  title: string;
  cover: string | null;
};

type ApiComicItem = {
  comic_id?: string;
  name?: string;
  author?: string;
  type_names?: string[];
  region?: string;
  topic_img?: string;
};

type ApiComicListResponse = {
  items?: ApiComicItem[];
};

type MangaDetail = {
  mangaPath: string;
  title: string;
  thumbnail: string | null;
  author: string | null;
  tags: string[];
  description: string | null;
  status: "ongoing" | "completed" | "unknown";
};

type ChapterRequest = {
  url: string;
  headers: Record<string, string>;
  isLast: boolean;
};

type ChapterListEntry = {
  name: string;
  chapterPath: string;
};

type ApiChapterEntry = ChapterSummary;

function normalizeUrl(
  pathOrUrl: string,
  base: string = DEFAULT_DOMAIN,
): string {
  return new URL(pathOrUrl, base).toString();
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readMapString(map: StringMap | null | undefined, key: string): string {
  return readString(map?.[key]);
}

async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("referer", "https://www.baozimh.com/");
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    headers,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return await res.text();
}

export async function fetchBytes(
  url: string,
  init: RequestInit = {},
): Promise<Uint8Array<ArrayBufferLike>> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("referer", "https://www.baozimh.com/");
  // 统一带上 app 标识头，尽量让 CDN 当作安卓 app 请求（避免 iOS 端被加"下载包子app"水印）
  headers.set("app-id", APP_ID);
  headers.set("app-version", APP_VERSION);
  headers.set("device-id", DEVICE_ID);
  headers.set("device-code", DEVICE_CODE);
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    headers,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function comicListUrl(
  page = 1,
  type = "all",
  region = "all",
  state = "all",
  filter = "*",
): string {
  const u = new URL("/api/bzmhq/amp_comic_list", DEFAULT_DOMAIN);
  u.searchParams.set("type", type);
  u.searchParams.set("region", region);
  u.searchParams.set("state", state);
  u.searchParams.set("filter", filter);
  u.searchParams.set("page", String(page));
  u.searchParams.set("limit", "36");
  u.searchParams.set("language", "tw");
  u.searchParams.set("__amp_source_origin", DEFAULT_DOMAIN);
  return u.toString();
}

function searchLink(query: string): string {
  const u = new URL("/search", DEFAULT_DOMAIN);
  u.searchParams.set("q", query);
  return u.toString();
}

function detailLink(mangaPath: string): string {
  return normalizeUrl(mangaPath);
}

function pageListLink(chapterPath: string): string {
  return normalizeUrl(chapterPath);
}

function toQuickChapterPath(rawPath: string): string {
  const url = new URL(rawPath, DEFAULT_DOMAIN);
  const comicId = url.searchParams.get("comic_id");
  const section = url.searchParams.get("section_slot");
  const chapter = url.searchParams.get("chapter_slot");
  if (!comicId || !section || !chapter) return rawPath;
  return `/comic/chapter/${comicId}/${section}_${chapter}.html`;
}

function parseSectionChapter(chapterPath: string): {
  section: number;
  chapter: number;
} {
  const m = chapterPath.match(/\/comic\/chapter\/[^/]+\/(\d+)_(\d+)\.html/);
  if (!m) return { section: Number.NaN, chapter: Number.NaN };
  return {
    section: Number.parseInt(m[1], 10),
    chapter: Number.parseInt(m[2], 10),
  };
}

function makeActionItem(name: string): {
  name: string;
  onTap: StringMap;
  extern: StringMap;
} {
  return { name, onTap: {}, extern: {} };
}

function makeImage(
  id: string,
  url: string,
  name = "cover",
  path = url,
): ChapterPage["id"] extends string
  ? { id: string; url: string; name: string; path: string; extern: StringMap }
  : never {
  return {
    id,
    url,
    name,
    path: path.split("/").at(-1) || path,
    extern: {},
  };
}

function parseSearchHtml(html: string): SearchHit[] {
  const $ = cheerio.load(html);
  const rows: SearchHit[] = [];
  $("a.comics-card__poster, div.classify-items a").each((_, el) => {
    const href = readString($(el).attr("href"));
    const title = readString(
      $(el).attr("title") ?? $(el).find("img").attr("alt"),
    );
    const img = readString(
      $(el).find("amp-img").attr("src") ?? $(el).find("img").attr("src"),
    );
    if (!href || !href.startsWith("/comic/")) return;
    rows.push({
      mangaPath: href,
      title,
      cover: img ? normalizeUrl(img) : null,
    });
  });
  const uniq = new Map<string, SearchHit>();
  for (const row of rows) {
    if (!uniq.has(row.mangaPath)) uniq.set(row.mangaPath, row);
  }
  return Array.from(uniq.values());
}

function parseComicListJson(jsonText: string): SearchHit[] {
  const obj = JSON.parse(jsonText) as ApiComicListResponse;
  const items = Array.isArray(obj.items) ? obj.items : [];
  return items.map(
    (it): SearchHit => ({
      mangaPath: `/comic/${readString(it.comic_id)}`,
      title: readString(it.name),
      cover: it.topic_img
        ? `https://static-tw.baozimh.com/cover/${it.topic_img}`
        : null,
    }),
  );
}

function getMetaContent($: CheerioAPI, selector: string): string {
  return readString($(selector).first().attr("content"));
}

function getPageTitle($: CheerioAPI): string {
  return (
    readString($("h1.comics-detail__title").first().text()) ||
    getMetaContent($, 'meta[property="og:novel:book_name"]') ||
    readString($("title").first().text()).replace(/\s*-\s*包子漫畫\s*$/u, "")
  );
}

function getPageAuthor($: CheerioAPI): string | null {
  return (
    readString($("h2.comics-detail__author").first().text()) ||
    getMetaContent($, 'meta[property="og:novel:author"]') ||
    null
  );
}

function getPageTags($: CheerioAPI): string[] {
  const tags: string[] = [];
  $("div.tag-list span.tag").each((_, el) => {
    const tag = readString($(el).text());
    if (tag) tags.push(tag);
  });
  if (tags.length > 0) return tags;
  const fallback = readMapString(
    { categories: getMetaContent($, 'meta[property="og:novel:category"]') },
    "categories",
  );
  return fallback
    ? fallback
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function getPageStatus($: CheerioAPI): MangaDetail["status"] {
  const statusTag =
    readString($("div.tag-list > span.tag").first().text()) ||
    getMetaContent($, 'meta[property="og:novel:status"]');
  if (["连载中", "連載中"].includes(statusTag)) return "ongoing";
  if (["已完结", "已完結"].includes(statusTag)) return "completed";
  return "unknown";
}

async function getMangaDetail(mangaPath: string): Promise<MangaDetail> {
  const html = await fetchText(detailLink(mangaPath));
  const $ = cheerio.load(html);
  const thumbnail =
    readString($("div.pure-g div > amp-img").first().attr("src")) ||
    getMetaContent($, 'meta[property="og:image"]');
  const title = getPageTitle($);
  const author = getPageAuthor($);
  const tags = getPageTags($);
  const description =
    readString($("p.comics-detail__desc").first().text()) ||
    getMetaContent($, 'meta[property="og:description"]') ||
    null;
  return {
    mangaPath,
    title,
    thumbnail: thumbnail ? normalizeUrl(thumbnail) : null,
    author,
    tags,
    description,
    status: getPageStatus($),
  };
}

async function getChapterList(mangaPath: string): Promise<ChapterSummary[]> {
  const html = await fetchText(detailLink(mangaPath));
  const $ = cheerio.load(html);
  const list: ChapterListEntry[] = [];
  $(".comics-chapters a[href]").each((_, el) => {
    const name = readString($(el).text());
    const href = readString($(el).attr("href"));
    if (!href) return;
    list.push({ name, chapterPath: toQuickChapterPath(href) });
  });
  const dedup: ChapterListEntry[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const key = `${row.name}@@${row.chapterPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(row);
    }
  }
  dedup.sort((a, b) => {
    const aa = parseSectionChapter(a.chapterPath);
    const bb = parseSectionChapter(b.chapterPath);
    if (
      Number.isNaN(aa.section) ||
      Number.isNaN(aa.chapter) ||
      Number.isNaN(bb.section) ||
      Number.isNaN(bb.chapter)
    ) {
      return b.chapterPath.localeCompare(a.chapterPath);
    }
    if (aa.section !== bb.section) return bb.section - aa.section;
    return bb.chapter - aa.chapter;
  });
  const total = dedup.length;
  const chapters: ChapterSummary[] = dedup.map((item, index) => ({
    id: item.chapterPath,
    requestId: item.chapterPath,
    logicalKey: String(total - index),
    storageChapterId: item.chapterPath,
    name: item.name,
    order: total - index,
    extern: {},
  }));

  if (chapters.length > 0) {
    chapters[0].storageChapterId += LAST_CHAPTER_MARK;
    chapters[0].requestId += LAST_CHAPTER_MARK;
    chapters[0].logicalKey += LAST_CHAPTER_MARK;
  }
  return chapters.reverse();
}

function randomBypassHost(): string {
  return BYPASS_HOSTS[Math.floor(Math.random() * BYPASS_HOSTS.length)];
}

function buildChapterRequestUrl(
  chapterPath: string,
  forcedBypassHost: string | null = null,
): ChapterRequest {
  const isLast = chapterPath.endsWith(LAST_CHAPTER_MARK);
  if (!isLast) {
    return {
      url: pageListLink(chapterPath),
      headers: { referer: "https://www.baozimh.com/" },
      isLast,
    };
  }
  const raw = chapterPath.slice(0, -LAST_CHAPTER_MARK.length);
  const u = new URL(pageListLink(raw));
  u.host = forcedBypassHost || randomBypassHost();
  u.pathname = `/baozimhapp${u.pathname}`;
  return {
    url: u.toString(),
    headers: {
      referer: "https://app.baozimh.com/",
      "accept-encoding": "gzip",
      "app-id": APP_ID,
      "app-version": APP_VERSION,
      connection: "Keep-Alive",
      "device-code": DEVICE_CODE,
      "device-id": DEVICE_ID,
      "user-agent": USER_AGENT,
    },
    isLast,
  };
}

function isCertExpiredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = Reflect.get(err, "cause") as { code?: unknown } | undefined;
  return String(cause?.code ?? "").includes("CERT_HAS_EXPIRED");
}

function parsePageImageUrls(
  html: string,
  isLast: boolean,
): { urls: string[]; nextHref: string | null } {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  if (!isLast) {
    $("amp-state[id^=chapter][id$=Src] > script[type=application/json]").each(
      (_, el) => {
        const data = readString($(el).text());
        if (!data) return;
        try {
          const obj = JSON.parse(data) as { url?: unknown };
          if (obj.url) urls.push(String(obj.url));
        } catch {
          return;
        }
      },
    );
  } else {
    $("div.chapter-img img.comic-contain__item[data-src]").each((_, el) => {
      const src = readString($(el).attr("data-src"));
      if (src) urls.push(src);
    });
  }
  const nextHref =
    $("div.next_chapter a")
      .filter((_, el) => {
        const txt = readString($(el).text());
        return txt.includes("點擊進入下一頁") || txt.includes("点击进入下一页");
      })
      .first()
      .attr("href") || null;
  return { urls, nextHref };
}

export async function getPages(chapterPath: string): Promise<string[]> {
  const pages: string[] = [];
  let currentPath = chapterPath;
  const isLastRoot = currentPath.endsWith(LAST_CHAPTER_MARK);
  while (true) {
    let html: string | undefined;
    let req: ChapterRequest | null = null;
    if (!currentPath.endsWith(LAST_CHAPTER_MARK)) {
      req = buildChapterRequestUrl(currentPath);
      html = await fetchText(req.url, { headers: req.headers });
    } else {
      const hosts = [...BYPASS_HOSTS];
      let lastErr: unknown;
      for (const host of hosts) {
        try {
          req = buildChapterRequestUrl(currentPath, host);
          html = await fetchText(req.url, { headers: req.headers });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (!isCertExpiredError(err)) {
            throw err;
          }
        }
      }
      if (!html) {
        throw (
          lastErr ||
          new Error("Failed to fetch last-chapter page from all bypass hosts")
        );
      }
    }
    if (!req) {
      throw new Error("chapter request not built");
    }
    const parsed = parsePageImageUrls(html, req.isLast);
    for (const u of parsed.urls) pages.push(u);
    if (!parsed.nextHref) break;
    currentPath = parsed.nextHref + (isLastRoot ? LAST_CHAPTER_MARK : "");
  }
  return pages;
}

export function createComicListItem(
  id: string,
  title: string,
  cover: string | null,
  subtitle = "",
  raw: StringMap = {},
): {
  source: string;
  id: string;
  title: string;
  subtitle: string;
  finished: boolean;
  likesCount: number;
  viewsCount: number;
  updatedAt: string;
  cover: {
    id: string;
    url: string;
    name: string;
    path: string;
    extern: StringMap;
  };
  metadata: {
    type: string;
    name: string;
    value: { name: string; onTap: StringMap; extern: StringMap }[];
  }[];
  raw: StringMap;
  extern: StringMap;
} {
  const coverUrl = cover ?? "";
  return {
    source: PLUGIN_ID,
    id,
    title,
    subtitle,
    finished: false,
    likesCount: 0,
    viewsCount: 0,
    updatedAt: "",
    cover: {
      id,
      url: coverUrl,
      name: "cover",
      path: coverUrl.split("/").at(-1) || coverUrl,
      extern: {},
    },
    metadata: [],
    raw,
    extern: {},
  };
}

function chaptersToData(chapters: ChapterSummary[]): ChapterSummary[] {
  return chapters.map((item) => ({
    id: item.id,
    requestId: item.requestId,
    logicalKey: item.logicalKey,
    storageChapterId: item.storageChapterId,
    name: item.name,
    order: item.order,
    extern: item.extern,
  }));
}

export async function searchComic(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  const keyword = readString(
    payload.keyword ?? readMapString(payload.extern, "keyword"),
  );
  const page = Math.max(1, Number(payload.page ?? 1) || 1);
  const html = await fetchText(searchLink(keyword));
  const items = parseSearchHtml(html).map((row) =>
    createComicListItem(
      row.mangaPath.replace(/^\/comic\//, ""),
      row.title || row.mangaPath,
      row.cover,
      "",
      row as unknown as StringMap,
    ),
  );
  const paging = { page, pages: 1, total: items.length, hasReachedMax: true };
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "searchResult",
      source: PLUGIN_ID,
      list: "comicGrid",
    },
    data: { paging, items },
    paging,
    items,
  };
}

export async function getComicDetail(
  payload: ChapterPayload & { comicId?: string } = {},
): Promise<ComicDetailContract> {
  const comicId = readString(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const mangaPath = comicId.startsWith("/comic/")
    ? comicId
    : comicId.startsWith("/")
      ? comicId
      : `/comic/${comicId}`;
  const normalizedComicId = mangaPath.replace(/^\/comic\//, "");
  const detail = await getMangaDetail(mangaPath);
  const chapters = await getChapterList(mangaPath);
  return {
    source: PLUGIN_ID,
    comicId: normalizedComicId,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "comicDetail", source: PLUGIN_ID },
    data: {
      normal: {
        comicInfo: {
          id: normalizedComicId,
          title: detail.title,
          titleMeta: [
            makeActionItem(
              detail.status === "completed"
                ? "已完結"
                : detail.status === "ongoing"
                  ? "連載中"
                  : "未知",
            ),
            makeActionItem(`${chapters.length} 章`),
          ],
          creator: {
            id: normalizedComicId,
            name: detail.author || "",
            avatar: makeImage(
              normalizedComicId,
              detail.thumbnail || "",
              "cover",
              detail.thumbnail || "",
            ),
            onTap: {},
            extern: {},
          },
          description: detail.description || "",
          cover: makeImage(
            normalizedComicId,
            detail.thumbnail || "",
            "cover",
            detail.thumbnail || "",
          ),
          metadata: [
            {
              type: "author",
              name: "作者",
              value: detail.author ? [makeActionItem(detail.author)] : [],
            },
            {
              type: "tags",
              name: "标签",
              value: detail.tags.map((tag) => makeActionItem(tag)),
            },
          ],
          extern: { status: detail.status },
        },
        eps: chapters,
        recommend: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        isFavourite: false,
        isLiked: false,
        allowComments: false,
        allowLike: false,
        allowCollected: false,
        allowDownload: true,
        extern: {},
      },
      raw: { detail, chapters },
    },
  };
}

export async function getChapter(
  payload: ChapterPayload = {},
): Promise<ChapterContentContract> {
  const comicId = readString(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const detail = await getComicDetail({ comicId, extern: payload.extern });
  const chapters = detail.data.normal.eps;
  const chapterId = readString(payload.chapterId);
  const chapter =
    chapters.find(
      (item) => item.requestId === chapterId || item.id === chapterId,
    ) ?? chapters[0];
  const pages = await getPages(chapter.requestId);
  const pageItems: ChapterPage[] = pages.map((url, idx) => ({
    id: `${idx + 1}`,
    name: `${idx + 1}`,
    path: url.split("/").at(-1) || `${idx + 1}`,
    url,
    extern: {},
  }));
  return {
    source: PLUGIN_ID,
    comicId,
    chapterId: chapter.id,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "chapterContent", source: PLUGIN_ID },
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_ID,
        title: detail.data.normal.comicInfo.title,
        extern: {},
      },
      chapter: {
        ...chapter,
        pages: pageItems,
      },
      chapters,
    },
  };
}

export async function getReadSnapshot(
  payload: ReadSnapshotPayload = {},
): Promise<ReadSnapshotContract> {
  const comicId = readString(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const detail = await getComicDetail({ comicId, extern: payload.extern });
  const chapters = detail.data.normal.eps;
  const chapterId = readString(payload.chapterId);
  const currentChapter =
    chapters.find(
      (item) => item.requestId === chapterId || item.id === chapterId,
    ) ?? chapters[0];
  const pages = await getPages(currentChapter.requestId);
  const pageItems: ChapterPage[] = pages.map((url, idx) => ({
    id: `${idx + 1}`,
    name: `${idx + 1}`,
    path: url.split("/").at(-1) || `${idx + 1}`,
    url,
    extern: {},
  }));
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_ID,
        title: detail.data.normal.comicInfo.title,
        extern: {},
      },
      chapter: {
        ...currentChapter,
        pages: pageItems,
      },
      chapters: chapters.map((item) => ({
        id: item.id,
        name: item.name,
        order: item.order,
        extern: item.extern,
      })),
    },
  };
}

export async function fetchImageBytes(
  payload: FetchImageBytesPayload = {},
): Promise<FetchImageBytesResult> {
  const targetUrl = readString(payload.url);
  if (!targetUrl) throw new Error("url 不能为空");
  return await fetchBytes(targetUrl);
}
