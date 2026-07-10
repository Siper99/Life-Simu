// 全局状态：界面路由、开局流程、回合状态机（idle → parsing → swinging → narrating → idle）。

import { create } from "zustand";
import { GenderPref, applyTalent, newGameState, reassignGender } from "../engine/genesis";
import { Rng } from "../engine/rng";
import { appendWeeklyNote } from "../engine/memory";
import { DecisionBoard, DecisionChoice, getDecisionBoard, selectionError } from "../engine/decisions";
import { SWING_EASE_LEVELS, judgeSwing as engineJudgeSwing } from "../engine/resolver";
import { beginTurn, fastForward, finalizeTurn, TurnOutcome } from "../engine/turn";
import {
  ATTR_LABELS,
  AttrKey,
  GameState,
  SwingVerdict,
  Talent,
  TIER_LABELS,
  formatDate,
} from "../engine/types";
import { narrateSkip, narrateTurn, parseIntents, proposeChoices, writeEpitaph } from "../llm/orchestrator";
import { AppSettings, DEFAULT_SETTINGS, profileForRole } from "../llm/types";
import * as persist from "./persist";

export type Screen = "menu" | "genesis" | "game" | "settings";
export type TurnPhase = "idle" | "parsing" | "swinging" | "narrating";

/** 结算浮字：一条数值变化（绿升红降，技能升级金色） */
export interface FloatChip {
  text: string;
  kind: "up" | "down" | "gold";
}

/** 一个回合结算产生的浮字批次；seq 递增用于触发重播 */
export interface FloatBatch {
  seq: number;
  chips: FloatChip[];
  attrDeltas: Partial<Record<AttrKey, number>>; // 属性行闪烁用
}

/** LLM 补充行动卡：按局+回合缓存，过期即弃 */
export interface LlmChoiceBatch {
  gameId: string;
  turn: number;
  choices: DecisionChoice[];
  loading: boolean;
}

/** 固定卡池 + 本回合有效的 LLM 补充卡 → 完整决策盘（UI 与提交校验共用同一份） */
export function mergedBoard(game: GameState, llm: LlmChoiceBatch | null): DecisionBoard {
  const extras =
    llm && llm.gameId === game.id && llm.turn === game.turn && !llm.loading ? llm.choices : [];
  return getDecisionBoard(game, extras);
}

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
  floats: FloatBatch | null; // 最近一次结算的浮字
  llmChoices: LlmChoiceBatch | null; // 本回合的 LLM 补充行动卡
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
  submitChoices: (choiceIds: string[]) => Promise<void>;
  judgeSwing: (offset: number) => SwingVerdict | null; // 停针瞬间：判定+豁免掷点，返回最终结论供演出
  confirmSwing: () => Promise<void>; // 演出结束：推进到下一针或结算回合
  doFastForward: (turns: number, spanLabel?: string) => Promise<void>;
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
  floats: null,
  llmChoices: null,
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
    g.state.log.push({
      turn: 0,
      date: `${g.state.character.birthYear}年`,
      kind: "system",
      text:
        "【指引】天命已定——出身、家庭、时代都无法重来。每回合你有三格时间，" +
        "先从系统给出的现实选项里安排生活；限时机会错过就不会回来。" +
        "如果这些选项都不够，你仍然可以展开「自定义行动」。",
    });
    set({ game: touch(g.state), genesis: null, screen: "game", phase: "idle", floats: null });
    refreshLlmChoices(set, get);
    await persist.saveGame(g.state);
    await get().refreshSaves();
  },

  loadSave: async (id) => {
    try {
      const game = await persist.loadGame(id);
      // 读档时丢弃未完成的回合中间态，回到输入阶段
      game.pending = null;
      set({ game, screen: "game", phase: "idle", floats: null, lastError: null });
      refreshLlmChoices(set, get);
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
      const pending = beginTurn(game, text, intents, SWING_EASE_LEVELS[settings.swingDifficulty]);
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


  submitChoices: async (choiceIds) => {
    const { game, phase, llmChoices, settings } = get();
    if (!game || game.ended || phase !== "idle") return;
    // 必须与 UI 使用同一份合并看板，否则选中的 LLM 卡会被误判过期
    const board = mergedBoard(game, llmChoices);
    const error = selectionError(game, board, choiceIds);
    if (error) {
      set({ lastError: error });
      return;
    }
    const selected = choiceIds.map((id) => board.choices.find((choice) => choice.id === id)!);
    const text = selected.map((choice) => choice.title).join("；");
    const intents = selected.map((choice, index) => ({
      ...choice.intent,
      id: `choice-${game.turn}-${index}`,
    }));

    set({ phase: "parsing", lastError: null });
    game.log.push({ turn: game.turn, date: formatDate(game), kind: "player", text });
    game.decisionHistory.push({
      turn: game.turn,
      choiceIds: selected.map((choice) => choice.id),
      categories: intents.map((intent) => intent.category),
    });
    if (game.decisionHistory.length > 24) game.decisionHistory = game.decisionHistory.slice(-24);

    try {
      const pending = beginTurn(game, text, intents, SWING_EASE_LEVELS[settings.swingDifficulty]);
      game.pending = pending;
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
  judgeSwing: (offset) => {
    const { game, currentCheckIndex } = get();
    const pending = game?.pending;
    if (!game || !pending) return null;
    const check = pending.checks[currentCheckIndex];
    if (!check) return null;
    if (pending.checkResults.some((r) => r.checkId === check.actionId)) return null; // 防重复停针
    const verdict = engineJudgeSwing(game, check, offset); // 引擎判定 + 豁免掷点（写回 rngState）
    pending.checkResults.push({ checkId: check.actionId, ...verdict, offset });
    game.log.push({
      turn: game.turn,
      date: formatDate(game),
      kind: "system",
      text: verdict.saved
        ? `⚡ ${check.label} → 大失败…🍀 运气救场，降为失败！`
        : `⚡ ${check.label} → ${TIER_LABELS[verdict.tier]}`,
    });
    set({ game: touch(game) });
    return verdict;
  },

  confirmSwing: async () => {
    const { game, currentCheckIndex } = get();
    const pending = game?.pending;
    if (!game || !pending) return;
    if (currentCheckIndex + 1 < pending.checks.length) {
      set({ currentCheckIndex: currentCheckIndex + 1 });
    } else {
      await finishTurn(set, get);
    }
  },

  doFastForward: async (turns, spanLabelIn) => {
    const { game, phase, settings } = get();
    if (!game || game.ended || phase !== "idle") return;
    set({ phase: "narrating", lastError: null });

    const unit = game.granularity === "week" ? "周" : game.granularity === "month" ? "个月" : "年";
    const spanLabel = spanLabelIn ?? (turns === 1 ? `这一${unit}` : `${turns}${unit}`);
    const notes = fastForward(game, turns);
    // 跳过也有内容：把被动变化（收支/健康/时代事件）写成一段岁月摘要
    const { text } = await narrateSkip(settings, game, spanLabel, notes);
    game.log.push({ turn: game.turn, date: formatDate(game), kind: "narrative", text });
    appendWeeklyNote(game, text);

    if (game.ended) {
      await handleDeath(set, get);
    }
    set({ game: touch(game), phase: "idle" });
    refreshLlmChoices(set, get);
    await persist.saveGame(game);
  },
}));

type Set = (partial: Partial<Store>) => void;
type Get = () => Store;

/**
 * 请求 LLM 为当前回合补充行动卡（异步，不阻塞决策盘展示）。
 * 结果落地前若回合/存档已变化则丢弃，避免旧卡串场。
 */
function refreshLlmChoices(set: Set, get: Get): void {
  const { game, settings } = get();
  if (!game || game.ended) {
    set({ llmChoices: null });
    return;
  }
  if (!profileForRole(settings, "narrative")) {
    set({ llmChoices: null }); // 未配置 LLM：固定卡池全量兜底
    return;
  }
  const gameId = game.id;
  const turn = game.turn;
  set({ llmChoices: { gameId, turn, choices: [], loading: true } });
  void proposeChoices(settings, game, getDecisionBoard(game)).then((choices) => {
    const cur = get();
    if (cur.game?.id === gameId && cur.game.turn === turn) {
      set({ llmChoices: { gameId, turn, choices, loading: false } });
    }
  });
}

async function finishTurn(set: Set, get: Get): Promise<void> {
  const { game, settings } = get();
  const pending = game?.pending;
  if (!game || !pending) return;
  set({ phase: "narrating" });

  // 技能等级快照：finalize 后对比检出升级，浮金色字
  const lvBefore = new Map(game.character.skills.map((s) => [s.id, s.level]));
  const outcome = finalizeTurn(game, pending);
  const { chips, attrDeltas } = collectFloatChips(game, outcome, lvBefore);
  const { text, hooks: newHooks } = await narrateTurn(settings, game, pending.playerText, outcome);

  game.log.push({ turn: game.turn, date: formatDate(game), kind: "narrative", text });
  appendWeeklyNote(game, text);

  // 线头生命周期：叙事已拿到过期线头做最后交代，此后只保留 4 回合内的 + 本回合新增，上限 6 条
  const activeHooks = game.hooks.filter((h) => game.turn - h.turn <= 4);
  game.hooks = [
    ...activeHooks,
    ...newHooks.map((t, i) => ({ id: `hook-${game.turn}-${i}`, text: t, turn: game.turn })),
  ].slice(-6);

  if (outcome.died) {
    game.ended = true;
    await handleDeath(set, get);
  }

  set({
    game: touch(game),
    phase: "idle",
    floats:
      chips.length > 0
        ? { seq: (get().floats?.seq ?? 0) + 1, chips, attrDeltas }
        : get().floats,
  });
  refreshLlmChoices(set, get);
  await persist.saveGame(game);
  await get().refreshSaves();
}

/** 把本回合行动/事件的数值变化摊平、合并同类，转成浮字队列 */
function collectFloatChips(
  game: GameState,
  outcome: TurnOutcome,
  lvBefore: Map<string, number>,
): { chips: FloatChip[]; attrDeltas: Partial<Record<AttrKey, number>> } {
  const attrs = new Map<AttrKey, number>();
  const affinity = new Map<string, number>();
  let money = 0;
  let connections = 0;

  const deltas = outcome.actions.map((a) => a.deltas);
  let energy = 0;
  if (outcome.event) deltas.push(outcome.event.deltas);
  for (const d of deltas) {
    for (const [k, v] of Object.entries(d.attrs)) {
      if (v) attrs.set(k as AttrKey, (attrs.get(k as AttrKey) ?? 0) + v);
    }
    money += d.money;
    connections += d.connections;
    energy += d.energy;
    for (const a of d.affinity) affinity.set(a.npcName, (affinity.get(a.npcName) ?? 0) + a.delta);
  }

  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  const chips: FloatChip[] = [];
  const attrDeltas: Partial<Record<AttrKey, number>> = {};
  for (const [k, v] of attrs) {
    if (v === 0) continue;
    attrDeltas[k] = v;
    chips.push({ text: `${sign(v)} ${ATTR_LABELS[k]}`, kind: v > 0 ? "up" : "down" });
  }
  if (money !== 0) chips.push({ text: `${sign(money)} 金钱`, kind: money > 0 ? "up" : "down" });
  if (connections !== 0)
    chips.push({ text: `${sign(connections)} 人脉`, kind: connections > 0 ? "up" : "down" });
  if (energy !== 0) chips.push({ text: `${sign(energy)} 精力`, kind: energy > 0 ? "up" : "down" });
  for (const [name, v] of affinity) {
    if (v !== 0) chips.push({ text: `${name} 好感${sign(v)}`, kind: v > 0 ? "up" : "down" });
  }
  for (const s of game.character.skills) {
    if (s.level > (lvBefore.get(s.id) ?? 0)) {
      chips.push({ text: `🎉 ${s.name} Lv${s.level}`, kind: "gold" });
    }
  }
  return { chips: chips.slice(0, 8), attrDeltas }; // 截断防刷屏
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
