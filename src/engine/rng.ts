// 可持久化的种子随机数（mulberry32）：state 存进存档，读档后随机序列可复现。

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  static fromState(state: number): Rng {
    const r = new Rng(0);
    r.state = state >>> 0;
    return r;
  }

  getState(): number {
    return this.state;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [lo, hi] 整数 */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** [lo, hi) 浮点 */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 按权重抽取 */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    const total = items.reduce((s, it) => s + weightOf(it), 0);
    let roll = this.next() * total;
    for (const it of items) {
      roll -= weightOf(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** 不重复抽 n 个 */
  sample<T>(arr: readonly T[], n: number): T[] {
    const pool = [...arr];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }
}
