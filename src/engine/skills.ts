// 技能命名真值：技能必须是可长期积累的「手艺名词」（木工/吉他/编程/厨艺），
// 不是行动描述——"扶着家具探索"是一件事，不是一门技能；也不是学段标签——
// "小学课业"会过时，"学识"跟人一辈子。
// 推断优先级：意图自带的 skill 字段（LLM/卡片给出）→ 关键词词典 → 类别兜底 → 不积累。
// 技能不只是展示：熟练度会降低相关行动的判定难度、提高工作与理财的收入（见 turn/resolver）。

import { ActionCategory, ActionIntent, GameState, Skill, ageOf, clamp } from "./types";

/** 行动类别 → 技能归类（无技能可积累的类别为 null） */
const CATEGORY_SKILL_CAT: Record<ActionCategory, Skill["category"] | null> = {
  study: "学业",
  work: "职业",
  exercise: "生活",
  finance: "生活",
  leisure: "爱好",
  adventure: "爱好",
  social: null,
  romance: null,
  health: null,
  other: null,
};

/** 关键词词典：从行动描述里识别具体手艺（顺序即优先级） */
const KEYWORD_SKILLS: [RegExp, string, Skill["category"]][] = [
  [/吉他|钢琴|小提琴|乐器|架子鼓/, "乐器", "爱好"],
  [/画|素描|美术|水彩/, "绘画", "爱好"],
  [/编程|代码|写程序|软件|开发/, "编程", "职业"],
  [/写作|写小说|写诗|作文|回忆录|写日记/, "写作", "爱好"],
  [/做饭|下厨|厨艺|烹饪|烘焙/, "厨艺", "生活"],
  [/木工|手工|雕刻|缝纫|修理|拼装/, "手工", "爱好"],
  [/投资|理财|炒股|基金|存钱|记账/, "理财", "生活"],
  [/篮球|足球|羽毛球|乒乓|排球|打球/, "球类", "爱好"],
  [/跑步|健身|游泳|撸铁|骑行|爬山/, "体能", "生活"],
  [/外语|英语|日语|口语|单词/, "外语", "学业"],
  [/数学|奥数|物理|化学|生物|竞赛题|理科/, "数理", "学业"],
  [/历史|地理|哲学|文学|诗词|国学|文科/, "人文", "学业"],
  [/驾驶|开车|考驾照/, "驾驶", "生活"],
  [/摄影|拍照|拍视频|剪辑/, "摄影", "爱好"],
  [/围棋|象棋|棋|牌技/, "棋艺", "爱好"],
  [/唱歌|跳舞|舞蹈|表演/, "文艺", "爱好"],
  [/演讲|谈判|销售|带货/, "口才", "职业"],
];

/** 职业赛道 → 对应手艺：在岗位上磨的是真本事，不是笼统的「职场」 */
export const TRACK_SKILLS: Record<string, string> = {
  医疗: "医术",
  技术: "编程",
  教育: "教学",
  法律: "法务",
  销售: "销售",
  设计: "设计",
  餐饮: "厨艺",
  公职: "公文",
  金融: "金融",
};

/** 工作类兜底：有职业按赛道给手艺名，没职业才落到「职场」（求职、零工的通用经验） */
function workSkillName(state: GameState): string {
  const track = state.character.identity.job?.track;
  return (track && TRACK_SKILLS[track]) ?? "职场";
}

/**
 * 这次行动在积累什么技能？返回 null = 不积累（玩就是玩，社交就是社交）。
 * 学龄前只长属性不长技能。
 */
export function skillForIntent(
  state: GameState,
  intent: ActionIntent,
): { name: string; category: Skill["category"] } | null {
  if (ageOf(state) < 6) return null;

  // 1) 意图自带技能名（LLM 解析/卡片定义），引擎只裁剪归类
  const named = intent.skill?.trim().slice(0, 6);
  if (named) {
    return { name: named, category: CATEGORY_SKILL_CAT[intent.category] ?? "爱好" };
  }

  // 2) 关键词词典：从描述里认出具体手艺
  for (const [re, name, category] of KEYWORD_SKILLS) {
    if (re.test(intent.summary)) return { name, category };
  }

  // 3) 类别兜底：只有明确「在练什么」的类别才给
  switch (intent.category) {
    case "study":
      return { name: "学识", category: "学业" }; // 不分学段：读的书都长在同一个人身上
    case "work":
      return { name: workSkillName(state), category: "职业" };
    case "exercise":
      return { name: "体能", category: "生活" };
    case "finance":
      return { name: "理财", category: "生活" };
    default:
      return null; // 玩乐/社交/恋爱/冒险没点名手艺就不长技能
  }
}

/** 这次行动能吃到的已有熟练度（0~10）：做熟悉的事更稳、更值钱 */
export function skillMasteryFor(
  state: GameState,
  intent: ActionIntent,
): { name: string; level: number } | null {
  const trained = skillForIntent(state, intent);
  if (!trained) return null;
  const skill = state.character.skills.find((s) => s.name === trained.name);
  if (!skill || skill.level <= 0) return null;
  return { name: skill.name, level: skill.level };
}

/** 熟练度对判定难度的减免：Lv10 大师做本行的事，难度 -30 */
export function masteryDifficultyBonus(state: GameState, intent: ActionIntent): number {
  return (skillMasteryFor(state, intent)?.level ?? 0) * 3;
}

/** 升级所需经验随等级递增：入门快、精通慢，大师是一生的事 */
export function xpToNext(level: number): number {
  return 60 + clamp(level, 0, 10) * 40;
}

/** 技能段位：等级的语义化标签，UI 与叙事共用 */
export function skillTierLabel(level: number): string {
  if (level >= 8) return "大师";
  if (level >= 5) return "精通";
  if (level >= 3) return "熟练";
  if (level >= 1) return "入门";
  return "生疏";
}
