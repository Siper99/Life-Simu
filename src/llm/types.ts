// LLM 配置类型：多 profile，按角色路由。

export type ProfileRole = "narrative" | "nsfw" | "summary";

export interface LlmProfile {
  id: string;
  name: string;
  kind: "openai" | "anthropic"; // openai = 一切 OpenAI 兼容端点（含 Ollama/LM Studio/中转）
  baseURL: string; // openai: http://host/v1 ；anthropic: https://api.anthropic.com
  apiKey: string;
  model: string;
  roles: ProfileRole[];
}

export type ContentRating = "clean" | "suggestive" | "explicit";

export const CONTENT_RATING_LABELS: Record<ContentRating, string> = {
  clean: "清水",
  suggestive: "暗示",
  explicit: "露骨",
};

export interface AppSettings {
  profiles: LlmProfile[];
  contentRating: ContentRating;
  narrativeStyle: string; // 叙事风格提示，如"写实细腻"、"幽默毒舌"
}

export const DEFAULT_SETTINGS: AppSettings = {
  profiles: [],
  contentRating: "clean",
  narrativeStyle: "写实细腻，带一点生活的幽默感",
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
