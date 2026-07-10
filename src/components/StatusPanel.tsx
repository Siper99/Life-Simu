// 左侧角色状态面板：属性条、资源、身份、天赋、技能、关系网。

import { getTalentRarity } from "../engine/talents";
import { LIFESTYLES, LIFESTYLE_ORDER, cityCostMult } from "../engine/economy";
import { skillTierLabel, xpToNext } from "../engine/skills";
import { ATTR_LABELS, AttrKey, GameState, ageOf, energyStateLabel, lifeStageOf } from "../engine/types";
import { attributeScaleLabel } from "../engine/attributes";
import { useStore } from "../store/gameStore";
import { FloatingDeltas } from "./FloatingDeltas";

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
  const floats = useStore((s) => s.floats);
  const setLifestyle = useStore((s) => s.setLifestyle);
  return (
    <aside className="status-panel">
      <FloatingDeltas />
      <div className="status-name">
        {c.name}
        <span className="status-sub">
          {c.gender} · {age}岁 · {lifeStageOf(age)}期{c.alive ? "" : " · 已故"}
        </span>
      </div>
      <div className="status-loc">
        📍 {c.identity.residence} · {game.background.familyClass}家庭
      </div>

      <div className="energy-meter">
        <div className="energy-meter-head"><span>⚡ 当前精力</span><b>{c.energy}/100</b></div>
        <div className="energy-meter-track">
          <div className="energy-meter-fill" style={{ width: `${c.energy}%` }} />
        </div>
        <div className="energy-state">{energyStateLabel(c.energy)}</div>
      </div>

      <div className="status-section">
        {(Object.keys(c.attrs) as AttrKey[]).map((k) => {
          const delta = floats?.attrDeltas[k];
          const range = c.attrBounds[k];
          // key 带上 seq：新一轮结算触发重挂载，闪烁动画重播一次
          const flashKey = delta ? `${k}-${floats!.seq}` : k;
          const flashClass = delta ? ` attr-flash-${delta > 0 ? "up" : "down"}` : "";
          const scale = attributeScaleLabel(k, c.attrs[k]);
          return (
            <div key={k} className="attr-row"
              title={`${ATTR_LABELS[k]} ${c.attrs[k]}：${scale}；先天基线 ${range.floor}，个人潜力 ${range.ceiling}`}>
              <span className="attr-label">{ATTR_LABELS[k]}</span>
              <div className="attr-bar">
                <div
                  className="attr-fill"
                  style={{ width: `${c.attrs[k]}%`, background: ATTR_COLORS[k] }}
                />
                {range.floor > 0 && <span className="attr-bound attr-floor" style={{ left: `${range.floor}%` }} />}
                {range.ceiling < 100 && <span className="attr-bound attr-ceiling" style={{ left: `${range.ceiling}%` }} />}
              </div>
              <span key={flashKey} className={`attr-value${flashClass}`}>
                {c.attrs[k]}<small>/{range.ceiling}</small>
              </span>
            </div>
          );
        })}
        <div className="attr-legend">短线＝先天基线　亮线＝个人潜力上限；100＝人类极限</div>
      </div>

      <div className="status-section status-kv">
        <div>💰 金钱 <b>{c.money.toLocaleString()}</b></div>
        {age >= 18 && c.alive && (
          <div className="lifestyle-row">
            <span className="lifestyle-label">生活方式</span>
            {LIFESTYLE_ORDER.map((k) => {
              const def = LIFESTYLES[k];
              const weeklyCost = Math.round(120 * def.costMult * cityCostMult(game));
              return (
                <button key={k} type="button"
                  className={`lifestyle-btn${(c.lifestyle ?? "standard") === k ? " active" : ""}`}
                  title={`${def.desc}（约 ${weeklyCost}/周，钱包撑不住会自动降档）`}
                  onClick={() => setLifestyle(k)}>
                  {def.label}
                </button>
              );
            })}
          </div>
        )}
        <div>🤝 人脉 <b>{c.connections}</b></div>
        {c.identity.schooling && <div>🎓 {c.identity.schooling}</div>}
        <div>
          💼 {c.identity.job
            ? <><b>{c.identity.job.title}</b><span> · {c.identity.job.employer}</span></>
            : age >= 18 ? "无业" : "未就业"}
        </div>
        {c.identity.job && c.identity.job.track !== "退休" && (
          <div className="career-progress">晋升进度 {c.identity.job.xp}/100 · 周薪 {c.identity.job.weeklyPay}</div>
        )}
        <div>💕 {c.identity.maritalStatus}</div>
        {c.identity.legalStatus !== "清白" && <div className="legal-status">⚖️ {c.identity.legalStatus}</div>}
        {c.identity.conditions.length > 0 && <div>🩹 {c.identity.conditions.join("、")}</div>}
      </div>

      {c.talents.length > 0 && (
        <div className="status-section">
          <div className="status-heading">天赋</div>
          {c.talents.map((t) => (
            <div key={t.id} className={`talent-chip rarity-${getTalentRarity(t)}`} title={t.desc}>
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
              <div key={s.id} className="skill-row"
                title={`${s.name} Lv${s.level}（${skillTierLabel(s.level)}）· 距下一级 ${xpToNext(s.level) - s.xp} 经验`}>
                <span>{s.name}</span>
                <span className="skill-level">Lv{s.level} · {skillTierLabel(s.level)}</span>
              </div>
            ))}
        </div>
      )}

      <div className="status-section">
        <div className="status-heading">关系</div>
        {c.npcs
          .filter((n) => n.birthYear <= game.world.year)
          .sort((a, b) => Number(b.alive) - Number(a.alive) || b.affinity - a.affinity)
          .slice(0, 10)
          .map((n) => {
            const npcAge = game.world.year - n.birthYear;
            const healthClass = n.health < 35 ? "npc-health-low" : n.health < 60 ? "npc-health-mid" : "";
            return (
              <div key={n.id} className={`npc-row${n.alive ? "" : " npc-deceased"}`}
                title={[...n.personality, n.occupation ?? "", ...n.conditions].filter(Boolean).join("、")}>
                <div className="npc-main">
                  <span>{n.name} <span className="npc-relation">{n.relation}</span></span>
                  <span className={`npc-meta ${healthClass}`}>
                    {npcAge}岁 · {n.occupation ?? "无职业"} · {n.alive ? `健康 ${n.health}` : "已故"}
                  </span>
                </div>
                <span className={n.affinity >= 0 ? "affinity-pos" : "affinity-neg"}>
                  {n.alive ? (n.affinity >= 0 ? "❤" : "💢") : "🕯"}{Math.abs(n.affinity)}
                </span>
              </div>
            );
          })}
      </div>
    </aside>
  );
}
