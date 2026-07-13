// 设置页：LLM profiles 编辑 + 连接测试 + 内容分级 + 叙事风格 + 检查更新。

import { useState } from "react";
import { checkBackendUrl, testProfile } from "../llm/client";
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
  XAI_DEFAULTS,
} from "../llm/types";
import { useStore } from "../store/gameStore";

const ROLE_LABELS: Record<ProfileRole, string> = {
  narrative: "主叙事",
  nsfw: "成人内容",
  summary: "摘要压缩",
};

/** profile id：同一毫秒内连建多个（如一键预设）也不能撞车 */
function newProfileId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function blankProfile(): LlmProfile {
  return {
    id: newProfileId(),
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
    id: newProfileId(),
    name: "DeepSeek",
    kind: "deepseek",
    baseURL: DEEPSEEK_DEFAULTS.baseURL,
    apiKey: "",
    model: DEEPSEEK_DEFAULTS.model,
    roles: ["narrative"],
  };
}

function xaiProfile(): LlmProfile {
  return {
    id: newProfileId(),
    name: "xAI",
    kind: "xai",
    baseURL: XAI_DEFAULTS.baseURL,
    apiKey: "",
    model: XAI_DEFAULTS.model,
    roles: ["narrative"],
  };
}

/** 一键双后端：常规内容走 DeepSeek，成人内容严格只走 Grok（只填两个 key 即可） */
function dualBackendPreset(): LlmProfile[] {
  return [
    { ...deepseekProfile(), name: "DeepSeek（常规）", roles: ["narrative", "summary"] },
    { ...xaiProfile(), name: "Grok（成人）", roles: ["nsfw"] },
  ];
}

const KIND_PLACEHOLDERS: Record<LlmProfile["kind"], { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1", model: "模型名，如 gpt-4o" },
  anthropic: { url: "https://api.anthropic.com", model: "模型名，如 claude-sonnet-5" },
  deepseek: { url: DEEPSEEK_DEFAULTS.baseURL, model: "deepseek-chat 或 deepseek-reasoner" },
  xai: { url: XAI_DEFAULTS.baseURL, model: "grok-4 或 grok-4-fast" },
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
    // 发送前确认：把密钥发往非官方、非本机的自定义域名时，明确告知用户目标地址
    const custom = draft.profiles.filter((p) => {
      if (!p.apiKey.trim()) return false;
      const c = checkBackendUrl(p.baseURL);
      return c.ok && !c.isOfficial && !c.isLocal;
    });
    if (custom.length > 0) {
      const lines = custom.map((p) => `· ${p.name}：${checkBackendUrl(p.baseURL).host}`).join("\n");
      const ok = window.confirm(
        `以下后端配置了 API Key，保存后每次请求都会把密钥发送到这些自定义地址：\n\n${lines}\n\n` +
        `请确认这些是你信任的服务商域名。确定继续保存吗？`,
      );
      if (!ok) return;
    }
    // 拦下协议不安全的地址（明文 HTTP 发往远端等），避免密钥泄露
    const unsafe = draft.profiles.filter((p) => p.apiKey.trim() && !checkBackendUrl(p.baseURL).ok);
    if (unsafe.length > 0) {
      setTestResult((r) => ({
        ...r,
        ...Object.fromEntries(unsafe.map((p) => [p.id, `❌ 地址不安全：${checkBackendUrl(p.baseURL).reason}`])),
      }));
      return;
    }
    await updateSettings(draft);
    setScreen(game ? "game" : "menu");
  };

  return (
    <div className="settings-screen">
      <h1>设置</h1>

      <section className="settings-section">
        <h2>大模型配置</h2>
        <p className="settings-hint">
          可添加多个后端并指派用途。主叙事推荐官方 API；「成人内容」请配置宽松端点（如 Grok）或本地模型
          （Ollama：http://localhost:11434/v1）。露骨内容只会发给标了「成人内容」的后端，
          且 NSFW 后端生成的原文不会混进发给常规后端的上下文。同一用途有多个后端时，排在前面的优先。
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
                  // 切到 DeepSeek/xAI 时自动填官方地址与默认模型（仅当还是别家默认值/空时，不覆盖手改的）
                  const patch: Partial<LlmProfile> = { kind };
                  const untouched = ["", "https://api.openai.com/v1", "https://api.anthropic.com"];
                  if (kind === "deepseek") {
                    if (untouched.includes(p.baseURL.trim())) patch.baseURL = DEEPSEEK_DEFAULTS.baseURL;
                    if (!p.model.trim()) patch.model = DEEPSEEK_DEFAULTS.model;
                  } else if (kind === "xai") {
                    if (untouched.includes(p.baseURL.trim())) patch.baseURL = XAI_DEFAULTS.baseURL;
                    if (!p.model.trim()) patch.model = XAI_DEFAULTS.model;
                  }
                  patchProfile(p.id, patch);
                }}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
                <option value="xai">xAI（Grok）</option>
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
          <button
            className="btn-ghost"
            onClick={() => setDraft({ ...draft, profiles: [...draft.profiles, xaiProfile()] })}
          >
            ＋ 添加 xAI
          </button>
          <button
            className="btn-ghost preset-dual"
            title="一次建好两个后端：DeepSeek 负责主叙事和摘要，Grok 只负责成人内容——填两个 API Key 即可"
            onClick={() => setDraft({ ...draft, profiles: [...draft.profiles, ...dualBackendPreset()] })}
          >
            ⚡ 一键双后端：DeepSeek 常规 + Grok 成人
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
