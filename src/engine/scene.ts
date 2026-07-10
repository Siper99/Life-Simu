// 场景模式：把镜头从「一季」拉近到「此刻」——一个时间冻结的连续场景，
// 玩家一拍台词/动作、场景引擎接一拍剧情，适合深入的对话与亲密剧情。
// 世界时钟不走：预算是精力（每拍固定消耗），收场时由引擎结算好感与心境。

import { Rng } from "./rng";
import { GameState, Identity, clamp, emptyDeltas } from "./types";
import { applyDeltas } from "./resolver";

export const SCENE_MAX_BEATS = 12; // 一场戏的上限：再长该收场了
export const SCENE_BEAT_ENERGY = 5; // 每拍精力消耗

/** 能否进入场景；返回错误文案，null = 可以 */
export function canEnterScene(state: GameState): string | null {
  if (state.ended) return "人生已落幕";
  if (state.pending) return "先处理完当前回合的判定";
  if (state.scene) return "已有场景进行中";
  if (state.character.energy < SCENE_BEAT_ENERGY * 2) return "精力不足以支撑一场戏，先休整";
  return null;
}

export function beginScene(state: GameState, target: string | null, nsfw: boolean): void {
  state.scene = { target, nsfw, beats: [], startedTurn: state.turn };
}

/** 这一拍能不能继续；返回错误文案，null = 可以 */
export function sceneBeatError(state: GameState): string | null {
  const scene = state.scene;
  if (!scene) return "没有进行中的场景";
  if (scene.beats.length >= SCENE_MAX_BEATS) return `一场戏最多 ${SCENE_MAX_BEATS} 拍，该收场了`;
  if (state.character.energy < SCENE_BEAT_ENERGY) return "精力见底，这场戏撑不下去了";
  return null;
}

export function applySceneBeatCost(state: GameState): void {
  state.character.energy = clamp(state.character.energy - SCENE_BEAT_ENERGY, 0, 100);
}

// ---------- 场景后果：戏里发生的事当场落到引擎真值 ----------

/** 一拍的结构化后果：LLM 在正文尾行输出 EFFECTS:{...}，这里是净化后的形态 */
export interface SceneEffects {
  money: number;
  mood: number;
  affinity: number;
  connections: number;
  legal: Identity["legalStatus"] | null; // null = 本拍没有法律处境变化
  conditionsAdd: string[];
  conditionsRemove: string[];
}

const LEGAL_STATUSES = new Set<Identity["legalStatus"]>(["清白", "缓刑", "服刑", "通缉"]);

export function emptySceneEffects(): SceneEffects {
  return { money: 0, mood: 0, affinity: 0, connections: 0, legal: null, conditionsAdd: [], conditionsRemove: [] };
}

/**
 * 净化 LLM 给出的场景后果：数值全部 clamp 到单拍合理区间，法律状态走白名单。
 * 红线：LLM 只产出意图，真值变化必须经这里裁剪落地。
 */
export function sanitizeSceneEffects(state: GameState, raw: unknown): SceneEffects {
  const fx = emptySceneEffects();
  if (!raw || typeof raw !== "object") return fx;
  const r = raw as Record<string, unknown>;

  // 单拍金钱量级：跟人物收入水平挂钩（与 resolver.moneyScale 同口径），
  // 且花销不能超过「现有的钱 + 少量透支」——戏再大也掏不出没有的钱
  const c = state.character;
  const age = state.world.year - c.birthYear;
  const scale = c.identity.job ? Math.max(80, c.identity.job.weeklyPay * 0.5) : age < 18 ? 40 : 300;
  const cap = Math.max(1000, Math.round(scale * 10));
  const money = clamp(Math.round(Number(r.money) || 0), -cap, cap);
  fx.money = Math.max(money, -(Math.max(0, c.money) + 5000));

  fx.mood = clamp(Math.round(Number(r.mood) || 0), -8, 8);
  fx.affinity = clamp(Math.round(Number(r.affinity) || 0), -10, 10);
  fx.connections = clamp(Math.round(Number(r.connections) || 0), -3, 3);

  const legal = String(r.legal ?? "");
  if (LEGAL_STATUSES.has(legal as Identity["legalStatus"]) && legal !== c.identity.legalStatus) {
    fx.legal = legal as Identity["legalStatus"];
  }

  const cleanList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((item) => String(item).trim().slice(0, 8)).filter(Boolean).slice(0, 2)
      : [];
  fx.conditionsAdd = cleanList(r.conditions_add);
  fx.conditionsRemove = cleanList(r.conditions_remove);
  return fx;
}

/**
 * 把净化后的后果实时应用到人物（金钱/心境/好感/人脉经 applyDeltas，法律状态与
 * 状态列表直改 identity），返回给日志用的变化描述（空数组 = 这拍没有数值后果）。
 */
export function applySceneEffects(state: GameState, target: string | null, fx: SceneEffects): string[] {
  const notes: string[] = [];
  const c = state.character;

  const deltas = emptyDeltas();
  deltas.money = fx.money;
  if (fx.mood) deltas.attrs.mood = fx.mood;
  deltas.connections = fx.connections;
  if (fx.affinity && target) deltas.affinity.push({ npcName: target, delta: fx.affinity });
  applyDeltas(state, deltas);

  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  if (fx.money) notes.push(`金钱 ${sign(fx.money)}`);
  if (fx.mood) notes.push(`心境 ${sign(fx.mood)}`);
  if (fx.affinity && target) notes.push(`${target}好感 ${sign(fx.affinity)}`);
  if (fx.connections) notes.push(`人脉 ${sign(fx.connections)}`);

  if (fx.legal) {
    c.identity.legalStatus = fx.legal;
    notes.push(`⚖️ 法律处境：${fx.legal}`);
  }
  for (const cond of fx.conditionsAdd) {
    if (!c.identity.conditions.includes(cond)) {
      c.identity.conditions.push(cond);
      notes.push(`状态 +${cond}`);
    }
  }
  if (c.identity.conditions.length > 6) c.identity.conditions = c.identity.conditions.slice(-6);
  for (const cond of fx.conditionsRemove) {
    if (c.identity.conditions.includes(cond)) {
      c.identity.conditions = c.identity.conditions.filter((item) => item !== cond);
      notes.push(`状态 -${cond}`);
    }
  }
  return notes;
}

/**
 * 场景收场：按投入的拍数结算好感与心境（引擎持数值真值，叙事只是演出），
 * 给对手 NPC 记一条共同记忆，然后清空场景。返回结算文案。
 */
export function settleScene(state: GameState): string[] {
  const scene = state.scene;
  if (!scene) return [];
  const notes: string[] = [];
  const beats = scene.beats.length;

  if (beats > 0) {
    const rng = Rng.fromState(state.rngState);
    const deltas = emptyDeltas();
    deltas.attrs.mood = rng.int(1, Math.min(6, 1 + beats));
    if (scene.target) {
      deltas.affinity.push({
        npcName: scene.target,
        delta: Math.min(14, Math.max(1, Math.round(beats * rng.range(0.8, 1.6)))),
      });
    }
    applyDeltas(state, deltas);
    state.rngState = rng.getState();

    const npc = scene.target ? state.character.npcs.find((n) => n.name === scene.target) : null;
    if (npc) {
      // 共同记忆永远用含蓄措辞——它会进入 statusCard 发给所有后端
      npc.memories.push(`${state.world.year}年，一段专注的相处`);
      if (npc.memories.length > 8) npc.memories = npc.memories.slice(-8);
    }
    notes.push(`一段专注的相处（${beats} 拍）${scene.target ? `，${scene.target}和你的距离近了一点` : ""}`);
  }

  state.scene = null;
  return notes;
}
