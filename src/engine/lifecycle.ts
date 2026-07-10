// 人生动态：职业、关系人物与衰老。所有变化由确定性规则与主 RNG 产生。

import { Rng } from "./rng";
import {
  ActionIntent,
  ActionResolution,
  GameState,
  Job,
  NPC,
  Tier,
  ageOf,
  clamp,
} from "./types";

interface CareerTrack {
  titles: readonly [string, string, string, string, string];
  employer: string;
  basePay: number;
  hours: number;
}

const CAREER_TRACKS = {
  医疗: { titles: ["实习医生", "住院医师", "主治医师", "副主任医师", "主任医师"], employer: "市立医院", basePay: 1500, hours: 48 },
  技术: { titles: ["技术助理", "程序员", "高级程序员", "技术主管", "技术总监"], employer: "科技公司", basePay: 1200, hours: 40 },
  教育: { titles: ["助教", "教师", "骨干教师", "教研组长", "校级负责人"], employer: "学校", basePay: 900, hours: 38 },
  法律: { titles: ["律师助理", "执业律师", "资深律师", "合伙人", "高级合伙人"], employer: "律师事务所", basePay: 1300, hours: 45 },
  销售: { titles: ["销售助理", "销售专员", "销售主管", "销售经理", "销售总监"], employer: "商贸公司", basePay: 850, hours: 42 },
  设计: { titles: ["设计助理", "设计师", "资深设计师", "设计主管", "创意总监"], employer: "设计工作室", basePay: 1000, hours: 40 },
  餐饮: { titles: ["后厨学徒", "厨师", "主厨", "行政总厨", "餐饮负责人"], employer: "餐饮企业", basePay: 800, hours: 48 },
  公职: { titles: ["办事员", "科员", "业务骨干", "部门负责人", "高级公务员"], employer: "公共机构", basePay: 950, hours: 40 },
  金融: { titles: ["金融助理", "分析师", "高级分析师", "投资经理", "投资总监"], employer: "金融机构", basePay: 1400, hours: 45 },
  通用: { titles: ["职场新人", "业务专员", "业务主管", "部门经理", "业务总监"], employer: "本地企业", basePay: 800, hours: 40 },
} as const satisfies Record<string, CareerTrack>;

type CareerKey = keyof typeof CAREER_TRACKS;

const CAREER_MATCHERS: [RegExp, CareerKey][] = [
  [/医生|医院|医疗|护士/, "医疗"],
  [/编程|代码|程序|软件|开发|技术/, "技术"],
  [/教师|老师|教学|学校/, "教育"],
  [/律师|法律|法务/, "法律"],
  [/销售|市场|营销|带货/, "销售"],
  [/设计|美术|视觉|产品/, "设计"],
  [/厨师|烹饪|餐饮|后厨/, "餐饮"],
  [/公务员|考公|机关|公职/, "公职"],
  [/金融|投行|证券|银行|分析师/, "金融"],
];

const POSITIVE_TIERS = new Set<Tier>(["crit", "success", "partial"]);
const STRONG_TIERS = new Set<Tier>(["crit", "success"]);
const PROMOTION_WORDS = /升职|晋升|竞聘|更大的责任|带团队/;
const SWITCH_WORDS = /跳槽|换工作|换一份工作|应聘|求职|面试|入职/;
const RESIGN_WORDS = /辞职|离职|不干了/;

function careerKeyFor(intent: ActionIntent): CareerKey {
  const text = intent.summary + " " + (intent.skill ?? "");
  return CAREER_MATCHERS.find(([re]) => re.test(text))?.[1] ?? "通用";
}

/** 当前居住城市：residence 形如「中国·杭州」，取末段；异常时退回出生城市 */
export function currentCityOf(state: GameState): string {
  const parts = state.character.identity.residence.split("·").filter(Boolean);
  return parts[parts.length - 1] ?? state.background.city;
}

function makeJob(state: GameState, key: CareerKey, level = 0): Job {
  const def = CAREER_TRACKS[key];
  const safeLevel = clamp(Math.round(level), 0, 4);
  return {
    title: def.titles[safeLevel],
    employer: currentCityOf(state) + "·" + def.employer,
    weeklyHours: def.hours,
    weeklyPay: Math.round(def.basePay * (1 + safeLevel * 0.35)),
    track: key,
    level: safeLevel,
    xp: 0,
  };
}

function normalizeCareerKey(job: Job): CareerKey {
  return job.track in CAREER_TRACKS ? job.track as CareerKey : "通用";
}

/** 工作结果一落地就更新任职、跳槽与晋升，不等 LLM 在叙事里猜。 */
export function settleCareer(state: GameState, actions: ActionResolution[]): string[] {
  const notes: string[] = [];
  const c = state.character;
  if (ageOf(state) < 18) return notes;

  for (const action of actions) {
    if (action.intent.category !== "work") continue;
    const summary = action.intent.summary;
    const strong = STRONG_TIERS.has(action.tier);

    if (c.identity.job && RESIGN_WORDS.test(summary) && strong) {
      const old = c.identity.job;
      c.identity.job = null;
      notes.push("你离开了" + old.employer + "的" + old.title + "职位");
      continue;
    }

    const desiredTrack = careerKeyFor(action.intent);
    if (!c.identity.job && strong) {
      c.identity.schooling = null;
      c.identity.job = makeJob(state, desiredTrack);
      notes.push("职业更新：你入职" + c.identity.job.employer + "，成为" + c.identity.job.title);
      continue;
    }

    const job = c.identity.job;
    if (!job || job.track === "退休") continue;

    if (SWITCH_WORDS.test(summary) && strong) {
      const old = job.title;
      const nextLevel = Math.min(4, job.level + (action.tier === "crit" ? 1 : 0));
      c.identity.job = makeJob(state, desiredTrack, nextLevel);
      notes.push("职业更新：你从" + old + "转为" + c.identity.job.title + "，新单位是" + c.identity.job.employer);
      continue;
    }

    const gains: Record<Tier, number> = { crit: 6, success: 3, partial: 1, fail: -2, fumble: -5 };
    job.xp = Math.max(0, job.xp + gains[action.tier]);
    if (PROMOTION_WORDS.test(summary) && strong && job.level < 4) job.xp = 100;
    if (job.xp >= 100 && job.level < 4) {
      job.xp -= 100;
      job.level += 1;
      const track = CAREER_TRACKS[normalizeCareerKey(job)];
      const old = job.title;
      job.title = track.titles[job.level];
      job.weeklyPay = Math.round(track.basePay * (1 + job.level * 0.35));
      notes.push("职位晋升：" + old + " → " + job.title + "，周薪调整为 " + job.weeklyPay);
    }
  }
  return notes;
}

// ---------- 迁移：人搬到哪，坐标就在哪 ----------

/** 识别「把生活搬去别处」的表达；捕获组为目的地，惰性匹配 + 后置边界防止把动词尾巴吞进地名 */
const MOVE_PATTERNS: RegExp[] = [
  /(?:搬到|搬去|搬家到|移居|迁往|定居在|定居到|搬回|回到)([一-鿿]{2,8}?)(?=$|[，。；！？、\s]|去|工作|上班|生活|发展|定居|打拼|闯荡|安家|落脚|读|上学|求学|附近|郊区|那边|市区|城区)/,
  /(?:去|到|回|赴)([一-鿿]{2,8}?)(?:工作|上班|发展|打拼|闯荡|定居|安家|上大学|读大学|读研|求学)/,
  /(?:北上|南下|远赴|飞往|奔赴)([一-鿿]{2,8}?)(?=$|[，。；！？、\s]|工作|上班|发展|打拼|闯荡|定居|生活|读|求学|上学)/,
];
/** 捕获到这些词说明不是城市搬迁（去图书馆工作≠移居图书馆） */
const NOT_A_PLACE = /图书馆|学校|大学|公司|工厂|车间|餐厅|酒吧|网吧|医院|健身房|工地|考场|职场|那里|哪里|这里|外地|远方|别处|城里|附近|对方|异地/;
const HOME_WORDS = /^(老家|家乡|故乡)$/;
const KNOWN_COUNTRIES = /^(中国|美国|日本|德国|法国|英国|俄罗斯|印度|巴西|泰国|瑞士|韩国|新加坡|加拿大|澳大利亚|尼日利亚)/;

/** 行动里真的把生活搬去了别处：更新坐标；同回合的入职、叙事都以新城市为准 */
export function settleResidence(state: GameState, actions: ActionResolution[]): string[] {
  const notes: string[] = [];
  const c = state.character;
  if (ageOf(state) < 15) return notes; // 少年以前搬家是家庭决定，不由单次行动触发

  for (const action of actions) {
    if (!POSITIVE_TIERS.has(action.tier)) continue; // 判定失败 = 迁移落空
    let dest: string | null = null;
    for (const re of MOVE_PATTERNS) {
      const m = action.intent.summary.match(re);
      if (m) { dest = m[1]; break; }
    }
    if (!dest || NOT_A_PLACE.test(dest)) continue;
    if (HOME_WORDS.test(dest)) dest = state.background.city;

    // 目的地带国家名（移居日本东京）时整体替换；否则沿用当前国家前缀
    const countryHit = dest.match(KNOWN_COUNTRIES)?.[0];
    const next = countryHit
      ? (dest === countryHit ? countryHit : `${countryHit}·${dest.slice(countryHit.length)}`)
      : `${c.identity.residence.split("·")[0] || state.background.country}·${dest}`;
    if (next === c.identity.residence) continue;

    c.identity.residence = next;
    notes.push(`你把生活搬到了${dest}，坐标更新为 ${next}`);
  }
  return notes;
}

function findNpcForTarget(state: GameState, target: string): NPC | undefined {
  const aliases: Record<string, string> = { 爸爸: "父亲", 爸: "父亲", 妈妈: "母亲", 妈: "母亲" };
  const normalized = aliases[target] ?? target;
  return state.character.npcs.find((npc) =>
    npc.name === normalized || npc.relation === normalized || npc.relation.includes(normalized)
  );
}

function isConcreteName(target: string): boolean {
  return target.length >= 2 && target.length <= 20 &&
    !/身边|某个|一个|朋友|同事|同学|老师|恋人|家人|父母|大家|对方|陌生人/.test(target);
}

function relationForNewNpc(state: GameState, romance: boolean): string {
  if (romance) return "心仪对象";
  if (state.character.identity.schooling) return "同学";
  if (state.character.identity.job) return "同事";
  return "朋友";
}

function updateMaritalStatus(state: GameState): void {
  const alive = state.character.npcs.filter((npc) => npc.alive);
  if (alive.some((npc) => npc.relation === "配偶")) {
    state.character.identity.maritalStatus = "已婚";
  } else if (alive.some((npc) => npc.relation === "恋人")) {
    state.character.identity.maritalStatus = "恋爱中";
}
}

/** 新认识的人进入关系网；好感达到阈值后，朋友与恋爱关系会及时改变。 */
export function settleRelationships(rng: Rng, state: GameState, actions: ActionResolution[]): string[] {
  const notes: string[] = [];
  const familyRelations = /父亲|母亲|哥哥|姐姐|弟弟|妹妹|祖父|祖母|儿子|女儿/;

  for (const action of actions) {
    const intent = action.intent;
    if ((intent.category !== "social" && intent.category !== "romance") || !intent.target) continue;
    const target = intent.target.trim();
    let npc = findNpcForTarget(state, target);
    const affinityDelta = action.deltas.affinity.find((item) => item.npcName === target)?.delta ?? 0;

    if (!npc && POSITIVE_TIERS.has(action.tier) && isConcreteName(target)) {
      npc = {
        id: "npc-met-" + state.turn + "-" + state.character.npcs.length,
        name: target,
        relation: relationForNewNpc(state, intent.category === "romance"),
        birthYear: state.character.birthYear + rng.int(-5, 5),
        occupation: ageOf(state) < 22 ? "学生" : state.character.identity.job?.title ?? null,
        health: rng.int(58, 90),
        conditions: [],
        affinity: clamp(25 + affinityDelta, -100, 100),
        personality: [],
        memories: ["在" + state.world.year + "年与你相识"],
        alive: true,
      };
      state.character.npcs.push(npc);
      notes.push("关系网新增：" + npc.name + "（" + npc.relation + "）");
    }
    if (!npc) continue;

    if (intent.category === "romance") {
      if (/分手|离婚/.test(intent.summary) && STRONG_TIERS.has(action.tier)) {
        npc.relation = "前任";
        state.character.identity.maritalStatus = /离婚/.test(intent.summary) ? "离异" : "单身";
        notes.push("关系变化：你与" + npc.name + "结束了亲密关系");
      } else if (/求婚|结婚|领证/.test(intent.summary) && STRONG_TIERS.has(action.tier) && npc.affinity >= 55) {
        npc.relation = "配偶";
        state.character.identity.maritalStatus = "已婚";
        notes.push("关系变化：" + npc.name + "成为你的配偶");
      } else if (POSITIVE_TIERS.has(action.tier) && npc.affinity >= 40 && !familyRelations.test(npc.relation) && npc.relation !== "配偶") {
        if (npc.relation !== "恋人") notes.push("关系变化：" + npc.name + "成为你的恋人");
        npc.relation = "恋人";
      }
    } else if (!familyRelations.test(npc.relation) && !/恋人|配偶|前任/.test(npc.relation)) {
      const old = npc.relation;
      npc.relation = npc.affinity >= 85 ? "挚友" : npc.affinity >= 60 ? "好友" : npc.affinity < -30 ? "疏远的朋友" : npc.relation;
      if (npc.relation !== old) notes.push("关系变化：" + npc.name + "从" + old + "变为" + npc.relation);
    }
  }

  updateMaritalStatus(state);
  return notes;
}

function randomNpcOccupation(rng: Rng): string {
  return rng.pick(["教师", "程序员", "护士", "会计", "厨师", "销售专员", "个体店主", "公务员", "工程师", "快递站长"]);
}

function promoteNpcOccupation(current: string): string {
  const exact: Record<string, string> = {
    技术助理: "程序员", 程序员: "高级程序员", 护士: "护师", 护师: "护士长",
    教师: "高级教师", 中学教师: "高级教师", 会计: "财务主管", 销售专员: "销售主管",
    销售主管: "销售经理", 工程师: "高级工程师", 公务员: "业务骨干",
  };
  if (exact[current]) return exact[current];
  if (/助理|学徒|实习/.test(current)) return current.replace(/助理|学徒|实习/, "专员");
  if (/专员|职员/.test(current)) return current.replace(/专员|职员/, "主管");
  if (/主管/.test(current)) return current.replace("主管", "经理");
  if (/经理/.test(current)) return current.replace("经理", "总监");
  if (/资深|高级|总监|董事长|老板|掌门人|投资人|教授|律师|医生|无业|退休|低保|拾荒|零工/.test(current)) return current;
  return "资深" + current;
}

function stochasticLoss(rng: Rng, expected: number): number {
  if (expected <= 0) return 0;
  const whole = Math.floor(expected);
  return whole + (rng.chance(expected - whole) ? 1 : 0);
}

function syncNpcConditions(npc: NPC, age: number): void {
  const generated = new Set(["体力下降", "健康欠佳", "重病"]);
  npc.conditions = npc.conditions.filter((item) => !generated.has(item));
  if (age >= 60 && npc.health < 60) npc.conditions.push("体力下降");
  if (npc.health < 40) npc.conditions.push("健康欠佳");
  if (npc.health < 20) npc.conditions.push("重病");
}

/** 每跨过一个自然年，关系人物会长一岁，健康、职位、退休与生死同步变化。 */
export function advanceRelationshipYear(rng: Rng, state: GameState, year: number): string[] {
  const notes: string[] = [];
  for (const npc of state.character.npcs) {
    if (!npc.alive || year < npc.birthYear) continue;
    const age = year - npc.birthYear;

    if (age >= 6 && age < 22 && !npc.occupation) npc.occupation = "学生";
    if (age >= 22 && npc.occupation === "学生") {
      npc.occupation = randomNpcOccupation(rng);
      notes.push(npc.name + "结束学业，成为" + npc.occupation);
    } else if (age >= 22 && age < 60 && !npc.occupation && rng.chance(0.4)) {
      npc.occupation = randomNpcOccupation(rng);
      notes.push(npc.name + "开始从事" + npc.occupation);
    } else if (age >= 65 && npc.occupation && !npc.occupation.startsWith("退休")) {
      const old = npc.occupation;
      npc.occupation = "退休（原" + old + "）";
      notes.push(npc.name + "从" + old + "岗位退休");
    } else if (age >= 24 && age < 60 && npc.occupation && rng.chance(0.07)) {
      const old = npc.occupation;
      npc.occupation = promoteNpcOccupation(old);
      if (npc.occupation !== old) notes.push(npc.name + "的职位变为" + npc.occupation);
    } else if (age >= 22 && age < 60 && npc.occupation && rng.chance(0.025)) {
      const old = npc.occupation;
      npc.occupation = randomNpcOccupation(rng);
      if (npc.occupation !== old) notes.push(npc.name + "换了工作：" + old + " → " + npc.occupation);
    }

    const healthLoss = stochasticLoss(rng, age > 45 ? ((age - 45) / 30) * 3 : 0);
    if (healthLoss > 0) npc.health = clamp(npc.health - healthLoss, 0, 100);
    syncNpcConditions(npc, age);

    const mortality = age > 70 ? ((age - 70) / 45) * (1 - npc.health / 140) * 0.35 : 0;
    if (npc.health <= 0 || rng.chance(Math.max(0, mortality))) {
      npc.alive = false;
      if (npc.relation === "配偶") {
        state.character.identity.maritalStatus = "丧偶";
      } else if (npc.relation === "恋人") {
        state.character.identity.maritalStatus = "单身";
      notes.push(npc.name + "在" + age + "岁时离世，这段关系成为了回忆");
      }
    } else if (healthLoss > 0) {
      notes.push(npc.name + "年岁渐长，健康 -" + healthLoss + "（现为" + npc.health + "）");
    }
  }
  return notes;
}

/** 玩家自身的健康与体质也随时间老化，体质较好会减缓健康衰退。 */
export function applyAgingEffects(rng: Rng, state: GameState, weeks: number): string[] {
  const notes: string[] = [];
  const c = state.character;
  const age = ageOf(state);
  const fitnessProtection = 1 - c.attrs.fitness / 250;
  const healthExpected = age > 45 ? ((age - 45) / 30) * 5 * fitnessProtection * (weeks / 52) : 0;
  const fitnessExpected = age > 55 ? ((age - 55) / 30) * 2.5 * (weeks / 52) : 0;
  const healthLoss = stochasticLoss(rng, healthExpected);
  const fitnessLoss = stochasticLoss(rng, fitnessExpected);

  if (healthLoss > 0) {
    c.attrs.health = clamp(c.attrs.health - healthLoss, 0, 100);
    notes.push("年龄带来的身体变化：健康 -" + healthLoss);
  }
  if (fitnessLoss > 0) {
    c.attrs.fitness = clamp(c.attrs.fitness - fitnessLoss, 0, 100);
    notes.push("年龄带来的身体变化：体质 -" + fitnessLoss);
  }

  const generated = new Set(["慢性病管理", "健康危机"]);
  c.identity.conditions = c.identity.conditions.filter((item) => !generated.has(item));
  if (age >= 65 && c.attrs.health < 50) c.identity.conditions.push("慢性病管理");
  if (c.attrs.health < 25) c.identity.conditions.push("健康危机");
  return notes;
}

/** 到退休年龄立即更新身份；退休金从下一段时间开始结算。 */
export function advancePlayerCareerYear(state: GameState): string[] {
  const job = state.character.identity.job;
  if (!job || job.track === "退休" || ageOf(state) < 65) return [];
  const oldTitle = job.title;
  const oldEmployer = job.employer;
  state.character.identity.job = {
    title: "退休人员",
    employer: "原" + oldEmployer,
    weeklyHours: 0,
    weeklyPay: Math.round(job.weeklyPay * 0.35),
    track: "退休",
    level: 0,
    xp: 0,
  };
  return ["身份更新：你从" + oldTitle + "岗位退休，开始领取退休金"];
}
