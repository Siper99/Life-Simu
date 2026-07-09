// 设置页：LLM profiles 编辑 + 连接测试 + 内容分级 + 叙事风格。

import { useState } from "react";
import { testProfile } from "../llm/client";
import {
  AppSettings,
  CONTENT_RATING_LABELS,
  ContentRating,
  LlmProfile,
  ProfileRole,
} from "../llm/types";
import { useStore } from "../store/gameStore";

const ROLE_LABELS: Record<ProfileRole, string> = {
  narrative: "主叙事",
  nsfw: "成人内容",
  summary: "摘要压缩",
};

function blankProfile(): LlmProfile {
  return {
    id: `p-${Date.now()}`,
    name: "新配置",
    kind: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    roles: ["narrative"],
  };
}

export function Settings() {
  const { settings, updateSettings, setScreen, game } = useStore();
  const [draft, setDraft] = useState<AppSettings>(() => JSON.parse(JSON.stringify(settings)));
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const patchProfile = (id: string, patch: Partial<LlmProfile>) => {
    setDraft({
      ...draft,
      profiles: draft.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const toggleRole = (p: LlmProfile, role: ProfileRole) => {
    const roles = p.roles.includes(role) ? p.roles.filter((r) => r !== role) : [...p.roles, role];
    patchProfile(p.id, { roles });
  };

  const runTest = async (p: LlmProfile) => {
    setTestResult((r) => ({ ...r, [p.id]: "测试中…" }));
    try {
      const reply = await testProfile(p);
      setTestResult((r) => ({ ...r, [p.id]: `✅ ${reply}` }));
    } catch (e) {
      setTestResult((r) => ({ ...r, [p.id]: `❌ ${String(e).slice(0, 120)}` }));
    }
  };

  const save = async () => {
    await updateSettings(draft);
    setScreen(game ? "game" : "menu");
  };

  return (
    <div className="settings-screen">
      <h1>设置</h1>

      <section className="settings-section">
        <h2>大模型配置</h2>
        <p className="settings-hint">
          可添加多个后端并指派用途。主叙事推荐官方 API；「成人内容」请配置本地模型（如 Ollama：
          http://localhost:11434/v1）或宽松的兼容端点——露骨内容只会发给标了「成人内容」的后端。
        </p>
        {draft.profiles.map((p) => (
          <div key={p.id} className="profile-card">
            <div className="profile-row">
              <input
                className="input"
                style={{ width: 140 }}
                value={p.name}
                onChange={(e) => patchProfile(p.id, { name: e.target.value })}
                placeholder="名称"
              />
              <select
                className="input"
                value={p.kind}
                onChange={(e) => patchProfile(p.id, { kind: e.target.value as LlmProfile["kind"] })}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <input
                className="input profile-url"
                value={p.baseURL}
                onChange={(e) => patchProfile(p.id, { baseURL: e.target.value })}
                placeholder={p.kind === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
              />
            </div>
            <div className="profile-row">
              <input
                className="input profile-key"
                type="password"
                value={p.apiKey}
                onChange={(e) => patchProfile(p.id, { apiKey: e.target.value })}
                placeholder="API Key（本地模型可留空）"
              />
              <input
                className="input"
                style={{ width: 220 }}
                value={p.model}
                onChange={(e) => patchProfile(p.id, { model: e.target.value })}
                placeholder="模型名，如 claude-sonnet-5"
              />
            </div>
            <div className="profile-row profile-roles">
              {(Object.keys(ROLE_LABELS) as ProfileRole[]).map((role) => (
                <label key={role} className="role-check">
                  <input
                    type="checkbox"
                    checked={p.roles.includes(role)}
                    onChange={() => toggleRole(p, role)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
              <span className="profile-spacer" />
              <button className="btn-ghost" onClick={() => void runTest(p)}>测试连接</button>
              <button
                className="btn-ghost btn-danger"
                onClick={() =>
                  setDraft({ ...draft, profiles: draft.profiles.filter((x) => x.id !== p.id) })
                }
              >
                删除
              </button>
            </div>
            {testResult[p.id] && <div className="profile-test">{testResult[p.id]}</div>}
          </div>
        ))}
        <button
          className="btn-ghost"
          onClick={() => setDraft({ ...draft, profiles: [...draft.profiles, blankProfile()] })}
        >
          ＋ 添加后端
        </button>
      </section>

      <section className="settings-section">
        <h2>内容分级</h2>
        <div className="rating-options">
          {(Object.keys(CONTENT_RATING_LABELS) as ContentRating[]).map((r) => (
            <label key={r} className="role-check">
              <input
                type="radio"
                name="rating"
                checked={draft.contentRating === r}
                onChange={() => setDraft({ ...draft, contentRating: r })}
              />
              {CONTENT_RATING_LABELS[r]}
            </label>
          ))}
        </div>
        <p className="settings-hint">
          「露骨」档需要配置了「成人内容」用途的后端才会生效，否则相关场景自动淡化处理。仅限成年虚构角色。
        </p>
      </section>

      <section className="settings-section">
        <h2>叙事风格</h2>
        <input
          className="input"
          style={{ width: "100%" }}
          value={draft.narrativeStyle}
          onChange={(e) => setDraft({ ...draft, narrativeStyle: e.target.value })}
          placeholder="如：写实细腻，带一点生活的幽默感"
        />
      </section>

      <div className="settings-actions">
        <button className="btn-primary" onClick={() => void save()}>保存</button>
        <button className="btn-ghost" onClick={() => setScreen(game ? "game" : "menu")}>取消</button>
      </div>
    </div>
  );
}
