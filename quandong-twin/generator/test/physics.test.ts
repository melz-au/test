import { describe, expect, it } from "vitest";
import { REFERENCE } from "../src/contracts/reference.generated.ts";
import { initialPhysics, rotateLeadPump, stepPhysics } from "../src/model/physics.ts";
import { rngFor } from "../src/model/rng.ts";
import { pumpStation } from "../src/model/sites.ts";

const bands = REFERENCE.process_bands;

describe("physical process model under normal operation", () => {
  for (const index of [1, 2, 3, 4, 5, 6]) {
    it(`PS0${index} stays inside every operating band for 14 days`, () => {
      const site = pumpStation(index);
      const state = initialPhysics(site, rngFor("p", site.id, 0, "init"));
      let pumpStarts = 0;
      let wasRunning = false;
      let peakDemand = 0;
      let nightDemand = Infinity;
      for (let m = 0; m < 14 * 1440; m++) {
        if (m % 1440 === 0) rotateLeadPump(state);
        const r = stepPhysics(site, state, m % 1440, rngFor("p", site.id, m * 60_000, "physics"));
        expect(r.cl2Mgl).toBeGreaterThanOrEqual(bands["CL2.DOSE_MGL"].min);
        expect(r.cl2Mgl).toBeLessThanOrEqual(bands["CL2.DOSE_MGL"].max);
        expect(r.pressureKpa).toBeGreaterThanOrEqual(bands["MAIN.PRESSURE_KPA"].min);
        expect(r.pressureKpa).toBeLessThanOrEqual(bands["MAIN.PRESSURE_KPA"].max);
        expect(r.levelPct).toBeGreaterThanOrEqual(bands["RES.LEVEL_PCT"].min);
        expect(r.levelPct).toBeLessThanOrEqual(bands["RES.LEVEL_PCT"].max);
        for (const f of r.flowsLps) expect(f).toBeLessThanOrEqual(bands["PUMP.FLOW_LPS"].max);
        const anyRunning = r.running.some(Boolean);
        if (anyRunning && !wasRunning) pumpStarts++;
        wasRunning = anyRunning;
        if (m % 1440 === 8 * 60) peakDemand = Math.max(peakDemand, r.demandLps);
        if (m % 1440 === 3 * 60) nightDemand = Math.min(nightDemand, r.demandLps);
      }
      // Pumps cycle on reservoir level (a few times a day), and demand peaks in the morning.
      expect(pumpStarts).toBeGreaterThan(14);
      expect(peakDemand).toBeGreaterThan(nightDemand * 1.5);
    });
  }

  it("pressure follows pump state", () => {
    const site = pumpStation(1);
    const s = initialPhysics(site, rngFor("p", site.id, 0, "init"));
    s.levelPct = 50;
    s.pumps.forEach((p) => (p.running = false));
    let off = 0;
    for (let i = 0; i < 10; i++) off = stepPhysics(site, { ...s, levelPct: 50, pumps: s.pumps.map(() => ({ running: false, minutesInState: 0 })) }, 600, rngFor("p", "x", i, "q")).pressureKpa;
    const on = stepPhysics(site, { ...s, levelPct: 30, pressureKpa: 420, pumps: [{ running: true, minutesInState: 5 }, { running: false, minutesInState: 5 }] }, 600, rngFor("p", "x", 99, "q"));
    expect(on.pressureKpa).toBeGreaterThan(off);
  });

  it("chlorine responds to a setpoint change over tens of minutes, not instantly", () => {
    const site = pumpStation(3);
    const s = initialPhysics(site, rngFor("p", site.id, 0, "init"));
    s.setpointMgl = 4;
    const series: number[] = [];
    for (let m = 0; m < 60; m++) series.push(stepPhysics(site, s, 120 + m, rngFor("p", site.id, m, "cl2")).cl2Mgl);
    const firstOutOfBand = series.findIndex((v) => v > 1.5);
    expect(firstOutOfBand).toBeGreaterThan(8);
    expect(firstOutOfBand).toBeLessThan(35);
    expect(series.at(-1)).toBeGreaterThan(2);
  });
});
