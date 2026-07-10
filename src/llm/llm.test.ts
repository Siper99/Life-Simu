import { describe, expect, it, vi } from "vitest";
import { AppSettings, DEFAULT_SETTINGS, LlmProfile, profileForRole } from "./types";
import { newGameState } from "../engine/genesis";
import { getDecisionBoard } from "../engine/decisions";
import { SceneState, emptyDeltas } from "../engine/types";
import { TurnOutcome } from "../engine/turn";
import { NSFW_MEMORY_PLACEHOLDER, choiceUserPrompt } from "./prompts";

vi.mock("./client", () => ({
  chat: vi.fn(async () => "两个人的夜晚很长。\nHOOKS:[]"),
  extractJson: vi.fn(() => ({})),
}));
import { chat } from "./client";
import { narrateSceneBeat, narrateTurn } from "./orchestrator";

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

describe("场景模式路由：连续对手戏的每一拍", () => {
  const mockedChat = vi.mocked(chat);

  function explicitSettings(profiles: LlmProfile[]): AppSettings {
    return { ...DEFAULT_SETTINGS, profiles, contentRating: "explicit" };
  }

  const mkScene = (nsfw: boolean): SceneState => ({
    target: "小柔",
    nsfw,
    beats: [{ player: "凑近一点", narrative: "她抬起头看你，没有躲开。" }],
    startedTurn: 0,
  });

  it("NSFW 场景走 nsfw 后端，带上此前的完整场景记录（连续性）", async () => {
    mockedChat.mockClear();
    const { state } = newGameState(5);
    const res = await narrateSceneBeat(explicitSettings([official, local]), state, mkScene(true), "牵她的手");
    expect(mockedChat.mock.calls[0][0]).toBe(local);
    expect(mockedChat.mock.calls[0][2]?.purpose).toBe("场景·NSFW");
    const userPrompt = String(mockedChat.mock.calls[0][1][1].content);
    expect(userPrompt).toContain("她抬起头看你，没有躲开。"); // 上一拍原文在场
    expect(userPrompt).toContain("牵她的手");
    expect(res.usedLlm).toBe(true);
  });

  it("普通场景走主叙事后端", async () => {
    mockedChat.mockClear();
    const { state } = newGameState(5);
    await narrateSceneBeat(explicitSettings([official, local]), state, mkScene(false), "聊聊近况");
    expect(mockedChat.mock.calls[0][0]).toBe(official);
    expect(mockedChat.mock.calls[0][2]?.purpose).toBe("场景");
  });

  it("成人场景但没配 nsfw 后端：退回主叙事并要求镜头拉远", async () => {
    mockedChat.mockClear();
    const { state } = newGameState(5);
    await narrateSceneBeat(explicitSettings([official]), state, mkScene(true), "靠近");
    expect(mockedChat.mock.calls[0][0]).toBe(official);
    expect(String(mockedChat.mock.calls[0][1][0].content)).toContain("镜头拉远");
  });

  it("无后端时模板兜底，游戏离线可玩；花钱表达有最小后果识别", async () => {
    const { state } = newGameState(5);
    const res = await narrateSceneBeat(explicitSettings([]), state, mkScene(false), "说点什么");
    expect(res.usedLlm).toBe(false);
    expect(res.text).toContain("离线模式");
    expect(res.effects).toBeNull();
    const spend = await narrateSceneBeat(explicitSettings([]), state, mkScene(false), "请她吃一顿大餐");
    expect(spend.effects).toEqual({ money: -200 });
  });

  it("EFFECTS 尾行被剥离并透传给净化器", async () => {
    mockedChat.mockClear();
    mockedChat.mockResolvedValueOnce('她收下了项链，脸红了。\nEFFECTS:{"money":-2000,"affinity":6}');
    const { state } = newGameState(5);
    const res = await narrateSceneBeat(explicitSettings([official]), state, mkScene(false), "把项链递过去");
    expect(res.text).toBe("她收下了项链，脸红了。");
    expect(res.effects).toEqual({ money: -2000, affinity: 6 });
  });

  it("splitSceneEffects：缺失、空对象与坏 JSON 都静默降级", async () => {
    const { splitSceneEffects } = await import("./prompts");
    expect(splitSceneEffects("正文。\nEFFECTS:{}")).toEqual({ text: "正文。", effects: {} });
    expect(splitSceneEffects("正文而已。")).toEqual({ text: "正文而已。", effects: null });
    expect(splitSceneEffects("正文。\nEFFECTS:{坏的")).toEqual({ text: "正文。", effects: null });
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
