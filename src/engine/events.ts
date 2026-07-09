// 事件系统：加权随机事件表（骨架）+ 抽取器。骨架给 LLM 填充血肉，数值边界由引擎定。

import { Rng } from "./rng";
import { EventSkeleton, GameState, LifeStage, ageOf, lifeStageOf } from "./types";

const E = (
  id: string,
  name: string,
  rarity: EventSkeleton["rarity"],
  stages: LifeStage[],
  good: boolean,
  prompt: string,
  opts: Partial<Pick<EventSkeleton, "attr" | "requiresCheck" | "rewardLevel" | "difficulty">> = {},
): EventSkeleton => ({
  id,
  name,
  rarity,
  stages,
  good,
  prompt,
  weight: { common: 100, uncommon: 40, rare: 12, epic: 3 }[rarity],
  attr: opts.attr,
  requiresCheck: opts.requiresCheck ?? false,
  rewardLevel: opts.rewardLevel ?? { common: 1, uncommon: 2, rare: 4, epic: 5 }[rarity],
  difficulty: opts.difficulty ?? { common: 20, uncommon: 40, rare: 65, epic: 85 }[rarity],
});

export const EVENT_TABLE: EventSkeleton[] = [
  // ---- 婴儿/童年 ----
  E("ev-fever", "一场高烧", "common", ["婴儿", "童年"], false, "孩子突然发起高烧，家人连夜送医", { attr: "health" }),
  E("ev-firstword", "成长的瞬间", "common", ["婴儿"], true, "孩子解锁了一个成长里程碑（说话/走路/认字），家人惊喜"),
  E("ev-playground", "小伙伴", "common", ["童年"], true, "在附近结识了一个玩得来的小伙伴，可能成为多年好友"),
  E("ev-bully", "被欺负了", "uncommon", ["童年", "少年"], false, "在学校/村里被年长的孩子欺负", { attr: "fitness", requiresCheck: true, rewardLevel: 2, difficulty: 45 }),
  E("ev-prize-kid", "小小荣誉", "uncommon", ["童年"], true, "一次比赛或考试拿了名次，家人很有面子", { attr: "intelligence" }),
  E("ev-lost", "走丢了", "rare", ["童年"], false, "在人多的地方和家人走散了，惊魂一场", { attr: "luck", requiresCheck: true, difficulty: 50, rewardLevel: 2 }),

  // ---- 少年 ----
  E("ev-exam", "关键考试", "common", ["少年"], true, "一场对升学有影响的考试临近", { attr: "intelligence", requiresCheck: true, rewardLevel: 3, difficulty: 50 }),
  E("ev-crush", "青涩心动", "common", ["少年"], true, "对班上一个同学产生了朦胧的好感"),
  E("ev-teacher", "恩师", "uncommon", ["少年"], true, "某位老师注意到了你的潜力，愿意额外指点你"),
  E("ev-fight", "冲突", "uncommon", ["少年", "青年"], false, "和人发生激烈冲突，可能动手", { attr: "fitness", requiresCheck: true, difficulty: 55, rewardLevel: 2 }),
  E("ev-talent-found", "天赋觉醒", "rare", ["少年"], true, "偶然的机会发现自己在某个领域天赋异禀", { rewardLevel: 4 }),
  E("ev-family-crisis", "家庭变故", "rare", ["童年", "少年", "青年"], false, "家里出了大事（生意失败/亲人重病/意外），生活轨迹可能改变"),

  // ---- 青年 ----
  E("ev-jobop", "工作机会", "common", ["青年", "中年"], true, "一个还不错的工作/兼职机会出现了", { attr: "eq", requiresCheck: true, rewardLevel: 3, difficulty: 45 }),
  E("ev-romance", "邂逅", "common", ["青年", "中年"], true, "在偶然场合遇到一个让你心动的人", { attr: "charm", requiresCheck: true, rewardLevel: 3, difficulty: 50 }),
  E("ev-scam", "骗局", "uncommon", ["青年", "中年", "老年"], false, "有人向你兜售一个'稳赚不赔'的机会，是坑还是真机遇？", { attr: "intelligence", requiresCheck: true, difficulty: 60, rewardLevel: 3 }),
  E("ev-invest", "投资风口", "uncommon", ["青年", "中年"], true, "你嗅到一个投资风口，跟还是不跟？", { attr: "luck", requiresCheck: true, difficulty: 65, rewardLevel: 4 }),
  E("ev-illness", "身体亮红灯", "uncommon", ["青年", "中年", "老年"], false, "长期透支后身体发出警告", { attr: "health" }),
  E("ev-noble", "贵人相助", "rare", ["青年", "中年"], true, "一位有能量的人物对你青眼有加，愿意拉你一把", { rewardLevel: 4 }),
  E("ev-windfall", "天降横财", "rare", ["青年", "中年", "老年"], true, "一笔意外之财砸到你头上（中奖/拆迁/遗产）", { rewardLevel: 4 }),
  E("ev-accident", "飞来横祸", "rare", ["少年", "青年", "中年", "老年"], false, "一场突如其来的事故", { attr: "luck", requiresCheck: true, difficulty: 60, rewardLevel: 2 }),
  E("ev-fame", "一夜成名的机会", "epic", ["青年", "中年"], true, "一个能让你被无数人看见的机会摆在面前，抓住它人生就此改写", { attr: "charm", requiresCheck: true, rewardLevel: 5, difficulty: 85 }),
  E("ev-lawsuit", "官司缠身", "rare", ["青年", "中年"], false, "你被卷入一场官司", { attr: "eq", requiresCheck: true, difficulty: 65, rewardLevel: 2 }),

  // ---- 中年/老年 ----
  E("ev-midlife", "中年危机", "uncommon", ["中年"], false, "事业瓶颈、家庭压力一起涌来，你开始怀疑人生的意义"),
  E("ev-promotion", "晋升窗口", "uncommon", ["青年", "中年"], true, "上升通道的门开了一条缝", { attr: "eq", requiresCheck: true, rewardLevel: 3, difficulty: 55 }),
  E("ev-reunion", "故人重逢", "common", ["中年", "老年"], true, "多年未见的老友/旧识突然联系你"),
  E("ev-health-scare", "体检报告", "common", ["中年", "老年"], false, "体检查出了一些需要注意的指标", { attr: "health" }),
  E("ev-legacy", "传承时刻", "rare", ["老年"], true, "你有机会把毕生所学/家业传给下一代"),
  E("ev-grandkid", "含饴弄孙", "common", ["老年"], true, "晚辈带来的天伦之乐"),

  // ---- 全阶段 ----
  E("ev-quiet", "平静的日子", "common", ["婴儿", "童年", "少年", "青年", "中年", "老年"], true, "没有大事发生，生活按部就班地流淌"),
  E("ev-smallluck", "小确幸", "common", ["童年", "少年", "青年", "中年", "老年"], true, "一件微小但让人开心的事"),
  E("ev-smallloss", "倒霉的一周", "common", ["童年", "少年", "青年", "中年", "老年"], false, "接二连三的小倒霉事"),
];

/** 每回合触发随机事件的概率（周粒度）。月/年粒度按次数放大在 clock 里处理。 */
export const WEEKLY_EVENT_CHANCE = 0.38;

export function pickEvent(rng: Rng, state: GameState): EventSkeleton | null {
  const stage = lifeStageOf(ageOf(state));
  const candidates = EVENT_TABLE.filter((e) => e.stages.includes(stage));
  if (candidates.length === 0) return null;
  // 运气影响：运气高时正面事件权重上调，负面下调（幅度温和）
  const luck = state.character.attrs.luck;
  const luckFactor = 1 + (luck - 50) / 150; // 0.67 ~ 1.33
  return rng.weighted(candidates, (e) => (e.good ? e.weight * luckFactor : e.weight / luckFactor));
}
