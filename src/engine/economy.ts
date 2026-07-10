// 经济系统：金钱和人脉都要有「花出去的窗口」。
// 生活方式档位是持续性花费（开销换持续 buff），人脉护航是一次性花费（点数换判定难度）。
// 一次性的大额消费卡（报班/就医）在 decisions.ts 的情境卡里生成，经 intent.moneyCost 结算。

import { ActionCategory, GameState, LifestyleKey, ageOf } from "./types";

export interface LifestyleDef {
  label: string;
  desc: string;
  costMult: number; // 生活开销倍率
  moodAnchor: number; // 心境回归目标的偏移（基准 55）
  energyMult: number; // 精力自然恢复倍率
  charmPerYear: number; // 每年魅力漂移（打扮/憔悴都会写在脸上）
  socialEase: number; // 社交/恋爱判定难度减免（钱开路的圈子）
}

export const LIFESTYLES: Record<LifestyleKey, LifestyleDef> = {
  frugal: { label: "拮据", desc: "能省则省。开销减半，但人会慢慢灰下去。", costMult: 0.5, moodAnchor: -5, energyMult: 1, charmPerYear: -1, socialEase: 0 },
  standard: { label: "普通", desc: "量入为出，不亏待也不放纵。", costMult: 1, moodAnchor: 0, energyMult: 1, charmPerYear: 0, socialEase: 0 },
  comfort: { label: "讲究", desc: "把钱花在自己身上：吃好睡好，状态在线。", costMult: 2.2, moodAnchor: 4, energyMult: 1.15, charmPerYear: 1, socialEase: 0 },
  lavish: { label: "优渥", desc: "钱开路的生活，连圈子都跟着换了一层。", costMult: 4.5, moodAnchor: 8, energyMult: 1.3, charmPerYear: 2, socialEase: 5 },
};

export const LIFESTYLE_ORDER: LifestyleKey[] = ["frugal", "standard", "comfort", "lavish"];

export function lifestyleOf(state: GameState): LifestyleKey {
  return state.character.lifestyle ?? "standard";
}

/** 成年后生活方式才由自己做主；童年由家庭供养，按「普通」结算且不产生开销 */
export function activeLifestyle(state: GameState): LifestyleDef {
  return ageOf(state) >= 18 ? LIFESTYLES[lifestyleOf(state)] : LIFESTYLES.standard;
}

/**
 * 城市生活成本系数：按当前坐标认城市档（迁移后跟着人走），
 * 认不出且还住在出生城市时退回出生城市的档位描述。
 */
const CITY_COST_TIERS: [RegExp, number][] = [
  [/北京|上海|深圳|广州|纽约|洛杉矶|东京|苏黎世|伦敦|香港|新加坡/, 1.6],
  [/成都|杭州|武汉|南京|重庆|西安|苏州|天津|大阪|柏林|莫斯科|曼谷|孟买|圣保罗|拉各斯/, 1.3],
  [/农村|山村|贫民|乡下/, 0.6],
  [/县城|小镇|乡|村|镇/, 0.7],
];
const BIRTH_TIER_COST: [RegExp, number][] = [
  [/一线|国际大都市|富裕城市/, 1.6],
  [/新一线|大城市/, 1.3],
  [/三线/, 0.9],
  [/县城|小镇/, 0.7],
  [/农村|乡村|贫民/, 0.6],
];

export function cityCostMult(state: GameState): number {
  const residence = state.character.identity.residence;
  for (const [re, mult] of CITY_COST_TIERS) if (re.test(residence)) return mult;
  if (residence.includes(state.background.city)) {
    for (const [re, mult] of BIRTH_TIER_COST) if (re.test(state.background.cityTier)) return mult;
  }
  return 1.0;
}

/** 一段时间的生活开销（基准 120/周 × 生活方式 × 城市） */
export function livingCost(state: GameState, weeks: number): number {
  return Math.round(120 * weeks * activeLifestyle(state).costMult * cityCostMult(state));
}

/** 生活方式对社交/恋爱判定的难度减免 */
export function lifestyleEase(state: GameState, category: ActionCategory): number {
  if (category !== "social" && category !== "romance") return 0;
  return activeLifestyle(state).socialEase;
}

/**
 * 动用人脉护航：一次高危回合最多花 15 点人脉，按花费降低本回合高危行动的判定难度（至多 -10）。
 * 少于 5 点撑不起一次像样的人情，返回 null。
 */
export function connectionsBoost(state: GameState): { cost: number; ease: number } | null {
  const cost = Math.min(15, Math.floor(state.character.connections));
  if (cost < 5) return null;
  return { cost, ease: Math.min(10, Math.round(cost * 0.7)) };
}
