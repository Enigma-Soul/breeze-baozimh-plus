// 图片去水印处理：wm1 版权横幅裁切 + 纯白错误页占位
//
// 算法移植自 G:\baozimh（libs/wm1_remover.py + run_pipeline.py 的 white_frac），
// 改为纯 typed-array 运算（原 Python 用 cv2/numpy）。QuickJS-NG 沙箱无 WebAssembly，
// 故用纯 JS 的 jpeg-js 解码/编码，无任何 WASM 依赖。
//
// 安全原则：任何异常 / 非 JPEG / 尺寸异常都原样返回原始字节，绝不中断阅读。

import * as jpeg from "jpeg-js";
import { WM1_JPEG_B64 } from "./wm1-template";

// 阈值与 G:\baozimh\config.toml [detect] 对齐
const STRIP_H = 200; // wm1 横幅高度（图片顶/底多出的 200 行）
const DIFF_THR = 15; // 顶/底条带与模板的均值像素差 < 此值 → 判定为 wm1
const MATCH_OFFSETS = 5; // 顶/底匹配各向下/向上试几格，容忍略偏/略高的 wm1 条带（如 202 高）
const WHITE_THR = 240; // 灰度 > 此值视为白
const DELETE_THR = 0.99; // 白色占比 ≥ 此值 → 纯白损坏页
const JPEG_QUALITY = 95;
// 高度预判（避免每张图都做 ~5s 全解码；baozimh 图宽恒为 1280，按高度分档）：
//   h < 350   → 极小图（多为广告条/碎片），占位丢弃
//   h ≤ 1005  → 正常页（无 wm1 条带），原样返回
//   h > 1005  → 疑似有 wm1 条带，全解码匹配
// 注：wm1 页 ≈ 内容(~1000) + 200 条带 ≈ 1200；极端特例（极少数非标高度真页）按用户意愿忽略
const HEIGHT_DISCARD = 350;
const HEIGHT_MATCH = 1005;

type Decoded = { width: number; height: number; data: Uint8Array };

// wm1 模板解码一次、模块级缓存（1280×200 RGBA）
let tplCache: Decoded | null = null;
function loadTemplate(): Decoded {
  if (tplCache) return tplCache;
  const buf = Buffer.from(WM1_JPEG_B64, "base64");
  const r = jpeg.decode(buf, { useTArray: true });
  tplCache = { width: r.width, height: r.height, data: r.data as Uint8Array };
  return tplCache;
}

function decodeJpeg(bytes: Uint8Array): Decoded | null {
  try {
    const r = jpeg.decode(bytes, { useTArray: true });
    if (!r.width || !r.height || r.data.length < r.width * r.height * 4) {
      return null;
    }
    return { width: r.width, height: r.height, data: r.data as Uint8Array };
  } catch {
    return null; // 非 JPEG 或解码失败
  }
}

function encodeJpeg(img: Decoded, quality: number): Uint8Array {
  const r = jpeg.encode(
    { width: img.width, height: img.height, data: img.data },
    quality,
  );
  return new Uint8Array(r.data); // encode 返回 {data: Buffer}，取 .data
}

// 只扫 JPEG 头部标记拿图像高度（不解码），用于廉价预判是否可能有 wm1 条带
function readJpegHeight(bytes: Uint8Array): number {
  let i = 2; // 跳过 SOI(FFD8)
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const m = bytes[i + 1];
    if (m === 0xda) break; // SOS → 之后是熵编码数据，SOF 必然在此之前
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      // SOF 段：len(2) precision(1) height(2)
      return (bytes[i + 5] << 8) | bytes[i + 6];
    }
    const seg = (bytes[i + 2] << 8) | bytes[i + 3]; // 该标记段长度（大端）
    i += 2 + seg;
  }
  return 0;
}

// 图像 [startRow, startRow+th) 行（前 tw 列 RGB）与模板的均值绝对差
function stripDiffAt(img: Decoded, tpl: Decoded, startRow: number): number {
  const { width: iw, data: id } = img;
  const { width: tw, height: th, data: td } = tpl;
  let sum = 0;
  for (let y = 0; y < th; y++) {
    const irow = (startRow + y) * iw * 4;
    const trow = y * tw * 4;
    for (let x = 0; x < tw; x++) {
      const i = irow + x * 4;
      const t = trow + x * 4;
      // 只比 RGB，跳过 alpha
      sum +=
        Math.abs(id[i] - td[t]) +
        Math.abs(id[i + 1] - td[t + 1]) +
        Math.abs(id[i + 2] - td[t + 2]);
    }
  }
  return sum / (th * tw * 3);
}

type SideResult = { side: "top" | "bottom" | null; dt: number; db: number };

// 判定 wm1 在顶/底/无。顶/底各试 MATCH_OFFSETS 格偏移取最小差，容忍略偏/略高（如 202）的条带
function detectSide(img: Decoded, tpl: Decoded): SideResult {
  const { height: ih } = img;
  const { height: th } = tpl;
  if (ih <= th || img.width < tpl.width) {
    return { side: null, dt: Number.POSITIVE_INFINITY, db: Number.POSITIVE_INFINITY };
  }
  // top：窗口从第 0 行起向下试几格
  let dt = Number.POSITIVE_INFINITY;
  for (let off = 0; off <= MATCH_OFFSETS; off++) {
    const d = stripDiffAt(img, tpl, off);
    if (d < dt) dt = d;
  }
  // bottom：窗口从倒数 th 行起向上试几格（对齐更高的底部条带）
  let db = Number.POSITIVE_INFINITY;
  for (let off = 0; off <= MATCH_OFFSETS; off++) {
    const startRow = ih - th - off;
    if (startRow < 0) break;
    const d = stripDiffAt(img, tpl, startRow);
    if (d < db) db = d;
  }
  let side: "top" | "bottom" | null = null;
  if (dt < DIFF_THR && dt <= db) side = "top";
  else if (db < DIFF_THR) side = "bottom";
  return { side, dt, db };
}

// 裁掉顶/底 wm1 条带。h>1200 时条带高 = h-1000（内容恒 ~1000）；否则按固定 STRIP_H
function cropStrip(img: Decoded, side: "top" | "bottom"): Decoded {
  const { width, height, data } = img;
  const cropH = height > 1200 ? height - 1000 : STRIP_H;
  const newH = height - cropH;
  const out = new Uint8Array(width * newH * 4);
  const srcRow = side === "top" ? cropH : 0; // top 跳过前 cropH 行；bottom 取前 newH 行
  out.set(data.subarray(srcRow * width * 4, (srcRow + newH) * width * 4));
  return { width, height: newH, data: out };
}

// 灰度均值 > WHITE_THR 的像素占比
function whiteFrac(img: Decoded): number {
  const { data, width, height } = img;
  const n = width * height;
  let white = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if ((data[i] + data[i + 1] + data[i + 2]) / 3 > WHITE_THR) white++;
  }
  return white / n;
}

// 8×8 白色占位 JPEG（损坏页用，解码一次缓存）
let whiteCache: Uint8Array | null = null;
function whitePlaceholder(): Uint8Array {
  if (whiteCache) return whiteCache;
  const data = new Uint8Array(8 * 8 * 4).fill(255);
  whiteCache = encodeJpeg({ width: 8, height: 8, data }, 90);
  return whiteCache;
}

export interface ProcessInfo {
  w: number;
  h: number;
  side: "top" | "bottom" | null;
  dt: number;
  db: number;
  white: number | null;
  action: string;
}

export interface ProcessResult {
  bytes: Uint8Array;
  changed: boolean;
  info: ProcessInfo;
}

const rnd = (n: number, p = 1): number => {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
};

/**
 * 处理一张漫画图：wm1 裁切 + 空白页占位。
 * 输入/输出都是 JPEG 字节。info 返回判定细节（供调试日志）。
 * 无 wm1 的页原样返回（零重编码、无损）。
 */
export function processImageBytes(raw: Uint8Array): ProcessResult {
  // 廉价高度预判（只读 JPEG 头，不解码）
  const h0 = readJpegHeight(raw);
  if (h0 > 0 && h0 < HEIGHT_DISCARD) {
    // 极小图（广告条/碎片）→ 占位丢弃
    return {
      bytes: whitePlaceholder(),
      changed: true,
      info: { w: 0, h: h0, side: null, dt: 0, db: 0, white: null, action: "discard" },
    };
  }
  if (h0 > 0 && h0 <= HEIGHT_MATCH) {
    // 正常页高度（无 wm1 条带）→ 原样返回，不做 ~5s 全解码
    return {
      bytes: raw,
      changed: false,
      info: { w: 0, h: h0, side: null, dt: 0, db: 0, white: null, action: "skip" },
    };
  }
  if (h0 === 0) {
    // 读不到高度（极少见）→ 保守原样返回，不解码
    return {
      bytes: raw,
      changed: false,
      info: { w: 0, h: 0, side: null, dt: 0, db: 0, white: null, action: "skip(no-height)" },
    };
  }

  // h0 > HEIGHT_MATCH → 疑似 wm1 条带，全解码匹配
  const img = decodeJpeg(raw);
  if (!img) {
    return {
      bytes: raw,
      changed: false,
      info: { w: 0, h: h0, side: null, dt: 0, db: 0, white: null, action: "decode-fail" },
    };
  }

  let tpl: Decoded;
  try {
    tpl = loadTemplate();
  } catch {
    return {
      bytes: raw,
      changed: false,
      info: { w: img.width, h: img.height, side: null, dt: 0, db: 0, white: null, action: "tpl-load-fail" },
    };
  }

  const { side, dt, db } = detectSide(img, tpl);

  if (!side) {
    return {
      bytes: raw,
      changed: false,
      info: { w: img.width, h: img.height, side: null, dt: rnd(dt), db: rnd(db), white: null, action: "passthrough" },
    };
  }

  const work = cropStrip(img, side);
  const white = whiteFrac(work);
  if (white >= DELETE_THR) {
    return {
      bytes: whitePlaceholder(),
      changed: true,
      info: { w: img.width, h: img.height, side, dt: rnd(dt), db: rnd(db), white: rnd(white, 3), action: "blank" },
    };
  }
  return {
    bytes: encodeJpeg(work, JPEG_QUALITY),
    changed: true,
    info: { w: img.width, h: img.height, side, dt: rnd(dt), db: rnd(db), white: rnd(white, 3), action: "cropped" },
  };
}
