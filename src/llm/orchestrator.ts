// 回合编排的 LLM 侧：意图解析、叙事生成、记忆压缩、墓志铭。全部带无 LLM 兜底。

import { DecisionBoard, DecisionChoice, sanitizeLlmChoices } from "../engine/decisions";
import { fallbackParseIntents } from "../engine/resolver";
import { TurnOutcome } from "../engine/turn";
import { ActionIntent, GameState } from "../engine/types";
import { chat, extractJson } from "./client";
import {
  CHOICE_SYSTEM,
  INTENT_SYSTEM,
  SUMMARY_SYSTEM,
  choiceUserPrompt,
  SKIP_SYSTEM,
  epitaphPrompt,
  fallbackNarrative,
  intentUserPrompt,
  narrativeSystem,
  narrativeUserPrompt,
  skipUserPrompt,
  splitNarrativeHooks,
  trimToSentenceEnd,
} from "./prompts";
import { AppSettings, profileForRole } from "./types";

const VALID_CATEGORIES = new Set(["study","work","social","romance","exercise","leisure","adventure","finance","health","other"]);
const VALID_ATTRS = new Set(["health","fitness","intelligence","eq","charm","mood","luck"]);
const VALID_RISK = new Set(["none","low","high"]);

interface RawIntent {
  summary?: string; category?: string; hours?: number;
  risk?: string; attr?: string; nsfw?: boolean; target?: string; skill?: string;
}

/** 意图解析：LLM 优先，失败/未配置回退关键词解析 */
export async function parseIntents(
  settings: AppSettings,
  state: GameState,
  playerText: string,
): Promise<{ intents: ActionIntent[]; usedLlm: boolean }> {
  // 露骨模式下玩家原始输入可能含成人内容，解析也走 NSFW 后端，不经过官方 API
  const nsfwProfile =
    settings.contentRating === "explicit" ? profileForRole(settings, "nsfw") : null;
  const profile = nsfwProfile ?? profileForRole(settings, "narrative");
  if (!profile) {
    return { intents: fallbackParseIntents(playerText), usedLlm: false };
  }
  try {
    const raw = await chat(
      profile,
      [
        { role: "system", content: INTENT_SYSTEM },
        { role: "user", content: intentUserPrompt(state, playerText) },
      ],
      { temperature: 0.2, maxTokens: 800, purpose: nsfwProfile ? "意图解析·露骨模式" : "意图解析" },
    );
    const arr = extractJson<RawIntent[]>(raw);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("空数组");
    const intents = arr.slice(0, 4).map((r, i): ActionIntent => ({
      id: `act-${i}`,
      summary: String(r.summary ?? playerText).slice(0, 40),
      category: VALID_CATEGORIES.has(r.category ?? "") ? (r.category as ActionIntent["category"]) : "other",
      hours: Math.min(100, Math.max(1, Math.round(Number(r.hours) || 20))),
      risk: VALID_RISK.has(r.risk ?? "") ? (r.risk as ActionIntent["risk"]) : "low",
      attr: VALID_ATTRS.has(r.attr ?? "") ? (r.attr as ActionIntent["attr"]) : "mood",
      nsfw: Boolean(r.nsfw),
      target: r.target ? String(r.target).slice(0, 20) : undefined,
      skill: r.skill ? String(r.skill).trim().slice(0, 6) : undefined,
    }));
    return { intents, usedLlm: true };
  } catch (e) {
    console.warn("意图解析走兜底：", e);
    return { intents: fallbackParseIntents(playerText), usedLlm: false };
  }
}

/**
 * 叙事生成：NSFW 场景路由到 nsfw profile；顺带产出 0~3 条叙事线头（同一次调用）。
 * 返回的 nsfw=true 表示正文由 nsfw 后端按露骨分级生成——调用方必须把它隔离在
 * 游戏内展示层（记忆、线头、后续 prompt 一律用替身文案），防止原文回流官方 API。
 */
export async function narrateTurn(
  settings: AppSettings,
  state: GameState,
  playerText: string,
  outcome: TurnOutcome,
): Promise<{ text: string; hooks: string[]; usedLlm: boolean; nsfw: boolean }> {
  const isNsfwTurn =
    settings.contentRating === "explicit" &&
    outcome.actions.some((a) => a.intent.nsfw);
  const nsfwProfile = profileForRole(settings, "nsfw");
  const profile = isNsfwTurn && nsfwProfile ? nsfwProfile : profileForRole(settings, "narrative");
  if (!profile) {
    return { text: fallbackNarrative(outcome), hooks: [], usedLlm: false, nsfw: false };
  }
  // 关键安全约束：露骨内容只发给明确标了 nsfw 角色的后端，绝不发官方 API
  const hasNsfwBackend = Boolean(nsfwProfile) && profile === nsfwProfile;
  const explicitGenerated = isNsfwTurn && hasNsfwBackend;
  try {
    const raw = await chat(
      profile,
      [
        { role: "system", content: narrativeSystem(settings.contentRating, hasNsfwBackend, settings.narrativeStyle) },
        { role: "user", content: narrativeUserPrompt(state, playerText, outcome) },
      ],
      { temperature: 0.95, maxTokens: 2000, purpose: explicitGenerated ? "叙事·NSFW" : "叙事" },
    );
    const { text, hooks } = splitNarrativeHooks(raw.trim());
    return { text: trimToSentenceEnd(text), hooks, usedLlm: true, nsfw: explicitGenerated };
  } catch (e) {
    console.warn("叙事生成走兜底：", e);
    return { text: fallbackNarrative(outcome), hooks: [], usedLlm: false, nsfw: false };
  }
}

/**
 * 决策盘补充卡：让 LLM 基于角色当下的处境提出更具体的行动选项。
 * 失败/未配置时返回空数组——固定卡池本身就是完整兜底。
 */
export async function proposeChoices(
  settings: AppSettings,
  state: GameState,
  board: DecisionBoard,
): Promise<DecisionChoice[]> {
  const profile = profileForRole(settings, "narrative");
  if (!profile) return [];
  try {
    const raw = await chat(
      profile,
      [
        { role: "system", content: CHOICE_SYSTEM },
        { role: "user", content: choiceUserPrompt(state, board) },
      ],
      { temperature: 0.9, maxTokens: 1200, purpose: "灵感卡" },
    );
    return sanitizeLlmChoices(state, extractJson(raw));
  } catch (e) {
    console.warn("补充行动卡生成失败，仅用固定卡池：", e);
    return [];
  }
}

/** 跳过时间的岁月摘要：把被动变化写成一小段流逝叙事；无 LLM/失败时用模板兜底 */
export async function narrateSkip(
  settings: AppSettings,
  state: GameState,
  spanLabel: string,
  notes: string[],
): Promise<{ text: string; usedLlm: boolean }> {
  const fallback = `你随波逐流，任凭${spanLabel}推着自己往前走……${
    notes.length > 0 ? notes.slice(-6).join("；") : "一切平静，什么也没有改变。"
  }`;
  const profile = profileForRole(settings, "narrative");
  if (!profile) return { text: fallback, usedLlm: false };
  try {
    const text = await chat(
      profile,
      [
        { role: "system", content: SKIP_SYSTEM },
        { role: "user", content: skipUserPrompt(state, spanLabel, notes) },
      ],
      { temperature: 0.9, maxTokens: 700, purpose: "岁月摘要" },
    );
    return { text: trimToSentenceEnd(text.trim()), usedLlm: true };
  } catch (e) {
    console.warn("岁月摘要走兜底：", e);
    return { text: fallback, usedLlm: false };
  }
}

/** 记忆压缩（可选，失败静默跳过——兜底截断逻辑在 memory.ts） */
export async function summarize(settings: AppSettings, text: string): Promise<string | null> {
  const profile = profileForRole(settings, "summary") ?? profileForRole(settings, "narrative");
  if (!profile) return null;
  try {
    const out = await chat(
      profile,
      [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: text },
      ],
      { temperature: 0.3, maxTokens: 200, purpose: "记忆压缩" },
    );
    return out.trim().slice(0, 100);
  } catch {
    return null;
  }
}

export async function writeEpitaph(
  settings: AppSettings,
  state: GameState,
): Promise<{ summary: string; epitaph: string }> {
  const profile = profileForRole(settings, "narrative");
  const fallback = {
    summary: `你走完了 ${state.world.year - state.character.birthYear} 年的人生，死因：${state.character.deathCause ?? "未知"}。`,
    epitaph: "一个认真活过的人。",
  };
  if (!profile) return fallback;
  try {
    const raw = await chat(profile, [{ role: "user", content: epitaphPrompt(state) }], {
      temperature: 0.9,
      maxTokens: 600,
      purpose: "墓志铭",
    });
    const j = extractJson<{ summary?: string; epitaph?: string }>(raw);
    return {
      summary: String(j.summary ?? fallback.summary),
      epitaph: String(j.epitaph ?? fallback.epitaph),
    };
  } catch {
    return fallback;
  }
}
