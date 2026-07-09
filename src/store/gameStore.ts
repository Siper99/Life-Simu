// 全局状态：界面路由、开局流程、回合状态机（idle → parsing → swinging → narrating → idle）。

import { create } from "zustand";
import { GenderPref, applyTalent, newGameState, reassignGender } from "../engine/genesis";
import { Rng } from "../engine/rng";
import { appendWeeklyNote } from "../engine/memory";
import { tierFromOffset } from "../engine/resolver";
import { beginTurn, fastForward, finalizeTurn } from "../engine/turn";
import { GameState, Talent, Tier, TIER_LABELS, formatDate } from "../engine/types";
import { narrateTurn, parseIntents, writeEpitaph } from "../llm/orchestrator";
import { AppSettings, DEFAULT_SETTINGS } from "../llm/types";
import * as persist from "./persist";

export type Screen = "menu" | "genesis" | "game" | "settings";
export type TurnPhase = "idle" | "parsing" | "swinging" | "narrating";

interface GenesisDraft {
  state: GameState;
  talentChoices: Talent[];
  rerollsLeft: number;
}

interface Store {
  screen: Screen;
  settings: AppSettings;
  settingsLoaded: boolean;
  game: GameState | null;
  genesis: GenesisDraft | null;
  saves: persist.SaveMeta[];
  phase: TurnPhase;
  currentCheckIndex: number; // pending.checks 中当前待处理的
  lastError: string | null;
  genderPref: GenderPref; // 开局性别偏好：随机/男/女

  init: () => Promise<void>;
  setScreen: (s: Screen) => void;
  updateSettings: (s: AppSettings) => Promise<void>;
  refreshSaves: () => Promise<void>;

  startNewGame: () => void;
  rerollGenesis: () => void;
  setGenderPref: (pref: GenderPref) => void;
  chooseTalent: (t: Talent) => Promise<void>;
  loadSave: (id: string) => Promise<void>;
  deleteSave: (id: string) => Promise<void>;

  submitTurn: (text: string) => Promise<void>;
  reportSwing: (offset: number) => Promise<void>;
  doFastForward: (turns: number) => Promise<void>;
}

function touch(game: GameState): GameState {
  return { ...game };
}

export const useStore = create<Store>((set, get) => ({
  screen: "menu",
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  game: null,
  genesis: null,
  saves: [],
  phase: "idle",
  currentCheckIndex: 0,
  lastError: null,
  genderPref: "random",

  init: async () => {
    const settings = await persist.loadSettings();
    const saves = await persist.listSaves();
    set({ settings, saves, settingsLoaded: true });
  },

  setScreen: (screen) => set({ screen }),

  updateSettings: async (settings) => {
    set({ settings });
    await persist.saveSettings(settings);
  },

  refreshSaves: async () => set({ saves: await persist.listSaves() }),

  startNewGame: () => {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const { state, talentChoices } = newGameState(seed, get().genderPref);
    set({ genesis: { state, talentChoices, rerollsLeft: 2 }, screen: "genesis" });
  },

  rerollGenesis: () => {
    const g = get().genesis;
    if (!g || g.rerollsLeft <= 0) return;
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const { state, talentChoices } = newGameState(seed, get().genderPref);
    set({ genesis: { state, talentChoices, rerollsLeft: g.rerollsLeft - 1 } });
  },

  setGenderPref: (pref) => {
    const g = get().genesis;
    // 选定男/女时当场换性别与名字（不消耗重掷次数）；选随机只影响之后的重掷
    if (g && pref !== "random") {
      reassignGender(g.state.character, pref, new Rng(Date.now() >>> 0));
      set({ genderPref: pref, genesis: { ...g, state: { ...g.state } } });
    } else {
      set({ genderPref: pref });
    }
  },

  chooseTalent: async (talent) => {
    const g = get().genesis;
    if (!g) return;
    applyTalent(g.state.character, talent);
    g.state.log.push({
      turn: 0,
      date: `${g.state.character.birthYear}年`,
      kind: "system",
      text: `天赋觉醒：【${talent.name}】${talent.desc}`,
    });
    set({ game: touch(g.state), genesis: null, screen: "game", phase: "idle" });
    await persist.saveGame(g.state);
    await get().refreshSaves();
  },

  loadSave: async (id) => {
    try {
      const game = await persist.loadGame(id);
      // 读档时丢弃未完成的回合中间态，回到输入阶段
      game.pending = null;
      set({ game, screen: "game", phase: "idle", lastError: null });
    } catch (e) {
      set({ lastError: `读档失败：${e}` });
    }
  },

  deleteSave: async (id) => {
    await persist.deleteSave(id);
    await get().refreshSaves();
  },

  submitTurn: async (text) => {
    const { game, settings, phase } = get();
    if (!game || game.ended || phase !== "idle") return;
    set({ phase: "parsing", lastError: null });

    game.log.push({ turn: game.turn, date: formatDate(game), kind: "player", text });
    set({ game: touch(game) });

    try {
      const { intents } = await parseIntents(settings, game, text);
      const pending = beginTurn(game, text, intents);
      game.pending = pending;
      // 必须先把 pending 同步进 store：finishTurn 内部用 get() 重新取 game，
      // 如果这里不 touch，它拿到的还是上一次 set 时的旧引用，pending 为空会静默 return，
      // 导致 UI 卡在"正在理解你的安排……"不再有任何回应。
      set({ game: touch(game) });
      if (pending.checks.length > 0) {
        set({ phase: "swinging", currentCheckIndex: 0 });
      } else {
        await finishTurn(set, get);
      }
    } catch (e) {
      set({ phase: "idle", lastError: `回合处理失败：${e}` });
    }
  },

  reportSwing: async (offset) => {
    const { game, currentCheckIndex } = get();
    const pending = game?.pending;
    if (!game || !pending) return;
    const check = pending.checks[currentCheckIndex];
    if (!check) return;
    const tier: Tier = tierFromOffset(offset, check.zones);
    pending.checkResults.push({ checkId: check.actionId, tier, offset });
    game.log.push({
      turn: game.turn,
      date: formatDate(game),
      kind: "system",
      text: `⚡ ${check.label} → ${TIER_LABELS[tier]}`,
    });
    if (currentCheckIndex + 1 < pending.checks.length) {
      set({ game: touch(game), currentCheckIndex: currentCheckIndex + 1 });
    } else {
      set({ game: touch(game) });
      await finishTurn(set, get);
    }
  },

  doFastForward: async (turns) => {
    const { game, phase } = get();
    if (!game || game.ended || phase !== "idle") return;
    const notes = fastForward(game, turns);
    game.log.push({
      turn: game.turn,
      date: formatDate(game),
      kind: "system",
      text: `时光飞逝……${notes.length > 0 ? notes.slice(-5).join("；") : "平静无事。"}`,
    });
    if (game.ended) {
      await handleDeath(set, get);
    }
    set({ game: touch(game) });
    await persist.saveGame(game);
  },
}));

type Set = (partial: Partial<Store>) => void;
type Get = () => Store;

async function finishTurn(set: Set, get: Get): Promise<void> {
  const { game, settings } = get();
  const pending = game?.pending;
  if (!game || !pending) return;
  set({ phase: "narrating" });

  const outcome = finalizeTurn(game, pending);
  const { text } = await narrateTurn(settings, game, pending.playerText, outcome);

  game.log.push({ turn: game.turn, date: formatDate(game), kind: "narrative", text });
  appendWeeklyNote(game, text);

  if (outcome.died) {
    game.ended = true;
    await handleDeath(set, get);
  }

  set({ game: touch(game), phase: "idle" });
  await persist.saveGame(game);
  await get().refreshSaves();
}

async function handleDeath(set: Set, get: Get): Promise<void> {
  const { game, settings } = get();
  if (!game) return;
  const { summary, epitaph } = await writeEpitaph(settings, game);
  game.epitaph = epitaph;
  game.log.push({
    turn: game.turn,
    date: formatDate(game),
    kind: "system",
    text: `【人生落幕】${summary}\n\n墓志铭：${epitaph}`,
  });
  set({ game: touch(game) });
  await persist.saveGame(game);
}
