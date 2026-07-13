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
import { attributeScaleLabel } from "./attributes";

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
      for (const [key, value] of Object.entries(roll.character.attrs)) {
        const range = roll.character.attrBounds[key as keyof typeof roll.character.attrs];
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(range.ceiling);
        expect(range.floor).toBeLessThanOrEqual(range.ceiling);
      }
      expect(roll.character.attrs.intelligence).toBeLessThanOrEqual(14); // 新生儿是当前发育值，不是成人智力
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
    const beforeCeiling = state.character.attrBounds.intelligence.ceiling;
    applyTalent(state.character, talent);
    expect(state.character.attrs.intelligence).toBe(Math.min(state.character.attrBounds.intelligence.ceiling, before + 15));
    expect(state.character.attrBounds.intelligence.ceiling).toBeGreaterThanOrEqual(beforeCeiling);
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
      expect(board.choices.some((choice) => choice.kind === "intense" && choice.energyCost >= 45)).toBe(true);
      expect(board.choices.some((choice) => choice.kind === "recovery")).toBe(true);
      expect(board.timeLabel).toBe(state.granularity === "year" ? "这一年" : "本季重心");
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
    expect(cards[0].energyCost).toBe(70); // 999 → 70
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
    expect(getDecisionBoard(state).headline).toMatch(/[？。]$/); // 默认标题从轮换池里出
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

  it("学习兜底是不过时的「学识」，关键词能认出学科", async () => {
    const { skillForIntent } = await import("./skills");
    const { state } = newGameState(11);
    state.world.year = state.character.birthYear + 10;
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "认真读书" }))).toEqual(
      { name: "学识", category: "学业" },
    );
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "刷奥数竞赛题" }))?.name).toBe("数理");
    state.world.year = state.character.birthYear + 16;
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "背英语单词" }))?.name).toBe("外语");
    // 不同学段的学习都长在同一门「学识」上，不再出现"小学课业"这类学段标签
    expect(skillForIntent(state, mkIntent({ category: "study", summary: "认真读书" }))?.name).toBe("学识");
  });

  it("工作兜底按职业赛道映射成真手艺", async () => {
    const { skillForIntent } = await import("./skills");
    const { state } = newGameState(12);
    state.world.year = state.character.birthYear + 26;
    expect(skillForIntent(state, mkIntent({ category: "work", summary: "认真上班" }))?.name).toBe("职场");
    state.character.identity.job = { title: "程序员", employer: "杭州·科技公司", weeklyHours: 40, weeklyPay: 1200, track: "技术", level: 1, xp: 0 };
    expect(skillForIntent(state, mkIntent({ category: "work", summary: "认真上班" }))?.name).toBe("编程");
    state.character.identity.job.track = "餐饮";
    expect(skillForIntent(state, mkIntent({ category: "work", summary: "认真上班" }))?.name).toBe("厨艺");
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
    expect(study.deltas.skillXp[0].name).toBe("学识");
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

describe("属性潜力、精力与季度节奏", () => {
  it("先天基线和潜力随机化，100 明确代表人类极限", () => {
    const intelligenceCaps = new Set<number>();
    const fitnessFloors = new Set<number>();
    for (let seed = 1; seed <= 80; seed++) {
      const { character } = rollGenesis(new Rng(seed));
      intelligenceCaps.add(character.attrBounds.intelligence.ceiling);
      fitnessFloors.add(character.attrBounds.fitness.floor);
      expect(character.attrs.intelligence).toBeLessThan(character.attrBounds.intelligence.ceiling);
      expect(character.attrBounds.health.ceiling).toBeLessThanOrEqual(100);
    }
    expect(intelligenceCaps.size).toBeGreaterThan(8);
    expect(fitnessFloors.size).toBeGreaterThan(6);
    expect(attributeScaleLabel("intelligence", 100)).toContain("世界最聪明");
  });

  it("正向训练不能突破个人潜力，伤病仍可跌破先天基线", () => {
    const { state } = newGameState(201);
    const cap = state.character.attrBounds.fitness.ceiling;
    state.character.attrs.fitness = cap - 1;
    const gain = emptyDeltas();
    gain.attrs.fitness = 20;
    applyDeltas(state, gain);
    expect(state.character.attrs.fitness).toBe(cap);
    expect(gain.attrs.fitness).toBe(1);

    const harm = emptyDeltas();
    harm.attrs.fitness = -100;
    applyDeltas(state, harm);
    expect(state.character.attrs.fitness).toBe(0);
    expect(state.character.attrs.fitness).toBeLessThan(state.character.attrBounds.fitness.floor);
  });

  it("儿童每季会从上课和自然发育中成长，一年只需四个回合", () => {
    const { state } = newGameState(202);
    state.world.year = state.character.birthYear + 6;
    state.granularity = "season";
    const yearBefore = state.world.year;
    const intelligenceBefore = state.character.attrs.intelligence;
    fastForward(state, 4);
    expect(state.world.year).toBe(yearBefore + 1);
    expect(state.character.attrs.intelligence).toBeGreaterThan(intelligenceBefore);
    expect(state.character.attrs.intelligence).toBeLessThanOrEqual(state.character.attrBounds.intelligence.ceiling);
  });

  it("高精力投入有更高回报，精力不足时收益打折并伤身", () => {
    const { state } = newGameState(203);
    state.world.year = state.character.birthYear + 25;
    state.character.energy = 100;
    state.character.attrs.intelligence = 20;
    state.character.attrBounds.intelligence.ceiling = 100;
    const intent = {
      id: "energy-test", summary: "集中学习编程", category: "study" as const, hours: 20,
      risk: "low" as const, attr: "intelligence" as const, nsfw: false, skill: "编程",
    };
    const light = resolveAction(new Rng(9), state, { ...intent, energyCost: 12 }, "success");
    const intense = resolveAction(new Rng(9), state, { ...intent, energyCost: 70 }, "success");
    expect(intense.deltas.skillXp[0].xp).toBeGreaterThan(light.deltas.skillXp[0].xp);

    state.character.energy = 5;
    const overdrawn = resolveAction(new Rng(9), state, { ...intent, energyCost: 70 }, "success");
    expect(overdrawn.deltas.attrs.health).toBeLessThan(0);
    expect(overdrawn.mechanical).toContain("强行透支");
  });

  it("精力见底会在自然恢复前损害健康", () => {
    const { state } = newGameState(204);
    state.world.year = state.character.birthYear + 25;
    state.granularity = "season";
    state.character.energy = 0;
    state.character.attrs.health = 60;
    fastForward(state, 1);
    expect(state.character.attrs.health).toBe(58);
    expect(state.character.energy).toBeGreaterThan(0);
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

  it("技能经验累积升级：门槛随等级递增", () => {
    const { state } = newGameState(21);
    const d = emptyDeltas();
    d.skillXp.push({ name: "吉他", category: "爱好", xp: 250 });
    applyDeltas(state, d);
    const skill = state.character.skills.find((s) => s.name === "吉他")!;
    // 250 = 60（升Lv1）+ 100（升Lv2）+ 剩 90（Lv3 需要 140）
    expect(skill.level).toBe(2);
    expect(skill.xp).toBe(90);
  });
});

describe("技能熟练度：技能不再只是展示", () => {
  it("升级门槛随等级递增，段位标签正确", async () => {
    const { xpToNext, skillTierLabel } = await import("./skills");
    expect(xpToNext(0)).toBe(60);
    expect(xpToNext(5)).toBe(260);
    expect(skillTierLabel(0)).toBe("生疏");
    expect(skillTierLabel(1)).toBe("入门");
    expect(skillTierLabel(3)).toBe("熟练");
    expect(skillTierLabel(5)).toBe("精通");
    expect(skillTierLabel(9)).toBe("大师");
  });

  it("熟练度直接抵扣高危判定难度", () => {
    const mk = () => ({
      id: "a", summary: "押上积蓄开吉他教室", category: "adventure" as const, hours: 30,
      risk: "high" as const, attr: "luck" as const, nsfw: false, skill: "吉他",
    });
    const a = newGameState(42).state;
    a.world.year = a.character.birthYear + 25;
    const b = newGameState(42).state;
    b.world.year = b.character.birthYear + 25;
    b.character.skills.push({ id: "s", name: "吉他", category: "爱好", level: 5, xp: 0 });
    const cold = beginTurn(a, "开吉他教室", [mk()]);
    const warm = beginTurn(b, "开吉他教室", [mk()]);
    expect(warm.checks[0].difficulty).toBe(cold.checks[0].difficulty - 15); // Lv5 × 3
  });

  it("熟练的手艺挣钱更多，结算文案标注技能加成", () => {
    const intent = {
      id: "w", summary: "上班干活", category: "work" as const, hours: 20,
      risk: "low" as const, attr: "eq" as const, nsfw: false, energyCost: 20,
    };
    const { state } = newGameState(43);
    state.world.year = state.character.birthYear + 30;
    state.character.energy = 100;
    const rookie = resolveAction(new Rng(5), state, intent, "success");
    state.character.skills.push({ id: "s", name: "职场", category: "职业", level: 5, xp: 0 });
    const veteran = resolveAction(new Rng(5), state, intent, "success");
    expect(veteran.deltas.money).toBeGreaterThan(rookie.deltas.money);
    expect(veteran.mechanical).toContain("技能「职场」Lv5");
    expect(rookie.mechanical).not.toContain("做熟悉的事更稳");
  });
});

describe("迁移定位：人搬到哪坐标就在哪", () => {
  const mkMove = (summary: string, tier: "success" | "fail" = "success") => ({
    intent: {
      id: "m", summary, category: "work" as const, hours: 20,
      risk: "low" as const, attr: "eq" as const, nsfw: false,
    },
    tier,
    deltas: emptyDeltas(),
    mechanical: "",
  });

  it("去外地工作成功后坐标更新，同回合入职落在新城市", async () => {
    const { settleResidence, settleCareer } = await import("./lifecycle");
    const { state } = newGameState(31);
    state.world.year = state.character.birthYear + 22;
    state.character.identity.residence = "中国·洛阳";
    const actions = [mkMove("去深圳工作")];
    const notes = settleResidence(state, actions);
    expect(state.character.identity.residence).toBe("中国·深圳");
    expect(notes[0]).toContain("深圳");
    settleCareer(state, actions);
    expect(state.character.identity.job?.employer.startsWith("深圳·")).toBe(true);
  });

  it("判定失败、非地名、未成年都不迁移", async () => {
    const { settleResidence } = await import("./lifecycle");
    const { state } = newGameState(32);
    state.world.year = state.character.birthYear + 22;
    const home = state.character.identity.residence;
    settleResidence(state, [mkMove("去杭州工作", "fail")]);
    expect(state.character.identity.residence).toBe(home);
    settleResidence(state, [mkMove("去图书馆工作")]);
    expect(state.character.identity.residence).toBe(home);
    state.world.year = state.character.birthYear + 10;
    settleResidence(state, [mkMove("搬到上海生活")]);
    expect(state.character.identity.residence).toBe(home);
  });

  it("搬回老家回到出生城市，移居国外整体替换国家", async () => {
    const { settleResidence } = await import("./lifecycle");
    const { state } = newGameState(33);
    state.world.year = state.character.birthYear + 30;
    state.background.city = "洛阳";
    state.character.identity.residence = "中国·北京";
    settleResidence(state, [mkMove("搬回老家生活")]);
    expect(state.character.identity.residence).toBe("中国·洛阳");
    settleResidence(state, [mkMove("移居日本东京")]);
    expect(state.character.identity.residence).toBe("日本·东京");
  });
});

describe("情境卡与卡面个性化", () => {
  it("欠债时出现补窟窿卡，引用真实欠款数字", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(40);
    state.world.year = state.character.birthYear + 25;
    state.character.money = -500;
    const board = getDecisionBoard(state);
    const debt = board.choices.find((c) => c.id === "context-ctx-debt");
    expect(debt).toBeDefined();
    expect(debt!.description).toContain("500");
  });

  it("技能磨砺卡引用最深的技能并积累该技能", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(41);
    state.world.year = state.character.birthYear + 20;
    state.character.skills.push({ id: "s", name: "吉他", category: "爱好", level: 4, xp: 10 });
    const board = getDecisionBoard(state);
    const hone = board.choices.find((c) => c.id === "context-ctx-hone-吉他");
    expect(hone).toBeDefined();
    expect(hone!.title).toContain("吉他");
    expect(hone!.intent.skill).toBe("吉他");
  });

  it("固定卡文案跨回合轮换：恢复卡不再一辈子一句话", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(80);
    state.world.year = state.character.birthYear + 25;
    const titles = new Set<string>();
    for (let turn = 0; turn < 8; turn++) {
      state.turn = turn;
      const recovery = getDecisionBoard(state).choices.find((c) => c.kind === "recovery")!;
      titles.add(recovery.title);
    }
    expect(titles.size).toBeGreaterThan(1);
  });

  it("关系卡在好感前三里轮换对象，不再永远盯着同一个人", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(81);
    state.world.year = state.character.birthYear + 20;
    const targets = new Set<string>();
    for (let turn = 0; turn < 8; turn++) {
      state.turn = turn;
      const rel = getDecisionBoard(state).choices.find((c) => c.kind === "relationship")!;
      if (rel.intent.target) targets.add(rel.intent.target);
    }
    expect(targets.size).toBeGreaterThan(1);
  });

  it("条件卡按处境进出卡池：无业才有求职卡", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const collectDaily = (employed: boolean): Set<string> => {
      const { state } = newGameState(82);
      state.world.year = state.character.birthYear + 25;
      state.character.identity.schooling = null;
      state.character.identity.job = employed
        ? { title: "程序员", employer: "x", weeklyHours: 40, weeklyPay: 1200, track: "技术", level: 1, xp: 0 }
        : null;
      const ids = new Set<string>();
      for (let turn = 0; turn < 24; turn++) {
        state.turn = turn;
        for (const c of getDecisionBoard(state).choices) {
          if (c.kind === "daily") ids.add(c.id);
        }
      }
      return ids;
    };
    expect(collectDaily(false).has("daily-jobhunt")).toBe(true);
    expect(collectDaily(true).has("daily-jobhunt")).toBe(false);
  });

  it("模糊的「才艺」占位被替换为角色专属特长，同一角色稳定", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const HOBBIES = ["绘画", "乐器", "棋艺", "舞蹈", "手工", "书法"];
    const { state } = newGameState(50);
    state.world.year = state.character.birthYear + 8; // 童年：极限投入卡原本挂「才艺」
    state.granularity = "season";
    const intense = getDecisionBoard(state).choices.find((c) => c.kind === "intense")!;
    expect(HOBBIES).toContain(intense.intent.skill);
    expect(getDecisionBoard(state).choices.find((c) => c.kind === "intense")!.intent.skill).toBe(intense.intent.skill);
  });
});

describe("经济系统：钱和人脉都有花出去的窗口", () => {
  it("生活方式与城市共同决定生活开销", async () => {
    const { livingCost } = await import("./economy");
    const { state } = newGameState(60);
    state.world.year = state.character.birthYear + 25;
    state.character.identity.residence = "中国·北京";
    state.character.lifestyle = "frugal";
    expect(livingCost(state, 13)).toBe(Math.round(120 * 13 * 0.5 * 1.6));
    state.character.lifestyle = "lavish";
    expect(livingCost(state, 13)).toBe(Math.round(120 * 13 * 4.5 * 1.6));
    state.character.identity.residence = "中国·某县城";
    expect(livingCost(state, 13)).toBe(Math.round(120 * 13 * 4.5 * 0.7));
  });

  it("存款撑不住时生活方式自动降档", () => {
    const { state } = newGameState(60);
    state.world.year = state.character.birthYear + 25;
    state.granularity = "season";
    state.character.lifestyle = "lavish";
    state.character.money = 1000;
    const notes = fastForward(state, 1);
    expect(state.character.lifestyle).toBe("comfort");
    expect(notes.some((n) => n.includes("生活方式降为"))).toBe(true);
  });

  it("讲究的日子恢复更快：精力自然恢复随档位提升", () => {
    const mk = (lifestyle: "frugal" | "lavish") => {
      const { state } = newGameState(64);
      state.world.year = state.character.birthYear + 25;
      state.granularity = "season";
      state.character.lifestyle = lifestyle;
      state.character.money = 10_000_000; // 避免自动降档干扰
      state.character.energy = 40;
      fastForward(state, 1);
      return state.character.energy;
    };
    expect(mk("lavish")).toBeGreaterThan(mk("frugal"));
  });

  it("动用人脉护航：扣点数、降难度；点数不足时无效", () => {
    const mkRisk = () => ({
      id: "r", summary: "赌一把大的", category: "adventure" as const, hours: 20,
      risk: "high" as const, attr: "luck" as const, nsfw: false,
    });
    const a = newGameState(61).state;
    a.world.year = a.character.birthYear + 25;
    a.character.connections = 0;
    const base = beginTurn(a, "x", [mkRisk()]);

    const b = newGameState(61).state;
    b.world.year = b.character.birthYear + 25;
    b.character.connections = 15;
    const boosted = beginTurn(b, "x", [mkRisk()], undefined, { connections: true });
    expect(boosted.checks[0].difficulty).toBe(base.checks[0].difficulty - 10);
    expect(b.character.connections).toBe(0);
    expect(boosted.connectionsSpent).toBe(15);

    const c = newGameState(61).state;
    c.world.year = c.character.birthYear + 25;
    c.character.connections = 3; // 不足 5 点撑不起人情
    const weak = beginTurn(c, "x", [mkRisk()], undefined, { connections: true });
    expect(weak.checks[0].difficulty).toBe(base.checks[0].difficulty);
    expect(c.character.connections).toBe(3);
  });

  it("报班：钱无论成败都花出去，技能经验 ×2.5", () => {
    const { state } = newGameState(62);
    state.world.year = state.character.birthYear + 20;
    state.character.energy = 100;
    const intent = {
      id: "t", summary: "跟老师学吉他", category: "leisure" as const, hours: 20,
      risk: "low" as const, attr: "mood" as const, nsfw: false, skill: "吉他", energyCost: 20,
    };
    const free = resolveAction(new Rng(3), state, intent, "success");
    const paid = resolveAction(new Rng(3), state, { ...intent, moneyCost: 900 }, "success");
    expect(paid.deltas.money).toBe(-900);
    expect(paid.deltas.skillXp[0].xp).toBeGreaterThan(free.deltas.skillXp[0].xp * 2);
    const failedPaid = resolveAction(new Rng(3), state, { ...intent, moneyCost: 900 }, "fail");
    expect(failedPaid.deltas.money).toBe(-900); // 学费不退
  });

  it("就医：花钱买健康，恢复量翻倍", () => {
    const { state } = newGameState(62);
    state.world.year = state.character.birthYear + 45;
    state.character.energy = 100;
    state.character.attrs.health = 40;
    state.character.attrBounds.health.ceiling = 100;
    const intent = {
      id: "h", summary: "认真做一次体检调理", category: "health" as const, hours: 20,
      risk: "low" as const, attr: "health" as const, nsfw: false, energyCost: -12,
    };
    const free = resolveAction(new Rng(4), state, intent, "success");
    const paid = resolveAction(new Rng(4), state, { ...intent, moneyCost: 600 }, "success");
    expect(paid.deltas.money).toBe(-600);
    expect(paid.deltas.attrs.health ?? 0).toBeGreaterThan(free.deltas.attrs.health ?? 0);
  });

  it("就医情境卡按处境出现，钱不够时提交被拦下", async () => {
    const { getDecisionBoard, selectionError } = await import("./decisions");
    const { state } = newGameState(63);
    state.world.year = state.character.birthYear + 45;
    state.character.money = 5000;
    state.character.attrs.health = 45;
    const board = getDecisionBoard(state);
    const medical = board.choices.find((c) => c.id === "context-ctx-medical");
    expect(medical).toBeDefined();
    expect(medical!.moneyCost).toBeGreaterThan(0);
    state.character.money = 0;
    expect(selectionError(state, board, [medical!.id])).toContain("钱不够");
  });

  it("LLM 卡的 moneyCost 被裁剪到付得起的范围", async () => {
    const { sanitizeLlmChoices } = await import("./decisions");
    const { state } = newGameState(2);
    state.character.money = 500;
    const cards = sanitizeLlmChoices(state, [
      { title: "给她买条项链", category: "romance", attr: "charm", moneyCost: 999999 },
    ]);
    expect(cards[0].moneyCost).toBe(500);
    expect(cards[0].intent.moneyCost).toBe(500);
  });
});

describe("自定义行动的金钱现实感", () => {
  it("离线解析认得购买并按品类估价", () => {
    expect(fallbackParseIntents("去买部新手机")[0].moneyCost).toBe(3000);
    expect(fallbackParseIntents("攒钱买一套房")[0].moneyCost).toBe(300000);
    expect(fallbackParseIntents("买点零食")[0].moneyCost).toBe(200);
    expect(fallbackParseIntents("认真学习")[0].moneyCost).toBeUndefined();
  });

  it("买不起：行动被「无力承担」拦下——不扣钱、不转针，只有落空的心情", () => {
    const { state } = newGameState(90);
    state.world.year = state.character.birthYear + 15;
    state.granularity = "season";
    state.character.money = 427;
    const intent = {
      id: "a", summary: "去买部新手机", category: "leisure" as const, hours: 10,
      risk: "high" as const, attr: "luck" as const, nsfw: false, moneyCost: 3000,
    };
    const pending = beginTurn(state, "去买部新手机", [intent]);
    expect(pending.checks.filter((c) => c.actionId === "a")).toHaveLength(0); // 高危也不给转针
    const before = state.character.money;
    const outcome = finalizeTurn(state, pending);
    expect(outcome.actions[0].mechanical).toContain("无力承担");
    expect(outcome.actions[0].mechanical).toContain("3,000");
    expect(outcome.actions[0].deltas.money).toBe(0);
    expect((outcome.actions[0].deltas.attrs.mood ?? 0)).toBeLessThan(0);
    expect(state.character.money).toBe(before); // 15 岁无生活开销，钱应分文未动
  });

  it("买得起：按真实标价扣钱，而不是类别公式的零星收支", () => {
    const { state } = newGameState(91);
    state.world.year = state.character.birthYear + 25;
    state.character.money = 8000;
    state.character.energy = 90;
    const res = resolveAction(new Rng(2), state, {
      id: "b", summary: "去买部新手机", category: "leisure", hours: 10,
      risk: "low", attr: "luck", nsfw: false, moneyCost: 3000,
    }, "success");
    expect(res.deltas.money).toBe(-3000);
  });
});

describe("场景模式：时间冻结的连续对手戏", () => {
  it("进入条件与拍数/精力预算", async () => {
    const { canEnterScene, beginScene, sceneBeatError, applySceneBeatCost, SCENE_MAX_BEATS, SCENE_BEAT_ENERGY } = await import("./scene");
    const { state } = newGameState(70);
    state.character.energy = 50;
    expect(canEnterScene(state)).toBeNull();
    beginScene(state, null, false);
    expect(canEnterScene(state)).toContain("已有场景");
    expect(sceneBeatError(state)).toBeNull();
    applySceneBeatCost(state);
    expect(state.character.energy).toBe(50 - SCENE_BEAT_ENERGY);
    for (let i = 0; i < SCENE_MAX_BEATS; i++) state.scene!.beats.push({ player: "x", narrative: "y" });
    expect(sceneBeatError(state)).toContain("最多");
    state.scene!.beats.length = 0;
    state.character.energy = SCENE_BEAT_ENERGY - 1;
    expect(sceneBeatError(state)).toContain("精力");
  });

  it("收场结算：好感、心境与共同记忆落地，场景清空", async () => {
    const { beginScene, settleScene } = await import("./scene");
    const { state } = newGameState(71);
    const npc = state.character.npcs[0];
    const affinityBefore = npc.affinity;
    const moodBefore = state.character.attrs.mood;
    beginScene(state, npc.name, false);
    for (let i = 0; i < 6; i++) state.scene!.beats.push({ player: "聊聊", narrative: "回应" });
    const notes = settleScene(state);
    expect(state.scene).toBeNull();
    expect(npc.affinity).toBeGreaterThan(affinityBefore);
    expect(state.character.attrs.mood).toBeGreaterThan(moodBefore);
    expect(npc.memories.some((m) => m.includes("专注的相处"))).toBe(true);
    expect(notes[0]).toContain(npc.name);
  });

  it("零拍收场不产生任何结算", async () => {
    const { beginScene, settleScene } = await import("./scene");
    const { state } = newGameState(72);
    beginScene(state, null, false);
    expect(settleScene(state)).toEqual([]);
    expect(state.scene).toBeNull();
  });

  it("场景后果净化：数值 clamp、花销不超钱包+小额透支、法律走白名单", async () => {
    const { sanitizeSceneEffects } = await import("./scene");
    const { state } = newGameState(73);
    state.world.year = state.character.birthYear + 25;
    state.character.money = 1000;
    state.character.identity.job = { title: "程序员", employer: "x", weeklyHours: 40, weeklyPay: 2000, track: "技术", level: 1, xp: 0 };
    const fx = sanitizeSceneEffects(state, {
      money: -99999, mood: 50, affinity: -99, connections: 9,
      legal: "越狱中", conditions_add: ["受了一点小伤但是问题不大", "轻伤", "第三条被裁"], conditions_remove: "不是数组",
    });
    expect(fx.money).toBe(-6000); // 钱包 1000 + 透支 5000
    expect(fx.mood).toBe(8);
    expect(fx.affinity).toBe(-10);
    expect(fx.connections).toBe(3);
    expect(fx.legal).toBeNull(); // 白名单之外的法律状态被丢弃
    expect(fx.conditionsAdd).toEqual(["受了一点小伤但是", "轻伤"]);
    expect(fx.conditionsRemove).toEqual([]);
    expect(sanitizeSceneEffects(state, "垃圾").money).toBe(0);
    // 合法的法律状态变化被保留
    expect(sanitizeSceneEffects(state, { legal: "通缉" }).legal).toBe("通缉");
  });

  it("场景后果实时落地：钱包、好感、法律状态与状态列表", async () => {
    const { applySceneEffects, emptySceneEffects } = await import("./scene");
    const { state } = newGameState(74);
    state.world.year = state.character.birthYear + 25;
    state.character.money = 5000;
    const npc = state.character.npcs[0];
    const affinityBefore = npc.affinity;
    const fx = { ...emptySceneEffects(), money: -2000, affinity: 6, legal: "通缉" as const, conditionsAdd: ["轻伤"] };
    const notes = applySceneEffects(state, npc.name, fx);
    expect(state.character.money).toBe(3000);
    expect(npc.affinity).toBe(affinityBefore + 6);
    expect(state.character.identity.legalStatus).toBe("通缉");
    expect(state.character.identity.conditions).toContain("轻伤");
    expect(notes.join("，")).toContain("⚖️ 法律处境：通缉");
  });

  it("被通缉/服刑时决策盘标题直说", async () => {
    const { getDecisionBoard } = await import("./decisions");
    const { state } = newGameState(75);
    state.background.country = "中国";
    state.world.year = 2019; // 无大事年份，避免标题被时代事件接管
    state.character.identity.legalStatus = "通缉";
    expect(getDecisionBoard(state).headline).toContain("警察在找你");
    state.character.identity.legalStatus = "服刑";
    expect(getDecisionBoard(state).headline).toContain("高墙内");
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
    expect(granularityOf(8)).toBe("season");
    expect(granularityOf(14)).toBe("season");
  });
});

