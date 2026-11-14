import { describe, expect, it } from "vitest";
import { Rng, hash32, rngFor } from "../src/model/rng.ts";
import { deterministicUuid, hexToken } from "../src/model/ids.ts";

describe("seeded random numbers", () => {
  it("the same key always gives the same sequence", () => {
    const a = new Rng("seed|PS03|1700000000000|telemetry");
    const b = new Rng("seed|PS03|1700000000000|telemetry");
    const xs = Array.from({ length: 100 }, () => a.float());
    expect(Array.from({ length: 100 }, () => b.float())).toEqual(xs);
  });

  it("is independent per site, minute and purpose", () => {
    const base = rngFor("s", "PS03", 60_000, "x").float();
    expect(rngFor("s", "PS04", 60_000, "x").float()).not.toBe(base);
    expect(rngFor("s", "PS03", 120_000, "x").float()).not.toBe(base);
    expect(rngFor("s", "PS03", 60_000, "y").float()).not.toBe(base);
    expect(rngFor("t", "PS03", 60_000, "x").float()).not.toBe(base);
  });

  it("produces exact, pinned values (guards against accidental algorithm changes)", () => {
    expect(hash32("quandong")).toMatchInlineSnapshot(`1265167155`);
    const r = new Rng("pinned");
    expect([r.nextUint32(), r.nextUint32(), r.int(1, 6)]).toMatchInlineSnapshot(`
      [
        1824450542,
        3914148097,
        6,
      ]
    `);
  });

  it("int stays within bounds and normal has roughly the right moments", () => {
    const r = new Rng("moments");
    const n = 20_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const k = r.int(2, 5);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(5);
      const z = r.normal(10, 2);
      sum += z;
      sq += z * z;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sq / n - mean * mean);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeGreaterThan(1.9);
    expect(sd).toBeLessThan(2.1);
  });

  it("derives valid, deterministic version 8 UUIDs", () => {
    const u = deterministicUuid("seed", "PS03", "process_telemetry", 123, "PS03.CL2.DOSE_MGL");
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicUuid("seed", "PS03", "process_telemetry", 123, "PS03.CL2.DOSE_MGL")).toBe(u);
    expect(deterministicUuid("seed", "PS03", "process_telemetry", 124, "PS03.CL2.DOSE_MGL")).not.toBe(u);
    expect(hexToken("a")).toMatch(/^[0-9a-f]{8}$/);
  });
});
