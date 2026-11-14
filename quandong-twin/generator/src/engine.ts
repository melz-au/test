/**
 * Site simulation engine: advances one site minute by minute, writes each group of minutes to the
 * outbox as pre-serialised NDJSON, and flushes complete windows to a sink.
 *
 * It has no Cloudflare dependencies, so the Durable Object, the tests, the smoke test and the
 * backfill script all run exactly the same code.
 */
import { LANDING_FOLDER, type ScenarioLogEvent, type Stream } from "./contracts/generated.ts";
import { inventoryRow } from "./feeds/asset-inventory.ts";
import { complianceRows, type ComplianceSignals } from "./feeds/compliance-evidence.ts";
import { Emitter, envelope, type FeedContext } from "./feeds/envelope.ts";
import { flowRow, pollingFlow } from "./feeds/network-flows.ts";
import { pointName, protocolRow, readPoll } from "./feeds/protocol-events.ts";
import { telemetryRows } from "./feeds/process-telemetry.ts";
import { sessionRow } from "./feeds/remote-access.ts";
import { alertRow } from "./feeds/security-alerts.ts";
import {
  HEAD_OFFICE_SUBNET,
  REMOTE_ACCESS_GATEWAY_IP,
  assetByRole,
  baselineAssets,
  controllers,
  type Asset,
} from "./model/assets.ts";
import { initialPhysics, rotateLeadPump, stepPhysics, type PhysicsState } from "./model/physics.ts";
import { dailyPlan, type DailyPlan } from "./model/plan.ts";
import { rngFor } from "./model/rng.ts";
import { headOffice, type SiteSpec } from "./model/sites.ts";
import { DAY_MS, MINUTE_MS, floorTo, localTime, utcDate } from "./model/time.ts";
import { DRIVERS } from "./scenarios/index.ts";
import type { ScenarioContext, ScenarioInstance, ScenarioName } from "./scenarios/types.ts";
import type { Store } from "./store.ts";
import { landingPath, type Sink, type VolumeLocation } from "./sink/types.ts";

export interface EngineOptions {
  seed: string;
  runId: string;
  site: SiteSpec;
  /** Width of a landed file's time window, in minutes. Rows never straddle windows. */
  flushWindowMinutes: number;
  /** If the site falls further behind than this, skip ahead (the gap shows in site health). */
  maxCatchUpMinutes: number;
  /** Called when a scenario raises a compliance signal for head office. */
  onSignal?: (controlId: string, tsMs: number) => void;
  /** Probability per simulated minute of starting a random scenario (0 disables). */
  randomScenarioRatePerMinute?: number;
}

export interface SiteState {
  version: 1;
  /** Incremented on every persist; the newest revision wins when state is reloaded. */
  rev: number;
  siteId: string;
  startedMs: number;
  nextMinuteMs: number;
  lastLocalDate: string | null;
  physics: PhysicsState | null;
  assets: Asset[];
  scenarios: ScenarioInstance[];
  signals: ComplianceSignals;
  inventoryAnnounced: boolean;
  /** Minutes skipped because the site fell too far behind (for status reporting). */
  skippedMinutes: number;
}

export interface FlushResult {
  windowsFlushed: number;
  filesPut: number;
  filesExisting: number;
  failed: { path: string; status: number; error: string } | null;
  rowsRemaining: number;
}

const HO_HISTORIAN = { ip: `${HEAD_OFFICE_SUBNET}.10`, id: "HO-HIS-01" };
const HO_SCADA = { ip: `${HEAD_OFFICE_SUBNET}.20`, id: "HO-SCD-01" };

export class SiteEngine {
  readonly opts: EngineOptions;
  private readonly store: Store;
  private stateCache: SiteState | null = null;
  private readonly plans = new Map<string, DailyPlan>();
  private readonly feed: FeedContext;

  constructor(opts: EngineOptions, store: Store) {
    if (opts.flushWindowMinutes < 1 || 1440 % opts.flushWindowMinutes !== 0) {
      throw new Error("flushWindowMinutes must divide a day evenly");
    }
    this.opts = opts;
    this.store = store;
    this.feed = { seed: opts.seed, runId: opts.runId, siteId: opts.site.id };
  }

  get windowMs(): number {
    return this.opts.flushWindowMinutes * MINUTE_MS;
  }

  /** Current state: newest of the outbox's last row and the checkpoint. Null if never started. */
  get state(): SiteState | null {
    if (this.stateCache) return this.stateCache;
    const candidates = [this.store.newest()?.state, this.store.getCheckpoint()]
      .filter((s): s is string => typeof s === "string")
      .map((s) => JSON.parse(s) as SiteState);
    candidates.sort((a, b) => b.rev - a.rev);
    this.stateCache = candidates[0] ?? null;
    return this.stateCache;
  }

  private requireState(): SiteState {
    const s = this.state;
    if (!s) throw new Error(`site ${this.opts.site.id} not started`);
    return s;
  }

  /** Initialise a new site starting at the minute containing startMs. No-op if already started. */
  start(startMs: number): SiteState {
    const existing = this.state;
    if (existing) return existing;
    const minute = floorTo(startMs, MINUTE_MS);
    const site = this.opts.site;
    const state: SiteState = {
      version: 1,
      rev: 0,
      siteId: site.id,
      startedMs: minute,
      nextMinuteMs: minute,
      lastLocalDate: null,
      physics: site.role === "pump_station" ? initialPhysics(site, rngFor(this.opts.seed, site.id, minute, "init")) : null,
      assets: baselineAssets(site),
      scenarios: [],
      signals: {},
      inventoryAnnounced: false,
      skippedMinutes: 0,
    };
    this.stateCache = state;
    this.checkpoint(state);
    return state;
  }

  private serialise(state: SiteState): string {
    state.rev++;
    return JSON.stringify(state);
  }

  private checkpoint(state: SiteState): void {
    this.store.putCheckpoint(this.serialise(state));
  }

  /** Simulate every whole minute that has fully elapsed by nowMs (bounded by maxMinutes). */
  runUntil(nowMs: number, maxMinutes = Number.POSITIVE_INFINITY): number {
    const state = this.requireState();
    const lastComplete = floorTo(nowMs, MINUTE_MS) - MINUTE_MS;
    const behind = (lastComplete - state.nextMinuteMs) / MINUTE_MS + 1;
    if (behind > this.opts.maxCatchUpMinutes) {
      const skipTo = floorTo(lastComplete - (this.opts.maxCatchUpMinutes - 1) * MINUTE_MS, MINUTE_MS);
      state.skippedMinutes += (skipTo - state.nextMinuteMs) / MINUTE_MS;
      state.nextMinuteMs = skipTo;
    }
    const n = Math.max(0, Math.min(maxMinutes, (lastComplete - state.nextMinuteMs) / MINUTE_MS + 1));
    return this.simulate(n);
  }

  /** Simulate exactly n minutes from the current position, regardless of wall-clock time. */
  simulate(n: number): number {
    const state = this.requireState();
    let group: { startMs: number; events: Partial<Record<Stream, string[]>> } | null = null;
    const writeGroup = (): void => {
      if (!group) return;
      const payload: Partial<Record<Stream, string>> = {};
      for (const [stream, lines] of Object.entries(group.events) as [Stream, string[]][]) {
        if (lines.length) payload[stream] = `${lines.join("\n")}\n`;
      }
      this.store.append({
        startMs: group.startMs,
        endMs: state.nextMinuteMs,
        payload: JSON.stringify(payload),
        state: this.serialise(state),
      });
      group = null;
    };
    for (let i = 0; i < n; i++) {
      const m = state.nextMinuteMs;
      if (group && floorTo(m, this.windowMs) !== floorTo(group.startMs, this.windowMs)) writeGroup();
      group ??= { startMs: m, events: {} };
      const em = this.step(state, m);
      for (const [stream, events] of Object.entries(em.events) as [Stream, object[]][]) {
        const lines = (group.events[stream] ??= []);
        for (const e of events) lines.push(JSON.stringify(e));
      }
      state.nextMinuteMs = m + MINUTE_MS;
    }
    writeGroup();
    return n;
  }

  private plan(date: string): DailyPlan {
    let p = this.plans.get(date);
    if (!p) {
      p = dailyPlan(this.opts.seed, this.opts.site, date);
      if (this.plans.size > 4) this.plans.clear();
      this.plans.set(date, p);
    }
    return p;
  }

  /** One simulated minute. */
  private step(state: SiteState, m: number): Emitter {
    const site = this.opts.site;
    const ctx = this.feed;
    const em = new Emitter();
    const lt = localTime(m);
    if (lt.date !== state.lastLocalDate) {
      if (state.lastLocalDate && state.physics) rotateLeadPump(state.physics);
      state.lastLocalDate = lt.date;
    }

    if (site.role === "pump_station" && state.physics) {
      this.stepPumpStation(state, state.physics, m, lt.minuteOfDay, lt.date, em);
    }

    this.stepScenarios(state, m, em);

    // Inventory: full snapshot when the site starts and daily at 00:05 local time.
    if (!state.inventoryAnnounced || lt.minuteOfDay === 5) {
      for (const a of state.assets) em.emit("asset_inventory", inventoryRow(ctx, m, a, "snapshot"));
      state.inventoryAnnounced = true;
    }

    // Head office: daily compliance evidence at 06:00 local time.
    if (site.id === headOffice.id && lt.minuteOfDay === 360) {
      const rng = rngFor(this.opts.seed, site.id, m, "compliance");
      for (const row of complianceRows(ctx, m, lt.date, state.signals, rng)) em.emit("compliance_evidence", row);
    }
    return em;
  }

  private stepPumpStation(state: SiteState, phys: PhysicsState, m: number, minuteOfDay: number, date: string, em: Emitter): void {
    const site = this.opts.site;
    const ctx = this.feed;
    const seed = this.opts.seed;
    const assets = state.assets;

    // Operator setpoint changes planned for this minute (within the normal band).
    const today = this.plan(date);
    const yesterday = this.plan(localTime(m - DAY_MS).date);
    const hmi = assetByRole(assets, "hmi");
    for (const c of today.setpointChanges) {
      if (floorTo(c.tsMs, MINUTE_MS) !== m) continue;
      const cl2 = assetByRole(assets, "chlorine");
      em.emit("protocol_events", protocolRow(ctx, c.tsMs, "operator-setpoint", {
        target: cl2,
        initiator: hmi,
        protocol: "Modbus/TCP",
        function_code: 6,
        operation: "write",
        register_or_point: pointName(site.id, "CL2.SETPOINT_MGL"),
        old_value: phys.setpointMgl,
        new_value: c.value,
        user_context: `hmi:${c.operator}`,
        command_count: 1,
        result: "success",
        logic_checksum_before: null,
        logic_checksum_after: null,
      }));
      phys.setpointMgl = c.value;
    }

    // Physics and telemetry.
    const reading = stepPhysics(site, phys, minuteOfDay, rngFor(seed, site.id, m, "physics"));
    for (const row of telemetryRows(ctx, m, assets, reading, rngFor(seed, site.id, m, "telemetry"))) {
      em.emit("process_telemetry", row);
    }

    // Baseline traffic: HMI polls every controller; HMI reports to SCADA; historian pulls from HMI.
    const rng = rngFor(seed, site.id, m, "traffic");
    for (const c of controllers(assets)) {
      em.emit("network_flows", flowRow(ctx, m, pollingFlow(hmi, c, rng)));
      em.emit("protocol_events", protocolRow(ctx, m, "poll", readPoll(hmi, c, 30, "hmi:polling")));
    }
    em.emit("network_flows", flowRow(ctx, m, {
      src: hmi, dst: { ip: HO_SCADA.ip }, dstPort: 4840, protocol: "OPC UA", direction: "outbound",
      bytes: 18_000 + rng.int(0, 4000), packets: 60 + rng.int(0, 12),
    }));
    em.emit("network_flows", flowRow(ctx, m, {
      src: { ip: HO_HISTORIAN.ip }, dst: hmi, dstPort: 4840, protocol: "OPC UA", direction: "inbound",
      bytes: 9_000 + rng.int(0, 2000), packets: 30 + rng.int(0, 8),
    }));

    // Planned remote sessions (today's, plus any that started yesterday and run past midnight).
    for (const s of [...yesterday.sessions, ...today.sessions]) {
      const startMin = floorTo(s.startMs, MINUTE_MS);
      const endMin = floorTo(s.endMs, MINUTE_MS);
      if (m < startMin || m > endMin) continue;
      if (m === startMin) em.emit("remote_access", sessionRow(ctx, s.startMs, s, "started", "accepted"));
      const target = assets.find((a) => a.asset_id === s.targetAssetId);
      if (target && m < endMin) {
        const port = s.protocol === "RDP" ? 3389 : s.protocol === "SSH" ? 22 : 443;
        em.emit("network_flows", flowRow(ctx, m, {
          src: { ip: REMOTE_ACCESS_GATEWAY_IP }, dst: target, dstPort: port, protocol: s.protocol, direction: "inbound",
          bytes: 250_000 + rng.int(0, 900_000), packets: 900 + rng.int(0, 1500),
        }));
      }
      if (m === endMin) em.emit("remote_access", sessionRow(ctx, s.endMs, s, "ended", "accepted"));
    }

    // Sensor background noise.
    for (const n of today.noise) {
      if (floorTo(n.tsMs, MINUTE_MS) === m) em.emit("security_alerts", alertRow(ctx, n.tsMs, "noise", n.alert));
    }
  }

  private scenarioContext(state: SiteState, em: Emitter): ScenarioContext {
    return {
      feed: this.feed,
      site: this.opts.site,
      seed: this.opts.seed,
      assets: state.assets,
      physics: state.physics,
      emit: (stream, event) => em.emit(stream, event),
      emitted: (stream) => em.events[stream] ?? [],
      logStep: (inst, tsMs, step, stepName, technique, expected, evidence, description) => {
        const row: ScenarioLogEvent = {
          ...envelope(this.feed, "scenario_log", tsMs, inst.id, step),
          scenario_id: inst.id,
          scenario_name: inst.name,
          step,
          step_name: stepName,
          scenario_start_ts: new Date(inst.startMs).toISOString(),
          mitre_attack_ics_technique: technique,
          expected_rule_ids: expected,
          evidence_event_ids: evidence.map((e) => e.event_id),
          description,
        };
        return em.emit("scenario_log", row);
      },
      signal: (controlId, tsMs) => {
        if (this.opts.site.id === headOffice.id) state.signals[controlId] = tsMs;
        else this.opts.onSignal?.(controlId, tsMs);
      },
    };
  }

  private stepScenarios(state: SiteState, m: number, em: Emitter): void {
    const rate = this.opts.randomScenarioRatePerMinute ?? 0;
    if (rate > 0 && this.opts.site.role === "pump_station" && !this.attackInProgress(state, m)) {
      const rng = rngFor(this.opts.seed, this.opts.site.id, m, "random-scenario");
      if (rng.chance(rate)) {
        const driver = rng.pick(Object.values(DRIVERS).filter((d) => d.supports(this.opts.site)));
        this.addScenario(state, driver.name, driver.defaultStart(m), "random");
      }
    }
    const active = state.scenarios.filter((s) => !s.done && s.startMs <= m + MINUTE_MS - 1);
    if (!active.length) return;
    const ctx = this.scenarioContext(state, em);
    for (const inst of active) {
      const driver = DRIVERS[inst.name];
      if (floorTo(inst.startMs, MINUTE_MS) > m) continue;
      inst.done = driver.onMinute(ctx, inst, m);
    }
    // Keep only recent instances in state.
    state.scenarios = state.scenarios.filter((s) => !s.done || m - s.startMs < DAY_MS);
  }

  /** True while a scenario is scheduled or in its attack phase at minute m. */
  private attackInProgress(state: SiteState, m: number): boolean {
    return state.scenarios.some((s) => !s.done && m < s.startMs + DRIVERS[s.name].attackMinutes * MINUTE_MS);
  }

  private addScenario(state: SiteState, name: ScenarioName, startMs: number, origin: "api" | "random"): ScenarioInstance {
    const inst: ScenarioInstance = {
      id: `GT-${this.opts.site.id}-${name}-${startMs}`,
      name,
      startMs,
      origin,
      done: false,
      data: {},
    };
    state.scenarios.push(inst);
    return inst;
  }

  /**
   * Schedule a scenario. `start` is "now" (next simulated minute) or "next_window" (the scenario's
   * default start, e.g. 02:00 local for rogue_setpoint), or an explicit epoch ms.
   */
  scheduleScenario(name: ScenarioName, start: "now" | "next_window" | number): ScenarioInstance {
    const state = this.requireState();
    const driver = DRIVERS[name];
    if (!driver.supports(this.opts.site)) throw new Error(`${name} is not supported at ${this.opts.site.id}`);
    const startMs =
      start === "now" ? state.nextMinuteMs : start === "next_window" ? driver.defaultStart(state.nextMinuteMs) : start;
    if (this.attackInProgress(state, state.nextMinuteMs) || state.scenarios.some((s) => !s.done && s.name === name)) {
      throw new Error(`a scenario is already scheduled or in progress at ${this.opts.site.id}`);
    }
    const inst = this.addScenario(state, name, Math.max(startMs, state.nextMinuteMs), "api");
    this.checkpoint(state);
    return inst;
  }

  /** Record a compliance signal (head office only). */
  recordSignal(controlId: string, tsMs: number): void {
    const state = this.requireState();
    state.signals[controlId] = Math.max(state.signals[controlId] ?? 0, tsMs);
    this.checkpoint(state);
  }

  /**
   * Flush every complete window (one whose end the simulation has passed) to the sink, oldest
   * first. A window's rows are deleted only after all of its files are accepted; on any failure
   * the flush stops and the rows stay for the next attempt (at-least-once delivery).
   */
  async flush(sink: Sink, location: VolumeLocation, maxWindows = 12): Promise<FlushResult> {
    const result: FlushResult = { windowsFlushed: 0, filesPut: 0, filesExisting: 0, failed: null, rowsRemaining: 0 };
    const state = this.state;
    if (!state) return result;
    const cutoff = floorTo(state.nextMinuteMs, this.windowMs);
    const rows = this.store.rowsBefore(cutoff, maxWindows * this.opts.flushWindowMinutes);
    const windows = new Map<number, typeof rows>();
    for (const r of rows) {
      const w = floorTo(r.startMs, this.windowMs);
      const list = windows.get(w) ?? [];
      list.push(r);
      windows.set(w, list);
    }
    let flushedAny = false;
    for (const [w, windowRows] of [...windows.entries()].sort((a, b) => a[0] - b[0]).slice(0, maxWindows)) {
      const bodies = new Map<Stream, string>();
      for (const r of windowRows) {
        for (const [stream, text] of Object.entries(JSON.parse(r.payload) as Record<Stream, string>) as [Stream, string][]) {
          bodies.set(stream, (bodies.get(stream) ?? "") + text);
        }
      }
      let ok = true;
      for (const [stream, body] of bodies) {
        const path = landingPath(location, LANDING_FOLDER[stream], utcDate(w), this.opts.site.id, w);
        const res = await sink.put(path, body);
        if (!res.ok) {
          result.failed = { path, status: res.status, error: res.error };
          ok = false;
          break;
        }
        if (res.outcome === "created") result.filesPut++;
        else result.filesExisting++;
      }
      if (!ok) break;
      this.store.deleteRange(w, w + this.windowMs);
      result.windowsFlushed++;
      flushedAny = true;
    }
    if (flushedAny) this.checkpoint(state);
    result.rowsRemaining = this.store.count();
    return result;
  }
}
