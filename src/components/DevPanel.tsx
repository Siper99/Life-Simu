// 开发者面板：直接改写引擎真值（属性/精力/金钱/人脉）+ 瞬时快进时间。
// 仅供调试：不走判定、不写叙事；时间快进只做被动结算（fastForward）。

import { useState } from "react";
import { clearLlmCallLog, llmCallLog } from "../llm/client";
import { ATTR_LABELS, AttrKey, GameState, ageOf, formatDate } from "../engine/types";
import { useStore } from "../store/gameStore";

export function DevPanel({ game }: { game: GameState }) {
  const { devMutate, devSkipTurns, devSkipToYear, toggleDev, phase } = useStore();
  const busy = phase !== "idle";
  const c = game.character;
  const age = ageOf(game);
  const [targetAge, setTargetAge] = useState(Math.min(age + 5, 100));
  const [logTick, setLogTick] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const calls = [...llmCallLog()].reverse().slice(0, 12);

  // 抓住标题栏拖动面板；点到按钮时不启动拖拽
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = e.currentTarget.parentElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent) => {
      setPos({
        x: Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - 120),
        y: Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - 60),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const setAttr = (k: AttrKey, raw: number) => devMutate((g) => {
    const v = Math.max(0, Math.min(100, Math.round(raw) || 0));
    g.character.attrs[k] = v;
    // 拖过潜力上限视为调试意图：顺手抬高上限，避免面板与状态栏显示打架
    if (v > g.character.attrBounds[k].ceiling) g.character.attrBounds[k].ceiling = v;
  });

  return (
    <div className="dev-panel" style={pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined}>
      <div className="dev-head" onPointerDown={startDrag} title="按住拖动">
        <span>🛠 开发者模式 <small>直接改写引擎真值 · 可拖动</small></span>
        <button className="btn-ghost" onClick={toggleDev}>✕</button>
      </div>

      <div className="dev-section">
        <div className="dev-heading">属性（超过潜力上限会自动抬高上限）</div>
        {(Object.keys(c.attrs) as AttrKey[]).map((k) => (
          <div key={k} className="dev-row">
            <span className="dev-label">{ATTR_LABELS[k]}</span>
            <input type="range" min={0} max={100} value={c.attrs[k]}
              onChange={(e) => setAttr(k, Number(e.target.value))} />
            <input type="number" className="dev-num" min={0} max={100} value={c.attrs[k]}
              onChange={(e) => setAttr(k, Number(e.target.value))} />
          </div>
        ))}
        <div className="dev-row">
          <span className="dev-label">精力</span>
          <input type="range" min={0} max={100} value={c.energy}
            onChange={(e) => devMutate((g) => { g.character.energy = Number(e.target.value); })} />
          <input type="number" className="dev-num" min={0} max={100} value={c.energy}
            onChange={(e) => devMutate((g) => { g.character.energy = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))); })} />
        </div>
      </div>

      <div className="dev-section">
        <div className="dev-heading">资源</div>
        <div className="dev-row">
          <span className="dev-label">金钱</span>
          <input type="number" className="dev-num dev-num-wide" value={c.money}
            onChange={(e) => devMutate((g) => { g.character.money = Math.round(Number(e.target.value) || 0); })} />
          <button className="dev-btn" onClick={() => devMutate((g) => { g.character.money += 10000; })}>+1万</button>
          <button className="dev-btn" onClick={() => devMutate((g) => { g.character.money += 1000000; })}>+100万</button>
          <button className="dev-btn" onClick={() => devMutate((g) => { g.character.money = 0; })}>归零</button>
        </div>
        <div className="dev-row">
          <span className="dev-label">人脉</span>
          <input type="number" className="dev-num" min={0} value={c.connections}
            onChange={(e) => devMutate((g) => { g.character.connections = Math.max(0, Math.round(Number(e.target.value) || 0)); })} />
          <button className="dev-btn" onClick={() => devMutate((g) => { g.character.connections += 10; })}>+10</button>
          <button className="dev-btn" onClick={() => devMutate((g) => { g.character.connections = 0; })}>归零</button>
        </div>
      </div>

      <div className="dev-section">
        <div className="dev-heading">时间（瞬时结算被动变化，不写叙事）· 现在 {formatDate(game)}</div>
        <div className="dev-row">
          <button className="dev-btn" disabled={busy || game.ended} onClick={() => void devSkipTurns(1)}>+1回合</button>
          <button className="dev-btn" disabled={busy || game.ended} onClick={() => void devSkipToYear(game.world.year + 1)}>+1年</button>
          <button className="dev-btn" disabled={busy || game.ended} onClick={() => void devSkipToYear(game.world.year + 5)}>+5年</button>
          <button className="dev-btn" disabled={busy || game.ended} onClick={() => void devSkipToYear(game.world.year + 10)}>+10年</button>
        </div>
        <div className="dev-row">
          <span className="dev-label">跳到</span>
          <input type="number" className="dev-num" min={age + 1} max={120} value={targetAge}
            onChange={(e) => setTargetAge(Math.round(Number(e.target.value) || age))} />
          <span className="dev-unit">岁</span>
          <button className="dev-btn" disabled={busy || game.ended || targetAge <= age}
            onClick={() => void devSkipToYear(c.birthYear + targetAge)}>
            出发
          </button>
        </div>
      </div>

      <div className="dev-section" data-tick={logTick}>
        <div className="dev-heading dev-heading-row">
          <span>LLM 路由日志（哪类请求发给了哪个后端）</span>
          <span>
            <button className="dev-btn" onClick={() => setLogTick((t) => t + 1)}>刷新</button>
            <button className="dev-btn" onClick={() => { clearLlmCallLog(); setLogTick((t) => t + 1); }}>清空</button>
          </span>
        </div>
        {calls.length === 0 ? (
          <div className="dev-empty">还没有 LLM 请求：未配置后端，或本局全走离线兜底。控制台（F12）也会打印每条 [LLM路由] 记录。</div>
        ) : (
          calls.map((r, i) => (
            <div key={`${r.time}-${i}`}
              className={`dev-call${r.status === "error" ? " dev-call-err" : ""}${/NSFW|露骨/.test(r.purpose) ? " dev-call-nsfw" : ""}`}
              title={`${r.baseURL} · ${r.status === "ok" ? `${r.chars}字` : r.error}`}>
              <span className="dev-call-time">{new Date(r.time).toLocaleTimeString("zh-CN", { hour12: false })}</span>
              <span className="dev-call-purpose">{r.purpose}</span>
              <span className="dev-call-target">→ {r.profileName} · {r.model}</span>
              <span className="dev-call-stat">{r.status === "ok" ? `${r.ms}ms` : "❌"}</span>
            </div>
          ))
        )}
      </div>

      {game.ended && (
        <div className="dev-section">
          <button className="dev-btn dev-revive" onClick={() => devMutate((g) => {
            g.ended = false;
            g.character.alive = true;
            g.character.attrs.health = Math.max(50, g.character.attrs.health);
            g.character.deathCause = undefined;
            g.epitaph = undefined;
            g.pending = null;
          }, "【DEV】起死回生：生命被强行续上了。")}>⚡ 复活角色</button>
        </div>
      )}
    </div>
  );
}
