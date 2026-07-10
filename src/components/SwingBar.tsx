// 摆动条判定 2.0：指针正弦摆动，点击/空格停针。速度∝收益，最佳区宽度∝1/难度。
// 预备读速（摆满一个来回才能停）、指针残影、双层区宽（属性加成可视化）、
// 五档差异化演出、运气救场两拍、超时自动停针。
// 判定真值在引擎（onJudge → judgeSwing），本组件只负责表现。

import { useCallback, useEffect, useRef, useState } from "react";
import { SwingCheck, SwingVerdict, Tier, TIER_LABELS } from "../engine/types";
import { SWING_DIFFICULTY_LABELS } from "../llm/types";
import { useStore } from "../store/gameStore";

interface Props {
  check: SwingCheck;
  onJudge: (offset: number) => SwingVerdict | null; // 停针瞬间的引擎判定（含豁免掷点）
  onDone: () => void; // 演出结束，推进回合
}

const TIER_COLORS: Record<Tier, string> = {
  crit: "#f5c542",
  success: "#4caf7d",
  partial: "#5b8dd9",
  fail: "#d98f5b",
  fumble: "#d95b5b",
};
const BONUS_COLOR = "#ffe08a"; // 属性加成拓宽的部分

type Beat = "raw" | "save" | "settled"; // 两拍演出：大失败…→运气救场→定格

const WARMUP_MIN = 500;
const WARMUP_MAX = 1600;
const AUTO_STOP_MS = 12000; // 超时按当前位置自动停针
const COUNTDOWN_FROM_MS = 8000; // 第 8 秒起按钮显示倒计时
const RAW_MS = 700;
const SAVE_MS = 950;
const SETTLE_SAVED_MS = 850;
const SETTLE_CRIT_MS = 1500;
const SETTLE_MS = 1050;

export function SwingBar({ check, onJudge, onDone }: Props) {
  const swingDifficulty = useStore((s) => s.settings.swingDifficulty);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [stopped, setStopped] = useState<{ pos: number; verdict: SwingVerdict; beat: Beat } | null>(null);

  const posRef = useRef(0.5);
  const trailRef = useRef<{ t: number; pos: number }[]>([]);
  const pointerRef = useRef<HTMLDivElement>(null);
  const ghost1Ref = useRef<HTMLDivElement>(null);
  const ghost2Ref = useRef<HTMLDivElement>(null);
  const startRef = useRef(performance.now());
  const rafRef = useRef(0);
  const stoppedRef = useRef(false);
  const readyRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };

  // 指针动画 + 残影（残影取 35/70ms 前的位置，速度与方向一眼可读）
  useEffect(() => {
    stoppedRef.current = false;
    readyRef.current = false;
    setStopped(null);
    setReady(false);
    setCountdown(null);
    startRef.current = performance.now();
    trailRef.current = [];

    const animate = (now: number) => {
      if (stoppedRef.current) return;
      const t = (now - startRef.current) / 1000;
      const pos = (Math.sin(2 * Math.PI * check.speedHz * t - Math.PI / 2) + 1) / 2;
      posRef.current = pos;
      if (pointerRef.current) pointerRef.current.style.left = `${pos * 100}%`;
      const trail = trailRef.current;
      trail.push({ t: now, pos });
      while (trail.length > 0 && now - trail[0].t > 120) trail.shift();
      const at = (ago: number) => trail.find((s) => now - s.t <= ago)?.pos;
      const g1 = at(35);
      const g2 = at(70);
      if (ghost1Ref.current) ghost1Ref.current.style.left = `${(g1 ?? pos) * 100}%`;
      if (ghost2Ref.current) ghost2Ref.current.style.left = `${(g2 ?? pos) * 100}%`;
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    // 预备读速：摆满一个完整来回后才接受停针
    const warmup = Math.min(WARMUP_MAX, Math.max(WARMUP_MIN, 1000 / check.speedHz));
    later(() => {
      readyRef.current = true;
      setReady(true);
    }, warmup);

    // 超时自动停针 + 倒计时（发呆不该永远等待，自动停等价于当下按下去）
    const liveStart = performance.now() + warmup;
    const ticker = window.setInterval(() => {
      if (stoppedRef.current) return;
      const elapsed = performance.now() - liveStart;
      if (elapsed >= AUTO_STOP_MS) {
        stop();
      } else if (elapsed >= COUNTDOWN_FROM_MS) {
        setCountdown(Math.ceil((AUTO_STOP_MS - elapsed) / 1000));
      }
    }, 250);
    timersRef.current.push(ticker as unknown as number);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearInterval(ticker);
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  const stop = useCallback(() => {
    if (stoppedRef.current || !readyRef.current) return;
    stoppedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    const pos = posRef.current;
    const verdict = onJudge(Math.abs(pos - 0.5));
    if (!verdict) return;
    setCountdown(null);

    if (verdict.saved) {
      // 两拍：先亮「大失败…！」，再金光救场，最后按降档结果定格
      setStopped({ pos, verdict, beat: "raw" });
      later(() => setStopped({ pos, verdict, beat: "save" }), RAW_MS);
      later(() => setStopped({ pos, verdict, beat: "settled" }), RAW_MS + SAVE_MS);
      later(onDone, RAW_MS + SAVE_MS + SETTLE_SAVED_MS);
    } else {
      setStopped({ pos, verdict, beat: "settled" });
      later(onDone, verdict.tier === "crit" ? SETTLE_CRIT_MS : SETTLE_MS);
    }
  }, [check, onJudge, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  // ---------- 轨道渐变：双层区宽（基础区 + 属性加成亮层） ----------
  const z = check.zones;
  const core = Math.min(check.baseBest, z.best); // 大成功区核心（属性 50 的宽度）
  const hasBonus = z.best > check.baseBest + 0.002;
  const stops = [
    { c: TIER_COLORS.fumble, to: 0.5 - z.fail },
    { c: TIER_COLORS.fail, to: 0.5 - z.partial },
    { c: TIER_COLORS.partial, to: 0.5 - z.success },
    { c: TIER_COLORS.success, to: 0.5 - z.best },
    ...(hasBonus ? [{ c: BONUS_COLOR, to: 0.5 - core }] : []),
    { c: TIER_COLORS.crit, to: 0.5 + core },
    ...(hasBonus ? [{ c: BONUS_COLOR, to: 0.5 + z.best }] : []),
    { c: TIER_COLORS.success, to: 0.5 + z.success },
    { c: TIER_COLORS.partial, to: 0.5 + z.partial },
    { c: TIER_COLORS.fail, to: 0.5 + z.fail },
    { c: TIER_COLORS.fumble, to: 1 },
  ];
  let acc = 0;
  const gradient = stops
    .map((s) => {
      const seg = `${s.c} ${(acc * 100).toFixed(1)}%, ${s.c} ${(s.to * 100).toFixed(1)}%`;
      acc = s.to;
      return seg;
    })
    .join(", ");

  // 属性加成文案（引擎已算好百分比，这里只排版）
  const attrLine =
    check.attrName && (check.attrZonePct !== 0 || check.attrSpeedPct !== 0)
      ? check.attrZonePct >= 0
        ? `${check.attrName}加成：大成功区 +${check.attrZonePct}%${check.attrSpeedPct !== 0 ? `，摆速 ${check.attrSpeedPct}%` : ""}`
        : `${check.attrName}不足：大成功区 ${check.attrZonePct}%`
      : null;

  // ---------- 演出状态 → 样式修饰符 ----------
  const beat = stopped?.beat;
  const displayTier: Tier | null = stopped
    ? beat === "raw"
      ? "fumble"
      : stopped.verdict.tier
    : null;
  const panelMod = !stopped
    ? ""
    : beat === "raw"
      ? " swing-hit-fumble"
      : beat === "save"
        ? " swing-hit-save"
        : ` swing-hit-${stopped.verdict.tier}`;

  const resultText = !stopped
    ? null
    : beat === "raw"
      ? "大失败…！"
      : beat === "save"
        ? "🍀 运气救场！"
        : stopped.verdict.saved
          ? "失败（有惊无险）"
          : `${TIER_LABELS[stopped.verdict.tier]}！`;
  const resultColor =
    beat === "save" ? TIER_COLORS.crit : displayTier ? TIER_COLORS[displayTier] : undefined;

  const buttonText = !ready ? "预备…" : countdown !== null ? `停！（${countdown}）` : "停！（空格）";

  return (
    <div className="swing-overlay" onClick={stop}>
      <div className={`swing-panel${panelMod}`} onClick={(e) => e.stopPropagation()}>
        <div className="swing-title">⚡ {check.label}</div>
        <div className="swing-meta">
          难度 {check.difficulty} ｜ 回报 {"★".repeat(check.reward)}{" "}
          <span className="swing-speed">摆速 {check.speedHz.toFixed(1)}x</span>
          <span className="swing-diff" title="可在设置中调整判定难度">
            {SWING_DIFFICULTY_LABELS[swingDifficulty]?.label ?? "标准"}手感
          </span>
        </div>
        {attrLine && (
          <div className={`swing-attr${check.attrZonePct >= 0 ? "" : " swing-attr-low"}`}>{attrLine}</div>
        )}
        <div
          className={`swing-track${stopped ? " swing-track-stopped" : ""}`}
          style={{ background: `linear-gradient(to right, ${gradient})` }}
          onClick={stop}
        >
          {hasBonus && !stopped && (
            <>
              <div
                className="swing-bonus"
                style={{ left: `${(0.5 - z.best) * 100}%`, width: `${(z.best - core) * 100}%` }}
              />
              <div
                className="swing-bonus"
                style={{ left: `${(0.5 + core) * 100}%`, width: `${(z.best - core) * 100}%` }}
              />
            </>
          )}
          {!stopped && <div ref={ghost2Ref} className="swing-ghost swing-ghost-2" />}
          {!stopped && <div ref={ghost1Ref} className="swing-ghost swing-ghost-1" />}
          <div
            ref={pointerRef}
            className={
              `swing-pointer${!ready && !stopped ? " swing-pointer-warmup" : ""}` +
              `${check.speedHz > 1.6 && !stopped ? " swing-pointer-fast" : ""}` +
              `${stopped ? " swing-pointer-hit" : ""}`
            }
            style={stopped ? { left: `${stopped.pos * 100}%` } : undefined}
          />
          {(beat === "save" || (beat === "settled" && stopped?.verdict.tier === "crit" && !stopped.verdict.saved)) && (
            <div className="swing-sweep" />
          )}
        </div>
        {resultText ? (
          <div
            className={`swing-result${beat === "settled" && displayTier === "crit" ? " swing-result-bounce" : ""}${beat === "save" ? " swing-result-bounce" : ""}`}
            style={{ color: resultColor }}
          >
            {resultText}
          </div>
        ) : (
          <button className={`swing-button${!ready ? " swing-button-warmup" : ""}`} onClick={stop}>
            {buttonText}
          </button>
        )}
      </div>
    </div>
  );
}
