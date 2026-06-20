// 调试日志：console.log + 自报到 dev server 的 /log（绕过宿主 console 通道的不确定性）。
// 由设置开关控制；关闭时 dbg() 直接 return，零开销。
// 自报候选地址覆盖本机 PC（localhost/127）与同 WiFi 手机（WLAN IP），端口兼容 7878/7879。

// 只发到本机 dev server（PC 上 Breeze 走 localhost 即可达），避免多端点 fetch 泛洪拖慢。
// 手机端如需收日志，把对应 WLAN 地址加进这个数组。
const ENDPOINTS = ["http://localhost:7878/log"];

let enabled = false;

export function setDebug(on: boolean): void {
  enabled = on;
}

export function isDebug(): boolean {
  return enabled;
}

/** 调试输出：开关闭合时，同时 console.log + POST 到 dev server /log */
export function dbg(msg: string, data?: unknown): void {
  if (!enabled) return;
  const payload =
    data === undefined
      ? ""
      : typeof data === "string"
        ? data
        : JSON.stringify(data);
  const line = payload ? `${msg} ${payload}` : msg;
  console.log("[baozimh+]", line);
  const body = JSON.stringify({ level: "log", message: `[baozimh+] ${line}` });
  for (const u of ENDPOINTS) {
    try {
      void fetch(u, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }).then(
        () => {},
        () => {},
      );
    } catch {
      /* 单个端点失败忽略 */
    }
  }
}
