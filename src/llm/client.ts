// 统一聊天客户端：OpenAI 兼容端点（含 DeepSeek）+ Anthropic 官方 API。
// 走 Tauri http 插件的 fetch，绕过 webview CORS 限制。

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ChatMessage, LlmProfile } from "./types";

// Tauri 环境走插件 fetch 绕过 CORS；纯浏览器/测试环境退回原生 fetch
const fetch: typeof globalThis.fetch =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? (tauriFetch as typeof globalThis.fetch)
    : globalThis.fetch.bind(globalThis);

export class LlmError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export async function chat(
  profile: LlmProfile,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const temperature = opts.temperature ?? 0.9;
  const maxTokens = opts.maxTokens ?? 1600;

  if (profile.kind === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");
    const res = await fetch(`${profile.baseURL.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: profile.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      throw new LlmError(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    }
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
    if (!text) throw new LlmError("Anthropic 返回为空");
    return text;
  }

  // OpenAI 兼容（含 DeepSeek：同一协议，走 Bearer 鉴权 + /chat/completions）
  const res = await fetch(`${profile.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(profile.apiKey ? { authorization: `Bearer ${profile.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: profile.model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!res.ok) {
    throw new LlmError(`API ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LlmError("模型返回为空");
  return text;
}

/** 从模型输出里抠出第一个 JSON 值（容忍代码围栏与前后废话） */
export function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const start = Math.min(
    ...[cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i >= 0),
  );
  if (!Number.isFinite(start)) throw new LlmError("输出中没有 JSON");
  // 从 start 开始配对括号
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
    }
  }
  throw new LlmError("JSON 括号不配对");
}

export async function testProfile(profile: LlmProfile): Promise<string> {
  const reply = await chat(
    profile,
    [{ role: "user", content: "回复「连接成功」四个字，不要多说。" }],
    { maxTokens: 20, temperature: 0 },
  );
  return reply.trim().slice(0, 50);
}
