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
import { GameState, granularityOf } from "../engine/types";
import { migratedAttributeBounds } from "../engine/attributes";
import { AppSettings, DEFAULT_SETTINGS } from "../llm/types";

const IS_TAURI = "__TAURI_INTERNALS__" in window;
const DIR = { baseDir: BaseDirectory.AppData };

/** 旧存档迁移：新增规则字段时在这里补默认值，避免已有角色无法继续。 */
export function migrateGame(state: GameState): GameState {
  state.character.energy ??= 75;
  state.character.lifestyle ??= "standard";
  state.scene ??= null;
  state.decisionHistory ??= [];
  state.hooks ??= [];
  state.character.attrBounds ??= migratedAttributeBounds(state.character, state.id);
  state.granularity = granularityOf(state.world.year - state.character.birthYear);

  for (const npc of state.character.npcs) {
    // v0.1 的父母关系写成“父亲（职业）”，迁移时拆成两个可独立变化的字段。
    const legacy = npc.relation.match(/^([^（(]+)[（(]([^）)]+)[）)]$/);
    if (legacy) {
      npc.relation = legacy[1];
      npc.occupation ??= legacy[2];
    }
    npc.birthYear ??= state.character.birthYear + (
      npc.relation === "父亲" ? -30
      : npc.relation === "母亲" ? -28
      : /哥哥|姐姐/.test(npc.relation) ? -3
      : /弟弟|妹妹/.test(npc.relation) ? 3
      : 0
    );
    npc.occupation ??= /哥哥|姐姐|弟弟|妹妹/.test(npc.relation) ? "学生" : null;
    npc.health ??= 70;
    npc.conditions ??= [];
  }

  const job = state.character.identity.job;
  if (job) {
    job.track ??= "通用";
    job.level ??= 0;
    job.xp ??= 0;
  }

  // 旧存档的技能名是行动描述（"扶着家具探索"）：6 字以上判定为旧数据，清除
  state.character.skills = state.character.skills.filter((s) => s.name.length < 6);

  // 学段命名的课业技能已废弃：合并为不过时的「学识」（保留练得最深的那份进度）
  const LEGACY_STUDY = new Set(["小学课业", "初中课业", "高中课业", "大学课业", "大学学业", "课业"]);
  const legacy = state.character.skills.filter((s) => LEGACY_STUDY.has(s.name));
  if (legacy.length > 0) {
    state.character.skills = state.character.skills.filter((s) => !LEGACY_STUDY.has(s.name));
    const best = legacy.reduce((a, b) => (b.level > a.level || (b.level === a.level && b.xp > a.xp) ? b : a));
    const existing = state.character.skills.find((s) => s.name === "学识");
    if (existing) {
      if (best.level > existing.level || (best.level === existing.level && best.xp > existing.xp)) {
        existing.level = best.level;
        existing.xp = best.xp;
      }
    } else {
      state.character.skills.push({ ...best, name: "学识", category: "学业" });
    }
  }
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
