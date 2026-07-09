// 游戏主界面：叙事流 + 建议行动 + 文本输入 + 随波逐流 + 摆动条弹层。

import { useEffect, useMemo, useRef, useState } from "react";
import { suggestActions } from "../engine/suggest";
import { formatDate } from "../engine/types";
import { actionHint } from "../engine/turn";
import { useStore } from "../store/gameStore";
import { StatusPanel } from "./StatusPanel";
import { SwingBar } from "./SwingBar";

export function GameScreen() {
  const { game, phase, currentCheckIndex, submitTurn, reportSwing, doFastForward, setScreen, lastError } =
    useStore();
  const [input, setInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [game?.log.length, phase]);

  const suggestions = useMemo(
    () => (game && !game.ended ? suggestActions(game) : []),
    // 回合数变化时刷新建议
    [game, game?.turn, game?.ended],
  );

  if (!game) return null;

  const busy = phase !== "idle";
  const currentCheck =
    phase === "swinging" && game.pending ? game.pending.checks[currentCheckIndex] : null;

  const onSubmit = () => {
    const text = input.trim();
    if (!text || busy || game.ended) return;
    setInput("");
    void submitTurn(text);
  };

  const unitLabel = game.granularity === "week" ? "周" : game.granularity === "month" ? "月" : "年";

  return (
    <div className="game-screen">
      <StatusPanel game={game} />
      <main className="game-main">
        <header className="game-header">
          <span className="game-date">{formatDate(game)}</span>
          <div className="game-header-actions">
            {!game.ended && (
              <>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  title="不做任何主动选择，让人生沿着出身的轨迹自己滑行"
                  onClick={() => doFastForward(4)}
                >
                  🌊 随波逐流4{unitLabel}
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  title="不做任何主动选择，让人生沿着出身的轨迹自己滑行"
                  onClick={() => doFastForward(12)}
                >
                  🌊 随波逐流12{unitLabel}
                </button>
              </>
            )}
            <button className="btn-ghost" onClick={() => setScreen("settings")}>⚙ 设置</button>
            <button className="btn-ghost" onClick={() => setScreen("menu")}>☰ 菜单</button>
          </div>
        </header>

        <div className="game-log" ref={logRef}>
          {game.log.map((entry, i) => (
            <div key={i} className={`log-entry log-${entry.kind}`}>
              <div className="log-date">{entry.date}</div>
              <div className="log-text">{entry.text}</div>
            </div>
          ))}
          {phase === "parsing" && <div className="log-entry log-thinking">正在理解你的安排……</div>}
          {phase === "narrating" && <div className="log-entry log-thinking">命运的齿轮转动中……</div>}
          {lastError && <div className="log-entry log-error">{lastError}</div>}
        </div>

        {game.ended ? (
          <div className="game-ended">
            <div className="game-ended-epitaph">「{game.epitaph ?? "……"}」</div>
            <button className="btn-primary" onClick={() => setScreen("menu")}>
              回到主菜单
            </button>
          </div>
        ) : (
          <div className="game-input-area">
            {suggestions.length > 0 && (
              <div className="suggestion-row">
                <span className="suggestion-label">不知道做什么？试试：</span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    className="suggestion-chip"
                    disabled={busy}
                    onClick={() => void submitTurn(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="game-input"
              placeholder={actionHint(game)}
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              rows={2}
            />
            <button className="btn-primary game-submit" disabled={busy || !input.trim()} onClick={onSubmit}>
              {busy ? "…" : `度过这一${unitLabel}`}
            </button>
          </div>
        )}
      </main>

      {currentCheck && <SwingBar key={currentCheck.actionId} check={currentCheck} onStop={(o) => void reportSwing(o)} />}
    </div>
  );
}
