// 提示词模板：意图解析（结构化输出）、行动卡补充、叙事生成、记忆压缩。

import { statusCard, historyContext } from "../engine/memory";
import { describeDeltas } from "../engine/resolver";
import { DecisionBoard } from "../engine/decisions";
import { TurnOutcome } from "../engine/turn";
import { GameState, SceneState, TIER_LABELS, formatDate } from "../engine/types";
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
  "target": "涉及的具体人物姓名（没有则省略此字段）",
  "skill": "这件事在积累的技能名（2~6字的手艺名词，如 吉他/木工/编程/厨艺；纯玩乐、社交、无技能可积累则省略此字段）"
}

规则：
- 最多拆 4 个行动；玩家写得再多也合并归纳。
- 玩家的角色状态见下文，明显不符合角色当前年龄/处境的要求也照常解析（引擎会判定失败），但把 risk 标为 high。
- 只输出 JSON 数组。`;

export function intentUserPrompt(state: GameState, playerText: string): string {
  const unit = state.granularity === "season" ? "季" : state.granularity === "week" ? "周" : state.granularity === "month" ? "月" : "年";
  return `【角色状态】\n${statusCard(state)}\n\n【玩家本${unit}输入】\n${playerText}`;
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
- 若【线头】列表非空：叙事中自然回应其中相关的线头；标了「已搁置」的线头可顺带一句交代它的结局（机会溜走、人心变凉——错过要有代价）。
- ${ratingDirective(rating, hasNsfwBackend)}
- 输出叙事正文（不要标题、不要元信息，长度 150~400 字）。正文结束后另起一行，以「HOOKS:」开头输出一个 JSON 字符串数组（0~3 条）：本回合叙事里埋下的、未来可以回应的线头（人物动向/未解决的冲突/冒头的机会），每条 ≤20 字。没有就输出 HOOKS:[]`;
}

export function narrativeUserPrompt(state: GameState, playerText: string, outcome: TurnOutcome): string {
  const lines: string[] = [];
  lines.push(`【时间】${formatDate(state)}`);
  lines.push(`【角色状态】\n${statusCard(state)}`);
  const hist = historyContext(state);
  if (hist) lines.push(hist);
  lines.push(`【玩家的打算】${playerText || "（无特别安排）"}`);
  if (state.hooks.length > 0) {
    const hookLines = state.hooks.map(
      (h) => `${h.text}${state.turn - h.turn > 4 ? "（已搁置）" : ""}`,
    );
    lines.push(`【线头】${hookLines.join("；")}`);
  }
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
  "energyCost": -25 到 70 的整数（负数表示恢复；50~70 只用于值得押上一整季的高强度行动）,
  "risk": "low" 或 "high"（high = 高风险高回报，会触发命运判定）,
  "consequences": ["可能的后果", "另一种后果"]（每条≤12字，一好一坏最佳）,
  "target": "涉及的NPC真实姓名（没有则省略）",
  "skill": "这张卡积累的技能名（2~6字手艺名词，如 吉他/木工；无技能可积累则省略）",
  "moneyCost": 这件事需要花的钱（正整数；只在真的要掏钱时给，且不能超过角色现有金钱，没有则省略）
}

规则：
- 第一张卡必须是「回响卡」：直接回应【上回合叙事】或【未回应的线头】里的具体人和事——玩家读完故事，要看到选项在接话。没有可回应的内容时才自由发挥。
- 3 张卡方向必须不同：一张围绕具体的人（用状态卡里的真实姓名），一张推进成长/事业/处境，一张出格的、平时不会做的事。
- 时代背景标注【大事件】时，至少一张卡与它有关——大时代要落到这个人身上。
- 必须符合角色年龄能做的事；婴幼儿写观察、模仿、亲子互动。
- 至多 1 张 risk 为 high。
- 不要与「已有选项」重复或近似。
- 只输出 JSON 数组，不要任何解释。`;

/**
 * 露骨叙事进入长期记忆/跨后端上下文时的替身文案。
 * 安全红线的延伸：Grok 等 nsfw 后端生成的原文只留在游戏日志里展示，
 * 绝不通过记忆、线头或「上回合叙事」回流到官方 API。
 */
export const NSFW_MEMORY_PLACEHOLDER = "（一段私密的亲密时光，细节不入档案）";

export function choiceUserPrompt(state: GameState, board: DecisionBoard): string {
  const lines: string[] = [];
  lines.push(
    `【时间】${formatDate(state)}｜${board.world.major ? "【大事件】" : "时代背景："}${board.world.title}——${board.world.summary}`,
  );
  lines.push(`【角色状态】\n${statusCard(state)}`);
  const hist = historyContext(state);
  if (hist) lines.push(hist);
  const lastNarrative = [...state.log].reverse().find((e) => e.kind === "narrative");
  if (lastNarrative) {
    // 出卡请求发给常规后端：露骨正文用替身文案代替，只保留「发生过亲密剧情」这个事实
    lines.push(
      lastNarrative.nsfw
        ? `【上回合叙事】${NSFW_MEMORY_PLACEHOLDER}可以用含蓄的方式回应这段关系的余温。`
        : `【上回合叙事】${lastNarrative.text.slice(0, 500)}`,
    );
  }
  const activeHooks = state.hooks.filter((h) => state.turn - h.turn <= 4);
  if (activeHooks.length > 0) {
    lines.push(`【未回应的线头】${activeHooks.map((h) => h.text).join("；")}`);
  }
  lines.push(`【已有选项（不要重复）】${board.choices.map((c) => c.title).join("、")}`);
  return lines.join("\n");
}

// ---------- 场景模式：镜头拉近的连续对手戏 ----------

export function sceneSystem(
  rating: ContentRating,
  onNsfwBackend: boolean,
  style: string,
  nsfwScene: boolean,
): string {
  const directive = nsfwScene && onNsfwBackend
    ? "本场景为成人向：涉及亲密时可以直接、细致地描写，节奏可以慢下来。硬性边界（不可违反）：所有角色均为成年人、情节双方自愿。"
    : ratingDirective(rating, onNsfwBackend);
  return `你是人生模拟游戏的场景引擎。玩家把镜头拉近到一个连续的当下，正在和你逐拍推进一场对手戏：玩家给一拍行动或台词，你接一拍场景。

要求：
- 紧接上一拍的结尾继续：同一时间、同一地点、同一情绪。不跳时间、不概括、不回顾。
- 每拍 80~220 字，第二人称「你」，以对话、动作、神态这些近景细节为主。风格：${style}。
- 对手是活人：有自己的心思、情绪和底线，会回应也会拒绝，不迎合、不复读玩家的话。
- 结尾停在玩家可以接话的瞬间；绝不替玩家说话、行动或做决定。
- ${directive}
- 正文结束后另起一行，输出 EFFECTS:{...}——这一拍**已经实际发生**的数值后果（JSON，所有字段可省略）：
  money（花掉为负、得到为正的金额，如买单/送礼/赔钱）、affinity（对手对你观感变化 -10~10）、
  mood（你的心境变化 -8~8）、connections（人脉 -3~3）、
  legal（"清白/缓刑/服刑/通缉"，仅当这一拍发生了改变法律处境的事件，如报警被立案、被逮捕）、
  conditions_add（新增状态，如 ["轻伤"]）、conditions_remove（解除的状态）。
  只记录已发生的事实，不预测未来；没有变化就输出 EFFECTS:{}`;
}

/** 拆出场景正文与 EFFECTS 尾行；EFFECTS 无论好坏都从正文剥掉，解析失败静默降级 */
export function splitSceneEffects(raw: string): { text: string; effects: unknown } {
  const m = raw.match(/([\s\S]*?)\n?\s*EFFECTS[:：]\s*([\s\S]*)$/);
  if (!m) return { text: raw.trim(), effects: null };
  let effects: unknown = null;
  const json = m[2].match(/\{[\s\S]*\}/);
  if (json) {
    try {
      effects = JSON.parse(json[0]);
    } catch {
      // JSON 坏了就只保正文
    }
  }
  return { text: m[1].trim(), effects };
}

export function sceneUserPrompt(state: GameState, scene: SceneState, playerText: string): string {
  const lines: string[] = [];
  lines.push(
    `【场景】镜头拉近的连续场景${scene.target ? `，对手：${scene.target}` : ""}——现在推进第 ${scene.beats.length + 1} 拍`,
  );
  lines.push(`【角色状态】\n${statusCard(state)}`);
  const npc = scene.target
    ? state.character.npcs.find((n) => n.name === scene.target)
    : null;
  if (npc) {
    lines.push(
      `【对手详情】${npc.name}（${npc.relation}，${state.world.year - npc.birthYear}岁，${npc.occupation ?? "无职业"}，好感${npc.affinity}` +
        `${npc.personality.length > 0 ? `，性格：${npc.personality.join("、")}` : ""}）` +
        `${npc.memories.length > 0 ? `\n共同记忆：${npc.memories.slice(-4).join("；")}` : ""}`,
    );
  }
  if (scene.beats.length > 0) {
    lines.push(
      "【这场戏到目前为止】\n" +
        scene.beats.slice(-8).map((b) => `你：${b.player}\n场景：${b.narrative}`).join("\n"),
    );
  }
  lines.push(`【你的这一拍】${playerText}`);
  return lines.join("\n");
}

/** 无 LLM 时的场景兜底：不出戏但明确提示配置后端才有完整演出 */
export function fallbackSceneBeat(scene: SceneState, playerText: string): string {
  const who = scene.target ?? "对方";
  const pool = [
    `你${playerText.length > 12 ? "说完这些" : "这样做了"}，${who}沉默了一瞬，眼神里有什么东西动了动。`,
    `${who}没有立刻回应，但也没有走开——这段相处还在继续。`,
    `空气安静下来，${who}看着你，像在等你的下一句话。`,
  ];
  return pool[scene.beats.length % pool.length] + "（离线模式：配置 LLM 后端可获得完整的场景演出）";
}

export const SUMMARY_SYSTEM = `你是记忆压缩器。把给出的人生片段浓缩成一段 60 字以内的第二人称摘要，只保留对后续人生有影响的事实（关系变化、重大得失、身份变动）。只输出摘要正文。`;

export function epitaphPrompt(state: GameState): string {
  return `以下是一个人的一生。请写：1) 一段 100 字以内的人生总结（第二人称）；2) 一句 20 字以内的墓志铭。用 JSON 输出：{"summary": "...", "epitaph": "..."}

【基本信息】\n${statusCard(state)}
【编年史】\n${state.chronicle.join("\n") || "（一生短暂）"}
【最近的日子】\n${state.weeklyNotes.map((n) => `${n.label}：${n.text.slice(0, 80)}`).join("\n")}
【死因】${state.character.deathCause ?? "未知"}`;
}

export const SKIP_SYSTEM = `你是人生模拟游戏的叙事引擎。玩家选择让一段时光自然流逝（不做主动安排）。用第二人称写 80~180 字的岁月流逝摘要：平淡但有具体的生活质感（季节、街景、家常），严格引用给出的被动变化（收支、健康、时代事件），不虚构新的大事件，不展望未来。只输出正文。`;

export function skipUserPrompt(state: GameState, spanLabel: string, notes: string[]): string {
  return [
    `【流逝的时间】${spanLabel}，现在是 ${formatDate(state)}`,
    `【角色状态】\n${statusCard(state)}`,
    `【这段时间的被动变化】${notes.length > 0 ? notes.join("；") : "一切平静"}`,
  ].join("\n");
}

/**
 * 断句兜底：文本以半句结尾（极端情况下续写仍未收尾）时裁到最后一个完整句读。
 * 找不到句读、或裁剪会丢掉一半以上内容时保留原文——宁可断句也不丢正文。
 */
export function trimToSentenceEnd(text: string): string {
  const t = text.trim();
  if (!t || /[。！？…”』」）)!?]$/.test(t)) return t;
  const idx = Math.max(
    t.lastIndexOf("。"),
    t.lastIndexOf("！"),
    t.lastIndexOf("？"),
    t.lastIndexOf("…"),
    t.lastIndexOf("”"),
  );
  if (idx < t.length * 0.5) return t;
  return t.slice(0, idx + 1);
}

/** 从叙事输出里拆出正文与 HOOKS 线头行；HOOKS 行无论好坏都从正文剥掉，解析失败静默降级 */
export function splitNarrativeHooks(raw: string): { text: string; hooks: string[] } {
  const m = raw.match(/([\s\S]*?)\n?\s*HOOKS[:：]\s*([\s\S]*)$/);
  if (!m) return { text: raw.trim(), hooks: [] };
  let hooks: string[] = [];
  const arr = m[2].match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      const parsed = JSON.parse(arr[0]) as unknown[];
      if (Array.isArray(parsed)) {
        hooks = parsed.map((h) => String(h).trim().slice(0, 24)).filter(Boolean).slice(0, 3);
      }
    } catch {
      // 数组坏了就只保正文
    }
  }
  return { text: m[1].trim(), hooks };
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
