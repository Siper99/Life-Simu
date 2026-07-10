// 结算浮字：本回合数值变化在人物旁依次浮出（绿升红降，技能升级金色）。
// 数据由 gameStore 在 finishTurn 时摊平好，这里只负责表现与自动消隐。

import { useEffect, useState } from "react";
import { useStore } from "../store/gameStore";

export function FloatingDeltas() {
  const floats = useStore((s) => s.floats);
  const [activeSeq, setActiveSeq] = useState(0);

  useEffect(() => {
    if (!floats || floats.chips.length === 0) return;
    setActiveSeq(floats.seq);
    // 全部弹完（150ms 间隔）+ 单条动画时长后卸载
    const ttl = floats.chips.length * 150 + 2000;
    const t = setTimeout(() => setActiveSeq(0), ttl);
    return () => clearTimeout(t);
  }, [floats]);

  if (!floats || activeSeq !== floats.seq) return null;
  return (
    <div className="float-deltas" aria-hidden="true">
      {floats.chips.map((c, i) => (
        <span
          key={`${floats.seq}-${i}`}
          className={`float-chip float-${c.kind}`}
          style={{ animationDelay: `${(i * 0.15).toFixed(2)}s` }}
        >
          {c.text}
        </span>
      ))}
    </div>
  );
}
