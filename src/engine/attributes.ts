// 属性标尺、先天基线、个人潜力与儿童自然成长。

import { Rng } from "./rng";
import {
  ATTR_LABELS,
  AttrKey,
  AttributeBounds,
  Attributes,
  CharacterState,
  GameState,
  ageOf,
  clamp,
} from "./types";

const DEVELOPABLE: AttrKey[] = ["health", "fitness", "intelligence", "eq", "charm"];

function centeredRoll(rng: Rng, lo: number, hi: number): number {
  return Math.round((rng.range(lo, hi) + rng.range(lo, hi) + rng.range(lo, hi)) / 3);
}

function potentialRoll(rng: Rng, lo: number, hi: number, perfectChance: number): number {
  return rng.chance(perfectChance) ? 100 : centeredRoll(rng, lo, hi);
}

/** 新角色的基线与潜力各自随机；100 是整个人类尺度的极限，不是常规满级。 */
export function rollAttributeBounds(rng: Rng): AttributeBounds {
  const healthFloor = rng.int(38, 62);
  const fitnessFloor = rng.int(8, 22);
  const intelligenceFloor = rng.int(3, 10);
  const eqFloor = rng.int(3, 12);
  const charmFloor = rng.int(18, 38);
  return {
    health: { floor: healthFloor, ceiling: Math.max(healthFloor + 20, potentialRoll(rng, 72, 99, 0.01)) },
    fitness: { floor: fitnessFloor, ceiling: Math.max(fitnessFloor + 30, potentialRoll(rng, 58, 97, 0.004)) },
    intelligence: { floor: intelligenceFloor, ceiling: Math.max(intelligenceFloor + 35, potentialRoll(rng, 58, 98, 0.002)) },
    eq: { floor: eqFloor, ceiling: Math.max(eqFloor + 30, potentialRoll(rng, 55, 95, 0.003)) },
    charm: { floor: charmFloor, ceiling: Math.max(charmFloor + 25, potentialRoll(rng, 55, 95, 0.003)) },
    mood: { floor: 0, ceiling: 100 },
    luck: { floor: 0, ceiling: 100 },
  };
}

/** 出生值代表当前发育水平，和未来能达到的潜力不是一回事。 */
export function newbornAttributes(rng: Rng, bounds: AttributeBounds): Attributes {
  return {
    health: rng.int(bounds.health.floor, Math.min(bounds.health.ceiling, bounds.health.floor + 24)),
    fitness: rng.int(bounds.fitness.floor, Math.min(bounds.fitness.ceiling, bounds.fitness.floor + 6)),
    intelligence: rng.int(bounds.intelligence.floor, Math.min(bounds.intelligence.ceiling, bounds.intelligence.floor + 4)),
    eq: rng.int(bounds.eq.floor, Math.min(bounds.eq.ceiling, bounds.eq.floor + 5)),
    charm: rng.int(bounds.charm.floor, Math.min(bounds.charm.ceiling, bounds.charm.floor + 10)),
    mood: rng.int(35, 75),
    luck: rng.int(20, 80),
  };
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicRange(seed: number, salt: number, lo: number, hi: number): number {
  let x = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return lo + ((x >>> 0) % (hi - lo + 1));
}

/** 旧存档没有潜力数据：用存档 id 稳定补一组随机边界，并保证不低于当前值。 */
export function migratedAttributeBounds(character: CharacterState, gameId: string): AttributeBounds {
  const seed = hashText(gameId + character.name + character.birthYear);
  const keys: AttrKey[] = ["health", "fitness", "intelligence", "eq", "charm", "mood", "luck"];
  const floorRanges: Record<AttrKey, [number, number]> = {
    health: [35, 60], fitness: [8, 24], intelligence: [4, 18], eq: [4, 18],
    charm: [15, 38], mood: [0, 0], luck: [0, 0],
  };
  const ceilingRanges: Record<AttrKey, [number, number]> = {
    health: [72, 96], fitness: [62, 94], intelligence: [62, 96], eq: [58, 94],
    charm: [58, 94], mood: [100, 100], luck: [100, 100],
  };
  return Object.fromEntries(keys.map((key, index) => {
    const [floorLo, floorHi] = floorRanges[key];
    const [ceilingLo, ceilingHi] = ceilingRanges[key];
    const floor = deterministicRange(seed, index * 2, floorLo, floorHi);
    const rolledCeiling = deterministicRange(seed, index * 2 + 1, ceilingLo, ceilingHi);
    return [key, {
      floor: Math.min(floor, character.attrs[key]),
      ceiling: clamp(Math.max(character.attrs[key], rolledCeiling, floor + 15), 1, 100),
    }];
  })) as AttributeBounds;
}

export function attributeCeiling(character: CharacterState, key: AttrKey): number {
  return character.attrBounds?.[key]?.ceiling ?? 100;
}

/** 正向成长受个人潜力限制；伤病、失败和衰老仍然可以跌到 0。 */
export function applyBoundedAttributeDelta(character: CharacterState, key: AttrKey, delta: number): number {
  const before = character.attrs[key];
  const ceiling = delta > 0 ? attributeCeiling(character, key) : 100;
  character.attrs[key] = clamp(before + delta, 0, ceiling);
  return character.attrs[key] - before;
}

/** 天赋既改变出生状态，也会小幅推高或压低对应潜力。 */
export function applyTalentToBounds(character: CharacterState, key: AttrKey, mod: number): void {
  if (!character.attrBounds) return;
  const range = character.attrBounds[key];
  if (DEVELOPABLE.includes(key)) {
    range.floor = clamp(range.floor + Math.round(mod * 0.2), 0, 80);
    range.ceiling = clamp(range.ceiling + Math.round(mod * 0.5), Math.max(10, range.floor + 10), 100);
  }
  applyBoundedAttributeDelta(character, key, mod);
}

export function attributeScaleLabel(key: AttrKey, value: number): string {
  if (value >= 100) {
    if (key === "intelligence") return "人类智力极限／世界最聪明级别";
    if (key === "fitness") return "人类体能极限／世界冠军级";
    if (key === "health") return "人体健康状态极限";
    return "人类尺度极限";
  }
  if (value >= 95) return "世界顶尖";
  if (value >= 85) return "精英水平";
  if (value >= 70) return "显著优秀";
  if (value >= 55) return "高于常人";
  if (value >= 40) return "普通范围";
  if (value >= 25) return "低于常人";
  if (value >= 10) return "明显薄弱";
  if (value > 0) return "严重不足";
  return key === "health" ? "生命无法维持" : "能力丧失";
}

function stochasticAmount(rng: Rng, expected: number): number {
  if (expected <= 0) return 0;
  const whole = Math.floor(expected);
  return whole + (rng.chance(expected - whole) ? 1 : 0);
}

function growthRate(key: AttrKey, age: number): number {
  if (key === "intelligence") {
    if (age < 3) return 1.5;
    if (age < 6) return 3;
    if (age < 12) return 5;
    return age < 18 ? 3 : 0;
  }
  if (key === "fitness") {
    if (age < 3) return 2.5;
    if (age < 6) return 3;
    if (age < 12) return 2.5;
    return age < 18 ? 1.2 : 0;
  }
  if (key === "eq") {
    if (age < 3) return 1;
    if (age < 6) return 2;
    if (age < 12) return 2;
    return age < 18 ? 1.5 : 0;
  }
  if (key === "charm") return age >= 12 && age < 18 ? 1.2 : 0;
  return 0;
}

/** 上课、日常活动与发育带来的被动成长；越接近潜力，增长越慢。 */
export function applyChildDevelopment(rng: Rng, state: GameState, weeks: number): string[] {
  const age = ageOf(state);
  if (age >= 18) return [];
  const gains: string[] = [];
  for (const key of ["intelligence", "fitness", "eq", "charm"] as AttrKey[]) {
    const rate = growthRate(key, age);
    const gap = attributeCeiling(state.character, key) - state.character.attrs[key];
    if (rate <= 0 || gap <= 0) continue;
    const gapFactor = clamp(gap / 30, 0.15, 1);
    const rolled = stochasticAmount(rng, rate * (weeks / 52) * gapFactor);
    if (rolled <= 0) continue;
    const actual = applyBoundedAttributeDelta(state.character, key, rolled);
    if (actual > 0) gains.push(ATTR_LABELS[key] + " +" + actual);
  }
  if (gains.length === 0) return [];
  const source = age >= 3 ? "上课、阅读和日常成长" : "自然发育与模仿";
  return [source + "带来：" + gains.join("，")];
}
