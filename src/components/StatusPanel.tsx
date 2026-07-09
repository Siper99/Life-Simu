// 左侧角色状态面板：属性条、资源、身份、天赋、技能、关系网。

import { ATTR_LABELS, AttrKey, GameState, ageOf, lifeStageOf } from "../engine/types";

const ATTR_COLORS: Record<AttrKey, string> = {
  health: "#e05d5d",
  fitness: "#e09a5d",
  intelligence: "#5d8de0",
  eq: "#9a5de0",
  charm: "#e05dba",
  mood: "#5dc9e0",
  luck: "#7de05d",
};

export function StatusPanel({ game }: { game: GameState }) {
  const c = game.character;
  const age = ageOf(game);
  return (
    <aside className="status-panel">
      <div className="status-name">
        {c.name}
        <span className="status-sub">
          {c.gender} · {age}岁 · {lifeStageOf(age)}期{c.alive ? "" : " · 已故"}
        </span>
      </div>
      <div className="status-loc">
        📍 {c.identity.residence} · {game.background.familyClass}家庭
      </div>

      <div className="status-section">
        {(Object.keys(c.attrs) as AttrKey[]).map((k) => (
          <div key={k} className="attr-row">
            <span className="attr-label">{ATTR_LABELS[k]}</span>
            <div className="attr-bar">
              <div
                className="attr-fill"
                style={{ width: `${c.attrs[k]}%`, background: ATTR_COLORS[k] }}
              />
            </div>
            <span className="attr-value">{c.attrs[k]}</span>
          </div>
        ))}
      </div>

      <div className="status-section status-kv">
        <div>💰 金钱 <b>{c.money.toLocaleString()}</b></div>
        <div>🤝 人脉 <b>{c.connections}</b></div>
        <div>🎓 {c.identity.schooling ?? c.identity.job?.title ?? "无业"}</div>
        <div>💕 {c.identity.maritalStatus}</div>
        {c.identity.conditions.length > 0 && <div>🩹 {c.identity.conditions.join("、")}</div>}
      </div>

      {c.talents.length > 0 && (
        <div className="status-section">
          <div className="status-heading">天赋</div>
          {c.talents.map((t) => (
            <div key={t.id} className="talent-chip" title={t.desc}>
              ✦ {t.name}
            </div>
          ))}
        </div>
      )}

      {c.skills.filter((s) => s.level > 0 || s.xp > 30).length > 0 && (
        <div className="status-section">
          <div className="status-heading">技能</div>
          {c.skills
            .filter((s) => s.level > 0 || s.xp > 30)
            .sort((a, b) => b.level - a.level || b.xp - a.xp)
            .slice(0, 10)
            .map((s) => (
              <div key={s.id} className="skill-row">
                <span>{s.name}</span>
                <span className="skill-level">Lv{s.level}</span>
              </div>
            ))}
        </div>
      )}

      <div className="status-section">
        <div className="status-heading">关系</div>
        {c.npcs
          .filter((n) => n.alive)
          .sort((a, b) => b.affinity - a.affinity)
          .slice(0, 8)
          .map((n) => (
            <div key={n.id} className="npc-row" title={n.personality.join("、")}>
              <span>
                {n.name} <span className="npc-relation">{n.relation}</span>
              </span>
              <span className={n.affinity >= 0 ? "affinity-pos" : "affinity-neg"}>
                {n.affinity >= 0 ? "❤" : "💢"}{Math.abs(n.affinity)}
              </span>
            </div>
          ))}
      </div>
    </aside>
  );
}
