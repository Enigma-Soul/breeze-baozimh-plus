// 图片预取与缓存：阅读时把后续若干页"下载 + 去水印"后缓存，翻页直接命中。
// 本章预处理完（剩余页填不满窗口）时，**跨到下一节开头**继续预取，
// 当前章 + 下一章合计不超过 MAX_CACHE 张。
//
// 运行时事实：Breeze 的 QuickJS-NG 沙箱无 Worker（探针实测 Worker=undefined），
// 无法真正多线程。这里用**并发异步 I/O** 实现并行预取——多个下载同时在途，
// jpeg 解码（CPU 密集）在单线程上交错执行。
//
// 缓存为 LRU，上限 MAX_CACHE 张。

type Fetcher = (url: string) => Promise<Uint8Array>;
type ChapterResolver = (chapterId: string) => Promise<string[]>;

const MAX_CACHE = 15; // 最多缓存张数（当前章 + 下一章合计）

let fetcher: Fetcher | null = null;
let currentPages: string[] = []; // 当前章节页面 url（阅读序）
let nextChapterId: string | null = null; // 下一章节 id（来自章节 nav 列表）
let resolveChapter: ChapterResolver | null = null;
let nextPages: string[] | null = null; // 下一章页面 url（懒加载）
let nextLoading = false;
let lastPrefetchUrl = "";

// LRU：Map 按插入序，访问/写入时 touch 到末尾，淘汰从头部
const cache = new Map<string, Uint8Array>();
// 进行中的请求（去重，避免同一 url 重复下载）
const inflight = new Map<string, Promise<Uint8Array>>();

export function configureFetcher(fn: Fetcher): void {
  fetcher = fn;
}

/** 设置章节上下文：当前章页面、下一章 id、章节页面解析器。新章节会清空缓存 */
export function setChapterContext(
  urls: string[],
  nextId: string | null,
  resolver: ChapterResolver | null,
): void {
  currentPages = urls.filter((u) => typeof u === "string" && u.length > 0);
  nextChapterId = nextId;
  resolveChapter = resolver;
  nextPages = null;
  nextLoading = false;
  lastPrefetchUrl = "";
  cache.clear();
  inflight.clear();
}

/** 兼容旧接口：无下一章上下文 */
export function setPageList(urls: string[]): void {
  setChapterContext(urls, null, null);
}

/** 清空缓存（设置变更等场景） */
export function clearCache(): void {
  cache.clear();
  inflight.clear();
}

/** 是否已缓存（供日志区分命中/未命中，不触发下载） */
export function hasCache(url: string): boolean {
  return cache.has(url);
}

function touch(url: string, bytes: Uint8Array): void {
  cache.delete(url);
  cache.set(url, bytes); // 移到末尾 = 最近使用
}

function evict(): void {
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchOne(url: string): Promise<Uint8Array> {
  const bytes = await fetcher!(url);
  touch(url, bytes);
  evict();
  return bytes;
}

/**
 * 取一张图：命中缓存则直接返回，否则发起（或复用进行中的）请求。
 * 当前页走这里（优先，不受预取节流影响）。
 */
export async function getOrFetch(url: string): Promise<Uint8Array> {
  const hit = cache.get(url);
  if (hit) {
    touch(url, hit);
    return hit;
  }
  let p = inflight.get(url);
  if (!p) {
    p = fetchOne(url).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

// 预取窗口：currentUrl + 之后最多 MAX_CACHE-1 页，跨章节（本章不足则续到下一章开头）
function buildWindow(currentUrl: string): string[] {
  const idx = currentPages.indexOf(currentUrl);
  // idx < 0 由 prefetchAhead 提前拦截，这里假定命中
  const tail = currentPages.slice(idx + 1);
  let ahead = tail;
  if (tail.length < MAX_CACHE - 1) {
    // 本章剩余填不满 → 续下一章开头
    const need = MAX_CACHE - 1 - tail.length;
    const head = nextPages ? nextPages.slice(0, need) : [];
    ahead = tail.concat(head);
  }
  return [currentUrl, ...ahead.slice(0, MAX_CACHE - 1)];
}

// 本章剩余不足以填满窗口时，懒加载下一章页面 url；就绪后触发一次 refill
function maybeLoadNextChapter(currentUrl: string): void {
  if (nextLoading || nextPages || !nextChapterId || !resolveChapter) return;
  const idx = currentPages.indexOf(currentUrl);
  if (idx >= 0 && currentPages.slice(idx + 1).length >= MAX_CACHE - 1) return;
  nextLoading = true;
  void resolveChapter(nextChapterId)
    .then((urls) => {
      nextPages = urls.filter((u) => typeof u === "string" && u.length > 0);
    })
    .catch(() => {
      /* 下一章页面拉取失败静默，用户翻到时由正式链路处理 */
    })
    .finally(() => {
      nextLoading = false;
      if (nextPages && lastPrefetchUrl) prefetchAhead(lastPrefetchUrl);
    });
}

/**
 * 预取 currentUrl 之后的若干页（跨章节），补到 MAX_CACHE 张。非阻塞、并发下载。
 * 非当前章节页（如封面）直接跳过，不动缓存。
 */
export function prefetchAhead(currentUrl: string): void {
  if (!fetcher) return;
  const idx = currentPages.indexOf(currentUrl);
  if (idx < 0) return; // 非当前章节页 → 不预取、不淘汰

  lastPrefetchUrl = currentUrl;
  const want = buildWindow(currentUrl);
  const keep = new Set(want);
  for (const u of [...cache.keys()]) {
    if (!keep.has(u)) cache.delete(u); // 淘汰窗口外
  }
  for (const u of want) {
    if (u === currentUrl) continue;
    if (!cache.has(u) && !inflight.has(u)) {
      void getOrFetch(u).catch(() => {
        /* 预取失败静默，正式读取时会重试 */
      });
    }
  }

  // 窗口没填满（本章短/到尾）且还没拉下一章 → 触发，就绪后 refill
  if (want.length < MAX_CACHE) maybeLoadNextChapter(currentUrl);
}
