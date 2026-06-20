// 繁体→简体转换。
//
// 宿主 runtime 内置 OpenCC，通过 bridge 路由 opencc.convert 调用，
// 无需打包字典/WASM（QJS 沙箱本就没有 WebAssembly）。
// baozimh 是台版繁体，用 tw2s（台湾繁体→简体）。
//
// 结果缓存：章节名等重复文本只转一次；转换关闭时直接原样返回（零开销）。

let enabled = true; // 默认开启（插件面向简体读者）
const cache = new Map<string, string>();

export function setSimplified(on: boolean): void {
  if (on !== enabled) {
    enabled = on;
    cache.clear();
  }
}

export function isSimplified(): boolean {
  return enabled;
}

/** 繁体→简体；关闭或空串原样返回。结果缓存（重复文本只转一次） */
export async function t2s(text?: string): Promise<string> {
  if (!enabled || !text) return text ?? "";
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  let out = text;
  try {
    out = (await bridge.call("opencc.convert", {
      text,
      config: "tw2s.json",
    })) as string;
  } catch {
    out = text; // 宿主 opencc 不可用 → 原样返回，不阻断
  }
  cache.set(text, out);
  return out;
}
