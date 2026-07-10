import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import { newGameState, rollGenesis, applyTalent, TALENT_POOL } from "./genesis";
import {
  buildSwingCheck,
  tierFromOffset,
  autoTier,
  fallbackParseIntents,
  applyDeltas,
  fumbleSaveChance,
  judgeSwing,
  resolveAction,
} from "./resolver";
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

  it("玩家与家人不重名", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const roll = rollGenesis(new Rng(seed));
      const names = [roll.character.name, ...roll.character.npcs.map((n) => n.name)];
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("学龄前儿童的行动不产生金钱变动", () => {
    const { state } = newGameState(7); // 0 岁
    const intent = {
      id: "x", summary: "玩玩具", category: "leisure" as const, hours: 20,
      risk: "low" as const, attr: "mood" as const, nsfw: false,
    };
    for (let i = 0; i < 20; i++) {
      const res = resolveAction(new Rng(i + 1), state, intent, "success");
      expect(res.deltas.money).toBe(0);
    }
  });

  it("天赋池：规模、唯一性与数值边界", () => {
    expect(TALENT_POOL.length).toBeGreaterThanOrEqual(300);
    expect(new Set(TALENT_POOL.map((t) => t.id)).size).toBe(TALENT_POOL.length);
    expect(new Set(TALENT_POOL.map((t) => t.name)).size).toBe(TALENT_POOL.length);
    const validAttrs = new Set(["health", "fitness", "intelligence", "eq", "charm", "mood", "luck"]);
    for (const talent of TALENT_POOL) {
      expect(talent.name.length).toBeGreaterThanOrEqual(2);
      expect(talent.desc.length).toBeGreaterThan(4);
      let net = 0;
      for (const [k, v] of Object.entries(talent.attrMods)) {
        expect(validAttrs.has(k)).toBe(true);
        expect(Math.abs(v as number)).toBeLessThanOrEqual(20); // 单项上限
        net += v as number;
      }
      expect(net).toBeGreaterThanOrEqual(-5); // 双刃剑净值不为大负
      expect(net).toBeLessThanOrEqual(32); // 总强度上限
    }
  });

  it("同一局的三个天赋候选互不重复", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const roll = rollGenesis(new Rng(seed));
      const ids = roll.talentChoices.map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
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

  it("降难重标定：摆速上限内减速、大失败区收窄到两端各 2%", () => {
    const check = buildSwingCheck("a", "t", 70, 4, 50);
    // 现行 2.07Hz × √0.8 ≈ 1.85
    expect(check.speedHz).toBeGreaterThan(1.8);
    expect(check.speedHz).toBeLessThan(1.9);
    expect(check.zones.fail).toBe(0.48);
    // 区宽 ×1.118：难度 70 的成功区约 ±0.187
    expect(check.zones.success).toBeGreaterThan(0.18);
    expect(check.zones.success).toBeLessThan(0.2);
  });

  it("运气豁免概率随运气增长且有上下限", () => {
    expect(fumbleSaveChance(0)).toBe(0.35);
    expect(fumbleSaveChance(50)).toBeCloseTo(0.5);
    expect(fumbleSaveChance(100)).toBeCloseTo(0.65);
    expect(fumbleSaveChance(999)).toBe(0.68);
  });

  it("停针判定：大失败约有一半被运气豁免为普通失败", () => {
    let saved = 0;
    let kept = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { state } = newGameState(seed);
      const intents = fallbackParseIntents("去赌一把");
      const pending = beginTurn(state, "去赌一把", intents);
      expect(pending.checks.length).toBeGreaterThanOrEqual(1);
      const verdict = judgeSwing(state, pending.checks[0], 0.49);
      if (verdict.saved) {
        saved++;
        expect(verdict.tier).toBe("fail");
      } else {
        kept++;
        expect(verdict.tier).toBe("fumble");
      }
    }
    // 豁免率 0.35~0.65 之间，统计上应两边都有且大致对半
    expect(saved).toBeGreaterThan(25);
    expect(kept).toBeGreaterThan(25);
  });

  it("finalizeTurn 尊重停针结果并在豁免时补充叙事标记", () => {
    const { state } = newGameState(9);
    const intents = fallbackParseIntents("去赌一把");
    const pending = beginTurn(state, "去赌一把", intents);
    pending.checkResults.push({
      checkId: pending.checks[0].actionId,
      tier: "fail",
      offset: 0.49,
      saved: true,
    });
    const outcome = finalizeTurn(state, pending);
    expect(outcome.actions[0].tier).toBe("fail");
    expect(outcome.actions[0].mechanical).toContain("运气救场");
  });

  it("难度三档：EASE 越小摆速越慢、区越宽", () => {
    const easy = buildSwingCheck("a", "t", 70, 4, 50, "运气", 0.65);
    const std = buildSwingCheck("b", "t", 70, 4, 50, "运气", 0.8);
    const hard = buildSwingCheck("c", "t", 70, 4, 50, "运气", 1.0);
    expect(easy.speedHz).toBeLessThan(std.speedHz);
    expect(std.speedHz).toBeLessThan(hard.speedHz);
    expect(easy.zones.success).toBeGreaterThan(std.zones.success);
    expect(std.zones.success).toBeGreaterThan(hard.zones.success);
  });

  it("双层区宽：属性高时 best 超出 baseBest，属性 50 时相等", () => {
    const strong = buildSwingCheck("a", "t", 60, 4, 95, "魅力");
    expect(strong.zones.best).toBeGreaterThan(strong.baseBest);
    expect(strong.attrZonePct).toBeGreaterThan(0);
    expect(strong.attrSpeedPct).toBeLessThan(0);
    const neutral = buildSwingCheck("b", "t", 60, 4, 50, "魅力");
    expect(neutral.zones.best).toBeCloseTo(neutral.baseBest, 5);
    expect(neutral.attrZonePct).toBe(0);
  });

  it("高危行动成功档以上有 1.25 倍收益加成", () => {
    const { state } = newGameState(30);
    state.world.year = state.character.birthYear + 20; // 成年才积累技能
    const mk = (risk: "low" | "high") => ({
      id: "x",
      summary: "学习",
      category: "study" as const,
      hours: 20,
      risk: risk as "low" | "high",
      attr: "intelligence" as const,
      nsfw: false,
    });
    // 技能经验不含随机项，高低危之比应 ≈1.25（世界趋势等公共因子约掉）
    const low = resolveAction(new Rng(1), state, mk("low"), "success");
    const high = resolveAction(new Rng(1), state, mk("high"), "success");
    const ratio = high.deltas.skillXp[0].xp / low.deltas.skillXp[0].xp;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.35);
    // 失败的代价不放大
    const lowFail = resolveAction(new Rng(2), state, mk("low"), "fail");
    const highFail = resolveAction(new Rng(2), state, mk("high"), "fail");
    expect(highFail.deltas.attrs.mood ?? 0).toBeLessThanOrEqual(0);
    expect(lowFail.deltas.skillXp).toHaveLength(0);
    expect(highFail.deltas.skillXp).toHaveLength(0);
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

describe("决策盘", () => {
  it("固定卡池至少给出 6 张卡且同回合稳定", async () => {
    const { getDecisionBoard } = await import("./decisions");
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = newGameState(seed);
      const board = getDecisionBoard(state);
      expect(board.choices.length).toBeGreaterThanOrEqual(6);
      expect(getDecisionBoard(state).choices.map((c) => c.id)).toEqual(
        board.choices.map((c) => c.id),
      );
      const ids = new Set(board.choices.map((c) => c.id));
      expect(ids.size).toBe(board.choices.length); // 无重复
    }
  });

  it("LLM 补充卡净化：越界数值被裁剪，垃圾条目被丢弃，至多一张高危", async () => {
    const { sanitizeLlmChoices, getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(2);
    const raw = [
      { title: "去河里摸鱼", description: "夏天的河湾水浅", category: "adventure", attr: "luck", timeCost: 9, energyCost: 999, risk: "high", consequences: ["可能满载而归", "可能感冒", "第三条", "第四条被裁"] },
      { title: "帮邻居修收音机", category: "study", attr: "intelligence", timeCost: 1, energyCost: -100, risk: "high" },
      { notitle: true },
      "垃圾",
      { title: "超出三张的卡" },
    ];
    const cards = sanitizeLlmChoices(state, raw);
    expect(cards).toHaveLength(2); // 无标题与非对象被丢弃，且只取前三条里合法的
    expect(cards[0].timeCost).toBe(1); // 9 → 1
    expect(cards[0].energyCost).toBe(40); // 999 → 40
    expect(cards[0].consequences).toHaveLength(3);
    expect(cards[1].energyCost).toBe(-25); // -100 → -25
    expect(cards[1].intent.risk).toBe("low"); // 第二张高危被降级
    expect(sanitizeLlmChoices(state, "不是数组")).toEqual([]);
    // 合并进看板且可被选中校验
    const board = getDecisionBoard(state, cards);
    expect(board.choices.some((c) => c.kind === "llm")).toBe(true);
  });
});

describe("世界观：时代大事件与标题联动", () => {
  it("大事年表按国家优先命中，无事年份返回 null", async () => {
    const { epochEventFor } = await import("./decisions");
    expect(epochEventFor(2003, "中国")?.title).toBe("非典");
    expect(epochEventFor(2008, "中国")?.title).toBe("奥运与金融危机");
    expect(epochEventFor(2008, "美国")?.title).toBe("全球金融危机");
    expect(epochEventFor(2020, "日本")?.title).toBe("新冠疫情");
    expect(epochEventFor(1999, "中国")).toBeNull();
  });

  it("大事件之年世界脉搏切换为事件本身并标记 major", async () => {
    const { getWorldPulse } = await import("./decisions");
    const { state } = newGameState(4);
    state.background.country = "中国";
    state.world.year = 2003;
    const pulse = getWorldPulse(state);
    expect(pulse.major).toBe(true);
    expect(pulse.title).toBe("非典");
    state.world.year = 1999;
    expect(getWorldPulse(state).major).toBe(false);
  });

  it("决策盘标题随处境变化", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(5);
    state.background.country = "中国";
    state.world.year = 1999; // 无大事年份
    state.character.money = 100;
    expect(getDecisionBoard(state).headline).toContain("怎么过");
    state.character.money = -50;
    expect(getDecisionBoard(state).headline).toContain("欠着钱");
    state.world.year = 2020;
    expect(getDecisionBoard(state).headline).toContain("新冠疫情"); // 大事件优先于危机
  });

  it("跨年进入大事件年份时产生被动记录", () => {
    const { state } = newGameState(6);
    state.background.country = "中国";
    state.granularity = "week";
    state.world.year = 2002;
    state.world.week = 52;
    const notes = fastForward(state, 1);
    expect(notes.some((n) => n.includes("非典"))).toBe(true);
  });
});

describe("技能定义：手艺名词而非行动描述", () => {
  const mkIntent = (over: Record<string, unknown>) => ({
    id: "x", summary: "随便做点什么", category: "leisure" as const, hours: 20,
    risk: "low" as const, attr: "mood" as const, nsfw: false, ...over,
  });

  it("学业按人生阶段归一化命名", async () => {
    const { skillForIntent } = await import("./skills");
    const { state } = newGameState(11);
    state.world.year = state.character.birthYear + 10;
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "认真读书" }))).toEqual(
      { name: "小学课业", category: "学业" },
    );
    state.world.year = state.character.birthYear + 16;
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "刷题" }))?.name).toBe("高中课业");
  });

  it("关键词能认出具体手艺", async () => {
    const { skillForIntent } = await import("./skills");
    const { state } = newGameState(12);
    state.world.year = state.character.birthYear + 14;
    expect(skillForIntent(state, mkIntent({ summary: "放学后偷偷练吉他" }))).toEqual(
      { name: "乐器", category: "爱好" },
    );
    expect(skillForIntent(state, mkIntent({ summary: "跟爷爷学木工", category: "adventure" }))).toEqual(
      { name: "手工", category: "爱好" },
    );
  });

  it("意图自带技能名优先，学龄前与纯玩乐不积累", async () => {
    const { skillForIntent } = await import("./skills");
    const { state } = newGameState(13);
    state.world.year = state.character.birthYear + 20;
    expect(skillForIntent(state, mkIntent({ skill: "烘焙" }))?.name).toBe("烘焙");
    expect(skillForIntent(state, mkIntent({ summary: "看电视发呆" }))).toBeNull(); // 玩就是玩
    state.world.year = state.character.birthYear + 3;
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "认字" }))).toBeNull(); // 学龄前
  });

  it("结算不再把行动描述当技能名", () => {
    const { state } = newGameState(14);
    state.world.year = state.character.birthYear + 10;
    const study = resolveAction(new Rng(1), state, {
      id: "a", summary: "把功课做扎实做到深夜", category: "study", hours: 20,
      risk: "low", attr: "intelligence", nsfw: false,
    }, "success");
    expect(study.deltas.skillXp[0].name).toBe("小学课业");
    const play = resolveAction(new Rng(2), state, {
      id: "b", summary: "反复摆弄一个玩具", category: "leisure", hours: 20,
      risk: "low", attr: "mood", nsfw: false,
    }, "success");
    expect(play.deltas.skillXp).toHaveLength(0);
  });
});

describe("叙事线头解析", () => {
  it("断句兜底：半句裁到句读，完整句与无句读原样保留", async () => {
    const { trimToSentenceEnd } = await import("../llm/prompts");
    expect(trimToSentenceEnd("这是完整的一句。")).toBe("这是完整的一句。");
    expect(trimToSentenceEnd("这个故事讲了很久很久，终于讲完了。然后被截")).toBe(
      "这个故事讲了很久很久，终于讲完了。",
    );
    expect(trimToSentenceEnd("完全没有句读的一段话被截断了")).toBe("完全没有句读的一段话被截断了");
    // 裁剪会丢掉一半以上内容时保留原文
    expect(trimToSentenceEnd("短。" + "很长的半句".repeat(10))).toBe("短。" + "很长的半句".repeat(10));
  });

  it("拆出正文与 HOOKS，坏 JSON 与缺失都静默降级", async () => {
    const { splitNarrativeHooks } = await import("../llm/prompts");
    const good = splitNarrativeHooks('这周你过得不错。\nHOOKS:["李老师注意到了你的画","期末考试临近"]');
    expect(good.text).toBe("这周你过得不错。");
    expect(good.hooks).toEqual(["李老师注意到了你的画", "期末考试临近"]);
    const none = splitNarrativeHooks("平淡的一周。");
    expect(none.text).toBe("平淡的一周。");
    expect(none.hooks).toEqual([]);
    const bad = splitNarrativeHooks("有事发生。\nHOOKS:[损坏的");
    expect(bad.text).toBe("有事发生。");
    expect(bad.hooks).toEqual([]);
    const empty = splitNarrativeHooks("无事。\nHOOKS:[]");
    expect(empty.text).toBe("无事。");
    expect(empty.hooks).toEqual([]);
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

