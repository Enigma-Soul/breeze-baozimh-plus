// 插件全局唯一 ID（UUID v4）—— 必须保证全局唯一，不能与其他插件重复
export const PLUGIN_ID = "791a42eb-cfff-4c12-86c4-cf4ce60bb1fe";
// ImageItem.url 必须是非空有效格式占位符，不能是 404 或空串
export const NOT_FOUND_IMAGE_URL = "https://www.baozimh.com/favicon.ico";
export const PLACEHOLDER_IMAGE_PATH = "placeholder/image-404.png";

import type {
  ActionItem,
  ComicListItem,
  ImageItem,
  MetadataListItem,
  PagingInfo,
  StringMap,
} from "../types/type";

export function toStringMap(value: unknown): StringMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function createActionItem(
  name: unknown,
  onTap: StringMap = {},
  extern: StringMap = {},
): ActionItem {
  // Keep all action payloads normalized so downstream schema consumers do not
  // have to special-case missing fields.
  return {
    name: String(name ?? ""),
    onTap,
    extern,
  };
}

export function createImage(
  input: {
    id?: string;
    url?: string;
    name?: string;
    path?: string;
    extern?: StringMap;
  } = {},
): ImageItem {
  return {
    id: String(input.id ?? ""),
    url: String(input.url ?? "").trim() || NOT_FOUND_IMAGE_URL,
    name: String(input.name ?? ""),
    path: String(input.path ?? "").trim() || PLACEHOLDER_IMAGE_PATH,
    extern: input.extern ?? {},
  };
}

export function createMetadataActionList(
  type: string,
  name: string,
  values: unknown,
  mapItem?: (value: string) => ActionItem,
): MetadataListItem {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  const normalized = list
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .map((item) => (mapItem ? mapItem(item) : createActionItem(item)));

  return {
    type,
    name,
    value: normalized,
  };
}

export function createBasicMetadata(
  type: string,
  name: string,
  values: unknown,
): MetadataListItem {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  return {
    type,
    name,
    value: list
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .map((item) => createActionItem(item)),
  };
}

export function createComicItem(id: string, title: string): ComicListItem {
  const path = `comic/${id}/cover.png`;
  return {
    source: PLUGIN_ID,
    id,
    title,
    subtitle: "这是一个占位漫画条目",
    finished: false,
    likesCount: 0,
    viewsCount: 0,
    updatedAt: "2026-01-01 00:00",
    cover: {
      id,
      url: NOT_FOUND_IMAGE_URL,
      path,
      name: "",
      extern: { path },
    },
    metadata: [
      createBasicMetadata("author", "作者", ["example-author"]),
      createBasicMetadata("categories", "分类", []),
      createBasicMetadata("tags", "标签", ["example", "placeholder"]),
      createBasicMetadata("works", "作品", []),
      createBasicMetadata("actors", "角色", []),
    ],
    raw: {
      id,
      name: title,
      author: "example-author",
      description: "placeholder",
      image: NOT_FOUND_IMAGE_URL,
      category: {
        id: "",
        title: "",
      },
      category_sub: {
        id: null,
        title: null,
      },
      liked: false,
      is_favorite: false,
      update_at: 0,
      likes: 0,
      totalViews: 0,
      tags: ["example", "placeholder"],
      works: [],
      actors: [],
      related_list: [],
    },
    extern: {},
  } satisfies ComicListItem;
}

export function createPaging(page = 1, total = 1): PagingInfo {
  return {
    page,
    pages: Math.max(1, total),
    total,
    hasReachedMax: true,
  };
}
