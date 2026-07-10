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
  SwingVerdict,
  Tier,
  TIER_LABELS,
  ZoneWidths,
  clamp,
  emptyDeltas,
} from "./types";
import { Rng } from "./rng";
import { worldModifierFor } from "./decisions";
import { skillForIntent } from "./skills";

// ---------- 摆动条参数 ----------

/**
 * 全局手感旋钮：时间窗 ∝ 区宽 ÷ 摆速，0.8 ≈ 判定比原版基准容易 20%。
 * 减负平摊到两个维度（各 √EASE）：摆速与区宽各担一半，视觉上都不突兀。
 * 三档难度（设置页可选）都通过这一个旋钮实现。
 */
export const SWING_EASE_LEVELS = { easy: 0.65, standard: 0.8, hard: 1.0 } as const;
export type SwingDifficulty = keyof typeof SWING_EASE_LEVELS;
export const DEFAULT_SWING_EASE = SWING_EASE_LEVELS.standard;

/**
 * 摆速 ∝ 收益（好爆率跳得快），最佳区宽度 ∝ 1/难度。
 * 相关属性高 → 减速（最多 30%）+ 最佳区加宽（最多 40%）。
 * baseBest 记录属性 50 时的区宽，UI 用它把属性加成画成独立的亮色层。
 */
export function buildSwingCheck(
  id: string,
  label: string,
  difficulty: number,
  reward: number,
  attrValue: number,
  attrName?: string,
  ease: number = DEFAULT_SWING_EASE,
): SwingCheck {
  const speedScale = Math.sqrt(ease);
  const zoneScale = 1 / speedScale;
  const attrBonus = clamp((attrValue - 50) / 50, -0.5, 1); // -0.5 ~ 1
  const speedHz = clamp(
    (0.55 + reward * 0.38) * speedScale * (1 - 0.3 * Math.max(0, attrBonus)),
    0.4,
    2.6 * speedScale,
  );
  const bestBase = clamp((0.16 - difficulty * 0.0013) * zoneScale, 0.028 * zoneScale, 0.16 * zoneScale);
  const best = clamp(bestBase * (1 + 0.4 * attrBonus), 0.02 * zoneScale, 0.2 * zoneScale);
  const zones: ZoneWidths = {
    best,
    success: clamp(best + (0.14 - difficulty * 0.0006) * zoneScale, best + 0.05 * zoneScale, 0.36),
    partial: clamp(best + (0.26 - difficulty * 0.0004) * zoneScale, best + 0.14 * zoneScale, 0.44),
    fail: 0.48, // |offset| > 0.48 → 大失败（两端各 2%）
  };
  return {
    actionId: id,
    label,
    difficulty,
    reward,
    speedHz,
    zones,
    baseBest: bestBase,
    attrName,
    attrZonePct: Math.round(40 * attrBonus),
    attrSpeedPct: Math.round(-30 * Math.max(0, attrBonus)),
  };
}

/**
 * 大失败运气豁免：转针停在大失败区时，按运气有概率降档为普通失败（有惊无险）。
 * 只用于玩家亲手转针的结果；autoTier 的大失败已经是低概率，不再豁免。
 */
export function fumbleSaveChance(luck: number): number {
  return clamp(0.35 + luck * 0.003, 0.35, 0.68);
}

/**
 * 转针判定收口：落点 → 档位 → 运气豁免掷点（消耗主 RNG，写回 rngState）。
 * 在停针瞬间调用，UI 直接拿最终结论播演出；finalizeTurn 只读结果不再掷点。
 */
export function judgeSwing(state: GameState, check: SwingCheck, offset: number): SwingVerdict {
  let tier = tierFromOffset(offset, check.zones);
  let saved = false;
  if (tier === "fumble") {
    const rng = Rng.fromState(state.rngState);
    saved = rng.chance(fumbleSaveChance(state.character.attrs.luck));
    state.rngState = rng.getState();
    if (saved) tier = "fail";
  }
  return { tier, saved };
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

const DEFAULT_ENERGY_COST: Record<ActionCategory, number> = {
  study: 22,
  work: 28,
  social: 12,
  romance: 12,
  exercise: 24,
  leisure: -16,
  adventure: 30,
  finance: 18,
  health: -12,
  other: 10,
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
  // 高危行动敢转针就该有超额回报：成功档以上收益 ×1.25，失败的代价不变
  const base = TIER_MULT[tier];
  const mult = intent.risk === "high" && base > 0 ? base * 1.25 : base;
  const worldMult = worldModifierFor(state, intent.category);
  const effort = clamp(intent.hours / 20, 0.2, 2); // 投入时间放大效果
  const deltas: StatDeltas = emptyDeltas();
  deltas.energy = -(intent.energyCost ?? DEFAULT_ENERGY_COST[intent.category]);

  for (const [k, w] of Object.entries(profile.attrs)) {
    const key = k as AttrKey;
    const raw = (w ?? 0) * mult * effort * rng.range(1.5, 3) * ((w ?? 0) > 0 ? worldMult : 1);
    // 负面基线（如学习掉心情）在失败时不反转成收益
    const v = (w ?? 0) < 0 ? Math.min(0, raw) : raw;
    if (Math.abs(v) >= 0.5) deltas.attrs[key] = Math.round(v);
  }
  if (profile.money !== 0) {
    const base = moneyScale(state) * profile.money * effort;
    deltas.money = Math.round(base * (profile.money > 0 ? mult * worldMult : 1) * rng.range(0.7, 1.4));
  }
  if (profile.connections > 0 && mult > 0) {
    deltas.connections = Math.round(profile.connections * mult * rng.range(0.5, 1.5));
  }
  // 技能是「手艺名词」不是行动描述：由 skills.ts 推断（意图自带 > 关键词 > 类别兜底 > 不积累）
  const trained = mult > 0 ? skillForIntent(state, intent) : null;
  if (trained) {
    deltas.skillXp.push({
      name: trained.name,
      category: trained.category,
      xp: Math.round(20 * mult * effort * worldMult),
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
  // 学龄前儿童不发生金钱交易（吃穿用度由家庭承担）
  if (state.world.year - state.character.birthYear < 6) {
    deltas.money = 0;
  }

  return {
    intent,
    tier,
    deltas,
    mechanical: `「${intent.summary}」→ ${TIER_LABELS[tier]}（判定属性：${ATTR_LABELS[intent.attr]}）${worldMult !== 1 ? `【世界趋势×${worldMult.toFixed(2)}】` : ""}${describeDeltas(deltas)}`,
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
  c.energy = clamp(c.energy + deltas.energy, 0, 100);
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
  if (d.energy) parts.push(`精力${d.energy > 0 ? "+" : ""}${d.energy}`);
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
