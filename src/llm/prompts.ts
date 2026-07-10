// 提示词模板：意图解析（结构化输出）、行动卡补充、叙事生成、记忆压缩。

import { statusCard, historyContext } from "../engine/memory";
import { describeDeltas } from "../engine/resolver";
import { DecisionBoard } from "../engine/decisions";
import { TurnOutcome } from "../engine/turn";
import { GameState, TIER_LABELS, formatDate } from "../engine/types";
import { ContentRating } from "./types";

export const INTENT_SYSTEM = `你是人生模拟游戏的意图解析器。玩家会用自由中文描述本周想做的事，你把它拆解为结构化行动列表。

只输出 JSON 数组，不要任何解释。每个行动的格式：
{
  "summary": "一句话概括这件事（保留玩家原意）",
  "category": "study|work|social|romance|exercise|leisure|adventure|finance|health|other 之一",
  "hours": 投入小时数（整数，所有行动合计不超过 100）,
  "risk": "none|low|high"（high = 结果有显著不确定性且代价/收益大，如表白、赌博、创业、辞职、冒险）,
  "attr": "health|fitness|intelligence|eq|charm|mood|luck 之一（这件事最依赖的属性）",
  "nsfw": 是否涉及性内容（布尔）,
  "target": "涉及的具体人物姓名（没有则省略此字段）"
}

规则：
- 最多拆 4 个行动；玩家写得再多也合并归纳。
- 玩家的角色状态见下文，明显不符合角色当前年龄/处境的要求也照常解析（引擎会判定失败），但把 risk 标为 high。
- 只输出 JSON 数组。`;

export function intentUserPrompt(state: GameState, playerText: string): string {
  return `【角色状态】\n${statusCard(state)}\n\n【玩家本${state.granularity === "week" ? "周" : state.granularity === "month" ? "月" : "年"}输入】\n${playerText}`;
}

function ratingDirective(rating: ContentRating, hasNsfwBackend: boolean): string {
  if (rating === "clean") {
    return "涉及亲密内容时一笔带过，不做任何描写。";
  }
  if (rating === "suggestive") {
    return "涉及亲密内容时可以暧昧暗示、留白处理，不做直白描写。";
  }
  return hasNsfwBackend
    ? "内容分级为成人向：涉及亲密场景时可以直接、细致地描写。硬性边界（不可违反）：所有角色均为成年人、情节双方自愿。"
    : "涉及亲密内容时用「镜头拉远」的方式带过（未配置成人内容后端）。";
}

export function narrativeSystem(rating: ContentRating, hasNsfwBackend: boolean, style: string): string {
  return `你是人生模拟游戏的叙事引擎，用第二人称「你」为玩家撰写这段时间的人生叙事。

写作要求：
- 风格：${style}。写成 2~4 段连贯的生活叙事，不要分条罗列。
- 严格遵循引擎给出的判定结果（大成功/成功/勉强/失败/大失败）和数值变化——结果是什么就写什么，不许翻案、不许夸大也不许淡化。
- 具体、有画面感：落到人物对话、天气、街景这样的细节上，避免空泛的总结句。
- 世界是真实的：有运气也有恶意，失败该疼就疼。不要说教，不要展望未来。
- 涉及的人物用状态卡里的真实姓名。
- ${ratingDirective(rating, hasNsfwBackend)}
- 只输出叙事正文，不要标题、不要元信息。长度 150~400 字。`;
}

export function narrativeUserPrompt(state: GameState, playerText: string, outcome: TurnOutcome): string {
  const lines: string[] = [];
  lines.push(`【时间】${formatDate(state)}`);
  lines.push(`【角色状态】\n${statusCard(state)}`);
  const hist = historyContext(state);
  if (hist) lines.push(hist);
  lines.push(`【玩家的打算】${playerText || "（无特别安排）"}`);
  lines.push("【引擎判定结果（必须严格遵循）】");
  for (const a of outcome.actions) {
    lines.push(`- ${a.mechanical}`);
  }
  if (outcome.event) {
    lines.push(`- 随机事件！${outcome.event.mechanical}。事件背景：${outcome.event.skeleton.prompt}`);
  }
  if (outcome.passive.length > 0) {
    lines.push(`- 被动变化：${outcome.passive.join("；")}`);
  }
  if (outcome.died) {
    lines.push(`- 【死亡】角色在本回合死亡，死因：${outcome.deathCause}。请写出人生落幕的场景。`);
  }
  return lines.join("\n");
}

export const CHOICE_SYSTEM = `你是人生模拟游戏的编剧。决策盘上已经有一批通用行动卡，你的任务是补充 3 张「只属于这个角色此刻人生」的行动卡——紧扣他的具体人物关系、技能、身份、时代背景和最近发生的事，比通用卡更具体、更有戏剧张力。

只输出 JSON 数组，每张卡：
{
  "title": "卡片标题（≤12字，动词开头，具体到人和事）",
  "description": "一句话说清这件事是什么、为什么是现在（≤40字）",
  "category": "study|work|social|romance|exercise|leisure|adventure|finance|health|other 之一",
  "attr": "health|fitness|intelligence|eq|charm|mood|luck 之一（最依赖的属性）",
  "timeCost": 1 或 2,
  "energyCost": -25 到 40 的整数（负数表示这件事能恢复精力）,
  "risk": "low" 或 "high"（high = 高风险高回报，会触发命运判定）,
  "consequences": ["可能的后果", "另一种后果"]（每条≤12字，一好一坏最佳）,
  "target": "涉及的NPC真实姓名（没有则省略）"
}

规则：
- 3 张卡方向必须不同：一张围绕具体的人（用状态卡里的真实姓名），一张推进成长/事业/处境，一张出格的、平时不会做的事。
- 必须符合角色年龄能做的事；婴幼儿写观察、模仿、亲子互动。
- 至多 1 张 risk 为 high。
- 不要与「已有选项」重复或近似。
- 只输出 JSON 数组，不要任何解释。`;

export function choiceUserPrompt(state: GameState, board: DecisionBoard): string {
  const lines: string[] = [];
  lines.push(`【时间】${formatDate(state)}｜时代背景：${board.world.title}——${board.world.summary}`);
  lines.push(`【角色状态】\n${statusCard(state)}`);
  const hist = historyContext(state);
  if (hist) lines.push(hist);
  lines.push(`【已有选项（不要重复）】${board.choices.map((c) => c.title).join("、")}`);
  return lines.join("\n");
}

export const SUMMARY_SYSTEM = `你是记忆压缩器。把给出的人生片段浓缩成一段 60 字以内的第二人称摘要，只保留对后续人生有影响的事实（关系变化、重大得失、身份变动）。只输出摘要正文。`;

export function epitaphPrompt(state: GameState): string {
  return `以下是一个人的一生。请写：1) 一段 100 字以内的人生总结（第二人称）；2) 一句 20 字以内的墓志铭。用 JSON 输出：{"summary": "...", "epitaph": "..."}

【基本信息】\n${statusCard(state)}
【编年史】\n${state.chronicle.join("\n") || "（一生短暂）"}
【最近的日子】\n${state.weeklyNotes.map((n) => `${n.label}：${n.text.slice(0, 80)}`).join("\n")}
【死因】${state.character.deathCause ?? "未知"}`;
}

/** 无 LLM 时的模板叙事兜底：直接展示引擎的机械结果 */
export function fallbackNarrative(outcome: TurnOutcome): string {
  const lines: string[] = outcome.actions.map((a) => a.mechanical);
  if (outcome.event) {
    const ev = outcome.event;
    // 玩家转过针的事件报判定档位；静默事件只报实际影响，无影响就只讲事
    const effects = describeDeltas(ev.deltas).replace(/^：/, "");
    let line = `【${ev.skeleton.name}】${ev.skeleton.prompt}`;
    if (ev.skeleton.requiresCheck) line += `——${TIER_LABELS[ev.tier]}`;
    if (effects) line += `（${effects}）`;
    lines.push(line);
  }
  if (outcome.passive.length > 0) lines.push(outcome.passive.join("；"));
  if (outcome.died) lines.push(`你的人生走到了尽头：${outcome.deathCause}。`);
  return lines.join("\n");
}
