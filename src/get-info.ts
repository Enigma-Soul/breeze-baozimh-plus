import type { InfoContract } from "../types/type";
import { PLUGIN_ID } from "./common";

export function buildPluginInfo(): InfoContract {
  return {
    name: "包子漫画 Plus",
    uuid: PLUGIN_ID,
    iconUrl: "https://www.baozimh.com/favicon.ico",
    creator: {
      name: "Enigma_Soul",
      describe: "包子漫画去水印增强插件",
    },
    describe: "包子漫画抓取 + wm1 版权横幅裁切 + 空白错误页处理（纯 TS，无 WASM）",
    version: "0.1.0",
    home: "https://github.com/Enigma-Soul/breeze-baozimh-plus",
    updateUrl:
      "https://api.github.com/repos/Enigma-Soul/breeze-baozimh-plus/releases/latest",
    npmName: "breeze-plugin-baozimh-plus",
    function: [],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
