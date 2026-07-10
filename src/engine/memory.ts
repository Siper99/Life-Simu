// 分层记忆：本周详情 → 月度摘要 → 年度编年史。组装 LLM 上下文时按层拼接。

import { LIFESTYLES, lifestyleOf } from "./economy";
import { ATTR_LABELS, AttrKey, GameState, ageOf, energyStateLabel, formatDate, lifeStageOf } from "./types";

const MAX_WEEKLY = 12;
const MAX_MONTHLY = 24;

export function appendWeeklyNote(state: GameState, text: string): void {
  state.weeklyNotes.push({ label: formatDate(state), text });
  if (state.weeklyNotes.length > MAX_WEEKLY) {
    // 溢出的旧详情降级并入月度摘要区（无 LLM 压缩时的兜底：直接截断保留）
    const old = state.weeklyNotes.splice(0, state.weeklyNotes.length - MAX_WEEKLY);
    for (const n of old) {
      state.monthlySummaries.push({ label: n.label, text: n.text.slice(0, 120) });
    }
    if (state.monthlySummaries.length > MAX_MONTHLY) {
      const dropped = state.monthlySummaries.splice(0, state.monthlySummaries.length - MAX_MONTHLY);
      // 再溢出则并入编年史（每条压到一句）
      state.chronicle.push(...dropped.map((d) => `${d.label}：${d.text.slice(0, 60)}`));
    }
  }
}

/** LLM 压缩完成后调用：用摘要替换一批月度记录 */
export function compressToChronicle(state: GameState, yearLabel: string, summary: string): void {
  state.chronicle.push(`${yearLabel}：${summary}`);
  if (state.chronicle.length > 100) {
    state.chronicle = state.chronicle.slice(-100);
  }
}

/** 组装给 LLM 的角色状态卡（JSON 太啰嗦，用紧凑中文） */
export function statusCard(state: GameState): string {
  const c = state.character;
  const age = ageOf(state);
  const attrs = (Object.keys(c.attrs) as AttrKey[])
    .map((k) => `${ATTR_LABELS[k]}${c.attrs[k]}/潜力${c.attrBounds[k].ceiling}`)
    .join(" ");
  const baselines = (["health", "fitness", "intelligence", "eq", "charm"] as AttrKey[])
    .map((k) => `${ATTR_LABELS[k]}${c.attrBounds[k].floor}`)
    .join(" ");
  const npcs = c.npcs
    .filter((n) => n.birthYear <= state.world.year)
    .sort((a, b) => Number(b.alive) - Number(a.alive) || b.affinity - a.affinity)
    .slice(0, 10)
    .map((n) => {
      const npcAge = state.world.year - n.birthYear;
      const life = n.alive ? `${npcAge}岁,${n.occupation ?? "无职业"},健康${n.health}` : "已故";
      return `${n.name}(${n.relation},${life},好感${n.affinity})`;
    })
    .join("；");
  const identities = [
    c.identity.schooling ? `学籍${c.identity.schooling}` : "",
    c.identity.job ? `职业${c.identity.job.title}@${c.identity.job.employer}` : "",
  ].filter(Boolean).join("｜") || "无业";
  const skills = c.skills
    .filter((s) => s.level > 0)
    .sort((a, b) => b.level - a.level)
    .slice(0, 8)
    .map((s) => `${s.name}Lv${s.level}`)
    .join("、");
  return [
    `姓名：${c.name}（${c.gender}，${age}岁，${lifeStageOf(age)}期）`,
    `坐标：${c.identity.residence}｜家庭：${state.background.familyClass}`,
    `属性（100为人类极限）：${attrs}`,
    `先天基线（伤病可跌破）：${baselines}`,
    `精力：${c.energy}/100（${energyStateLabel(c.energy)}）｜金钱：${c.money}${age >= 18 ? `（${LIFESTYLES[lifestyleOf(state)].label}生活）` : ""}｜人脉：${c.connections}`,
    `身份：${identities}｜婚恋：${c.identity.maritalStatus}${c.identity.conditions.length > 0 ? `｜状态：${c.identity.conditions.join("、")}` : ""}`,
    `天赋：${c.talents.map((t) => t.name).join("、") || "无"}`,
    skills ? `技能：${skills}` : "",
    npcs ? `关系：${npcs}` : "",
    state.world.macroNotes.length > 0 ? `世界：${state.world.macroNotes.join("；")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 组装叙事/解析用的历史上下文 */
export function historyContext(state: GameState): string {
  const parts: string[] = [];
  if (state.chronicle.length > 0) {
    parts.push("【人生编年史】\n" + state.chronicle.slice(-20).join("\n"));
  }
  if (state.monthlySummaries.length > 0) {
    parts.push(
      "【近期概要】\n" +
        state.monthlySummaries.slice(-6).map((m) => `${m.label}：${m.text}`).join("\n"),
    );
  }
  if (state.weeklyNotes.length > 0) {
    parts.push(
      "【最近发生】\n" +
        state.weeklyNotes.slice(-4).map((m) => `${m.label}：${m.text}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}
