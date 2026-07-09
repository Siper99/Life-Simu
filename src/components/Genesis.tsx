// 开局界面：出生卡 + 属性预览 + 天赋三选一 + 重掷。

import { ATTR_LABELS, AttrKey } from "../engine/types";
import { useStore } from "../store/gameStore";

export function Genesis() {
  const { genesis, rerollGenesis, chooseTalent, setScreen } = useStore();
  if (!genesis) return null;
  const { state, talentChoices, rerollsLeft } = genesis;
  const c = state.character;

  return (
    <div className="genesis-screen">
      <h1 className="genesis-title">命运的骰子已掷下</h1>
      <div className="genesis-card">
        <p className="genesis-summary">{state.log[0].text}</p>
        <div className="genesis-attrs">
          {(Object.keys(c.attrs) as AttrKey[]).map((k) => (
            <div key={k} className="genesis-attr">
              <span>{ATTR_LABELS[k]}</span>
              <b>{c.attrs[k]}</b>
            </div>
          ))}
        </div>
      </div>

      <h2 className="genesis-subtitle">选择一项与生俱来的天赋</h2>
      <div className="genesis-talents">
        {talentChoices.map((t) => (
          <button key={t.id} className="talent-card" onClick={() => void chooseTalent(t)}>
            <div className="talent-name">✦ {t.name}</div>
            <div className="talent-desc">{t.desc}</div>
          </button>
        ))}
      </div>

      <div className="genesis-actions">
        <button className="btn-ghost" disabled={rerollsLeft <= 0} onClick={rerollGenesis}>
          🎲 重掷命运（剩 {rerollsLeft} 次）
        </button>
        <button className="btn-ghost" onClick={() => setScreen("menu")}>
          返回
        </button>
      </div>
    </div>
  );
}
