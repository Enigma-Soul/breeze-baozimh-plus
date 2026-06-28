// Komga 兼容协议客户端：经 baozimh-proxy 访问，与 baozimh-core 的直连链平行。
// proxy 对外是 Komga/Kavita API（/api/v1 前缀），无认证；book_id 不透明搬运。
// proxy 自身已做去水印/繁简/空白页修复/预读，本层只做协议映射 + Breeze Contract 组装。

import { createComicListItem } from "./baozimh-core";
import { PLUGIN_ID } from "./common";
import { proxyUrl } from "./source-config";
import type {
  ChapterContentContract,
  ChapterPage,
  ChapterSummary,
  ComicDetailContract,
  ReadSnapshotContract,
  SearchComicPayload,
  SearchResultContract,
  StringMap,
} from "../types/type";

// ---- Komga DTO（对应 proxy komga/mapping.py，字段松定义）----
type KomgaSeriesList = {
  content?: KomgaSeries[];
  totalPages?: number;
  totalElements?: number;
};
type KomgaSeries = {
  id: string;
  name?: string;
  summary?: string;
  status?: string; // ONGOING | ENDED
  metadata?: {
    title?: string;
    summary?: string;
    status?: string;
    tags?: string[];
    genres?: string[];
  };
  books?: KomgaBook[];
};
type KomgaBook = {
  id: string; // = book_id（已编码，不透明）
  seriesId?: string;
  name?: string;
  number?: string; // 字符串，1-based
  media?: { pagesCount?: number; mediaType?: string };
};

function readStr(value: unknown): string {
  return String(value ?? "").trim();
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(proxyUrl(path), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`代理请求失败 ${res.status} ${path}`);
  }
  return (await res.json()) as T;
}

function makeImage(id: string, url: string, name = "cover") {
  return {
    id,
    url,
    name,
    path: readStr(url.split("/").at(-1)) || url,
    extern: {} as StringMap,
  };
}

function makeAction(name: string) {
  return { name, onTap: {} as StringMap, extern: {} as StringMap };
}

/** Komga Book → ChapterSummary（正序，order 0-based）*/
function bookToChapter(b: KomgaBook, idx: number): ChapterSummary {
  const num = Number(readStr(b.number)) || idx + 1;
  return {
    id: b.id,
    requestId: b.id,
    logicalKey: String(num),
    storageChapterId: b.id,
    name: readStr(b.name),
    order: num - 1,
    extern: {},
  };
}

/** Komga status (ONGOING/ENDED) → core 风格 */
function toCoreStatus(s?: string): "ongoing" | "completed" | "unknown" {
  if (s === "ENDED") return "completed";
  if (s === "ONGOING") return "ongoing";
  return "unknown";
}

function seriesThumbnail(comicId: string): string {
  return proxyUrl(`/api/v1/series/${encodeURIComponent(comicId)}/thumbnail`);
}

/** 取某 book 的页面列表（ChapterPage[]，url 指向 proxy pages 端点）*/
async function fetchChapterPages(bookId: string): Promise<ChapterPage[]> {
  // 真实页数要单独取（series 详情内嵌 book 的 pagesCount 恒 0）
  const book = await fetchJson<KomgaBook>(
    `/api/v1/books/${encodeURIComponent(bookId)}`,
  );
  const pagesCount = Number(book.media?.pagesCount) || 0;
  const pages: ChapterPage[] = [];
  for (let n = 1; n <= pagesCount; n++) {
    pages.push({
      id: String(n),
      name: String(n),
      path: `${n}.jpg`,
      url: proxyUrl(`/api/v1/books/${encodeURIComponent(bookId)}/pages/${n}`),
      extern: {},
    });
  }
  return pages;
}

// ---- 搜索 ----
export async function komgaSearch(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  const keyword =
    readStr(payload.keyword) ||
    readStr((payload.extern as StringMap | null | undefined)?.keyword);
  const breezePage = Math.max(1, Number(payload.page ?? 1) || 1);
  const komgaPage = breezePage - 1; // Komga page 0-based
  const data = await fetchJson<KomgaSeriesList>(
    `/api/v1/series?search=${encodeURIComponent(keyword)}&page=${komgaPage}&size=20`,
  );
  const series = Array.isArray(data.content) ? data.content : [];
  const items = series.map((s) =>
    createComicListItem(
      s.id,
      readStr(s.name),
      seriesThumbnail(s.id),
      "",
      s as unknown as StringMap,
    ),
  );
  const totalPages = Number(data.totalPages) || 1;
  const paging = {
    page: breezePage,
    pages: totalPages,
    total: Number(data.totalElements) || items.length,
    hasReachedMax: breezePage >= totalPages,
  };
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

// ---- 详情 ----
export async function komgaGetComicDetail(
  payload: { comicId?: string; extern?: StringMap | null } = {},
): Promise<ComicDetailContract> {
  const comicId = readStr(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const s = await fetchJson<KomgaSeries>(
    `/api/v1/series/${encodeURIComponent(comicId)}`,
  );
  const books = Array.isArray(s.books) ? s.books : [];
  const chapters = books.map(bookToChapter);
  const status = toCoreStatus(s.status ?? s.metadata?.status);
  const coverUrl = seriesThumbnail(comicId);
  const title = readStr(s.name) || readStr(s.metadata?.title) || comicId;
  const tags = Array.isArray(s.metadata?.tags) ? s.metadata.tags : [];
  return {
    source: PLUGIN_ID,
    comicId,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "comicDetail", source: PLUGIN_ID },
    data: {
      normal: {
        comicInfo: {
          id: comicId,
          title,
          titleMeta: [
            makeAction(
              status === "completed"
                ? "已完結"
                : status === "ongoing"
                  ? "連載中"
                  : "未知",
            ),
            makeAction(`${chapters.length} 章`),
          ],
          creator: {
            id: comicId,
            name: "", // proxy Komga 协议无作者字段
            avatar: makeImage(comicId, coverUrl, "cover"),
            onTap: {},
            extern: {},
          },
          description: readStr(s.summary) || readStr(s.metadata?.summary),
          cover: makeImage(comicId, coverUrl, "cover"),
          metadata: [
            { type: "author", name: "作者", value: [] },
            {
              type: "tags",
              name: "标签",
              value: tags.map((t) => makeAction(readStr(t))),
            },
          ],
          extern: { status },
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
      raw: { series: s },
    },
  };
}

// ---- 阅读快照 / 章节内容共用：加载某章的 books 定位 + 页面 ----
async function loadKomgaChapter(
  comicId: string,
  chapterId: string | number,
): Promise<{
  books: KomgaBook[];
  current: ChapterSummary;
  pages: ChapterPage[];
  title: string;
}> {
  const series = await fetchJson<KomgaSeries>(
    `/api/v1/series/${encodeURIComponent(comicId)}`,
  );
  const books = Array.isArray(series.books) ? series.books : [];
  let curIdx = books.findIndex((b) => b.id === readStr(chapterId));
  if (curIdx < 0) curIdx = 0;
  const currentBook = books[curIdx];
  const bookId = currentBook?.id ?? readStr(chapterId);
  const pages = await fetchChapterPages(bookId);
  const current = currentBook
    ? bookToChapter(currentBook, curIdx)
    : emptyChapter(bookId);
  return { books, current, pages, title: readStr(series.name) || comicId };
}

// ---- 阅读快照 ----
export async function komgaGetReadSnapshot(
  payload: {
    comicId?: string;
    chapterId?: string | number;
    extern?: StringMap | null;
  } = {},
): Promise<ReadSnapshotContract> {
  const comicId = readStr(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const { books, current, pages, title } = await loadKomgaChapter(
    comicId,
    payload.chapterId ?? "",
  );
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: { id: comicId, source: PLUGIN_ID, title, extern: {} },
      chapter: { ...current, pages },
      chapters: books.map((b, idx) => ({
        id: b.id,
        name: readStr(b.name),
        order: (Number(readStr(b.number)) || idx + 1) - 1,
        extern: {},
      })),
    },
  };
}

// ---- 章节内容（下载场景，结构同 snapshot）----
export async function komgaGetChapter(
  payload: {
    comicId?: string;
    chapterId?: string | number;
    extern?: StringMap | null;
  } = {},
): Promise<ChapterContentContract> {
  const comicId = readStr(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const { books, current, pages, title } = await loadKomgaChapter(
    comicId,
    payload.chapterId ?? "",
  );
  return {
    source: PLUGIN_ID,
    comicId,
    chapterId: current.id,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "chapterContent", source: PLUGIN_ID },
    data: {
      comic: { id: comicId, source: PLUGIN_ID, title, extern: {} },
      chapter: { ...current, pages },
      chapters: books.map(bookToChapter),
    },
  };
}

function emptyChapter(bookId: string): ChapterSummary {
  return {
    id: bookId,
    requestId: bookId,
    logicalKey: "1",
    storageChapterId: bookId,
    name: "",
    order: 0,
    extern: {},
  };
}
