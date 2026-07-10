// 技能命名真值：技能必须是可长期积累的「手艺名词」（木工/吉他/编程/厨艺），
// 不是行动描述——"扶着家具探索"是一件事，不是一门技能。
// 推断优先级：意图自带的 skill 字段（LLM/卡片给出）→ 关键词词典 → 类别兜底 → 不积累。

import { ActionCategory, ActionIntent, GameState, Skill, ageOf } from "./types";

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
  [/驾驶|开车|考驾照/, "驾驶", "生活"],
  [/摄影|拍照|拍视频|剪辑/, "摄影", "爱好"],
  [/围棋|象棋|棋|牌技/, "棋艺", "爱好"],
  [/唱歌|跳舞|舞蹈|表演/, "文艺", "爱好"],
  [/演讲|谈判|销售|带货/, "口才", "职业"],
];

/** 学业技能按人生阶段归一化命名，避免每个学期各建一个技能 */
function studySkillName(state: GameState): string {
  const age = ageOf(state);
  if (age < 12) return "小学课业";
  if (age < 15) return "初中课业";
  if (age < 18) return "高中课业";
  if (state.character.identity.schooling?.startsWith("大学")) return "大学学业";
  return "自学";
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
      return { name: studySkillName(state), category: "学业" };
    case "work":
      return { name: "职场", category: "职业" };
    case "exercise":
      return { name: "体能", category: "生活" };
    case "finance":
      return { name: "理财", category: "生活" };
    default:
      return null; // 玩乐/社交/恋爱/冒险没点名手艺就不长技能
  }
}
