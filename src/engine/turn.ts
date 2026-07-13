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
  advancePlayerCareerYear,
  advanceRelationshipYear,
  applyAgingEffects,
  settleCareer,
  settleRelationships,
  settleResidence,
} from "./lifecycle";
import { masteryDifficultyBonus } from "./skills";
import { LIFESTYLES, LIFESTYLE_ORDER, activeLifestyle, connectionsBoost, lifestyleEase, lifestyleOf, livingCost } from "./economy";
import { applyBoundedAttributeDelta, applyChildDevelopment } from "./attributes";
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
  opts?: { connections?: boolean },
): PendingTurn {
  const rng = Rng.fromState(state.rngState);
  const checks: SwingCheck[] = [];

  // 动用人脉护航：点数当场扣掉，本回合所有高危「行动」判定降难（随机事件不受人情关照）
  let connectionsSpent = 0;
  let connectionsEase = 0;
  if (opts?.connections && intents.some((i) => i.risk === "high")) {
    const boost = connectionsBoost(state);
    if (boost) {
      state.character.connections -= boost.cost;
      connectionsSpent = boost.cost;
      connectionsEase = boost.ease;
    }
  }

  for (const intent of intents) {
    if (intent.risk === "high") {
      // 熟练度、生活方式（社交场）与人脉护航都直接抵扣判定难度
      const difficulty = clamp(
        BASE_DIFFICULTY[intent.category] + 15
          - masteryDifficultyBonus(state, intent)
          - lifestyleEase(state, intent.category)
          - connectionsEase,
        0,
        95,
      );
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
    state.granularity === "week" ? WEEKLY_EVENT_CHANCE
    : state.granularity === "month" ? 0.6
    : state.granularity === "season" ? 0.7
    : 0.8;
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
  return {
    playerText,
    intents,
    checks,
    checkResults: [],
    event: event ?? null,
    connectionsSpent: connectionsSpent > 0 ? connectionsSpent : undefined,
  };
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
      autoTier(
        rng,
        (BASE_DIFFICULTY[intent.category] ?? 35)
          - masteryDifficultyBonus(state, intent)
          - lifestyleEase(state, intent.category),
        state.character.attrs[intent.attr],
      );
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

  const passive = [
    ...(pending.connectionsSpent ? [`动用人脉护航：人脉 -${pending.connectionsSpent}，本回合高危行动更稳`] : []),
    // 先落定迁移，再结算职业：同一回合「去深圳工作」，新工作要落在深圳
    ...settleResidence(state, actions),
    ...settleCareer(state, actions),
    ...settleRelationships(rng, state, actions),
    ...advanceTime(rng, state),
  ];
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
  const weeks = state.granularity === "week" ? 1 : state.granularity === "month" ? 4 : state.granularity === "season" ? 13 : 52;
  const c = state.character;

  const crossedYears: number[] = [];
  state.world.week += weeks;
  while (state.world.week > 52) {
    state.world.week -= 52;
    state.world.year += 1;
    // 跨进大事件之年：写一条被动记录，叙事与日志都会带到
    crossedYears.push(state.world.year);
    const epoch = epochEventFor(state.world.year, state.background.country);
    if (epoch) notes.push(`【${state.world.year}·${epoch.title}】${epoch.desc}`);
  }

  const age = ageOf(state);
  const pulse = getWorldPulse(state);
  state.world.macroNotes = [`${pulse.title}：${pulse.summary}`, `当前趋势：${pulse.trend}`];


  // 收入与开销（成年后自理，童年由家庭承担）；生活方式与所在城市共同决定开销
  const style = activeLifestyle(state);
  if (c.identity.job) {
    const job = c.identity.job;
    const pay = job.weeklyPay * weeks;
    c.money += pay;
    notes.push(`${job.track === "退休" ? "退休金" : "工资收入"} +${pay}`);
  }
  if (age >= 18) {
    const cost = livingCost(state, weeks);
    c.money -= cost;
    notes.push(`生活开销 -${cost}（${style.label}）`);
    if (c.money < 0) {
      c.attrs.mood = clamp(c.attrs.mood - 3, 0, 100);
      notes.push("入不敷出，心境下降");
    }
    // 存款撑不过 4 个周期就自动降档：日子是钱包说了算
    const idx = LIFESTYLE_ORDER.indexOf(lifestyleOf(state));
    if (idx > 0 && c.money < cost * 4) {
      c.lifestyle = LIFESTYLE_ORDER[idx - 1];
      notes.push(`钱包撑不住这样的日子，生活方式降为「${LIFESTYLES[c.lifestyle].label}」`);
    }
  }

  // 心境向生活方式决定的锚点回归；健康与体质的衰老规则在 lifecycle 中统一维护。
  const moodAnchor = 55 + style.moodAnchor;
  const drift = Math.sign(moodAnchor - c.attrs.mood) * Math.min(2, Math.abs(moodAnchor - c.attrs.mood)) * (weeks / 4);
  c.attrs.mood = clamp(Math.round(c.attrs.mood + drift), 0, 100);
  notes.push(...applyAgingEffects(rng, state, weeks));
  notes.push(...applyChildDevelopment(rng, state, weeks));
  // 精力见底会产生真实代价；自然恢复只补一部分，高强度行动后通常需要休整。
  if (age >= 6 && c.energy <= 5) {
    c.attrs.health = clamp(c.attrs.health - 2, 0, 100);
    c.attrs.mood = clamp(c.attrs.mood - 3, 0, 100);
    notes.push("精力彻底透支：健康 -2，心境 -3");
  }
  const recoveryBase =
    state.granularity === "week" ? 12
    : state.granularity === "month" ? 22
    : state.granularity === "season" ? 30
    : 100;
  const recovery = Math.round(recoveryBase * style.energyMult + c.attrs.health * 0.05 + c.attrs.mood * 0.03);
  const energyBeforeRecovery = c.energy;
  c.energy = clamp(c.energy + recovery, 0, 100);
  if (c.energy > energyBeforeRecovery) notes.push(`自然恢复精力 +${c.energy - energyBeforeRecovery}`);



  // 粒度切换（童年快进 → 少年周粒度）
  const g = granularityOf(age);
  if (g !== state.granularity) {
    state.granularity = g;
    notes.push(
      g === "season"
        ? "进入学龄后，人生按「一季」推进；每次选择代表三个月的生活重心。"
        : g === "year" ? "时间重新按年推进。" : "",
    );
  }

  // 学籍自动推进（简化：按年龄挂标签）

  // 只有真正跨年时才推进关系人物的年龄、职业和健康，避免周粒度重复触发。
  for (const year of crossedYears) {
    notes.push(...advanceRelationshipYear(rng, state, year));
    notes.push(...advancePlayerCareerYear(state));
    // 生活方式写在脸上：讲究的人年年精致一点，拮据的人慢慢灰下去
    if (age >= 18 && style.charmPerYear !== 0) {
      const applied = applyBoundedAttributeDelta(c, "charm", style.charmPerYear);
      if (applied !== 0) notes.push(`${style.label}的日子写在脸上：魅力 ${applied > 0 ? "+" : ""}${applied}`);
    }
  }
  const schooling =
    age < 3 ? null
    : age < 6 ? "幼儿园"
    : age < 12 ? `小学${clamp(age - 5, 1, 6)}年级`
    : age < 15 ? `初中${clamp(age - 11, 1, 3)}年级`
    : age < 18 ? `高中${clamp(age - 14, 1, 3)}年级`
    : c.identity.schooling?.startsWith("大学") ? c.identity.schooling
    : null;
  // 18 岁后也要执行：中学学籍到期清除（否则"高中3年级"终身残留），大学学籍保留
  if (schooling !== c.identity.schooling) {
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
    const weeks = state.granularity === "week" ? 1 : state.granularity === "month" ? 4 : state.granularity === "season" ? 13 : 52;
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

