// 回合建议：根据人生阶段与当前处境生成 3 个可一键执行的行动建议。
// 设计意图：天命（出身）固定，随波逐流有默认轨迹，建议是给玩家"主动改命"的抓手。

import { Rng } from "./rng";
import { GameState, ageOf, lifeStageOf } from "./types";

/** 候选建议：condition 缺省视为恒真 */
interface Suggestion {
  text: string;
  when?: (state: GameState) => boolean;
}

const isSingle = (s: GameState) => s.character.identity.maritalStatus === "单身";
const inLove = (s: GameState) => s.character.identity.maritalStatus === "恋爱中";
const married = (s: GameState) => s.character.identity.maritalStatus === "已婚";
const hasJob = (s: GameState) => s.character.identity.job !== null;
const noJob = (s: GameState) => s.character.identity.job === null;

const STAGE_POOL: Record<ReturnType<typeof lifeStageOf>, Suggestion[]> = {
  婴儿: [
    { text: "哭闹引起大人注意" },
    { text: "咿呀学语，努力说出第一个词" },
    { text: "满地爬来爬去，锻炼小身板" },
    { text: "安静地观察身边的世界" },
  ],
  童年: [
    { text: "认真读书，把功课做好" },
    { text: "放学后和小伙伴疯玩" },
    { text: "帮爸妈做家务，讨他们开心" },
    { text: "培养一个爱好，比如画画或下棋" },
    { text: "在外面疯跑，锻炼身体" },
    { text: "缠着大人讲故事，多认些字" },
  ],
  少年: [
    { text: "拼命刷题，为升学做准备" },
    { text: "和同学打球，顺便交朋友" },
    { text: "学一门乐器或特长" },
    { text: "读课外书开阔眼界" },
    { text: "周末打零工攒零花钱" },
    { text: "鼓起勇气向喜欢的人表白", when: isSingle },
    { text: "坚持晨跑，把身体练结实" },
  ],
  青年: [
    { text: "投简历找一份像样的工作", when: noJob },
    { text: "努力工作，争取被上司看见", when: hasJob },
    { text: "下班后自学新技能，准备跳槽", when: hasJob },
    { text: "去健身房锻炼，保持状态" },
    { text: "多参加聚会，扩展人脉" },
    { text: "主动认识新的人，寻找心动对象", when: isSingle },
    { text: "用心经营感情，多陪陪对方", when: (s) => inLove(s) || married(s) },
    { text: "省吃俭用存下第一桶金" },
    { text: "研究理财，让钱生钱", when: (s) => s.character.money > 5000 },
  ],
  中年: [
    { text: "在事业上再搏一把，争取更进一步", when: hasJob },
    { text: "寻找新的谋生门路", when: noJob },
    { text: "定期体检，认真对待身体的信号" },
    { text: "多陪伴家人，别让遗憾累积" },
    { text: "培养一个能做下去的副业" },
    { text: "整理积蓄，做稳健的投资", when: (s) => s.character.money > 10000 },
    { text: "重拾年轻时放下的爱好" },
  ],
  老年: [
    { text: "晨练太极，养好身体" },
    { text: "含饴弄孙，享受天伦之乐" },
    { text: "动笔写回忆录，梳理这一生" },
    { text: "来一场说走就走的旅行" },
    { text: "和老友喝茶叙旧" },
    { text: "把经验传给年轻人" },
  ],
};

/** 处境触发的紧急建议：命中则优先插入 */
const URGENT_POOL: Suggestion[] = [
  { text: "好好休息，让心情缓一缓", when: (s) => s.character.attrs.mood < 35 },
  { text: "去医院做个检查，把身体调理好", when: (s) => s.character.attrs.health < 40 && ageOf(s) >= 12 },
  { text: "想尽办法赚钱，先把债还上", when: (s) => s.character.money < 0 && ageOf(s) >= 16 },
];

/**
 * 生成本回合的 3 个建议。
 * 用 rngState⊕turn 派生随机序列：同一回合刷新页面建议不变，且不消耗游戏主 RNG。
 */
export function suggestActions(state: GameState): string[] {
  const rng = Rng.fromState(((state.rngState ^ Math.imul(state.turn + 1, 2654435761)) >>> 0) || 1);
  const out: string[] = [];

  for (const u of URGENT_POOL) {
    if (out.length >= 2) break; // 紧急项最多占两席，留至少一席给常规建议
    if (!u.when || u.when(state)) out.push(u.text);
  }

  const stage = lifeStageOf(ageOf(state));
  const pool = STAGE_POOL[stage].filter((c) => (!c.when || c.when(state)) && !out.includes(c.text));
  const picked = rng.sample(pool, Math.min(pool.length, 3 - out.length));
  out.push(...picked.map((c) => c.text));

  return out.slice(0, 3);
}
