/**
 * Seeded pseudo-random number generation.
 *
 * Every simulated minute gets its own generator, seeded from hash(seed, site, minute, purpose).
 * That makes output a pure function of (seed, site, timestamp): it does not matter how ticks are
 * chunked, whether the Durable Object was evicted in between, or whether history was produced by
 * the backfill script instead of the live Worker.
 */

/** 32-bit FNV-1a hash of a string, finished with a murmur3 avalanche for better bit mixing. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small, fast generator (sfc32) with a Gaussian helper. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seedKey: string) {
    this.a = hash32(`${seedKey}#a`);
    this.b = hash32(`${seedKey}#b`);
    this.c = hash32(`${seedKey}#c`);
    this.d = hash32(`${seedKey}#d`) | 1;
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.float() * items.length)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  }

  /** Standard normal deviate (Box–Muller). */
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const v = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }
}

/** Generator for one purpose ("telemetry", "flows", …) at one site and minute. */
export function rngFor(seed: string, siteId: string, minuteMs: number, purpose: string): Rng {
  return new Rng(`${seed}|${siteId}|${minuteMs}|${purpose}`);
}
