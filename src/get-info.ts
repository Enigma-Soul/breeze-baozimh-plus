import type { InfoContract } from "../types/type";
import { PLUGIN_ID } from "./common";

export function buildPluginInfo(): InfoContract {
  return {
    name: "包子漫画 Plus",
    uuid: PLUGIN_ID,
    iconUrl: "https://www.baozimh.com/favicon.ico",
    creator: {
      name: "Enigma_Soul",
      describe: "包子漫画增强插件",
    },
    describe: "包子漫画增强：繁简转换、翻页预读",
    version: "0.4.1",
    home: "https://github.com/Enigma-Soul/Breeze-plugin-baozimh-plus",
    updateUrl:
      "https://api.github.com/repos/Enigma-Soul/Breeze-plugin-baozimh-plus/releases/latest",
    npmName: "breeze-plugin-baozimh-plus",
    function: [],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
