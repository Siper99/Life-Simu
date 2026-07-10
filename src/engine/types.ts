// 引擎共享类型。原则：所有数值真值由引擎持有，LLM 只产出文本与结构化意图。

export type AttrKey =
  | "health" // 健康
  | "fitness" // 体质
  | "intelligence" // 智力
  | "eq" // 情商
  | "charm" // 魅力
  | "mood" // 心境
  | "luck"; // 运气

export type Attributes = Record<AttrKey, number>;

/** 先天基线不是伤病下的硬下限；潜力上限是正常成长和训练不可突破的个人边界。 */
export interface AttributeRange {
  floor: number;
  ceiling: number;
}
export type AttributeBounds = Record<AttrKey, AttributeRange>;

export const ATTR_LABELS: Record<AttrKey, string> = {
  health: "健康",
  fitness: "体质",
  intelligence: "智力",
  eq: "情商",
  charm: "魅力",
  mood: "心境",
  luck: "运气",
};

export interface Skill {
  id: string;
  name: string;
  category: "学业" | "职业" | "爱好" | "生活";
  level: number; // 0-10
  xp: number; // 每 100xp 升一级
}

export interface NPC {
  id: string;
  name: string;
  relation: string; // 父亲/母亲/同学/恋人/上司……（不再混入职业）
  birthYear: number;
  occupation: string | null;
  health: number; // 0..100，随年龄和事件变化
  conditions: string[];
  affinity: number; // -100..100
  personality: string[];
  memories: string[]; // 共同记忆摘要，最多保留 8 条
  alive: boolean;
}

export type LifeStage = "婴儿" | "童年" | "少年" | "青年" | "中年" | "老年";
export type Granularity = "year" | "season" | "month" | "week";

export interface Job {
  title: string;
  employer: string;
  weeklyHours: number;
  weeklyPay: number;
  track: string; // 职业路线，用于稳定地产生晋升头衔
  level: number; // 0..4
  xp: number; // 0..99，工作行动即时累积
}

export interface Identity {
  schooling: string | null; // 幼儿园/小学三年级/高二/大学……
  job: Job | null;
  maritalStatus: "单身" | "恋爱中" | "已婚" | "离异" | "丧偶";
  residence: string;
  legalStatus: "清白" | "缓刑" | "服刑" | "通缉";
  conditions: string[]; // 疾病/状态列表
}

export interface Talent {
  id: string;
  name: string;
  desc: string;
  attrMods: Partial<Attributes>;
  tags: string[];
}

export interface Background {
  country: string;
  city: string;
  cityTier: string; // 一线/二线/县城/农村……
  familyClass: string; // 赤贫/工薪/小康/中产/富裕/豪门
  familyWealth: number; // 家庭初始资产（用于事件与零花钱）
  familyDesc: string; // 给 LLM 的家庭背景描述
}

/** 生活方式档位：金钱的持续性花费窗口，定义见 economy.ts */
export type LifestyleKey = "frugal" | "standard" | "comfort" | "lavish";

export interface CharacterState {
  name: string;
  gender: "男" | "女";
  birthYear: number;
  attrs: Attributes;
  attrBounds: AttributeBounds;
  energy: number; // 0..100，跨回合保留；透支后需要主动休息恢复
  money: number;
  lifestyle: LifestyleKey; // 成年后生效；钱包撑不住会自动降档
  connections: number; // 人脉点
  skills: Skill[];
  npcs: NPC[];
  identity: Identity;
  talents: Talent[];
  alive: boolean;
  deathCause?: string;
}

export interface WorldState {
  year: number;
  week: number; // 1..52
  macroNotes: string[]; // 当前宏观世界备注（经济、社会事件）
}

// ---------- 回合流程 ----------

export type ActionCategory =
  | "study"
  | "work"
  | "social"
  | "romance"
  | "exercise"
  | "leisure"
  | "adventure"
  | "finance"
  | "health"
  | "other";

export interface ActionIntent {
  id: string;
  summary: string; // 玩家想做的事，一句话
  category: ActionCategory;
  hours: number; // 本周投入小时
  energyCost?: number; // 正数消耗精力，负数恢复精力
  risk: "none" | "low" | "high"; // high 触发摆动条
  attr: AttrKey; // 主判定属性
  nsfw: boolean;
  target?: string; // 涉及的 NPC 姓名
  skill?: string; // 这件事在积累的技能名（2~6字名词，如 吉他/木工；缺省由引擎推断）
  moneyCost?: number; // 显性花费（报班费/医药费）：无论成败都扣，买来的服务放大正向产出
}

export type Tier = "crit" | "success" | "partial" | "fail" | "fumble";

export const TIER_LABELS: Record<Tier, string> = {
  crit: "大成功",
  success: "成功",
  partial: "勉强",
  fail: "失败",
  fumble: "大失败",
};

/** 摆动条参数：由引擎计算，UI 只负责表现与回传落点 */
export interface SwingCheck {
  actionId: string;
  label: string;
  difficulty: number; // 0..100
  reward: number; // 1..5，决定摆速
  speedHz: number; // 每秒完整往返次数
  zones: ZoneWidths; // 各档位半宽（相对 0.5 中心的距离阈值）
  baseBest: number; // 属性 50 时的大成功区半宽（双层区宽渲染用）
  attrName?: string; // 判定属性中文名（加成文案用）
  attrZonePct: number; // 属性对大成功区宽的影响（%，可为负）
  attrSpeedPct: number; // 属性对摆速的影响（%，≤0）
}

/** 转针判定结论：档位 + 是否触发运气豁免（大失败降为失败） */
export interface SwingVerdict {
  tier: Tier;
  saved: boolean;
}

/** 从中心往外：|pos-0.5| <= best 为大成功，<= success 为成功…… */
export interface ZoneWidths {
  best: number;
  success: number;
  partial: number;
  fail: number; // 超过 fail 即大失败
}

export interface StatDeltas {
  attrs: Partial<Attributes>;
  energy: number;
  money: number;
  connections: number;
  skillXp: { name: string; category: Skill["category"]; xp: number }[];
  affinity: { npcName: string; delta: number }[];
}

export interface ActionResolution {
  intent: ActionIntent;
  tier: Tier;
  deltas: StatDeltas;
  mechanical: string; // 给 LLM 的机械结果描述
}

export type EventRarity = "common" | "uncommon" | "rare" | "epic";

export interface EventSkeleton {
  id: string;
  name: string;
  rarity: EventRarity;
  stages: LifeStage[];
  weight: number;
  good: boolean; // 正面/负面基调
  prompt: string; // 给 LLM 填充血肉的骨架描述
  attr?: AttrKey; // 需要判定时的属性
  requiresCheck: boolean; // 是否触发摆动条
  rewardLevel: number; // 1..5
  difficulty: number; // 0..100
}

export interface EventResolution {
  skeleton: EventSkeleton;
  tier: Tier;
  deltas: StatDeltas;
  mechanical: string;
}

/** 回合中间态：意图已解析、部分摆动条待玩家操作 */
export interface PendingTurn {
  playerText: string;
  intents: ActionIntent[];
  checks: SwingCheck[]; // 待处理（含事件判定，actionId 以 "event:" 前缀区分）
  checkResults: { checkId: string; tier: Tier; offset: number; saved?: boolean }[];
  event: EventSkeleton | null;
  connectionsSpent?: number; // 本回合动用人脉护航花掉的点数（已扣除，结算时只补记录）
}

export interface LogEntry {
  turn: number;
  date: string; // "2008年 第14周 (7岁)"
  kind: "narrative" | "system" | "event" | "player";
  text: string;
  nsfw?: boolean; // 露骨叙事标记：这段正文只在游戏内展示，组装 prompt 时不发给非 nsfw 后端
}

export interface MemoryNote {
  label: string; // "2008年3月" / "2008年"
  text: string;
}

/** 叙事线头：LLM 在叙事里埋下的、未来可以回应的伏笔（人物动向/未解冲突/冒头的机会） */
export interface LifeHook {
  id: string;
  text: string; // ≤24 字
  turn: number; // 埋下时的回合；超过 4 回合未回应视为搁置
}
export interface DecisionHistoryEntry {
  turn: number;
  choiceIds: string[];
  categories: ActionCategory[];
}

// ---------- 场景模式：镜头拉近后的连续对手戏（见 engine/scene.ts） ----------

export interface SceneBeat {
  player: string; // 玩家这一拍的台词/动作
  narrative: string; // 场景引擎接的一拍
}

export interface SceneState {
  target: string | null; // 对手 NPC 姓名；null = 无特定对象
  nsfw: boolean; // 整场标记：每一拍都路由到 nsfw 后端，收场时记忆只留替身文案
  beats: SceneBeat[];
  startedTurn: number;
}


export interface GameState {
  id: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  rngState: number;
  turn: number;
  granularity: Granularity;
  character: CharacterState;
  background: Background;
  world: WorldState;
  log: LogEntry[];
  weeklyNotes: MemoryNote[]; // 近期详情（最多 12 条）
  monthlySummaries: MemoryNote[]; // 月度摘要（最多 24 条）
  chronicle: string[]; // 人生编年史（每年一段）
  pending: PendingTurn | null;
  scene: SceneState | null; // 进行中的场景（时间冻结，不影响回合推进）
  decisionHistory: DecisionHistoryEntry[]; // 导演系统只读取最近的结构化选择
  hooks: LifeHook[]; // 叙事线头（最多 6 条，回响卡与伏笔回收用）
  ended: boolean;
  epitaph?: string;
}

// ---------- 工具 ----------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function energyStateLabel(energy: number): string {
  if (energy >= 75) return "充沛：可以承担一次极限投入";
  if (energy >= 50) return "稳定：可以安排高强度行动";
  if (energy >= 25) return "疲惫：更适合轻量安排或恢复";
  if (energy > 5) return "低谷：强行投入会明显打折";
  return "透支：继续硬撑会伤害健康";
}

export function energyIntensityLabel(cost: number): string {
  if (cost < 0) return "恢复";
  if (cost >= 50) return "极限";
  if (cost >= 35) return "高强度";
  if (cost >= 18) return "中等";
  return "轻量";
}

export function ageOf(state: GameState): number {
  return state.world.year - state.character.birthYear;
}

export function lifeStageOf(age: number): LifeStage {
  if (age < 4) return "婴儿";
  if (age < 12) return "童年";
  if (age < 18) return "少年";
  if (age < 40) return "青年";
  if (age < 60) return "中年";
  return "老年";
}

export function granularityOf(age: number): Granularity {
  return age < 6 ? "year" : "season";
}

export function formatDate(state: GameState): string {
  const age = ageOf(state);
  if (state.granularity === "year") return `${state.world.year}年（${age}岁）`;
  if (state.granularity === "season") {
    return `${state.world.year}年 第${Math.min(4, Math.ceil(state.world.week / 13))}季（${age}岁）`;
  }
  return `${state.world.year}年 第${state.world.week}周（${age}岁）`;
}

export function emptyDeltas(): StatDeltas {
  return { attrs: {}, energy: 0, money: 0, connections: 0, skillXp: [], affinity: [] };
}
