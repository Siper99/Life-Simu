import { Rng } from "./rng";
import { TRACK_SKILLS, skillTierLabel } from "./skills";
import {
  ActionCategory,
  ActionIntent,
  AttrKey,
  GameState,
  LifeStage,
  Skill,
  ageOf,
  lifeStageOf,
} from "./types";

export type ChoiceKind = "daily" | "intense" | "relationship" | "opportunity" | "director" | "recovery" | "context" | "llm";

export interface DecisionChoice {
  id: string;
  title: string;
  description: string;
  kind: ChoiceKind;
  categoryLabel: string;
  timeCost: number;
  energyCost: number;
  moneyCost?: number; // 显性花费：卡面标价，结算时无论成败都扣
  consequences: string[];
  expiresIn?: number;
  directorNote?: string;
  intent: ActionIntent;
}

export interface WorldPulse {
  id: string;
  title: string;
  summary: string;
  trend: string;
  boosted: ActionCategory[];
  pressured: ActionCategory[];
  major: boolean; // 命中时代大事件的年份（UI 高亮、叙事强调）
}

/** 时代大事件：一次性的「那一年」，比时代底色（ERAS）更具体 */
export interface EpochEvent {
  year: number;
  country?: string; // 缺省 = 全球性事件
  title: string;
  desc: string; // 落到角色身边的写法，不写宏观口号
  boosted?: ActionCategory[];
  pressured?: ActionCategory[];
}

export interface DirectorRead {
  intensity: "观察" | "升温" | "高压" | "托底";
  message: string;
  injectedCategory?: ActionCategory;
}

export interface DecisionBoard {
  timeBudget: number;
  timeLabel: string;
  headline: string; // 决策盘标题：由当下处境生成，取代固定的「这一X怎么过？」
  world: WorldPulse;
  director: DirectorRead;
  choices: DecisionChoice[];
}

interface ChoiceDraft {
  id: string;
  title: string;
  description: string;
  category: ActionCategory;
  attr: AttrKey;
  timeCost: number;
  energyCost: number;
  moneyCost?: number;
  risk?: ActionIntent["risk"];
  skill?: string; // 这张卡积累的技能名（缺省由引擎按类别/关键词推断）
  consequences: string[];
}

interface EraRule extends Omit<WorldPulse, "major"> {
  from: number;
  to: number;
}

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  study: "成长",
  work: "事业",
  social: "关系",
  romance: "情感",
  exercise: "身体",
  leisure: "生活",
  adventure: "冒险",
  finance: "财富",
  health: "健康",
  other: "选择",
};

const ERAS: EraRule[] = [
  {
    id: "opening",
    from: 0,
    to: 1994,
    title: "城市正在加速",
    summary: "市场机会增多，但信息与资源仍集中在少数人手里。",
    trend: "流动年代",
    boosted: ["work", "social"],
    pressured: ["leisure"],
  },
  {
    id: "internet",
    from: 1995,
    to: 2007,
    title: "互联网把远方拉近",
    summary: "新行业开始冒头，学习速度和人脉都可能改写起点。",
    trend: "互联网浪潮",
    boosted: ["study", "adventure"],
    pressured: ["finance"],
  },
  {
    id: "winter",
    from: 2008,
    to: 2011,
    title: "经济进入寒潮",
    summary: "岗位收缩、资产波动，现金和稳定关系显得更重要。",
    trend: "金融寒潮",
    boosted: ["study", "health"],
    pressured: ["work", "finance"],
  },
  {
    id: "mobile",
    from: 2012,
    to: 2019,
    title: "每个人都被连接起来",
    summary: "移动平台重塑工作、消费与社交，注意力成为新的资源。",
    trend: "移动红利",
    boosted: ["social", "work"],
    pressured: ["leisure"],
  },
  {
    id: "reset",
    from: 2020,
    to: 2022,
    title: "世界按下重置键",
    summary: "健康与稳定压过扩张，许多旧路径突然失效。",
    trend: "秩序重排",
    boosted: ["health", "study"],
    pressured: ["adventure", "social"],
  },
  {
    id: "ai",
    from: 2023,
    to: 2031,
    title: "AI 正在重写职业地图",
    summary: "重复劳动迅速贬值，会提问、会协作、能承担结果的人更值钱。",
    trend: "智能革命",
    boosted: ["study", "adventure", "finance"],
    pressured: ["work"],
  },
  {
    id: "robotics",
    from: 2032,
    to: 2044,
    title: "机器人进入日常生活",
    summary: "生产效率跃升，照护、创造力与真实关系成为稀缺品。",
    trend: "机器社会",
    boosted: ["social", "health", "adventure"],
    pressured: ["work"],
  },
  {
    id: "energy",
    from: 2045,
    to: 9999,
    title: "能源与气候重塑城市",
    summary: "迁徙和产业重组同时发生，旧资产与新机会一起洗牌。",
    trend: "能源迁徙",
    boosted: ["finance", "adventure", "social"],
    pressured: ["health"],
  },
];

const STAGE_POOL: Record<LifeStage, ChoiceDraft[]> = {
  婴儿: [
    { id: "imitate", title: "模仿大人的声音", description: "把注意力放在语言和表情上。", category: "study", attr: "intelligence", timeCost: 1, energyCost: 14, consequences: ["智力可能提升", "更容易得到回应"] },
    { id: "explore", title: "扶着家具探索", description: "离开熟悉的角落，试着控制身体。", category: "exercise", attr: "fitness", timeCost: 1, energyCost: 22, risk: "low", consequences: ["体质可能提升", "有轻微磕碰风险"] },
    { id: "observe", title: "安静观察这个家", description: "记住声音、气味和每个人的脾气。", category: "other", attr: "eq", timeCost: 1, energyCost: 8, consequences: ["情商可能提升", "了解家人"] },
    { id: "play", title: "反复摆弄一个玩具", description: "从简单的重复里寻找乐趣。", category: "leisure", attr: "mood", timeCost: 1, energyCost: 6, consequences: ["心境可能提升", "成长较慢"] },
    { id: "cry", title: "用哭声指挥全家", description: "试探每个人的底线，学会精准表达需求。", category: "social", attr: "eq", timeCost: 1, energyCost: 12, consequences: ["情商可能提升", "家人多少有点累"] },
    { id: "nap", title: "睡一个漫长的午觉", description: "婴儿的头等大事就是长身体。", category: "health", attr: "health", timeCost: 1, energyCost: -20, consequences: ["恢复精力", "错过一些热闹"] },
    { id: "taste", title: "把一切塞进嘴里", description: "用最直接的方式认识世界。", category: "adventure", attr: "luck", timeCost: 1, energyCost: 16, risk: "high", consequences: ["认识世界的捷径", "可能吃坏肚子"] },
  ],
  童年: [
    { id: "homework", title: "把功课做扎实", description: "用稳定投入换取更好的学习基础。", category: "study", attr: "intelligence", timeCost: 2, energyCost: 28, consequences: ["学业成长", "心境可能下降"] },
    { id: "sport", title: "去操场疯跑", description: "和同龄人一起出汗，也一起争输赢。", category: "exercise", attr: "fitness", timeCost: 1, energyCost: 20, consequences: ["体质提升", "可能认识朋友"] },
    { id: "hobby", title: "认真培养一项爱好", description: "画画、乐器或棋类，总要先从笨拙开始。", category: "study", attr: "intelligence", timeCost: 1, energyCost: 16, skill: "才艺", consequences: ["获得新技能", "短期回报较少"] },
    { id: "wander", title: "放学后到处闲逛", description: "不按计划走，看看街角会发生什么。", category: "adventure", attr: "luck", timeCost: 1, energyCost: 14, risk: "high", consequences: ["可能发现新鲜事", "存在意外风险"] },
    { id: "read", title: "泡在图书角看闲书", description: "课本之外的世界，比想象的大得多。", category: "study", attr: "intelligence", timeCost: 1, energyCost: 14, skill: "阅读", consequences: ["智力与眼界", "功课让位"] },
    { id: "chores", title: "帮家里搭把手", description: "扫地、择菜、跑腿，大人会看在眼里。", category: "social", attr: "eq", timeCost: 1, energyCost: 14, consequences: ["家人好感提升", "玩的时间变少"] },
    { id: "pocketmoney", title: "攒下零花钱", description: "忍住小卖部的诱惑，第一次和欲望谈判。", category: "finance", attr: "intelligence", timeCost: 1, energyCost: 8, consequences: ["第一笔积蓄", "眼馋别人吃零食"] },
  ],
  少年: [
    { id: "exam", title: "为关键考试冲刺", description: "把大块时间押在分数和升学路径上。", category: "study", attr: "intelligence", timeCost: 2, energyCost: 34, consequences: ["学业大幅成长", "关系与心境承压"] },
    { id: "parttime", title: "周末去打零工", description: "提前接触真实的工作和收入。", category: "work", attr: "eq", timeCost: 2, energyCost: 32, consequences: ["赚取零花钱", "占用学习时间"] },
    { id: "club", title: "参加社团或比赛", description: "让兴趣第一次接受公开检验。", category: "adventure", attr: "charm", timeCost: 1, energyCost: 20, risk: "high", consequences: ["人脉与技能机会", "失败会受挫"] },
    { id: "gaming", title: "和朋友开黑到深夜", description: "快乐很直接，代价也会在第二天出现。", category: "leisure", attr: "mood", timeCost: 1, energyCost: 10, consequences: ["心境提升", "学习进度放缓"] },
    { id: "crush", title: "接近让你心动的人", description: "递一瓶水、借一本书，先让对方记住你。", category: "romance", attr: "charm", timeCost: 1, energyCost: 18, risk: "high", consequences: ["青涩的悸动", "可能被当众婉拒"] },
    { id: "extraread", title: "读课外书开阔眼界", description: "分数管三年，眼界管一生。", category: "study", attr: "intelligence", timeCost: 1, energyCost: 16, skill: "阅读", consequences: ["视野与谈资", "对考试没直接帮助"] },
    { id: "train", title: "坚持早起锻炼", description: "操场上的圈数不会说谎。", category: "exercise", attr: "fitness", timeCost: 1, energyCost: 24, consequences: ["体质稳步提升", "晚自习犯困"] },
  ],
  青年: [
    { id: "career", title: "把时间押在事业上", description: "争取机会、作品或一次更好的面试。", category: "work", attr: "eq", timeCost: 2, energyCost: 36, consequences: ["收入与职业成长", "精力消耗较大"] },
    { id: "upskill", title: "下班后学习新技能", description: "牺牲眼前的轻松，为下一次跳跃做准备。", category: "study", attr: "intelligence", timeCost: 2, energyCost: 30, skill: "专业技能", consequences: ["获得技能经验", "短期没有收入"] },
    { id: "sideproject", title: "启动一个小项目", description: "先做出能被人使用的东西，再谈梦想。", category: "adventure", attr: "intelligence", timeCost: 2, energyCost: 38, risk: "high", skill: "创业", consequences: ["可能打开新路径", "失败成本较高"] },
    { id: "invest", title: "研究并投入一笔钱", description: "让判断接受市场检验，而不是只看热闹。", category: "finance", attr: "luck", timeCost: 1, energyCost: 16, risk: "high", consequences: ["财富可能增长", "也可能亏损"] },
    { id: "network", title: "经营一场饭局", description: "有些机会只在酒过三巡后出现。", category: "social", attr: "eq", timeCost: 1, energyCost: 20, consequences: ["人脉扩展", "身体和钱包都出血"] },
    { id: "love", title: "认真经营一段感情", description: "把对方放进日程表，而不是空隙里。", category: "romance", attr: "charm", timeCost: 1, energyCost: 16, consequences: ["亲密关系推进", "自由时间变少"] },
    { id: "gym", title: "把健身变成习惯", description: "身体是唯一跟你走完全程的东西。", category: "exercise", attr: "fitness", timeCost: 1, energyCost: 26, consequences: ["体质与状态", "肌肉会先抗议"] },
    { id: "moonlight", title: "接一单私活", description: "用睡眠换现金流，短期见效最快的路。", category: "work", attr: "intelligence", timeCost: 1, energyCost: 26, consequences: ["额外收入", "透支精力"] },
  ],
  中年: [
    { id: "promotion", title: "争取更大的责任", description: "主动接下棘手项目，换取事业上升窗口。", category: "work", attr: "eq", timeCost: 2, energyCost: 38, risk: "high", consequences: ["事业与收入机会", "健康和关系承压"] },
    { id: "sidebusiness", title: "验证一门副业", description: "用现有经验寻找第二条收入曲线。", category: "finance", attr: "intelligence", timeCost: 2, energyCost: 32, risk: "high", consequences: ["财富机会", "可能损失本金"] },
    { id: "checkup", title: "认真处理身体信号", description: "预约体检，调整作息，不再假装没事。", category: "health", attr: "health", timeCost: 1, energyCost: -16, consequences: ["恢复健康与精力", "花费金钱"] },
    { id: "oldhobby", title: "捡回搁置多年的爱好", description: "给不产生绩效的自己留一块地方。", category: "leisure", attr: "mood", timeCost: 1, energyCost: -10, skill: "才艺", consequences: ["恢复心境与精力", "事业进度放缓"] },
    { id: "family", title: "认真陪一次家人", description: "关掉手机，把整段时间还给最近的人。", category: "social", attr: "eq", timeCost: 1, energyCost: 12, consequences: ["关系修复", "工作消息堆积"] },
    { id: "mentor", title: "带一带年轻人", description: "把经验变成别人的起点，也变成你的口碑。", category: "social", attr: "eq", timeCost: 1, energyCost: 16, consequences: ["人脉与声望", "考验耐心"] },
    { id: "assets", title: "重新梳理家庭资产", description: "保险、负债、闲钱，一笔一笔过。", category: "finance", attr: "intelligence", timeCost: 1, energyCost: 18, consequences: ["财务更稳健", "可能发现窟窿"] },
  ],
  老年: [
    { id: "exercise", title: "保持规律运动", description: "不追求极限，只维持身体仍能回应你。", category: "health", attr: "health", timeCost: 1, energyCost: 8, consequences: ["健康可能提升", "降低衰退速度"] },
    { id: "memoir", title: "整理一生的经验", description: "把做对和做错的事都写下来。", category: "study", attr: "intelligence", timeCost: 2, energyCost: 20, skill: "写作", consequences: ["留下传承", "梳理人生"] },
    { id: "travel", title: "去一个没去过的地方", description: "趁身体还允许，主动制造新的记忆。", category: "adventure", attr: "health", timeCost: 2, energyCost: 30, risk: "high", consequences: ["心境大幅改善机会", "健康与金钱风险"] },
    { id: "tea", title: "约老友喝茶", description: "有些关系不联系，就真的会消失。", category: "social", attr: "eq", timeCost: 1, energyCost: 8, consequences: ["关系与心境提升", "没有物质回报"] },
    { id: "garden", title: "侍弄一个小园子", description: "浇水、松土、等一茬时令菜慢慢长。", category: "leisure", attr: "mood", timeCost: 1, energyCost: 6, skill: "园艺", consequences: ["心境平和", "收成看天意"] },
    { id: "volunteer", title: "去社区做志愿者", description: "被人需要，是退休后最稀缺的感觉。", category: "social", attr: "eq", timeCost: 1, energyCost: 14, consequences: ["关系与被需要感", "消耗体力"] },
  ],
};

/** 大事年表：按出生年 1985~2012、寿命至本世纪末的时间轴布点 */
const EPOCH_EVENTS: EpochEvent[] = [
  { year: 1992, country: "中国", title: "下海潮", desc: "身边开始有人辞掉铁饭碗做生意，大人们饭桌上都在争论值不值。", boosted: ["finance", "adventure"] },
  { year: 1997, country: "中国", title: "香港回归", desc: "电视里直播交接仪式，街上挂满了旗子，那晚很多人没睡。" },
  { year: 1998, country: "中国", title: "下岗潮", desc: "厂里开始成批下岗，谁家大人「回家了」是最近最沉的话题。", pressured: ["work"] },
  { year: 2001, country: "中国", title: "入世与申奥成功", desc: "两件喜事挤在一年，大人们说以后做外贸、学外语有出路。", boosted: ["study", "work"] },
  { year: 2003, country: "中国", title: "非典", desc: "学校停课、进门量体温，白醋和板蓝根一夜脱销。", pressured: ["social", "adventure"], boosted: ["health"] },
  { year: 2008, country: "中国", title: "奥运与金融危机", desc: "上半年全民看奥运，下半年新闻开始讲裁员——冰火同年。", pressured: ["finance", "work"] },
  { year: 2008, title: "全球金融危机", desc: "银行倒闭的新闻天天播，身边有人一夜之间失了业。", pressured: ["finance", "work"] },
  { year: 2012, title: "移动互联网元年", desc: "似乎一夜之间人人都在低头刷手机，新的行当和新的瘾同时出现。", boosted: ["study", "adventure"] },
  { year: 2015, country: "中国", title: "股灾", desc: "楼下大爷都在谈股票的那个夏天，很多账户绿得发黑。", pressured: ["finance"] },
  { year: 2020, title: "新冠疫情", desc: "口罩、封控、网课与居家办公——所有人的生活被按下暂停键。", pressured: ["social", "adventure", "work"], boosted: ["health"] },
  { year: 2023, title: "生成式 AI 元年", desc: "会跟人对话的 AI 横空出世，有人焦虑饭碗，有人连夜学起了新东西。", boosted: ["study", "adventure"] },
  { year: 2032, title: "机器人走进家庭", desc: "第一批家用机器人开始送外卖、照顾老人，人们讨论哪些工作还剩下。", pressured: ["work"], boosted: ["social", "health"] },
  { year: 2045, title: "能源迁徙时代", desc: "新能源城市群崛起，老工业城的人口肉眼可见地流走。", boosted: ["finance", "adventure"] },
  { year: 2060, title: "百岁时代", desc: "平均寿命突破九十，「退休」这个词的含义正在被改写。", boosted: ["health", "study"] },
];

/** 当年命中的时代大事件（本国事件优先于全球事件） */
export function epochEventFor(year: number, country: string): EpochEvent | null {
  const hits = EPOCH_EVENTS.filter((e) => e.year === year);
  return hits.find((e) => e.country === country) ?? hits.find((e) => !e.country) ?? null;
}

export function getWorldPulse(state: GameState): WorldPulse {
  const era = ERAS.find((item) => state.world.year >= item.from && state.world.year <= item.to) ?? ERAS[ERAS.length - 1];
  const epoch = epochEventFor(state.world.year, state.background.country);
  if (epoch) {
    // 大事件之年：底色让位给「那一年」，修正与文案都换成事件本身
    return {
      id: `epoch-${epoch.year}`,
      title: epoch.title,
      summary: epoch.desc,
      trend: `${era.trend} · ${epoch.year}`,
      boosted: epoch.boosted ?? era.boosted,
      pressured: epoch.pressured ?? era.pressured,
      major: true,
    };
  }
  return {
    id: era.id,
    title: era.title,
    summary: era.summary,
    trend: era.trend,
    boosted: era.boosted,
    pressured: era.pressured,
    major: false,
  };
}

export function worldModifierFor(state: GameState, category: ActionCategory): number {
  const pulse = getWorldPulse(state);
  if (pulse.boosted.includes(category)) return 1.2;
  if (pulse.pressured.includes(category)) return 0.85;
  return 1;
}

function hoursPerBlock(state: GameState): number {
  if (state.granularity === "week") return 14;
  if (state.granularity === "month") return 56;
  if (state.granularity === "season") return 160;
  return 420;
}

function toChoice(state: GameState, draft: ChoiceDraft, kind: ChoiceKind = "daily"): DecisionChoice {
  return {
    id: `${kind}-${draft.id}`,
    title: draft.title,
    description: draft.description,
    kind,
    categoryLabel: CATEGORY_LABELS[draft.category],
    timeCost: draft.timeCost,
    energyCost: draft.energyCost,
    moneyCost: draft.moneyCost,
    consequences: draft.consequences,
    intent: {
      id: `choice-${draft.id}`,
      summary: draft.title,
      category: draft.category,
      hours: hoursPerBlock(state) * draft.timeCost,
      energyCost: draft.energyCost,
      risk: draft.risk ?? "low",
      attr: draft.attr,
      nsfw: false,
      skill: draft.skill,
      moneyCost: draft.moneyCost,
    },
  };
}

// ---------- 角色气质：同一个角色一生稳定、不同角色各不相同的「个人特长」 ----------

const HOBBY_POOL = ["绘画", "乐器", "棋艺", "舞蹈", "手工", "书法"];
const CRAFT_POOL = ["编程", "设计", "写作", "外语", "理财", "摄影"];

function personaPick(state: GameState, pool: string[], salt: number): string {
  return pool[(Math.imul(state.seed ^ salt, 2654435761) >>> 0) % pool.length];
}

/** 模糊卡个性化：把「才艺」「专业技能」这类占位词换成这个角色自己的东西 */
function personalizeDraft(state: GameState, draft: ChoiceDraft): ChoiceDraft {
  if (draft.skill === "才艺") {
    const hobby = personaPick(state, HOBBY_POOL, 0x51);
    const existing = state.character.skills.find((s) => s.name === hobby);
    return {
      ...draft,
      skill: hobby,
      title: draft.id === "hobby" ? `把「${hobby}」练出样子` : draft.id === "oldhobby" ? `捡回搁置多年的${hobby}` : draft.title,
      description: draft.id === "hobby"
        ? existing ? `${hobby}已经${skillTierLabel(existing.level)}，从笨拙到像样只差坚持。` : `从笨拙开始，把${hobby}变成自己的东西。`
        : draft.description,
    };
  }
  if (draft.skill === "专业技能") {
    const craft = TRACK_SKILLS[state.character.identity.job?.track ?? ""] ?? personaPick(state, CRAFT_POOL, 0xc7);
    return { ...draft, skill: craft, title: `下班后死磕${craft}`, description: `牺牲眼前的轻松，把${craft}磨成下一次跳跃的资本。` };
  }
  return draft;
}

// ---------- 情境卡：从当前处境里长出来的卡，引用真实的人、技能和数字 ----------

const SKILL_CAT_ACTION: Record<Skill["category"], { category: ActionCategory; attr: AttrKey }> = {
  学业: { category: "study", attr: "intelligence" },
  职业: { category: "work", attr: "eq" },
  爱好: { category: "leisure", attr: "mood" },
  生活: { category: "leisure", attr: "mood" },
};

function contextualChoices(state: GameState, rng: Rng): DecisionChoice[] {
  const c = state.character;
  const age = ageOf(state);
  const candidates: DecisionChoice[] = [];
  const push = (draft: ChoiceDraft, target?: string) => {
    const choice = toChoice(state, draft, "context");
    if (target) choice.intent.target = target;
    candidates.push(choice);
  };

  // 财务危机：欠钱是最要紧的事
  if (age >= 16 && c.money < 0) {
    push({
      id: "ctx-debt", title: "先把窟窿补上",
      description: `欠着 ${Math.abs(c.money).toLocaleString()} 的日子睡不安稳，接点活先止血。`,
      category: "work", attr: "eq", timeCost: 1, energyCost: 24,
      consequences: ["缓解财务压力", "占用发展时间"],
    });
  }

  // 牵挂：在乎的人健康亮了红灯
  const ailing = c.npcs
    .filter((n) => n.alive && n.birthYear <= state.world.year && n.health < 45 && n.affinity > 0)
    .sort((a, b) => a.health - b.health)[0];
  if (ailing && age >= 8) {
    push({
      id: `ctx-care-${ailing.id}`, title: `陪${ailing.name}去趟医院`,
      description: `${ailing.relation}的健康只剩 ${ailing.health}，有些事不能再拖了。`,
      category: "social", attr: "eq", timeCost: 1, energyCost: 14,
      consequences: [`${ailing.name}好感提升`, "花时间也花心力"],
    }, ailing.name);
  }

  // 裂痕：至亲或伴侣的关系跌破冰点
  const estranged = c.npcs
    .filter((n) => n.alive && n.birthYear <= state.world.year && n.affinity < 15 && /父亲|母亲|哥哥|姐姐|弟弟|妹妹|配偶|恋人/.test(n.relation))
    .sort((a, b) => a.affinity - b.affinity)[0];
  if (estranged && age >= 8) {
    push({
      id: `ctx-mend-${estranged.id}`, title: `和${estranged.name}把话说开`,
      description: `${estranged.relation}的好感只剩 ${estranged.affinity}。再僵下去，这个家会越来越安静。`,
      category: "social", attr: "eq", timeCost: 1, energyCost: 16,
      consequences: ["修复一段血缘", "旧账可能翻出来"],
    }, estranged.name);
  }

  // 磨砺：练得最深的技能值得再进一层
  const top = [...c.skills].sort((a, b) => b.level - a.level || b.xp - a.xp)[0];
  if (top && top.level >= 2 && top.level < 10) {
    const map = SKILL_CAT_ACTION[top.category];
    push({
      id: `ctx-hone-${top.name}`, title: `把「${top.name}」再磨一层`,
      description: `${skillTierLabel(top.level)}到${skillTierLabel(top.level + 1)}之间，隔着一段没人能替你走的路。`,
      category: map.category, attr: map.attr, timeCost: 1, energyCost: 22, skill: top.name,
      consequences: [`「${top.name}」经验大涨`, "其他安排让位"],
    });
  }

  // 花钱办事的基准量级（与 resolver.moneyScale 同口径，避免循环依赖就地计算）
  const spendScale = c.identity.job
    ? Math.max(80, c.identity.job.weeklyPay * 0.5)
    : age < 18 ? 40 : 300;

  // 报班：花钱请人指路，比闷头摸索快得多（技能经验 ×2.5，钱无论成败都花出去）
  const tuition = Math.round(spendScale * 3);
  if (age >= 16 && top && top.level >= 1 && top.level < 10 && c.money >= tuition * 1.5) {
    const map = SKILL_CAT_ACTION[top.category];
    push({
      id: `ctx-course-${top.name}`, title: `给「${top.name}」报个班`,
      description: `花 ${tuition.toLocaleString()} 请人指路，比自己闷头摸索快得多。`,
      category: map.category, attr: map.attr, timeCost: 1, energyCost: 20,
      moneyCost: tuition, skill: top.name,
      consequences: [`「${top.name}」经验×2.5`, `花费 ${tuition.toLocaleString()}`],
    });
  }

  // 就医：健康亮红灯或上了年纪，花钱把身体修回来（健康恢复 ×2）
  const medical = Math.round(spendScale * 2);
  if (age >= 18 && (c.attrs.health < 55 || age >= 60) && c.money >= medical) {
    push({
      id: "ctx-medical", title: "认真做一次体检调理",
      description: `花 ${medical.toLocaleString()} 买个明白：把隐患查出来，把身体养回来。`,
      category: "health", attr: "health", timeCost: 1, energyCost: -12,
      moneyCost: medical,
      consequences: ["健康恢复翻倍", `花费 ${medical.toLocaleString()}`],
    });
  }

  // 闲钱：趴着不动的钱在贬值
  if (age >= 18 && c.money > 30000) {
    push({
      id: "ctx-idle-money", title: "让闲钱出去干活",
      description: `账上躺着 ${c.money.toLocaleString()}。放着是安全感，动起来才是机会。`,
      category: "finance", attr: "intelligence", timeCost: 1, energyCost: 16, risk: "high",
      consequences: ["财富可能增长", "也可能交学费"],
    });
  }

  // 线头回响：叙事埋下的伏笔，引擎自己也接得住（离线时是唯一的回应通道）
  const hook = [...state.hooks].reverse().find((h) => state.turn - h.turn <= 4);
  if (hook) {
    push({
      id: `ctx-hook-${hook.id}`, title: hook.text.slice(0, 12),
      description: `这件事还悬着：${hook.text}。线头不去接，就会自己断掉。`,
      category: "adventure", attr: "luck", timeCost: 1, energyCost: 15,
      consequences: ["回应一段伏笔", "结果未必如愿"],
    });
  }

  return rng.sample(candidates, Math.min(2, candidates.length));
}

function relationshipChoice(state: GameState): DecisionChoice {
  const npc = state.character.npcs
    .filter((item) => item.alive && item.birthYear <= state.world.year)
    .sort((a, b) => b.affinity - a.affinity)[0];
  const target = npc?.name ?? "身边的人";
  const relation = npc?.relation ?? "关系";
  const npcDetail = npc
    ? `${relation}，${state.world.year - npc.birthYear}岁，${npc.occupation ?? "无职业"}，健康${npc.health}`
    : relation;
  const category: ActionCategory = ageOf(state) >= 16 && state.character.identity.maritalStatus === "恋爱中" ? "romance" : "social";
  const choice = toChoice(state, {
    id: `with-${npc?.id ?? "someone"}`,
    title: `把时间留给${target}`,
    description: `${npcDetail}。关系不会永远停在原地，见面和倾听也会改变彼此。`,
    category,
    attr: category === "romance" ? "charm" : "eq",
    timeCost: 1,
    energyCost: 10,
    consequences: [`${target}好感可能提升`, "其他进度放缓"],
  }, "relationship");
  choice.intent.target = target;
  return choice;
}

function recoveryChoice(state: GameState): DecisionChoice {
  return toChoice(state, {
    id: "recovery",
    title: "给自己留出空白",
    description: "早点睡、散步、发呆。没有产出，但人不是永动机。",
    category: state.character.attrs.health < 45 ? "health" : "leisure",
    attr: state.character.attrs.health < 45 ? "health" : "mood",
    timeCost: 1,
    energyCost: -24,
    consequences: ["恢复精力", "心境或健康改善"],
  }, "recovery");
}
function intenseChoice(state: GameState): DecisionChoice {
  const stage = lifeStageOf(ageOf(state));
  const config: Record<LifeStage, ChoiceDraft> = {
    婴儿: {
      id: "all-in-growth", title: "用整年学走路和说话", description: "把这一年的大部分力气都用在最关键的发育上。",
      category: "study", attr: "intelligence", timeCost: 2, energyCost: 45,
      consequences: ["成长收益显著提高", "几乎没有其他安排"],
    },
    童年: {
      id: "all-in-training", title: "参加一季强化训练", description: "连续三个月围绕一个目标训练，成果和疲惫都会很明显。",
      category: "study", attr: "intelligence", timeCost: 2, energyCost: 55, risk: "high", skill: "才艺",
      consequences: ["高强度高成长", "下一季可能需要休整"],
    },
    少年: {
      id: "all-in-exam", title: "把这一季押给冲刺", description: "暂停大部分娱乐，把时间和体力集中到一个关键目标。",
      category: "study", attr: "intelligence", timeCost: 2, energyCost: 65, risk: "high",
      consequences: ["可能实现明显跃升", "健康与关系承压"],
    },
    青年: {
      id: "all-in-career", title: "进行一次事业总攻", description: "用三个月完成平时半年才敢碰的目标，赌一次跃迁。",
      category: "work", attr: "eq", timeCost: 2, energyCost: 70, risk: "high",
      consequences: ["高回报职业机会", "失败会严重透支"],
    },
    中年: {
      id: "all-in-project", title: "扛下决定性项目", description: "把经验、声誉和体力一起押上，争取改变当前位置。",
      category: "work", attr: "eq", timeCost: 2, energyCost: 65, risk: "high",
      consequences: ["职位与收入跃升机会", "健康和家庭承压"],
    },
    老年: {
      id: "all-in-wish", title: "完成一件长久心愿", description: "趁身体还允许，用一季去做那件一直推迟的事。",
      category: "adventure", attr: "health", timeCost: 2, energyCost: 50, risk: "high",
      consequences: ["留下重要人生记忆", "身体恢复更慢"],
    },
  };
  return toChoice(state, personalizeDraft(state, config[stage]), "intense");
}

function opportunityChoice(state: GameState, world: WorldPulse): DecisionChoice | null {
  const windowStart = Math.floor(state.turn / 4) * 4;
  const opportunityId = `opportunity-${world.id}-${windowStart}`;
  const claimed = state.decisionHistory?.some((entry) => entry.choiceIds.includes(opportunityId));
  if (claimed) return null;

  const stage = lifeStageOf(ageOf(state));
  const config: Record<LifeStage, { title: string; description: string; category: ActionCategory; attr: AttrKey }> = {
    婴儿: { title: "家里来了一位特别的客人", description: "对方愿意花时间陪你，也可能影响父母之后的选择。", category: "social", attr: "luck" },
    童年: { title: "免费的体验名额只剩一个", description: `一项与「${world.trend}」有关的活动今天截止报名。`, category: "study", attr: "intelligence" },
    少年: { title: "关键比赛开放报名", description: `这可能成为你进入「${world.trend}」的一张早期门票。`, category: "adventure", attr: "intelligence" },
    青年: { title: `${world.trend}项目正在招募`, description: "收入和稳定性都不确定，但窗口关闭后不会等你。", category: "adventure", attr: "intelligence" },
    中年: { title: "一张合伙人席位", description: `旧同事邀请你进入「${world.trend}」，需要拿现金和声誉一起下注。`, category: "finance", attr: "eq" },
    老年: { title: "城市传承计划开放", description: "有人愿意认真听你的经验，但申请只开放很短时间。", category: "social", attr: "eq" },
  };
  const item = config[stage];
  const choice = toChoice(state, {
    id: `opportunity-${world.id}-${windowStart}`,
    title: item.title,
    description: item.description,
    category: item.category,
    attr: item.attr,
    timeCost: 2,
    energyCost: 34,
    risk: "high",
    consequences: ["可能改变人生路径", "高风险且不可重来"],
  }, "opportunity");
  choice.id = opportunityId;
  choice.expiresIn = 4 - (state.turn - windowStart);
  return choice;
}

export function readDirector(state: GameState): DirectorRead {
  if (state.character.attrs.health < 35 || state.character.energy < 22) {
    return { intensity: "托底", message: "你已经接近透支，系统正在增加恢复选项。", injectedCategory: "health" };
  }
  const recent = (state.decisionHistory ?? []).slice(-4).flatMap((entry) => entry.categories);
  if (recent.length === 0) {
    return { intensity: "观察", message: "导演正在观察你把时间投向哪里。" };
  }
  const counts = new Map<ActionCategory, number>();
  for (const category of recent) counts.set(category, (counts.get(category) ?? 0) + 1);
  const [dominant, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (count / recent.length < 0.6) {
    return { intensity: "升温", message: "你的生活暂时保持平衡，世界会逐渐提高赌注。" };
  }
  if (["study", "work", "finance"].includes(dominant)) {
    return { intensity: "高压", message: "你最近只顾成长和回报，关系事件正在靠近。", injectedCategory: "social" };
  }
  if (["social", "romance", "leisure"].includes(dominant)) {
    return { intensity: "升温", message: "你把很多时间给了感受，现实目标开始追上来。", injectedCategory: ageOf(state) < 18 ? "study" : "work" };
  }
  return { intensity: "升温", message: "你持续强化同一种生活，导演会制造新的取舍。", injectedCategory: "social" };
}

function directorChoice(state: GameState, director: DirectorRead): DecisionChoice | null {
  if (!director.injectedCategory || director.intensity === "托底") return null;
  const isRelationship = director.injectedCategory === "social";
  const draft: ChoiceDraft = isRelationship
    ? { id: "director-relationship", title: "回应一条被忽略的消息", description: "对方已经主动了两次。再不回应，这段关系会自己往前走。", category: "social", attr: "eq", timeCost: 1, energyCost: 12, consequences: ["修复一段关系", "打断当前节奏"] }
    : { id: "director-reality", title: ageOf(state) < 18 ? "补上落下的进度" : "处理积压的现实问题", description: "它不刺激，却会在继续拖延后变成真正的麻烦。", category: director.injectedCategory, attr: ageOf(state) < 18 ? "intelligence" : "eq", timeCost: 1, energyCost: 18, consequences: ["降低未来压力", "占用自由时间"] };
  const choice = toChoice(state, draft, "director");
  choice.directorNote = director.message;
  return choice;
}

/**
 * LLM 补充卡的净化入口：LLM 只产出文本与意图，数值真值由这里裁剪落地。
 * 任何字段缺失/越界都被拉回合法范围；解析不出标题的条目直接丢弃。
 */
export function sanitizeLlmChoices(state: GameState, raw: unknown): DecisionChoice[] {
  if (!Array.isArray(raw)) return [];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const validCategory = (c: unknown): c is ActionCategory =>
    typeof c === "string" && c in CATEGORY_LABELS;
  const VALID_ATTRS = new Set(["health", "fitness", "intelligence", "eq", "charm", "mood", "luck"]);
  const out: DecisionChoice[] = [];
  let riskUsed = false;

  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? "").trim().slice(0, 16);
    if (!title) continue;
    const category: ActionCategory = validCategory(r.category) ? r.category : "other";
    const attr = VALID_ATTRS.has(String(r.attr)) ? (r.attr as AttrKey) : "mood";
    const timeCost = Number(r.timeCost) === 2 ? 2 : 1;
    const energyCost = clamp(Math.round(Number(r.energyCost) || 15), -25, 70);
    // 显性花费不能超过角色现有的钱：LLM 不许开出付不起的价
    const moneyCost = clamp(Math.round(Number(r.moneyCost) || 0), 0, Math.max(0, state.character.money));
    const risk: ActionIntent["risk"] = r.risk === "high" && !riskUsed ? "high" : "low";
    if (risk === "high") riskUsed = true; // 每批至多一张高危卡
    const consequences = Array.isArray(r.consequences)
      ? r.consequences.slice(0, 3).map((c) => String(c).slice(0, 14)).filter(Boolean)
      : [];
    const id = `llm-${state.turn}-${out.length}`;
    out.push({
      id,
      title,
      description: String(r.description ?? "").trim().slice(0, 60),
      kind: "llm",
      categoryLabel: CATEGORY_LABELS[category],
      timeCost,
      energyCost,
      moneyCost: moneyCost > 0 ? moneyCost : undefined,
      consequences,
      intent: {
        id,
        summary: title,
        category,
        hours: hoursPerBlock(state) * timeCost,
        energyCost,
        risk,
        attr,
        nsfw: false,
        target: r.target ? String(r.target).slice(0, 20) : undefined,
        skill: r.skill ? String(r.skill).trim().slice(0, 6) : undefined,
        moneyCost: moneyCost > 0 ? moneyCost : undefined,
      },
    });
  }
  return out;
}

/** 决策盘标题：一句话点出当下最要紧的事，优先级 = 时代大事 > 升学关口 > 生存危机 > 默认 */
export function boardHeadline(state: GameState, world: WorldPulse, unitLabel: string): string {
  const c = state.character;
  const ask = `这一${unitLabel}怎么过？`;
  if (world.major) return `「${world.title}」来了——${ask}`;
  if (c.identity.legalStatus === "通缉") return `警察在找你——${ask}`;
  if (c.identity.legalStatus === "服刑") return `高墙内的日子——${ask}`;
  const schooling = c.identity.schooling ?? "";
  if (schooling.includes("初中3")) return `中考就在今年——${ask}`;
  if (schooling.includes("高中3")) return `高考近在眼前——${ask}`;
  if (c.money < 0) return `欠着钱的日子——${ask}`;
  if (c.attrs.health < 40) return `身体在报警——${ask}`;
  if (c.attrs.mood < 35) return `心里灰蒙蒙的——${ask}`;
  if (c.energy < 25) return `快被榨干了——${ask}`;
  return ask;
}

export function getDecisionBoard(state: GameState, extraChoices: DecisionChoice[] = []): DecisionBoard {
  const world = getWorldPulse(state);
  const director = readDirector(state);
  const stage = lifeStageOf(ageOf(state));
  const rng = Rng.fromState(((state.seed ^ Math.imul(state.turn + 1, 2654435761)) >>> 0) || 1);
  // 情境卡用独立随机序列：LLM 卡异步到达后重算看板时，日常卡的抽样不能被扰动
  const ctxRng = Rng.fromState(((state.seed ^ Math.imul(state.turn + 7, 40503)) >>> 0) || 1);
  const daily = rng
    .sample(STAGE_POOL[stage], Math.min(3, STAGE_POOL[stage].length))
    .map((item) => toChoice(state, personalizeDraft(state, item)));
  const opportunity = opportunityChoice(state, world);
  const injected = directorChoice(state, director);
  const choices = [
    ...(injected ? [injected] : []),
    ...(opportunity ? [opportunity] : []),
    intenseChoice(state),
    recoveryChoice(state), // 精力系统的托底项必须始终可见
    relationshipChoice(state),
    ...contextualChoices(state, ctxRng), // 情境卡：从当前处境长出来的个性化选项
    ...extraChoices, // LLM 补充卡紧随其后，位置醒目
    ...daily, // 通用日常卡垫底，被个性化内容挤掉也无妨
  ];
  const seen = new Set<string>();
  const deduped = choices.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const unitLabel = state.granularity === "season" ? "季" : state.granularity === "week" ? "周" : state.granularity === "month" ? "个月" : "年";
  return {
    timeBudget: 3,
    timeLabel: state.granularity === "season" ? "本季重心" : state.granularity === "week" ? "本周时间" : state.granularity === "month" ? "本月重心" : "这一年",
    headline: boardHeadline(state, world, unitLabel),
    world,
    director,
    choices: deduped.slice(0, 11),
  };
}

export function selectionError(state: GameState, board: DecisionBoard, ids: string[]): string | null {
  if (ids.length === 0) return "至少选择一项安排";
  const selected = ids.map((id) => board.choices.find((choice) => choice.id === id)).filter((choice): choice is DecisionChoice => Boolean(choice));
  if (selected.length !== ids.length) return "选择已经过期，请重新安排";
  const time = selected.reduce((sum, choice) => sum + choice.timeCost, 0);
  if (time > board.timeBudget) return `时间不够：需要 ${time} 格，只有 ${board.timeBudget} 格`;
  const energy = selected.reduce((sum, choice) => sum + Math.max(0, choice.energyCost), 0);
  if (energy > state.character.energy) return `精力不够：需要 ${energy}，当前只有 ${state.character.energy}`;
  const money = selected.reduce((sum, choice) => sum + (choice.moneyCost ?? 0), 0);
  if (money > Math.max(0, state.character.money)) return `钱不够：需要 ${money.toLocaleString()}，手头只有 ${Math.max(0, state.character.money).toLocaleString()}`;
  return null;
}
