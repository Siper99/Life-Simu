// 提示词模板：意图解析（结构化输出）、叙事生成、记忆压缩。

import { statusCard, historyContext } from "../engine/memory";
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
    lines.push(`【${outcome.event.skeleton.name}】${outcome.event.skeleton.prompt}——${TIER_LABELS[outcome.event.tier]}`);
  }
  if (outcome.passive.length > 0) lines.push(outcome.passive.join("；"));
  if (outcome.died) lines.push(`你的人生走到了尽头：${outcome.deathCause}。`);
  return lines.join("\n");
}
