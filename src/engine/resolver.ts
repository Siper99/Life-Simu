// 行动判定核心：摆动条参数计算、落点→档位映射、五档结算、数值应用。

import {
  ActionCategory,
  ActionIntent,
  ActionResolution,
  AttrKey,
  ATTR_LABELS,
  EventResolution,
  EventSkeleton,
  GameState,
  StatDeltas,
  SwingCheck,
  Tier,
  TIER_LABELS,
  ZoneWidths,
  clamp,
  emptyDeltas,
} from "./types";
import { Rng } from "./rng";

// ---------- 摆动条参数 ----------

/**
 * 摆速 ∝ 收益（好爆率跳得快），最佳区宽度 ∝ 1/难度。
 * 相关属性高 → 减速（最多 30%）+ 最佳区加宽（最多 40%）。
 */
export function buildSwingCheck(
  id: string,
  label: string,
  difficulty: number,
  reward: number,
  attrValue: number,
): SwingCheck {
  const attrBonus = clamp((attrValue - 50) / 50, -0.5, 1); // -0.5 ~ 1
  const speedHz = clamp((0.55 + reward * 0.38) * (1 - 0.3 * Math.max(0, attrBonus)), 0.4, 2.6);
  const bestBase = clamp(0.16 - difficulty * 0.0013, 0.028, 0.16);
  const best = clamp(bestBase * (1 + 0.4 * attrBonus), 0.02, 0.2);
  const zones: ZoneWidths = {
    best,
    success: clamp(best + 0.14 - difficulty * 0.0006, best + 0.05, 0.34),
    partial: clamp(best + 0.26 - difficulty * 0.0004, best + 0.14, 0.42),
    fail: 0.46, // |offset| > 0.46 → 大失败（两端各 4%）
  };
  return { actionId: id, label, difficulty, reward, speedHz, zones };
}

/** offset = |停针位置 - 0.5|，映射到五档 */
export function tierFromOffset(offset: number, zones: ZoneWidths): Tier {
  if (offset <= zones.best) return "crit";
  if (offset <= zones.success) return "success";
  if (offset <= zones.partial) return "partial";
  if (offset <= zones.fail) return "fail";
  return "fumble";
}

/** 低风险行动不弹摆动条，由属性 + 骰子自动判定 */
export function autoTier(rng: Rng, difficulty: number, attrValue: number): Tier {
  const roll = rng.next() * 100 + (attrValue - 50) * 0.6 - (difficulty - 40) * 0.5;
  if (roll > 92) return "crit";
  if (roll > 55) return "success";
  if (roll > 30) return "partial";
  if (roll > 8) return "fail";
  return "fumble";
}

// ---------- 结算 ----------

const TIER_MULT: Record<Tier, number> = {
  crit: 1.8,
  success: 1.0,
  partial: 0.45,
  fail: -0.3,
  fumble: -1.0,
};

/** 行动类别 → 主要收益方向 */
const CATEGORY_PROFILE: Record<
  ActionCategory,
  { attrs: Partial<Record<AttrKey, number>>; money: number; skillCat: "学业" | "职业" | "爱好" | "生活" | null; connections: number }
> = {
  study: { attrs: { intelligence: 1.2, mood: -0.2 }, money: 0, skillCat: "学业", connections: 0 },
  work: { attrs: { mood: -0.3 }, money: 1, skillCat: "职业", connections: 0.3 },
  social: { attrs: { eq: 0.6, mood: 0.5 }, money: -0.1, skillCat: null, connections: 1 },
  romance: { attrs: { mood: 1, charm: 0.3 }, money: -0.2, skillCat: null, connections: 0.2 },
  exercise: { attrs: { fitness: 1.2, health: 0.6 }, money: 0, skillCat: "生活", connections: 0 },
  leisure: { attrs: { mood: 1.2 }, money: -0.2, skillCat: "爱好", connections: 0 },
  adventure: { attrs: { mood: 0.8, fitness: 0.3 }, money: 0.3, skillCat: null, connections: 0.2 },
  finance: { attrs: {}, money: 1.6, skillCat: "生活", connections: 0 },
  health: { attrs: { health: 1.2, mood: 0.3 }, money: -0.3, skillCat: null, connections: 0 },
  other: { attrs: { mood: 0.3 }, money: 0, skillCat: null, connections: 0.1 },
};

/** 收入基准：按人生阶段和现有身份粗估一次行动的金钱量级 */
function moneyScale(state: GameState): number {
  const job = state.character.identity.job;
  if (job) return Math.max(80, job.weeklyPay * 0.5);
  const age = state.world.year - state.character.birthYear;
  if (age < 12) return 5;
  if (age < 18) return 40;
  return 300;
}

export function resolveAction(
  rng: Rng,
  state: GameState,
  intent: ActionIntent,
  tier: Tier,
): ActionResolution {
  const profile = CATEGORY_PROFILE[intent.category];
  const mult = TIER_MULT[tier];
  const effort = clamp(intent.hours / 20, 0.2, 2); // 投入时间放大效果
  const deltas: StatDeltas = emptyDeltas();

  for (const [k, w] of Object.entries(profile.attrs)) {
    const key = k as AttrKey;
    const raw = (w ?? 0) * mult * effort * rng.range(1.5, 3);
    // 负面基线（如学习掉心情）在失败时不反转成收益
    const v = (w ?? 0) < 0 ? Math.min(0, raw) : raw;
    if (Math.abs(v) >= 0.5) deltas.attrs[key] = Math.round(v);
  }
  if (profile.money !== 0) {
    const base = moneyScale(state) * profile.money * effort;
    deltas.money = Math.round(base * (profile.money > 0 ? mult : 1) * rng.range(0.7, 1.4));
  }
  if (profile.connections > 0 && mult > 0) {
    deltas.connections = Math.round(profile.connections * mult * rng.range(0.5, 1.5));
  }
  if (profile.skillCat && mult > 0) {
    deltas.skillXp.push({
      name: intent.summary.slice(0, 12),
      category: profile.skillCat,
      xp: Math.round(20 * mult * effort),
    });
  }
  // 失败/大失败的代价：心境受挫，大失败可能伤身/破财
  if (tier === "fail") {
    deltas.attrs.mood = (deltas.attrs.mood ?? 0) - rng.int(2, 5);
  } else if (tier === "fumble") {
    deltas.attrs.mood = (deltas.attrs.mood ?? 0) - rng.int(5, 10);
    if (intent.category === "adventure" || intent.category === "exercise") {
      deltas.attrs.health = (deltas.attrs.health ?? 0) - rng.int(3, 10);
    }
    if (intent.category === "finance") {
      deltas.money = -Math.round(moneyScale(state) * rng.range(1, 3));
    }
  }
  if (intent.target && (intent.category === "social" || intent.category === "romance")) {
    deltas.affinity.push({
      npcName: intent.target,
      delta: Math.round(mult * rng.range(3, 8)),
    });
  }

  return {
    intent,
    tier,
    deltas,
    mechanical: `「${intent.summary}」→ ${TIER_LABELS[tier]}（判定属性：${ATTR_LABELS[intent.attr]}）${describeDeltas(deltas)}`,
  };
}

export function resolveEvent(
  rng: Rng,
  state: GameState,
  skeleton: EventSkeleton,
  tier: Tier,
): EventResolution {
  const mult = TIER_MULT[tier];
  const deltas: StatDeltas = emptyDeltas();
  const scale = skeleton.rewardLevel;

  if (skeleton.good) {
    // 正面事件：成功放大收益，失败则错失甚至受损
    deltas.attrs.mood = Math.round(clamp(mult, -1, 2) * rng.range(2, 4) * Math.min(scale, 3));
    if (mult > 0 && (skeleton.id.includes("windfall") || skeleton.id.includes("invest") || skeleton.id.includes("jobop"))) {
      deltas.money = Math.round(moneyScale(state) * scale * mult * rng.range(1, 4));
    }
    if (mult > 0) deltas.connections = rng.chance(0.4) ? rng.int(1, scale) : 0;
  } else {
    // 负面事件：判定成功=化险为夷（小损失），失败=承受全额打击
    const damage = mult >= 1 ? 0.15 : mult > 0 ? 0.5 : 1 - mult * 0.5;
    deltas.attrs.mood = -Math.round(rng.range(2, 5) * scale * damage);
    if (skeleton.attr === "health" || skeleton.id.includes("accident") || skeleton.id.includes("illness")) {
      deltas.attrs.health = -Math.round(rng.range(3, 8) * scale * damage);
    }
    if (skeleton.id.includes("scam") || skeleton.id.includes("lawsuit") || skeleton.id.includes("family-crisis")) {
      deltas.money = -Math.round(moneyScale(state) * scale * damage * rng.range(1, 3));
    }
  }

  return {
    skeleton,
    tier,
    deltas,
    mechanical: `事件「${skeleton.name}」→ ${TIER_LABELS[tier]}${describeDeltas(deltas)}`,
  };
}

// ---------- 应用与描述 ----------

export function applyDeltas(state: GameState, deltas: StatDeltas): void {
  const c = state.character;
  for (const [k, v] of Object.entries(deltas.attrs)) {
    const key = k as AttrKey;
    c.attrs[key] = clamp(c.attrs[key] + (v ?? 0), 0, 100);
  }
  c.money = Math.round(c.money + deltas.money);
  c.connections = Math.max(0, c.connections + deltas.connections);
  for (const gain of deltas.skillXp) {
    let skill = c.skills.find((s) => s.name === gain.name && s.category === gain.category);
    if (!skill) {
      if (c.skills.length >= 30) continue; // 技能栏上限，防膨胀
      skill = { id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: gain.name, category: gain.category, level: 0, xp: 0 };
      c.skills.push(skill);
    }
    skill.xp += gain.xp;
    while (skill.xp >= 100 && skill.level < 10) {
      skill.xp -= 100;
      skill.level += 1;
    }
  }
  for (const a of deltas.affinity) {
    const npc = c.npcs.find((n) => n.name === a.npcName || n.relation.includes(a.npcName));
    if (npc) npc.affinity = clamp(npc.affinity + a.delta, -100, 100);
  }
}

export function describeDeltas(d: StatDeltas): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d.attrs)) {
    if (v) parts.push(`${ATTR_LABELS[k as AttrKey]}${v > 0 ? "+" : ""}${v}`);
  }
  if (d.money) parts.push(`金钱${d.money > 0 ? "+" : ""}${d.money}`);
  if (d.connections) parts.push(`人脉+${d.connections}`);
  for (const s of d.skillXp) parts.push(`技能「${s.name}」经验+${s.xp}`);
  for (const a of d.affinity) parts.push(`${a.npcName}好感${a.delta > 0 ? "+" : ""}${a.delta}`);
  return parts.length > 0 ? `：${parts.join("，")}` : "";
}

// ---------- 无 LLM 时的兜底意图解析 ----------

const CATEGORY_KEYWORDS: [ActionCategory, AttrKey, RegExp][] = [
  ["study", "intelligence", /学习|读书|复习|看书|上课|背|刷题|考/],
  ["work", "eq", /工作|上班|打工|兼职|加班|赚钱|搬砖/],
  ["exercise", "fitness", /锻炼|跑步|健身|运动|打球|游泳|爬山/],
  ["romance", "charm", /表白|约会|恋爱|追求|相亲|求婚/],
  ["social", "eq", /朋友|聚会|社交|聊天|拜访|应酬|认识/],
  ["finance", "intelligence", /投资|炒股|理财|买房|存钱|生意|创业/],
  ["health", "health", /看病|体检|休息|养生|治疗|睡觉/],
  ["adventure", "luck", /冒险|赌|探险|旅行|尝试|挑战/],
  ["leisure", "mood", /玩|游戏|娱乐|电影|听歌|放松|逛/],
];

export function fallbackParseIntents(text: string): ActionIntent[] {
  const parts = text
    .split(/[，。；;,\n、]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 4);
  if (parts.length === 0) parts.push(text.trim() || "随便过过");
  return parts.map((p, i) => {
    const hit = CATEGORY_KEYWORDS.find(([, , re]) => re.test(p));
    const [category, attr] = hit ? [hit[0], hit[1]] : (["other", "mood"] as const);
    const risky = /表白|赌|投资|创业|挑战|冒险|求婚|辞职|打架/.test(p);
    return {
      id: `act-${i}`,
      summary: p.slice(0, 30),
      category,
      hours: Math.min(60, Math.round(100 / parts.length)),
      risk: risky ? "high" : "low",
      attr,
      nsfw: false,
    } satisfies ActionIntent;
  });
}
