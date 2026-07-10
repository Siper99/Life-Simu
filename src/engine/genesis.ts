// 开局生成：出生背景、家庭、父母 NPC、天赋池抽卡、初始属性。

import { Rng } from "./rng";
import {
  Attributes,
  Background,
  CharacterState,
  GameState,
  NPC,
  Talent,
  clamp,
} from "./types";

const SURNAMES = "李王张刘陈杨黄赵吴周徐孙马朱胡郭何林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董潘袁蔡蒋余于杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎".split("");
const MALE_NAMES = ["伟","强","磊","军","洋","勇","杰","涛","明","超","刚","平","辉","健","俊杰","浩然","子轩","宇航","博文","天佑","立诚","嘉树","一鸣","晨曦","泽宇","思远"];
const FEMALE_NAMES = ["芳","娜","敏","静","丽","娟","艳","秀英","雪","婷","雨桐","欣怡","诗涵","梦琪","子涵","晓彤","若曦","佳怡","可欣","语嫣","采薇","念慈"];

interface CountryDef {
  name: string;
  weight: number;
  cities: { name: string; tier: string }[];
}

const COUNTRIES: CountryDef[] = [
  {
    name: "中国",
    weight: 60,
    cities: [
      { name: "北京", tier: "一线城市" },
      { name: "上海", tier: "一线城市" },
      { name: "深圳", tier: "一线城市" },
      { name: "成都", tier: "新一线城市" },
      { name: "杭州", tier: "新一线城市" },
      { name: "武汉", tier: "新一线城市" },
      { name: "长沙", tier: "二线城市" },
      { name: "南昌", tier: "二线城市" },
      { name: "洛阳", tier: "三线城市" },
      { name: "赣州下辖某县城", tier: "县城" },
      { name: "皖北某农村", tier: "农村" },
      { name: "黔东南某山村", tier: "农村" },
    ],
  },
  { name: "美国", weight: 8, cities: [{ name: "纽约", tier: "国际大都市" }, { name: "俄亥俄州小镇", tier: "小镇" }, { name: "洛杉矶", tier: "国际大都市" }] },
  { name: "日本", weight: 6, cities: [{ name: "东京", tier: "国际大都市" }, { name: "大阪", tier: "大城市" }, { name: "北海道乡下", tier: "乡村" }] },
  { name: "印度", weight: 8, cities: [{ name: "孟买", tier: "大城市" }, { name: "比哈尔邦农村", tier: "农村" }] },
  { name: "尼日利亚", weight: 4, cities: [{ name: "拉各斯", tier: "大城市" }, { name: "北部乡村", tier: "农村" }] },
  { name: "巴西", weight: 4, cities: [{ name: "圣保罗", tier: "大城市" }, { name: "里约贫民窟", tier: "贫民区" }] },
  { name: "德国", weight: 3, cities: [{ name: "柏林", tier: "大城市" }, { name: "巴伐利亚小镇", tier: "小镇" }] },
  { name: "俄罗斯", weight: 3, cities: [{ name: "莫斯科", tier: "大城市" }, { name: "西伯利亚小城", tier: "小城" }] },
  { name: "泰国", weight: 2, cities: [{ name: "曼谷", tier: "大城市" }, { name: "清迈", tier: "中等城市" }] },
  { name: "瑞士", weight: 2, cities: [{ name: "苏黎世", tier: "富裕城市" }] },
];

/** 家庭阶层：权重刻意向普通倾斜，豪门是真·稀有 */
const FAMILY_CLASSES = [
  { name: "赤贫", weight: 10, wealth: [0, 5000] as const, desc: "家徒四壁，父母为温饱奔波" },
  { name: "贫困", weight: 18, wealth: [5000, 30000] as const, desc: "日子紧巴巴，一场病就能压垮全家" },
  { name: "工薪", weight: 34, wealth: [30000, 150000] as const, desc: "普通工薪家庭，量入为出" },
  { name: "小康", weight: 22, wealth: [150000, 600000] as const, desc: "衣食无忧，偶尔全家旅游" },
  { name: "中产", weight: 11, wealth: [600000, 3000000] as const, desc: "有房有车，重视教育投入" },
  { name: "富裕", weight: 4, wealth: [3000000, 20000000] as const, desc: "本地有头有脸，资源丰富" },
  { name: "豪门", weight: 1, wealth: [20000000, 500000000] as const, desc: "含着金汤匙出生，家族产业庞大" },
];

const PARENT_JOBS: Record<string, string[]> = {
  赤贫: ["拾荒者", "零工", "无业", "残疾低保户"],
  贫困: ["农民", "环卫工", "保安", "流水线工人", "小摊贩"],
  工薪: ["工厂技工", "出租车司机", "超市理货员", "乡镇教师", "护士", "厨师", "快递站长"],
  小康: ["中学教师", "公务员", "工程师", "个体店主", "会计", "銷售主管"],
  中产: ["医生", "大学教授", "程序员", "律师", "外企经理", "建筑师"],
  富裕: ["企业主", "投资人", "连锁店老板", "开发商", "名医"],
  豪门: ["上市公司董事长", "家族企业掌门人", "资本大鳄"],
};

const PERSONALITIES = ["温和","严厉","急躁","乐观","悲观","沉默寡言","热情","控制欲强","溺爱","冷漠","幽默","迷信","要强","佛系","酗酒","勤俭","虚荣","正直"];

import { TALENT_POOL } from "./talents";
export { TALENT_POOL };

function rollAttr(rng: Rng): number {
  // 两次取样求均值，向中间收敛，极端值稀有
  return Math.round((rng.range(15, 85) + rng.range(15, 85)) / 2);
}

function makeParent(
  rng: Rng,
  relation: "父亲" | "母亲",
  surname: string,
  familyClass: string,
  pickGiven: (pool: string[]) => string,
): NPC {
  const jobs = PARENT_JOBS[familyClass] ?? PARENT_JOBS["工薪"];
  const given = pickGiven(relation === "父亲" ? MALE_NAMES : FEMALE_NAMES);
  return {
    id: `npc-${relation}`,
    name: `${relation === "母亲" ? rng.pick(SURNAMES) : surname}${given}`,
    relation: `${relation}（${rng.pick(jobs)}）`,
    affinity: rng.int(40, 80),
    personality: rng.sample(PERSONALITIES, 2),
    memories: [],
    alive: true,
  };
}

export interface GenesisRoll {
  background: Background;
  character: CharacterState;
  birthYear: number;
  talentChoices: Talent[]; // 三选一
  summary: string; // 出生卡文案（无 LLM 时直接展示）
}

export type GenderPref = "random" | "男" | "女";

export function rollGenesis(rng: Rng, genderPref: GenderPref = "random"): GenesisRoll {
  const birthYear = rng.int(1985, 2012);
  const country = rng.weighted(COUNTRIES, (c) => c.weight);
  const city = rng.pick(country.cities);
  const fam = rng.weighted(FAMILY_CLASSES, (f) => f.weight);
  const familyWealth = Math.round(rng.range(fam.wealth[0], fam.wealth[1]));

  const gender = genderPref === "random" ? (rng.chance(0.512) ? "男" : "女") : genderPref;
  const surname = rng.pick(SURNAMES);
  // 同姓家庭成员从同一个名字池抽取，必须排重，避免「哥哥和你同名」
  const usedGivenNames = new Set<string>();
  const pickGiven = (pool: string[]): string => {
    for (let tries = 0; tries < 10; tries++) {
      const given = rng.pick(pool);
      if (!usedGivenNames.has(given)) {
        usedGivenNames.add(given);
        return given;
      }
    }
    return rng.pick(pool); // 池子极端耗尽时容忍重复
  };
  const name = `${surname}${pickGiven(gender === "男" ? MALE_NAMES : FEMALE_NAMES)}`;

  const attrs: Attributes = {
    health: rollAttr(rng),
    fitness: rollAttr(rng),
    intelligence: rollAttr(rng),
    eq: rollAttr(rng),
    charm: rollAttr(rng),
    mood: rollAttr(rng),
    luck: rollAttr(rng),
  };

  const father = makeParent(rng, "父亲", surname, fam.name, pickGiven);
  const mother = makeParent(rng, "母亲", surname, fam.name, pickGiven);
  const npcs: NPC[] = [father, mother];

  const siblingCount = fam.name === "豪门" || fam.name === "富裕" ? rng.int(0, 2) : rng.int(0, 3);
  for (let i = 0; i < siblingCount; i++) {
    const isBrother = rng.chance(0.5);
    npcs.push({
      id: `npc-sibling-${i}`,
      name: `${surname}${pickGiven(isBrother ? MALE_NAMES : FEMALE_NAMES)}`,
      relation: rng.chance(0.5) ? (isBrother ? "哥哥" : "姐姐") : (isBrother ? "弟弟" : "妹妹"),
      affinity: rng.int(20, 75),
      personality: rng.sample(PERSONALITIES, 2),
      memories: [],
      alive: true,
    });
  }

  const background: Background = {
    country: country.name,
    city: city.name,
    cityTier: city.tier,
    familyClass: fam.name,
    familyWealth,
    familyDesc: `${fam.desc}。父亲是${father.relation.replace("父亲（", "").replace("）", "")}（${father.personality.join("、")}），母亲是${mother.relation.replace("母亲（", "").replace("）", "")}（${mother.personality.join("、")}）${siblingCount > 0 ? `，有${siblingCount}个兄弟姐妹` : "，是独生子女"}。`,
  };

  const character: CharacterState = {
    name,
    gender,
    birthYear,
    attrs,
    energy: rng.int(68, 88),
    money: 0,
    connections: 0,
    skills: [],
    npcs,
    identity: {
      schooling: null,
      job: null,
      maritalStatus: "单身",
      residence: `${country.name}·${city.name}`,
      legalStatus: "清白",
      conditions: [],
    },
    talents: [],
    alive: true,
  };

  const talentChoices = rng.sample(TALENT_POOL, 3);

  const summary =
    `${birthYear}年，你出生在${country.name}·${city.name}（${city.tier}）的一个${fam.name}家庭。` +
    background.familyDesc;

  return { background, character, birthYear, talentChoices, summary };
}

/** 就地改性别：只换性别与名字（姓氏保留），不影响属性与背景 */
export function reassignGender(character: CharacterState, gender: "男" | "女", rng: Rng): void {
  if (character.gender === gender) return;
  character.gender = gender;
  const surname = character.name[0]; // SURNAMES 全部为单字姓
  character.name = `${surname}${gender === "男" ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES)}`;
}

export function applyTalent(character: CharacterState, talent: Talent): void {
  character.talents.push(talent);
  for (const [k, v] of Object.entries(talent.attrMods)) {
    const key = k as keyof Attributes;
    character.attrs[key] = clamp(character.attrs[key] + (v ?? 0), 1, 100);
  }
}

export function newGameState(
  seed: number,
  genderPref: GenderPref = "random",
): { state: GameState; talentChoices: Talent[] } {
  const rng = new Rng(seed);
  const roll = rollGenesis(rng, genderPref);
  const state: GameState = {
    id: `save-${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    seed,
    rngState: rng.getState(),
    turn: 0,
    granularity: "year",
    character: roll.character,
    background: roll.background,
    world: { year: roll.birthYear, week: rng.int(1, 52), macroNotes: [] },
    log: [
      {
        turn: 0,
        date: `${roll.birthYear}年`,
        kind: "system",
        text: roll.summary,
      },
    ],
    weeklyNotes: [],
    monthlySummaries: [],
    chronicle: [],
    decisionHistory: [],
    hooks: [],
    pending: null,
    ended: false,
  };
  state.rngState = rng.getState();
  return { state, talentChoices: roll.talentChoices };
}
