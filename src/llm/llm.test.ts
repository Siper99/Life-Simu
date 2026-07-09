import { describe, expect, it } from "vitest";
import { AppSettings, DEFAULT_SETTINGS, LlmProfile, profileForRole } from "./types";

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
