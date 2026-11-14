/**
 * Physical process model for one pump station, stepped once per simulated minute.
 *
 * - Demand follows a daily curve with morning and evening peaks (Australia/Adelaide time).
 * - Duty/standby pumps are driven by reservoir level with hysteresis; the lead pump rotates daily.
 * - Main pressure follows pump state and demand.
 * - Chlorine residual tracks the dosing setpoint with a slow first-order lag (minutes to tens of
 *   minutes), plus Gaussian noise, so a malicious setpoint change shows up gradually.
 */
import type { Rng } from "./rng.ts";
import type { SiteSpec } from "./sites.ts";

export interface PumpState {
  running: boolean;
  minutesInState: number;
}

export interface PhysicsState {
  levelPct: number;
  cl2Mgl: number;
  setpointMgl: number;
  pressureKpa: number;
  pumps: PumpState[];
  /** Index (0-based) of the lead pump; rotates daily. */
  leadPump: number;
  /** True after an unauthorised logic change: the lead pump short-cycles. */
  logicTampered: boolean;
}

export interface MinuteReading {
  demandLps: number;
  flowsLps: number[];
  running: boolean[];
  levelPct: number;
  pressureKpa: number;
  cl2Mgl: number;
  setpointMgl: number;
}

export const NORMAL_SETPOINT_MGL = 1.0;

// Level control thresholds (percent). Lead: start < 45, stop > 85. Lag: start < 30, stop > 60.
const LEAD_START = 45;
const LEAD_STOP = 85;
const LAG_START = 30;
const LAG_STOP = 60;
// Tampered logic: lead pump forced off after this many minutes running, and kept off for the rest.
const TAMPER_MAX_RUN = 4;
const TAMPER_MIN_OFF = 3;
const CL2_RESPONSE_PER_MIN = 0.012;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Relative demand at a local time of day (mean ≈ 1 over a day). */
export function demandFactor(minuteOfDay: number): number {
  const h = minuteOfDay / 60;
  const morning = 0.6 * Math.exp(-(((h - 7.5) / 1.5) ** 2));
  const evening = 0.45 * Math.exp(-(((h - 18.5) / 2) ** 2));
  return (0.55 + morning + evening) / 0.683;
}

export function initialPhysics(site: SiteSpec, rng: Rng): PhysicsState {
  return {
    levelPct: 55 + rng.float() * 20,
    cl2Mgl: NORMAL_SETPOINT_MGL + rng.normal(0, 0.03),
    setpointMgl: NORMAL_SETPOINT_MGL,
    pressureKpa: 400,
    pumps: Array.from({ length: site.pumps }, (_, i) => ({ running: i === 0, minutesInState: 0 })),
    leadPump: 0,
    logicTampered: false,
  };
}

function setRunning(p: PumpState, running: boolean): void {
  if (p.running !== running) {
    p.running = running;
    p.minutesInState = 0;
  }
}

/** Advance the model one minute. Mutates and returns `state`; also returns the minute's readings. */
export function stepPhysics(site: SiteSpec, state: PhysicsState, minuteOfDay: number, rng: Rng): MinuteReading {
  const demandLps = Math.max(0, site.baseDemandLps * demandFactor(minuteOfDay) * (1 + rng.normal(0, 0.03)));
  const level = state.levelPct;

  // Pump control: lead pump first, then the next pump as lag; any third pump is standby only.
  const n = state.pumps.length;
  state.pumps.forEach((p, i) => {
    const rank = (i - state.leadPump + n) % n; // 0 = lead, 1 = lag, 2 = standby
    if (rank === 0) {
      if (state.logicTampered) {
        // Modified logic ignores the level band and short-cycles the lead pump.
        if (p.running && p.minutesInState >= TAMPER_MAX_RUN) setRunning(p, false);
        else if (!p.running && p.minutesInState >= TAMPER_MIN_OFF && level < LEAD_STOP) setRunning(p, true);
      } else if (!p.running && level < LEAD_START) setRunning(p, true);
      else if (p.running && level > LEAD_STOP) setRunning(p, false);
    } else if (rank === 1) {
      if (!p.running && level < LAG_START) setRunning(p, true);
      else if (p.running && level > LAG_STOP) setRunning(p, false);
    } else {
      setRunning(p, false);
    }
    p.minutesInState++;
  });

  const flowsLps = state.pumps.map((p) =>
    p.running ? Math.max(0, site.pumpRatedLps * (1 - 0.002 * (level - 50)) + rng.normal(0, 0.6)) : 0,
  );
  const inflow = flowsLps.reduce((a, b) => a + b, 0);
  const running = state.pumps.map((p) => p.running);
  const nRunning = running.filter(Boolean).length;

  // Reservoir mass balance over 60 seconds.
  state.levelPct = clamp(level + ((inflow - demandLps) * 60 * 100) / site.reservoirLitres, 0, 100);

  // Main pressure: pumped or gravity-fed.
  const target =
    nRunning > 0
      ? 380 + 70 * (nRunning - 1) + 0.9 * inflow - 2 * demandLps
      : 230 + 0.8 * state.levelPct - 0.8 * demandLps;
  state.pressureKpa = clamp(state.pressureKpa + 0.5 * (target - state.pressureKpa) + rng.normal(0, 3), 0, 1000);

  // Chlorine is dosed at the reservoir outlet, paced on demand flow, so the measured residual
  // tracks the setpoint whenever customers draw water (always, in practice), with a small daily drift.
  const diurnal = 0.04 * Math.sin((2 * Math.PI * minuteOfDay) / 1440);
  if (demandLps > 0) state.cl2Mgl += CL2_RESPONSE_PER_MIN * (state.setpointMgl + diurnal - state.cl2Mgl);
  state.cl2Mgl = clamp(state.cl2Mgl + rng.normal(0, 0.008), 0, 5);

  return {
    demandLps,
    flowsLps,
    running,
    levelPct: state.levelPct,
    pressureKpa: state.pressureKpa,
    cl2Mgl: state.cl2Mgl,
    setpointMgl: state.setpointMgl,
  };
}

/** Rotate the lead pump (called at local midnight). */
export function rotateLeadPump(state: PhysicsState): void {
  if (state.pumps.length) state.leadPump = (state.leadPump + 1) % state.pumps.length;
}
