// 游戏主界面：持续运转的世界、叙事记录与有限资源决策板。

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../engine/types";
import { mergedBoard, useStore } from "../store/gameStore";
import { StatusPanel } from "./StatusPanel";
import { SwingBar } from "./SwingBar";

const CATEGORY_NAMES = {
  study: "学习", work: "事业", social: "关系", romance: "情感", exercise: "运动",
  leisure: "休闲", adventure: "冒险", finance: "财富", health: "健康", other: "选择",
} as const;

export function GameScreen() {
  const { game, phase, currentCheckIndex, submitTurn, submitChoices, reportSwing,
    doFastForward, setScreen, lastError, llmChoices } = useStore();
  const [input, setInput] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
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
  const unitLabel = game.granularity === "week" ? "周" : game.granularity === "month" ? "月" : "年";
  const selectedChoices = board?.choices.filter((choice) => selectedIds.includes(choice.id)) ?? [];
  const timeUsed = selectedChoices.reduce((sum, choice) => sum + choice.timeCost, 0);
  const energyUsed = selectedChoices.reduce((sum, choice) => sum + Math.max(0, choice.energyCost), 0);

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
      setSelectionMessage("你的精力撑不住这些安排，先留时间休息吧。");
      return;
    }
    setSelectedIds([...selectedIds, id]);
    setSelectionMessage(null);
  };

  return (
    <div className="game-screen">
      <StatusPanel game={game} />
      <main className="game-main">
        <header className="game-header">
          <span className="game-date">{formatDate(game)}</span>
          <div className="game-header-actions">
            {!game.ended && <button className="btn-ghost" disabled={busy}
              title="不做主动选择，但世界仍会继续运转" onClick={() => doFastForward(1)}>
              跳过这一{unitLabel}
            </button>}
            <button className="btn-ghost" onClick={() => setScreen("settings")}>⚙ 设置</button>
            <button className="btn-ghost" onClick={() => setScreen("menu")}>☰ 菜单</button>
          </div>
        </header>

        {board && <section className="world-pulse">
          <div className="world-pulse-mark">WORLD · {board.world.trend}</div>
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

      {!game.ended && board && <aside className="decision-panel">
        <div className="decision-head">
          <div><span className="decision-kicker">DECISION BOARD</span><h2>这一{unitLabel}怎么过？</h2></div>
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
            return <button key={choice.id} type="button"
              className={`decision-card kind-${choice.kind}${selected ? " selected" : ""}`}
              disabled={busy} onClick={() => toggleChoice(choice.id)}>
              <div className="decision-card-top">
                <span className="choice-category">{choice.categoryLabel}</span>
                {choice.expiresIn && <span className="choice-expiry">仅剩 {choice.expiresIn} 回合</span>}
                {choice.kind === "director" && <span className="choice-director">导演介入</span>}
                {choice.kind === "llm" && <span className="choice-llm">✨ 灵感</span>}
                <span className="choice-selected">{selected ? "✓ 已安排" : "+ 安排"}</span>
              </div>
              <strong>{choice.title}</strong><p>{choice.description}</p>
              <div className="choice-costs"><span>时间 {choice.timeCost} 格</span>
                <span className={choice.energyCost < 0 ? "energy-gain" : ""}>
                  精力 {choice.energyCost > 0 ? `-${choice.energyCost}` : `+${Math.abs(choice.energyCost)}`}
                </span>
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
            <span>时间 {timeUsed}/{board.timeBudget} · 精力 {energyUsed}/{game.character.energy}</span></div>
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
              placeholder="描述一件选项里没有的事。自由输入是补充入口，不受三格时间保护。"
              onChange={(event) => setInput(event.target.value)} />
            <button className="btn-ghost" disabled={busy || !input.trim()} onClick={onSubmit}>执行自定义行动</button>
          </div>}
        </div>
      </aside>}

      {currentCheck && <SwingBar key={currentCheck.actionId} check={currentCheck}
        onStop={(offset) => void reportSwing(offset)} />}
    </div>
  );
}
