// LLM 配置与应用设置类型：多 profile，按角色路由。

import { SwingDifficulty } from "../engine/resolver";

export type ProfileRole = "narrative" | "nsfw" | "summary";

export interface LlmProfile {
  id: string;
  name: string;
  // openai = 一切 OpenAI 兼容端点（含 Ollama/LM Studio/中转）；deepseek = DeepSeek 官方（协议同 OpenAI）
  kind: "openai" | "anthropic" | "deepseek";
  baseURL: string; // openai/deepseek: http://host/v1 ；anthropic: https://api.anthropic.com
  apiKey: string;
  model: string;
  roles: ProfileRole[];
}

/** DeepSeek 官方端点预设 */
export const DEEPSEEK_DEFAULTS = {
  baseURL: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
} as const;

export type ContentRating = "clean" | "suggestive" | "explicit";

export const CONTENT_RATING_LABELS: Record<ContentRating, string> = {
  clean: "清水",
  suggestive: "暗示",
  explicit: "露骨",
};

export const SWING_DIFFICULTY_LABELS: Record<SwingDifficulty, { label: string; desc: string }> = {
  easy: { label: "轻松", desc: "指针更慢、判定区更宽，适合只想看故事" },
  standard: { label: "标准", desc: "默认手感，调平后的推荐难度" },
  hard: { label: "硬核", desc: "原版铁腕手感，大失败常伴左右" },
};

export interface AppSettings {
  profiles: LlmProfile[];
  contentRating: ContentRating;
  narrativeStyle: string; // 叙事风格提示，如"写实细腻"、"幽默毒舌"
  swingDifficulty: SwingDifficulty; // 转针判定难度，改动即时生效
}

export const DEFAULT_SETTINGS: AppSettings = {
  profiles: [],
  contentRating: "clean",
  narrativeStyle: "写实细腻，带一点生活的幽默感",
  swingDifficulty: "standard",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function profileForRole(settings: AppSettings, role: ProfileRole): LlmProfile | null {
  const exact = settings.profiles.find((p) => p.roles.includes(role)) ?? null;
  // 安全红线：nsfw 角色绝不回退到其他后端——找不到就是没有，
  // 否则露骨请求会被发给官方 API（封号风险）
  if (role === "nsfw") return exact;
  return exact ?? settings.profiles[0] ?? null;
}
