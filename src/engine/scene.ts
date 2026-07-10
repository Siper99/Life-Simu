// 场景模式：把镜头从「一季」拉近到「此刻」——一个时间冻结的连续场景，
// 玩家一拍台词/动作、场景引擎接一拍剧情，适合深入的对话与亲密剧情。
// 世界时钟不走：预算是精力（每拍固定消耗），收场时由引擎结算好感与心境。

import { Rng } from "./rng";
import { GameState, clamp, emptyDeltas } from "./types";
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
