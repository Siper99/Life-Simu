import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import { newGameState, rollGenesis, applyTalent, TALENT_POOL } from "./genesis";
import { buildSwingCheck, tierFromOffset, autoTier, fallbackParseIntents, applyDeltas } from "./resolver";
import { pickEvent, EVENT_TABLE } from "./events";
import { beginTurn, finalizeTurn, fastForward } from "./turn";
import { emptyDeltas, lifeStageOf, granularityOf } from "./types";

describe("Rng", () => {
  it("同种子序列可复现", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });

  it("状态可保存恢复", () => {
    const a = new Rng(7);
    a.next();
    const resumed = Rng.fromState(a.getState());
    const cont = a.next();
    expect(resumed.next()).toBe(cont);
  });
});

describe("开局生成", () => {
  it("属性在合法范围内且给出三个天赋候选", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const roll = rollGenesis(new Rng(seed));
      for (const v of Object.values(roll.character.attrs)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(roll.talentChoices).toHaveLength(3);
      expect(roll.character.npcs.length).toBeGreaterThanOrEqual(2); // 至少有父母
    }
  });

  it("天赋应用会修改属性并封顶", () => {
    const { state } = newGameState(1);
    const talent = TALENT_POOL.find((t) => t.id === "genius")!;
    const before = state.character.attrs.intelligence;
    applyTalent(state.character, talent);
    expect(state.character.attrs.intelligence).toBe(Math.min(100, before + 15));
    expect(state.character.talents).toContain(talent);
  });
});

describe("摆动条判定", () => {
  it("落点距中心越近档位越好", () => {
    const check = buildSwingCheck("a", "test", 50, 3, 50);
    expect(tierFromOffset(0, check.zones)).toBe("crit");
    expect(tierFromOffset(check.zones.best + 0.01, check.zones)).toBe("success");
    expect(tierFromOffset(check.zones.success + 0.01, check.zones)).toBe("partial");
    expect(tierFromOffset(check.zones.partial + 0.01, check.zones)).toBe("fail");
    expect(tierFromOffset(0.49, check.zones)).toBe("fumble");
  });

  it("收益越高摆速越快", () => {
    const slow = buildSwingCheck("a", "t", 50, 1, 50);
    const fast = buildSwingCheck("b", "t", 50, 5, 50);
    expect(fast.speedHz).toBeGreaterThan(slow.speedHz);
  });

  it("难度越高最佳区越窄", () => {
    const easy = buildSwingCheck("a", "t", 10, 3, 50);
    const hard = buildSwingCheck("b", "t", 90, 3, 50);
    expect(hard.zones.best).toBeLessThan(easy.zones.best);
  });

  it("属性高会减速并加宽最佳区", () => {
    const weak = buildSwingCheck("a", "t", 60, 4, 30);
    const strong = buildSwingCheck("b", "t", 60, 4, 95);
    expect(strong.speedHz).toBeLessThan(weak.speedHz);
    expect(strong.zones.best).toBeGreaterThan(weak.zones.best);
  });

  it("自动判定：属性高更容易成功", () => {
    const rng = new Rng(99);
    let strongWins = 0;
    let weakWins = 0;
    for (let i = 0; i < 500; i++) {
      const t1 = autoTier(rng, 50, 90);
      const t2 = autoTier(rng, 50, 20);
      if (t1 === "crit" || t1 === "success") strongWins++;
      if (t2 === "crit" || t2 === "success") weakWins++;
    }
    expect(strongWins).toBeGreaterThan(weakWins);
  });
});

describe("事件系统", () => {
  it("抽取的事件符合当前人生阶段", () => {
    const { state } = newGameState(3);
    // 推到少年期
    state.world.year = state.character.birthYear + 15;
    const rng = new Rng(5);
    for (let i = 0; i < 30; i++) {
      const ev = pickEvent(rng, state);
      expect(ev).not.toBeNull();
      expect(ev!.stages).toContain("少年");
    }
  });

  it("事件表覆盖所有人生阶段", () => {
    for (const stage of ["婴儿", "童年", "少年", "青年", "中年", "老年"] as const) {
      expect(EVENT_TABLE.some((e) => e.stages.includes(stage))).toBe(true);
    }
  });
});

describe("回合流程", () => {
  it("兜底意图解析能拆分多个行动并识别高风险", () => {
    const intents = fallbackParseIntents("认真学习，周末去表白");
    expect(intents).toHaveLength(2);
    expect(intents[0].category).toBe("study");
    expect(intents[1].risk).toBe("high");
  });

  it("完整回合：begin → 摆动结果 → finalize 推进时间", () => {
    const { state } = newGameState(8);
    state.world.year = state.character.birthYear + 20; // 成年
    state.granularity = "week";
    const weekBefore = state.world.week;
    const intents = fallbackParseIntents("努力工作，去赌一把");
    const pending = beginTurn(state, "努力工作，去赌一把", intents);
    for (const check of pending.checks) {
      pending.checkResults.push({ checkId: check.actionId, tier: "success", offset: 0.1 });
    }
    const outcome = finalizeTurn(state, pending);
    expect(outcome.actions).toHaveLength(2);
    expect(state.turn).toBe(1);
    expect(state.world.week === weekBefore + 1 || state.world.week === 1).toBe(true);
  });

  it("快进推进多个回合且能自然结算", () => {
    const { state } = newGameState(12);
    state.granularity = "week";
    const turnBefore = state.turn;
    fastForward(state, 10);
    expect(state.turn).toBe(turnBefore + 10);
  });

  it("健康归零死亡", () => {
    const { state } = newGameState(15);
    state.granularity = "week";
    state.character.attrs.health = 0;
    const pending = beginTurn(state, "躺着", fallbackParseIntents("躺着"));
    const outcome = finalizeTurn(state, pending);
    expect(outcome.died).toBe(true);
    expect(state.character.alive).toBe(false);
  });
});

describe("数值应用", () => {
  it("属性变化封顶在 0-100", () => {
    const { state } = newGameState(20);
    state.character.attrs.mood = 98;
    const d = emptyDeltas();
    d.attrs.mood = 10;
    applyDeltas(state, d);
    expect(state.character.attrs.mood).toBe(100);
  });

  it("技能经验累积升级", () => {
    const { state } = newGameState(21);
    const d = emptyDeltas();
    d.skillXp.push({ name: "吉他", category: "爱好", xp: 250 });
    applyDeltas(state, d);
    const skill = state.character.skills.find((s) => s.name === "吉他")!;
    expect(skill.level).toBe(2);
    expect(skill.xp).toBe(50);
  });
});

describe("人生阶段与粒度", () => {
  it("阶段划分正确", () => {
    expect(lifeStageOf(2)).toBe("婴儿");
    expect(lifeStageOf(8)).toBe("童年");
    expect(lifeStageOf(15)).toBe("少年");
    expect(lifeStageOf(25)).toBe("青年");
    expect(lifeStageOf(50)).toBe("中年");
    expect(lifeStageOf(70)).toBe("老年");
  });

  it("粒度随年龄细化", () => {
    expect(granularityOf(3)).toBe("year");
    expect(granularityOf(8)).toBe("month");
    expect(granularityOf(14)).toBe("week");
  });
});

describe("行动建议", () => {
  it("每个人生阶段都能给出 1-3 条非空建议，且同回合内稳定", async () => {
    const { suggestActions } = await import("./suggest");
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = newGameState(seed);
      // 让角色逐步变老，覆盖各人生阶段
      for (let round = 0; round < 20; round++) {
        if (state.ended) break;
        const a = suggestActions(state);
        expect(a.length).toBeGreaterThanOrEqual(1);
        expect(a.length).toBeLessThanOrEqual(3);
        for (const s of a) expect(s.length).toBeGreaterThan(0);
        expect(new Set(a).size).toBe(a.length); // 无重复
        expect(suggestActions(state)).toEqual(a); // 同回合稳定
        fastForward(state, 5);
      }
    }
  });

  it("处境恶化时给出对症建议", async () => {
    const { suggestActions } = await import("./suggest");
    const { state } = newGameState(3);
    fastForward(state, 30); // 成年
    state.character.attrs.mood = 20;
    state.character.attrs.health = 30;
    state.character.money = -500;
    const a = suggestActions(state);
    expect(a.some((s) => s.includes("休息") || s.includes("检查") || s.includes("还上"))).toBe(true);
  });
});
