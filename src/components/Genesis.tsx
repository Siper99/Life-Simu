// 开局界面：出生卡 + 性别选择 + 属性预览 + 天赋三选一 + 重掷。

import { GenderPref } from "../engine/genesis";
import { getTalentRarity } from "../engine/talents";
import { ATTR_LABELS, AttrKey } from "../engine/types";
import { attributeScaleLabel } from "../engine/attributes";
import { useStore } from "../store/gameStore";

const GENDER_OPTIONS: { value: GenderPref; label: string }[] = [
  { value: "random", label: "🎲 随机" },
  { value: "男", label: "♂ 男" },
  { value: "女", label: "♀ 女" },
];

export function Genesis() {
  const { genesis, rerollGenesis, chooseTalent, setScreen, genderPref, setGenderPref } = useStore();
  if (!genesis) return null;
  const { state, talentChoices, rerollsLeft } = genesis;
  const c = state.character;

  return (
    <div className="genesis-screen">
      <h1 className="genesis-title">命运的骰子已掷下</h1>
      <p className="genesis-fate">
        这是你的天命——出身、家庭、时代，无法选择。但从此刻起，每一个选择都属于你。
      </p>
      <div className="genesis-gender">
        <span className="genesis-gender-label">性别</span>
        {GENDER_OPTIONS.map((o) => (
          <button
            key={o.value}
            className={`btn-ghost gender-btn${genderPref === o.value ? " active" : ""}`}
            onClick={() => setGenderPref(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="genesis-card">
        <p className="genesis-name">
          {c.name}（{c.gender}）
        </p>
        <p className="genesis-summary">{state.log[0].text}</p>
        <div className="genesis-attrs">
          {(Object.keys(c.attrs) as AttrKey[]).map((k) => (
            <div key={k} className="genesis-attr"
              title={`${ATTR_LABELS[k]}当前 ${c.attrs[k]}：${attributeScaleLabel(k, c.attrs[k])}`}>
              <span>{ATTR_LABELS[k]}</span>
              <b>{c.attrs[k]}</b>
              <small>基线 {c.attrBounds[k].floor} · 潜力 {c.attrBounds[k].ceiling}</small>
            </div>
          ))}
        </div>
      </div>

      <h2 className="genesis-subtitle">选择一项与生俱来的天赋</h2>
      <div className="genesis-talents">
        {talentChoices.map((t) => (
          <button
            key={t.id}
            className={`talent-card rarity-${getTalentRarity(t)}`}
            onClick={() => void chooseTalent(t)}
          >
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
