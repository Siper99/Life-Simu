// 回合编排（纯引擎侧，不含 LLM 调用）：开始回合 → 收集摆动条结果 → 终局结算 → 时间推进。

import { Rng } from "./rng";
import { pickEvent, WEEKLY_EVENT_CHANCE } from "./events";
import {
  applyDeltas,
  autoTier,
  buildSwingCheck,
  resolveAction,
  resolveEvent,
} from "./resolver";
import {
  ActionIntent,
  ActionResolution,
  EventResolution,
  GameState,
  PendingTurn,
  SwingCheck,
  Tier,
  ageOf,
  clamp,
  granularityOf,
  lifeStageOf,
} from "./types";

/** 行动类别基础难度 */
const BASE_DIFFICULTY: Record<string, number> = {
  study: 40, work: 40, social: 35, romance: 55, exercise: 30,
  leisure: 15, adventure: 65, finance: 60, health: 25, other: 35,
};

const RISK_REWARD: Record<"none" | "low" | "high", number> = { none: 1, low: 2, high: 4 };

export function beginTurn(state: GameState, playerText: string, intents: ActionIntent[]): PendingTurn {
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
  const tierOf = (checkId: string): Tier | undefined =>
    pending.checkResults.find((r) => r.checkId === checkId)?.tier;

  const actions: ActionResolution[] = [];
  for (const intent of pending.intents) {
    let tier = tierOf(intent.id);
    if (!tier) {
      const difficulty = BASE_DIFFICULTY[intent.category] ?? 35;
      tier = autoTier(rng, difficulty, state.character.attrs[intent.attr]);
    }
    const res = resolveAction(rng, state, intent, tier);
    applyDeltas(state, res.deltas);
    actions.push(res);
  }

  let event: EventResolution | null = null;
  if (pending.event) {
    const tier =
      tierOf(`event:${pending.event.id}`) ??
      autoTier(rng, pending.event.difficulty, state.character.attrs[pending.event.attr ?? "luck"]);
    event = resolveEvent(rng, state, pending.event, tier);
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
  }

  const age = ageOf(state);

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

/** 当前人生阶段的默认行动提示（给输入框 placeholder） */
export function actionHint(state: GameState): string {
  const stage = lifeStageOf(ageOf(state));
  switch (stage) {
    case "婴儿": return "你还是个孩子，试试：哭闹引起注意 / 观察世界 / 努力学说话……";
    case "童年": return "试试：认真读书，放学和小伙伴玩 / 缠着爸妈买玩具 / 偷偷练习画画……";
    case "少年": return "试试：拼命刷题准备中考，周末打篮球 / 跟喜欢的同学表白 / 学吉他……";
    case "青年": return "试试：投简历找工作，晚上健身 / 约她看电影 / 拿积蓄投资朋友的项目……";
    case "中年": return "试试：争取升职，多陪陪家人 / 体检 / 开始筹划自己的生意……";
    case "老年": return "试试：晨练太极，含饴弄孙 / 写回忆录 / 来一场说走就走的旅行……";
  }
}
