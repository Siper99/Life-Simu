// 游戏主界面：持续运转的世界、叙事记录与有限资源决策板。

import { useEffect, useMemo, useRef, useState } from "react";
import { connectionsBoost } from "../engine/economy";
import { SCENE_BEAT_ENERGY, SCENE_MAX_BEATS } from "../engine/scene";
import { energyIntensityLabel, formatDate } from "../engine/types";
import { profileForRole } from "../llm/types";
import { mergedBoard, useStore } from "../store/gameStore";
import { DevPanel } from "./DevPanel";
import { StatusPanel } from "./StatusPanel";
import { SwingBar } from "./SwingBar";

const CATEGORY_NAMES = {
  study: "学习", work: "事业", social: "关系", romance: "情感", exercise: "运动",
  leisure: "休闲", adventure: "冒险", finance: "财富", health: "健康", other: "选择",
} as const;

const CATEGORY_EMOJI: Record<string, string> = {
  study: "📚", work: "💼", social: "🤝", romance: "💞", exercise: "🏃",
  leisure: "🎈", adventure: "🧭", finance: "💰", health: "🩺", other: "✨",
};

export function GameScreen() {
  const { game, phase, currentCheckIndex, submitTurn, submitChoices, judgeSwing, confirmSwing,
    doFastForward, setScreen, lastError, llmChoices, backing, setBacking, devOpen, toggleDev,
    enterScene, sceneBeat, exitScene, settings } = useStore();
  const [input, setInput] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [sceneTarget, setSceneTarget] = useState("");
  const [sceneNsfw, setSceneNsfw] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipIdx, setSkipIdx] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [game?.log.length, phase]);

  useEffect(() => {
    setSelectedIds([]);
    setSelectionMessage(null);
  }, [game?.turn]);

  const board = useMemo(
    () => (game && !game.ended ? mergedBoard(game, llmChoices) : null),
    [game, game?.turn, game?.ended, llmChoices],
  );
  const llmLoading = Boolean(
    llmChoices?.loading && game && llmChoices.gameId === game.id && llmChoices.turn === game.turn,
  );
  if (!game) return null;

  const busy = phase !== "idle";
  const currentCheck = phase === "swinging" && game.pending
    ? game.pending.checks[currentCheckIndex] : null;
  const unitLabel = game.granularity === "season" ? "季" : game.granularity === "week" ? "周" : game.granularity === "month" ? "月" : "年";
  // 默认成长节奏改为季度：一年只需四次关键选择，仍可继续快进。
  const skipOptions =
    game.granularity === "season"
      ? [{ turns: 1, label: "1季" }, { turns: 2, label: "半年" }, { turns: 4, label: "1年" }, { turns: 8, label: "2年" }]
      : game.granularity === "week"
        ? [{ turns: 1, label: "1周" }, { turns: 4, label: "1个月" }, { turns: 13, label: "1季" }, { turns: 26, label: "半年" }, { turns: 52, label: "1年" }]
        : game.granularity === "month"
          ? [{ turns: 1, label: "1个月" }, { turns: 3, label: "1季" }, { turns: 6, label: "半年" }, { turns: 12, label: "1年" }]
          : [{ turns: 1, label: "1年" }, { turns: 2, label: "2年" }, { turns: 3, label: "3年" }];
  const skipPick = skipOptions[Math.min(skipIdx, skipOptions.length - 1)];
  const selectedChoices = board?.choices.filter((choice) => selectedIds.includes(choice.id)) ?? [];
  const timeUsed = selectedChoices.reduce((sum, choice) => sum + choice.timeCost, 0);
  const energyUsed = selectedChoices.reduce((sum, choice) => sum + Math.max(0, choice.energyCost), 0);
  const moneyUsed = selectedChoices.reduce((sum, choice) => sum + (choice.moneyCost ?? 0), 0);
  // 人脉护航：选中的安排里有高危行动、且人脉攒够 5 点时才亮出开关
  const boost = connectionsBoost(game);
  const backingAvailable = Boolean(boost) && selectedChoices.some((choice) => choice.intent.risk === "high");
  // 成人场景开关：露骨分级 + 配置了 nsfw 后端才出现
  const nsfwSceneAvailable = settings.contentRating === "explicit" && Boolean(profileForRole(settings, "nsfw"));
  const sceneNpcs = game.character.npcs.filter((n) => n.alive && n.birthYear <= game.world.year);

  const onSubmit = () => {
    const text = input.trim();
    if (!text || busy || game.ended) return;
    setInput("");
    void submitTurn(text);
  };

  const toggleChoice = (id: string) => {
    if (!board || busy) return;
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((selectedId) => selectedId !== id));
      setSelectionMessage(null);
      return;
    }
    const choice = board.choices.find((item) => item.id === id);
    if (!choice) return;
    if (timeUsed + choice.timeCost > board.timeBudget) {
      setSelectionMessage("时间已经排满了。想选这件事，得先放弃另一件。");
      return;
    }
    if (energyUsed + Math.max(0, choice.energyCost) > game.character.energy) {
      setSelectionMessage("当前精力不足。高强度行动必须先休整一季，或放弃另一项安排。");
      return;
    }
    setSelectedIds([...selectedIds, id]);
    setSelectionMessage(null);
  };

  return (
    <div className="game-screen">
      <StatusPanel game={game} />
      {devOpen && <DevPanel game={game} />}
      <main className="game-main">
        <header className="game-header">
          <span className="game-date">{formatDate(game)}</span>
          <div className="game-header-actions">
            {!game.ended && <div className="skip-wrap">
              <button className="btn-ghost" disabled={busy}
                title="不做主动选择，让一段时光自然流逝" onClick={() => setSkipOpen(!skipOpen)}>
                ⏭ 跳过时间
              </button>
              {skipOpen && <div className="skip-panel">
                <input
                  type="range"
                  className="skip-range"
                  min={0}
                  max={skipOptions.length - 1}
                  step={1}
                  value={Math.min(skipIdx, skipOptions.length - 1)}
                  onChange={(e) => setSkipIdx(Number(e.target.value))}
                />
                <div className="skip-marks">
                  {skipOptions.map((o, i) => (
                    <span key={o.label} className={i === skipIdx ? "active" : ""}>{o.label}</span>
                  ))}
                </div>
                <button className="btn-primary skip-go" disabled={busy}
                  onClick={() => { setSkipOpen(false); void doFastForward(skipPick.turns, skipPick.label); }}>
                  随波逐流 {skipPick.label}
                </button>
              </div>}
            </div>}
            <button className={`btn-ghost${devOpen ? " dev-active" : ""}`} title="开发者模式" onClick={toggleDev}>🛠</button>
            <button className="btn-ghost" onClick={() => setScreen("settings")}>⚙ 设置</button>
            <button className="btn-ghost" onClick={() => setScreen("menu")}>☰ 菜单</button>
          </div>
        </header>

        {board && <section className={`world-pulse${board.world.major ? " world-pulse-major" : ""}`}>
          <div className="world-pulse-mark">{board.world.major ? "⚑ 大事件" : "WORLD"} · {board.world.trend}</div>
          <div><strong>{board.world.title}</strong><p>{board.world.summary}</p></div>
          <span>利好 {board.world.boosted.map((category) => CATEGORY_NAMES[category]).join(" · ")}</span>
        </section>}

        <div className="game-log" ref={logRef}>
          {game.log.map((entry, index) => <div key={index} className={`log-entry log-${entry.kind}`}>
            <div className="log-date">{entry.date}</div><div className="log-text">{entry.text}</div>
          </div>)}
          {phase === "parsing" && <div className="log-entry log-thinking">正在结算你的安排……</div>}
          {phase === "narrating" && <div className="log-entry log-thinking">命运的齿轮转动中……</div>}
          {lastError && <div className="log-entry log-error">{lastError}</div>}
        </div>

        {game.ended && <div className="game-ended">
          <div className="game-ended-epitaph">「{game.epitaph ?? "……"}」</div>
          <button className="btn-primary" onClick={() => setScreen("menu")}>回到主菜单</button>
        </div>}
      </main>

      {!game.ended && game.scene && <aside className="decision-panel scene-panel">
        <div className="decision-head">
          <div>
            <span className="decision-kicker">SCENE MODE{game.scene.nsfw ? " · 🔞" : ""}</span>
            <h2>🎬 {game.scene.target ? `与${game.scene.target}的场景` : "拉近的镜头"}</h2>
          </div>
        </div>
        <p className="scene-hint">
          时间已冻结，剧情逐拍显示在左侧记录里。第 {Math.min(game.scene.beats.length + 1, SCENE_MAX_BEATS)}/{SCENE_MAX_BEATS} 拍 ·
          每拍 -{SCENE_BEAT_ENERGY} 精力（当前 {game.character.energy}）· 收场时结算好感与心境。
        </p>
        <textarea className="game-input" rows={4} value={input} disabled={busy}
          placeholder={`对${game.scene.target ?? "此刻"}说点什么，或描述你的动作……一拍换一拍。`}
          onChange={(event) => setInput(event.target.value)} />
        <button className="btn-primary scene-beat-btn" disabled={busy || !input.trim()}
          onClick={() => { const t = input.trim(); setInput(""); void sceneBeat(t); }}>
          {busy ? "场景推进中…" : "▶ 推进这一拍"}
        </button>
        <button className="btn-ghost scene-exit-btn" disabled={busy} onClick={() => void exitScene()}>
          🎬 收场，回到人生节奏
        </button>
        {lastError && <p className="decision-error">{lastError}</p>}
      </aside>}

      {!game.ended && !game.scene && board && <aside className="decision-panel">
        <div className="decision-head">
          <div><span className="decision-kicker">DECISION BOARD</span><h2>{board.headline}</h2></div>
          <div className="time-budget" aria-label={`${board.timeLabel}已使用 ${timeUsed} 格，共 ${board.timeBudget} 格`}>
            {Array.from({ length: board.timeBudget }, (_, index) =>
              <span key={index} className={index < timeUsed ? "used" : ""} />)}
          </div>
        </div>

        <div className={`director-read director-${board.director.intensity}`}>
          <span>导演 · {board.director.intensity}</span><p>{board.director.message}</p>
        </div>

        <div className="choice-list">
          {board.choices.map((choice) => {
            const selected = selectedIds.includes(choice.id);
            const unaffordable = !selected && energyUsed + Math.max(0, choice.energyCost) > game.character.energy;
            return <button key={choice.id} type="button"
              className={`decision-card kind-${choice.kind}${selected ? " selected" : ""}${unaffordable ? " energy-unaffordable" : ""}`}
              disabled={busy} onClick={() => toggleChoice(choice.id)}>
              <div className="decision-card-top">
                <span className="choice-category" data-cat={choice.intent.category}>
                  {CATEGORY_EMOJI[choice.intent.category]} {choice.categoryLabel}
                </span>
                {choice.expiresIn && <span className="choice-expiry">仅剩 {choice.expiresIn} 回合</span>}
                {choice.kind === "director" && <span className="choice-director">导演介入</span>}
                {choice.kind === "context" && <span className="choice-context">🎯 此刻</span>}
                {choice.kind === "llm" && <span className="choice-llm">✨ 灵感</span>}
                {choice.kind === "intense" && <span className="choice-intense">🔥 极限投入</span>}
                <span className="choice-selected">{selected ? "✓ 已安排" : "+ 安排"}</span>
              </div>
              <strong>{choice.title}</strong><p>{choice.description}</p>
              <div className="choice-costs"><span>时间 {choice.timeCost} 格</span>
                <span className={choice.energyCost < 0 ? "energy-gain" : choice.energyCost >= 50 ? "energy-heavy" : ""}>
                  精力 {choice.energyCost > 0 ? `-${choice.energyCost}` : `+${Math.abs(choice.energyCost)}`}
                </span>
                <span className={`energy-intensity intensity-${choice.energyCost >= 50 ? "extreme" : choice.energyCost >= 35 ? "high" : "normal"}`}>
                  {energyIntensityLabel(choice.energyCost)}
                </span>
                {choice.moneyCost ? <span className="money-cost">💰 -{choice.moneyCost.toLocaleString()}</span> : null}
                {choice.intent.risk === "high" && <span className="risk-high">高风险</span>}
              </div>
              <div className="choice-consequences">
                {choice.consequences.map((item) => <span key={item}>{item}</span>)}
              </div>
            </button>;
          })}
          {llmLoading && <div className="llm-loading">✨ 编剧正在为你补充专属选项…</div>}
        </div>

        <div className="decision-footer">
          <div className="decision-summary"><span>{selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : "还没有安排"}</span>
            <span>时间 {timeUsed}/{board.timeBudget} · 精力 {energyUsed}/{game.character.energy}{moneyUsed > 0 ? ` · 花费 ${moneyUsed.toLocaleString()}` : ""}</span></div>
          {backingAvailable && boost && (
            <label className={`backing-toggle${backing ? " active" : ""}`}>
              <input type="checkbox" checked={backing} disabled={busy}
                onChange={(e) => setBacking(e.target.checked)} />
              🤝 动用人脉护航：花 {boost.cost} 点人脉，本回合高危判定难度 -{boost.ease}
            </label>
          )}
          {(selectionMessage || lastError) && <p className="decision-error">{selectionMessage ?? lastError}</p>}
          <button className="btn-primary decision-confirm" disabled={busy || selectedIds.length === 0}
            onClick={() => void submitChoices(selectedIds)}>
            {busy ? "世界正在推进…" : `确认安排，度过这一${unitLabel}`}
          </button>
          <button className="custom-toggle" type="button" onClick={() => setCustomOpen(!customOpen)}>
            {customOpen ? "收起自定义行动" : "这些都不想做？自定义行动"}
          </button>
          {customOpen && <div className="custom-action">
            <textarea className="game-input" value={input} disabled={busy} rows={3}
              placeholder="描述一件选项里没有的事。自由行动仍会消耗精力，强行透支会降低收益并伤害健康。"
              onChange={(event) => setInput(event.target.value)} />
            <button className="btn-ghost" disabled={busy || !input.trim()} onClick={onSubmit}>执行自定义行动</button>
          </div>}
          <button className="custom-toggle" type="button" onClick={() => setSceneOpen(!sceneOpen)}>
            {sceneOpen ? "收起场景模式" : "🎬 场景模式：把镜头拉近，连续深入一段剧情"}
          </button>
          {sceneOpen && <div className="scene-config">
            <div className="scene-config-row">
              <select className="input" value={sceneTarget} onChange={(e) => setSceneTarget(e.target.value)}>
                <option value="">无特定对象</option>
                {sceneNpcs.map((n) => (
                  <option key={n.id} value={n.name}>{n.name}（{n.relation}）</option>
                ))}
              </select>
              <button className="btn-ghost" disabled={busy}
                onClick={() => { setSceneOpen(false); enterScene(sceneTarget || null, sceneNsfw); }}>
                开始场景
              </button>
            </div>
            {nsfwSceneAvailable && (
              <label className="role-check scene-nsfw-check">
                <input type="checkbox" checked={sceneNsfw} onChange={(e) => setSceneNsfw(e.target.checked)} />
                🔞 成人场景：全程走 NSFW 后端，记忆只留含蓄替身
              </label>
            )}
            <p className="scene-config-hint">
              时间不会流逝：一拍你的台词/动作，一拍剧情回应，上下文逐拍连贯。每拍 {SCENE_BEAT_ENERGY} 精力，最多 {SCENE_MAX_BEATS} 拍。
            </p>
          </div>}
        </div>
      </aside>}

      {currentCheck && <SwingBar key={currentCheck.actionId} check={currentCheck}
        onJudge={judgeSwing} onDone={() => void confirmSwing()} />}
    </div>
  );
}
