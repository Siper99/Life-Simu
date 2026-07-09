// 游戏主界面：叙事流 + 文本输入 + 快进 + 摆动条弹层。

import { useEffect, useRef, useState } from "react";
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
                <button className="btn-ghost" disabled={busy} onClick={() => doFastForward(4)}>
                  ⏩ 快进4{unitLabel}
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => doFastForward(12)}>
                  ⏩⏩ 快进12{unitLabel}
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
