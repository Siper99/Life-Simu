// 自动更新：检查 GitHub Release 上的 latest.json，有新版则下载安装并重启。
// 仅在 Tauri 打包环境下可用；浏览器开发环境直接返回 null。

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  notes: string;
  /** 下载安装并重启应用 */
  install: () => Promise<void>;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    install: async () => {
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}
