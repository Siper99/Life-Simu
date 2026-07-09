// 摆动条判定：指针正弦摆动，点击/空格停针。速度∝收益，最佳区宽度∝1/难度。

import { useCallback, useEffect, useRef, useState } from "react";
import { SwingCheck, Tier, TIER_LABELS } from "../engine/types";
import { tierFromOffset } from "../engine/resolver";

interface Props {
  check: SwingCheck;
  onStop: (offset: number) => void;
}

const TIER_COLORS: Record<Tier, string> = {
  crit: "#f5c542",
  success: "#4caf7d",
  partial: "#5b8dd9",
  fail: "#d98f5b",
  fumble: "#d95b5b",
};

export function SwingBar({ check, onStop }: Props) {
  const [stopped, setStopped] = useState<{ pos: number; tier: Tier } | null>(null);
  const posRef = useRef(0.5);
  const pointerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(performance.now());
  const rafRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    setStopped(null);
    startRef.current = performance.now();
    const animate = (now: number) => {
      if (stoppedRef.current) return;
      const t = (now - startRef.current) / 1000;
      const pos = (Math.sin(2 * Math.PI * check.speedHz * t - Math.PI / 2) + 1) / 2;
      posRef.current = pos;
      if (pointerRef.current) {
        pointerRef.current.style.left = `${pos * 100}%`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [check]);

  const stop = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    const pos = posRef.current;
    const offset = Math.abs(pos - 0.5);
    const tier = tierFromOffset(offset, check.zones);
    setStopped({ pos, tier });
    setTimeout(() => onStop(offset), 900);
  }, [check, onStop]);

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

  const z = check.zones;
  // 从中心向外的分段（半宽），转为 CSS 渐变的百分比刻度
  const stops = [
    { c: TIER_COLORS.fumble, to: 0.5 - z.fail },
    { c: TIER_COLORS.fail, to: 0.5 - z.partial },
    { c: TIER_COLORS.partial, to: 0.5 - z.success },
    { c: TIER_COLORS.success, to: 0.5 - z.best },
    { c: TIER_COLORS.crit, to: 0.5 + z.best },
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

  return (
    <div className="swing-overlay" onClick={stop}>
      <div className="swing-panel" onClick={(e) => e.stopPropagation()}>
        <div className="swing-title">⚡ {check.label}</div>
        <div className="swing-meta">
          难度 {check.difficulty} ｜ 回报 {"★".repeat(check.reward)}{" "}
          <span className="swing-speed">摆速 {check.speedHz.toFixed(1)}x</span>
        </div>
        <div
          className={`swing-track${stopped ? " swing-track-stopped" : ""}`}
          style={{ background: `linear-gradient(to right, ${gradient})` }}
          onClick={stop}
        >
          <div
            ref={pointerRef}
            className={`swing-pointer${check.speedHz > 1.6 && !stopped ? " swing-pointer-fast" : ""}`}
            style={stopped ? { left: `${stopped.pos * 100}%` } : undefined}
          />
        </div>
        {stopped ? (
          <div className="swing-result" style={{ color: TIER_COLORS[stopped.tier] }}>
            {TIER_LABELS[stopped.tier]}！
          </div>
        ) : (
          <button className="swing-button" onClick={stop}>
            停！（空格）
          </button>
        )}
      </div>
    </div>
  );
}
