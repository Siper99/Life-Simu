// 回合编排（纯引擎侧，不含 LLM 调用）：开始回合 → 收集摆动条结果 → 终局结算 → 时间推进。

import { Rng } from "./rng";
import { epochEventFor, getWorldPulse } from "./decisions";
import { pickEvent, WEEKLY_EVENT_CHANCE } from "./events";
import {
  DEFAULT_SWING_EASE,
  applyDeltas,
  autoTier,
  buildSwingCheck,
  resolveAction,
  resolveEvent,
} from "./resolver";
import {
  ATTR_LABELS,
  ActionIntent,
  ActionResolution,
  EventResolution,
  GameState,
  PendingTurn,
  SwingCheck,
  ageOf,
  clamp,
  granularityOf,
} from "./types";

/** 行动类别基础难度 */
const BASE_DIFFICULTY: Record<string, number> = {
  study: 40, work: 40, social: 35, romance: 55, exercise: 30,
  leisure: 15, adventure: 65, finance: 60, health: 25, other: 35,
};

const RISK_REWARD: Record<"none" | "low" | "high", number> = { none: 1, low: 2, high: 4 };

export function beginTurn(
  state: GameState,
  playerText: string,
  intents: ActionIntent[],
  swingEase: number = DEFAULT_SWING_EASE,
): PendingTurn {
  const rng = Rng.fromState(state.rngState);
  const checks: SwingCheck[] = [];

  for (const intent of intents) {
    if (intent.risk === "high") {
      const difficulty = clamp(BASE_DIFFICULTY[intent.category] + 15, 0, 95);
      checks.push(
        buildSwingCheck(
          intent.id,
          intent.summary,
          difficulty,
          RISK_REWARD[intent.risk],
          state.character.attrs[intent.attr],
          ATTR_LABELS[intent.attr],
          swingEase,
        ),
      );
    }
  }

  // 随机事件（周粒度概率；月/年粒度提高，模拟更长时间跨度）
  const evChance =
    state.granularity === "week" ? WEEKLY_EVENT_CHANCE : state.granularity === "month" ? 0.6 : 0.8;
  const event = rng.chance(evChance) ? pickEvent(rng, state) : null;
  if (event?.requiresCheck) {
    checks.push(
      buildSwingCheck(
        `event:${event.id}`,
        event.name,
        event.difficulty,
        event.rewardLevel,
        state.character.attrs[event.attr ?? "luck"],
        ATTR_LABELS[event.attr ?? "luck"],
        swingEase,
      ),
    );
  }

  state.rngState = rng.getState();
  return { playerText, intents, checks, checkResults: [], event: event ?? null };
}

export interface TurnOutcome {
  actions: ActionResolution[];
  event: EventResolution | null;
  passive: string[]; // 被动变化描述（发工资、生活开销、衰老……）
  died: boolean;
  deathCause?: string;
}

export function finalizeTurn(state: GameState, pending: PendingTurn): TurnOutcome {
  const rng = Rng.fromState(state.rngState);
  // 运气豁免已在停针瞬间由 judgeSwing 掷定（checkResults.saved），这里只读结果
  const resultOf = (checkId: string) => pending.checkResults.find((r) => r.checkId === checkId);

  const actions: ActionResolution[] = [];
  for (const intent of pending.intents) {
    const result = resultOf(intent.id);
    const tier =
      result?.tier ??
      autoTier(rng, BASE_DIFFICULTY[intent.category] ?? 35, state.character.attrs[intent.attr]);
    const res = resolveAction(rng, state, intent, tier);
    if (result?.saved) res.mechanical += "（运气救场：大失败降为失败，有惊无险）";
    applyDeltas(state, res.deltas);
    actions.push(res);
  }

  let event: EventResolution | null = null;
  if (pending.event) {
    const result = resultOf(`event:${pending.event.id}`);
    const tier =
      result?.tier ??
      autoTier(rng, pending.event.difficulty, state.character.attrs[pending.event.attr ?? "luck"]);
    event = resolveEvent(rng, state, pending.event, tier);
    if (result?.saved) event.mechanical += "（运气救场：大失败降为失败，有惊无险）";
    applyDeltas(state, event.deltas);
  }

  const passive = advanceTime(rng, state);
  const death = checkDeath(rng, state);

  state.turn += 1;
  state.pending = null;
  state.updatedAt = Date.now();
  state.rngState = rng.getState();

  return { actions, event, passive, died: death.died, deathCause: death.cause };
}

/** 时间推进 + 被动结算（收支、属性漂移、衰老、粒度切换） */
function advanceTime(rng: Rng, state: GameState): string[] {
  const notes: string[] = [];
  const weeks = state.granularity === "week" ? 1 : state.granularity === "month" ? 4 : 52;
  const c = state.character;

  state.world.week += weeks;
  while (state.world.week > 52) {
    state.world.week -= 52;
    state.world.year += 1;
    // 跨进大事件之年：写一条被动记录，叙事与日志都会带到
    const epoch = epochEventFor(state.world.year, state.background.country);
    if (epoch) notes.push(`【${state.world.year}·${epoch.title}】${epoch.desc}`);
  }

  const age = ageOf(state);
  const pulse = getWorldPulse(state);
  state.world.macroNotes = [`${pulse.title}：${pulse.summary}`, `当前趋势：${pulse.trend}`];


  // 收入与开销（仅周/月粒度的成年生活需要精算，童年由家庭承担）
  if (c.identity.job) {
    const pay = c.identity.job.weeklyPay * weeks;
    c.money += pay;
    notes.push(`工资收入 +${pay}`);
  }
  if (age >= 18) {
    const cost = Math.round(120 * weeks * (state.background.familyClass === "赤贫" ? 0.6 : 1));
    c.money -= cost;
    notes.push(`生活开销 -${cost}`);
    if (c.money < 0) {
      c.attrs.mood = clamp(c.attrs.mood - 3, 0, 100);
      notes.push("入不敷出，心境下降");
    }
  }

  // 心境回归、健康衰老
  const drift = Math.sign(55 - c.attrs.mood) * Math.min(2, Math.abs(55 - c.attrs.mood)) * (weeks / 4);
  c.attrs.mood = clamp(Math.round(c.attrs.mood + drift), 0, 100);
  if (age > 45) {
    const decay = ((age - 45) / 30) * (weeks / 52) * 6;
    if (rng.chance(Math.min(0.9, decay))) {
      c.attrs.health = clamp(c.attrs.health - 1, 0, 100);
    }
  }
  // 精力跨回合保留，但时间流逝会带来自然恢复；周粒度下过度安排会累积疲劳。
  const recoveryBase = state.granularity === "week" ? 20 : state.granularity === "month" ? 45 : 100;
  const recovery = Math.round(recoveryBase + c.attrs.health * 0.08 + c.attrs.mood * 0.04);
  const energyBeforeRecovery = c.energy;
  c.energy = clamp(c.energy + recovery, 0, 100);
  if (c.energy > energyBeforeRecovery) notes.push(`休息恢复精力 +${c.energy - energyBeforeRecovery}`);



  // 粒度切换（童年快进 → 少年周粒度）
  const g = granularityOf(age);
  if (g !== state.granularity) {
    state.granularity = g;
    notes.push(
      g === "week"
        ? "你长大了，从现在起以「周」为单位度过人生。"
        : g === "month"
          ? "进入学龄，时间以「月」为单位流逝。"
          : "",
    );
  }

  // 学籍自动推进（简化：按年龄挂标签）
  const schooling =
    age < 3 ? null
    : age < 6 ? "幼儿园"
    : age < 12 ? `小学${clamp(age - 5, 1, 6)}年级`
    : age < 15 ? `初中${clamp(age - 11, 1, 3)}年级`
    : age < 18 ? `高中${clamp(age - 14, 1, 3)}年级`
    : c.identity.schooling?.startsWith("大学") ? c.identity.schooling
    : null;
  if (schooling !== c.identity.schooling && age < 18) {
    c.identity.schooling = schooling;
  }

  return notes.filter(Boolean);
}

function checkDeath(rng: Rng, state: GameState): { died: boolean; cause?: string } {
  const c = state.character;
  const age = ageOf(state);
  if (c.attrs.health <= 0) {
    c.alive = false;
    c.deathCause = "健康耗尽";
    return { died: true, cause: "健康耗尽" };
  }
  if (age > 70) {
    // 年龄+健康联合死亡率：健康好能长寿
    const weeks = state.granularity === "week" ? 1 : state.granularity === "month" ? 4 : 52;
    const p = ((age - 70) / 40) * (1 - c.attrs.health / 130) * 0.02 * weeks;
    if (rng.chance(Math.max(0, p))) {
      c.alive = false;
      c.deathCause = "寿终正寝";
      return { died: true, cause: "寿终正寝" };
    }
  }
  return { died: false };
}

/** 快进 N 个回合的「平静期」：无行动，只走被动结算与低概率事件 */
export function fastForward(state: GameState, turns: number): string[] {
  const notes: string[] = [];
  for (let i = 0; i < turns; i++) {
    if (state.ended) break;
    const rng = Rng.fromState(state.rngState);
    const passive = advanceTime(rng, state);
    notes.push(...passive);
    const death = checkDeath(rng, state);
    state.turn += 1;
    state.rngState = rng.getState();
    if (death.died) {
      state.ended = true;
      notes.push(`你在平静中走到了生命尽头：${death.cause}`);
      break;
    }
  }
  state.updatedAt = Date.now();
  return notes;
}

