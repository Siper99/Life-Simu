// 设置页：LLM profiles 编辑 + 连接测试 + 内容分级 + 叙事风格 + 检查更新。

import { useState } from "react";
import { testProfile } from "../llm/client";
import { checkForUpdate } from "../updater";
import { SwingDifficulty } from "../engine/resolver";
import {
  AppSettings,
  CONTENT_RATING_LABELS,
  ContentRating,
  DEEPSEEK_DEFAULTS,
  LlmProfile,
  ProfileRole,
  SWING_DIFFICULTY_LABELS,
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

function deepseekProfile(): LlmProfile {
  return {
    id: `p-${Date.now()}`,
    name: "DeepSeek",
    kind: "deepseek",
    baseURL: DEEPSEEK_DEFAULTS.baseURL,
    apiKey: "",
    model: DEEPSEEK_DEFAULTS.model,
    roles: ["narrative"],
  };
}

const KIND_PLACEHOLDERS: Record<LlmProfile["kind"], { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1", model: "模型名，如 gpt-4o" },
  anthropic: { url: "https://api.anthropic.com", model: "模型名，如 claude-sonnet-5" },
  deepseek: { url: DEEPSEEK_DEFAULTS.baseURL, model: "deepseek-chat 或 deepseek-reasoner" },
};

export function Settings() {
  const { settings, updateSettings, setScreen, game } = useStore();
  const [draft, setDraft] = useState<AppSettings>(() => JSON.parse(JSON.stringify(settings)));
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [updateMsg, setUpdateMsg] = useState("");

  const runUpdateCheck = async () => {
    setUpdateMsg("检查中…");
    try {
      const update = await checkForUpdate();
      if (!update) {
        setUpdateMsg("✅ 已是最新版本");
        return;
      }
      setUpdateMsg(`🔄 发现新版本 v${update.version}，正在下载安装，完成后自动重启…`);
      await update.install();
    } catch (e) {
      setUpdateMsg(`❌ 检查更新失败：${String(e).slice(0, 120)}`);
    }
  };

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
                onChange={(e) => {
                  const kind = e.target.value as LlmProfile["kind"];
                  // 切到 DeepSeek 时自动填官方地址与默认模型（仅当还是别家默认值/空时，不覆盖手改的）
                  const patch: Partial<LlmProfile> = { kind };
                  if (kind === "deepseek") {
                    const untouched = ["", "https://api.openai.com/v1", "https://api.anthropic.com"];
                    if (untouched.includes(p.baseURL.trim())) patch.baseURL = DEEPSEEK_DEFAULTS.baseURL;
                    if (!p.model.trim()) patch.model = DEEPSEEK_DEFAULTS.model;
                  }
                  patchProfile(p.id, patch);
                }}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
              </select>
              <input
                className="input profile-url"
                value={p.baseURL}
                onChange={(e) => patchProfile(p.id, { baseURL: e.target.value })}
                placeholder={KIND_PLACEHOLDERS[p.kind].url}
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
                placeholder={KIND_PLACEHOLDERS[p.kind].model}
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
        <div className="profile-add-row">
          <button
            className="btn-ghost"
            onClick={() => setDraft({ ...draft, profiles: [...draft.profiles, blankProfile()] })}
          >
            ＋ 添加后端
          </button>
          <button
            className="btn-ghost"
            onClick={() => setDraft({ ...draft, profiles: [...draft.profiles, deepseekProfile()] })}
          >
            ＋ 添加 DeepSeek
          </button>
        </div>
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
        <h2>判定难度</h2>
        <div className="rating-options">
          {(Object.keys(SWING_DIFFICULTY_LABELS) as SwingDifficulty[]).map((d) => (
            <label key={d} className="role-check" title={SWING_DIFFICULTY_LABELS[d].desc}>
              <input
                type="radio"
                name="swing-difficulty"
                checked={draft.swingDifficulty === d}
                onChange={() => setDraft({ ...draft, swingDifficulty: d })}
              />
              {SWING_DIFFICULTY_LABELS[d].label}
            </label>
          ))}
        </div>
        <p className="settings-hint">
          影响转针的摆速与判定区宽度，保存后对下一次判定立即生效。轻松≈成功率 +8%，硬核≈原版手感。
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

      <section className="settings-section">
        <h2>版本与更新</h2>
        <div className="profile-row">
          <button className="btn-ghost" onClick={() => void runUpdateCheck()}>检查更新</button>
          {updateMsg && <span className="settings-hint">{updateMsg}</span>}
        </div>
        <p className="settings-hint">更新来自 GitHub Release，需要联网。开发模式下不可用。</p>
      </section>

      <div className="settings-actions">
        <button className="btn-primary" onClick={() => void save()}>保存</button>
        <button className="btn-ghost" onClick={() => setScreen(game ? "game" : "menu")}>取消</button>
      </div>
    </div>
  );
}
