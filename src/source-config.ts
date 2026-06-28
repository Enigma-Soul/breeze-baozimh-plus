// 数据来源配置：直连 baozimh.com，或经 Komga 兼容协议访问自建 baozimh-proxy。
// 仿 convert.ts：模块级状态 + getter/setter（设置回调写入，各处读取）。

export type SourceMode = "direct" | "proxy";

let mode: SourceMode = "direct";
let baseUrl = "";

export function getSourceMode(): SourceMode {
  return mode;
}

export function setSourceMode(next: SourceMode): void {
  mode = next;
}

export function getProxyBaseUrl(): string {
  return baseUrl;
}

export function setProxyBaseUrl(raw: string): void {
  // trim + 去尾斜杠；IPv6 方括号原样保留（fetch 原生支持 http://[::1]:8787）
  baseUrl = String(raw ?? "").trim().replace(/\/+$/u, "");
}

/** 拼接 proxy 端点路径（path 以 / 开头）；baseUrl 未配置时抛错。 */
export function proxyUrl(path: string): string {
  if (!baseUrl) throw new Error("代理服务器地址未配置");
  return baseUrl + (path.startsWith("/") ? path : `/${path}`);
}
