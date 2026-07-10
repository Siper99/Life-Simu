// 持久化：Tauri 环境写 appData JSON 文件；纯浏览器预览退回 localStorage。

import { invoke } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { GameState } from "../engine/types";
import { AppSettings, DEFAULT_SETTINGS } from "../llm/types";

const IS_TAURI = "__TAURI_INTERNALS__" in window;
const DIR = { baseDir: BaseDirectory.AppData };

/** 旧存档迁移：新增规则字段时在这里补默认值，避免已有角色无法继续。 */
function migrateGame(state: GameState): GameState {
  state.character.energy ??= 75;
  state.decisionHistory ??= [];
  return state;
}

async function ensureDirs(): Promise<void> {
  if (!(await exists("saves", DIR))) {
    await mkdir("saves", { ...DIR, recursive: true });
  }
}

export interface SaveMeta {
  id: string;
  name: string;
  date: string;
  updatedAt: number;
}

function metaOf(state: GameState): SaveMeta {
  return {
    id: state.id,
    name: `${state.character.name}（${state.background.city}·${state.background.familyClass}）`,
    date: `${state.world.year}年，${state.world.year - state.character.birthYear}岁${state.ended ? "·已终结" : ""}`,
    updatedAt: state.updatedAt,
  };
}

export async function saveGame(state: GameState): Promise<void> {
  const json = JSON.stringify(state);
  if (IS_TAURI) {
    await ensureDirs();
    await writeTextFile(`saves/${state.id}.json`, json, DIR);
  } else {
    localStorage.setItem(`lifesim:${state.id}`, json);
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  const out: SaveMeta[] = [];
  if (IS_TAURI) {
    await ensureDirs();
    for (const entry of await readDir("saves", DIR)) {
      if (!entry.name.endsWith(".json")) continue;
      try {
        const state = migrateGame(JSON.parse(await readTextFile(`saves/${entry.name}`, DIR)) as GameState);
        out.push(metaOf(state));
      } catch {
        // 损坏的存档跳过
      }
    }
  } else {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("lifesim:save-")) continue;
      try {
        out.push(metaOf(migrateGame(JSON.parse(localStorage.getItem(key)!) as GameState)));
      } catch {
        // skip
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadGame(id: string): Promise<GameState> {
  const json = IS_TAURI
    ? await readTextFile(`saves/${id}.json`, DIR)
    : localStorage.getItem(`lifesim:${id}`);
  if (!json) throw new Error("存档不存在");
  return migrateGame(JSON.parse(json) as GameState);
}

export async function deleteSave(id: string): Promise<void> {
  if (IS_TAURI) {
    await remove(`saves/${id}.json`, DIR);
  } else {
    localStorage.removeItem(`lifesim:${id}`);
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (IS_TAURI) {
    // API key 存 Windows 凭据管理器，settings.json 只落空占位
    const previous = await readSettingsFile();
    const currentIds = new Set(settings.profiles.map((p) => p.id));
    for (const old of previous?.profiles ?? []) {
      if (!currentIds.has(old.id)) {
        await invoke("secret_delete", { profileId: old.id }).catch(() => {});
      }
    }
    for (const p of settings.profiles) {
      await invoke("secret_set", { profileId: p.id, value: p.apiKey });
    }
    const sanitized: AppSettings = {
      ...settings,
      profiles: settings.profiles.map((p) => ({ ...p, apiKey: "" })),
    };
    await writeTextFile("settings.json", JSON.stringify(sanitized, null, 2), DIR);
  } else {
    localStorage.setItem("lifesim:settings", JSON.stringify(settings));
  }
}

async function readSettingsFile(): Promise<AppSettings | null> {
  try {
    const json = IS_TAURI
      ? (await exists("settings.json", DIR))
        ? await readTextFile("settings.json", DIR)
        : null
      : localStorage.getItem("lifesim:settings");
    if (!json) return null;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(json) as Partial<AppSettings>) };
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const settings = await readSettingsFile();
  if (!settings) return DEFAULT_SETTINGS;
  if (IS_TAURI) {
    for (const p of settings.profiles) {
      p.apiKey = await invoke<string>("secret_get", { profileId: p.id }).catch(() => "");
    }
  }
  return settings;
}
