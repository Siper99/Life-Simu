import { describe, expect, it, vi } from "vitest";
import { AppSettings, DEFAULT_SETTINGS, LlmProfile, profileForRole } from "./types";
import { newGameState } from "../engine/genesis";
import { getDecisionBoard } from "../engine/decisions";
import { emptyDeltas } from "../engine/types";
import { TurnOutcome } from "../engine/turn";
import { NSFW_MEMORY_PLACEHOLDER, choiceUserPrompt } from "./prompts";

vi.mock("./client", () => ({
  chat: vi.fn(async () => "两个人的夜晚很长。\nHOOKS:[]"),
  extractJson: vi.fn(() => ({})),
}));
import { chat } from "./client";
import { narrateTurn } from "./orchestrator";

const official: LlmProfile = {
  id: "p-official",
  name: "官方",
  kind: "anthropic",
  baseURL: "https://api.anthropic.com",
  apiKey: "sk-xxx",
  model: "claude-sonnet-5",
  roles: ["narrative", "summary"],
};

const local: LlmProfile = {
  id: "p-local",
  name: "本地",
  kind: "openai",
  baseURL: "http://localhost:11434/v1",
  apiKey: "",
  model: "some-local-model",
  roles: ["nsfw"],
};

function settingsWith(profiles: LlmProfile[]): AppSettings {
  return { ...DEFAULT_SETTINGS, profiles };
}

describe("profileForRole 路由安全", () => {
  it("nsfw 角色未配置时绝不回退到其他后端", () => {
    expect(profileForRole(settingsWith([official]), "nsfw")).toBeNull();
  });

  it("nsfw 角色只命中显式标记的后端", () => {
    expect(profileForRole(settingsWith([official, local]), "nsfw")).toBe(local);
  });

  it("narrative/summary 允许回退到第一个后端", () => {
    const onlyLocal = settingsWith([local]);
    expect(profileForRole(onlyLocal, "narrative")).toBe(local);
    expect(profileForRole(onlyLocal, "summary")).toBe(local);
  });

  it("无任何后端时全部返回 null", () => {
    expect(profileForRole(settingsWith([]), "narrative")).toBeNull();
    expect(profileForRole(settingsWith([]), "nsfw")).toBeNull();
  });
});

describe("双后端内容路由：常规走主叙事后端，露骨只走 nsfw 后端", () => {
  const mockedChat = vi.mocked(chat);

  function explicitSettings(profiles: LlmProfile[]): AppSettings {
    return { ...DEFAULT_SETTINGS, profiles, contentRating: "explicit" };
  }

  function mkOutcome(nsfw: boolean): TurnOutcome {
    return {
      actions: [{
        intent: {
          id: "a", summary: "共度一晚", category: "romance", hours: 10,
          risk: "low", attr: "charm", nsfw,
        },
        tier: "success",
        deltas: emptyDeltas(),
        mechanical: "",
      }],
      event: null,
      passive: [],
      died: false,
    };
  }

  it("nsfw 回合发给 nsfw 后端并标记 nsfw=true", async () => {
    mockedChat.mockClear();
    const { state } = newGameState(1);
    const res = await narrateTurn(explicitSettings([official, local]), state, "x", mkOutcome(true));
    expect(mockedChat.mock.calls[0][0]).toBe(local);
    expect(res.nsfw).toBe(true);
  });

  it("普通回合发给主叙事后端，nsfw=false", async () => {
    mockedChat.mockClear();
    const { state } = newGameState(1);
    const res = await narrateTurn(explicitSettings([official, local]), state, "x", mkOutcome(false));
    expect(mockedChat.mock.calls[0][0]).toBe(official);
    expect(res.nsfw).toBe(false);
  });

  it("没配 nsfw 后端时露骨回合退回主叙事后端并要求镜头拉远，正文不标 nsfw", async () => {
    mockedChat.mockClear();
    const { state } = newGameState(1);
    const res = await narrateTurn(explicitSettings([official]), state, "x", mkOutcome(true));
    expect(mockedChat.mock.calls[0][0]).toBe(official);
    expect(String(mockedChat.mock.calls[0][1][0].content)).toContain("镜头拉远");
    expect(res.nsfw).toBe(false);
  });
});

describe("NSFW 上下文隔离：露骨正文不回流常规后端", () => {
  it("出卡提示词对 nsfw 叙事使用替身文案", () => {
    const { state } = newGameState(3);
    state.log.push({ turn: 0, date: "d", kind: "narrative", text: "这里是露骨细节原文XYZ", nsfw: true });
    const prompt = choiceUserPrompt(state, getDecisionBoard(state));
    expect(prompt).not.toContain("露骨细节原文XYZ");
    expect(prompt).toContain(NSFW_MEMORY_PLACEHOLDER);
  });

  it("普通叙事仍原文进入出卡提示词", () => {
    const { state } = newGameState(3);
    state.log.push({ turn: 0, date: "d", kind: "narrative", text: "平常的一天原文ABC" });
    const prompt = choiceUserPrompt(state, getDecisionBoard(state));
    expect(prompt).toContain("平常的一天原文ABC");
  });
});
