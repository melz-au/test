/**
 * SiteTwin Durable Object: one instance per site (PS01…PS40, plus HO for head office).
 *
 * - alarm() fires every TICK_MINUTES (1 by default) and simulates the minutes that have elapsed.
 * - flush() is called by the cron Worker every 5 minutes; it PUTs complete windows to Databricks
 *   from inside the object, so each object stays well under the 50-subrequest limit per invocation
 *   on Workers Free, however many sites there are.
 */
import { DurableObject } from "cloudflare:workers";
import { loadConfig, type TwinConfig } from "./config.ts";
import { SiteEngine, type FlushResult, type SiteState } from "./engine.ts";
import type { Env } from "./env.ts";
import { HEAD_OFFICE_ID, siteById } from "./model/sites.ts";
import { MINUTE_MS, floorTo, isoMs } from "./model/time.ts";
import { isScenarioName, type ScenarioInstance } from "./scenarios/types.ts";
import { DatabricksFilesSink } from "./sink/databricks.ts";
import { SqliteStore } from "./sqlite-store.ts";

/** Keep each alarm's CPU small: simulate at most this many minutes per invocation. */
const MAX_MINUTES_PER_ALARM = 30;
/** Leave headroom under the 50-subrequest limit (retries count as subrequests). */
const SUBREQUEST_BUDGET = 40;

export interface SiteStatus {
  siteId: string;
  started: boolean;
  simulatedThrough: string | null;
  outboxRows: number;
  skippedMinutes: number;
  scenarios: Pick<ScenarioInstance, "name" | "startMs" | "done" | "origin">[];
  nextAlarm: string | null;
}

export class SiteTwin extends DurableObject<Env> {
  private store!: SqliteStore;
  private engine: SiteEngine | null = null;
  private readonly cfg: TwinConfig;
  private pendingSignals: { controlId: string; tsMs: number }[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.cfg = loadConfig(env);
    void ctx.blockConcurrencyWhile(() => {
      this.store = new SqliteStore(ctx.storage.sql);
      return Promise.resolve();
    });
  }

  private tickMinutes(siteId: string): number {
    return siteId === HEAD_OFFICE_ID ? Math.max(60, this.cfg.tickMinutes) : this.cfg.tickMinutes;
  }

  /** Engine for this object. The site ID is persisted in state, so alarms can recover it. */
  private getEngine(siteId?: string): SiteEngine | null {
    if (this.engine) return this.engine;
    let id = siteId;
    if (!id) {
      const raw = this.store.getCheckpoint();
      id = raw ? (JSON.parse(raw) as SiteState).siteId : undefined;
    }
    if (!id) return null;
    this.engine = new SiteEngine(
      {
        seed: this.cfg.seed,
        runId: this.cfg.runId,
        site: siteById(id),
        flushWindowMinutes: this.cfg.flushWindowMinutes,
        maxCatchUpMinutes: this.cfg.maxCatchUpMinutes,
        randomScenarioRatePerMinute: this.cfg.randomScenariosPerSiteDay / 1440,
        onSignal: (controlId, tsMs) => this.pendingSignals.push({ controlId, tsMs }),
      },
      this.store,
    );
    return this.engine;
  }

  private async ensureAlarm(siteId: string): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.scheduleNext(siteId, Date.now());
  }

  private async scheduleNext(siteId: string, nowMs: number): Promise<void> {
    const engine = this.getEngine(siteId);
    const step = this.tickMinutes(siteId) * MINUTE_MS;
    const behind = engine?.state && engine.state.nextMinuteMs + MINUTE_MS <= floorTo(nowMs, MINUTE_MS) - MAX_MINUTES_PER_ALARM * MINUTE_MS;
    // 2 s after the next tick boundary, so the minute being simulated has fully elapsed.
    await this.ctx.storage.setAlarm(behind ? nowMs + 1000 : floorTo(nowMs, step) + step + 2000);
  }

  private async deliverSignals(): Promise<void> {
    const signals = this.pendingSignals;
    this.pendingSignals = [];
    if (!signals.length) return;
    const ho = this.env.SITE_TWIN.get(this.env.SITE_TWIN.idFromName(HEAD_OFFICE_ID));
    for (const s of signals) await ho.recordSignal(s.controlId, s.tsMs);
  }

  override async alarm(): Promise<void> {
    const engine = this.getEngine();
    if (!engine?.state) return;
    const siteId = engine.opts.site.id;
    engine.runUntil(Date.now(), MAX_MINUTES_PER_ALARM);
    await this.deliverSignals();
    await this.scheduleNext(siteId, Date.now());
  }

  /** Start the site if needed and make sure its alarm is set. */
  async ensureRunning(siteId: string): Promise<SiteStatus> {
    const engine = this.getEngine(siteId);
    if (!engine) throw new Error("engine unavailable");
    engine.start(Date.now());
    await this.ensureAlarm(siteId);
    return this.status();
  }

  /** Flush complete windows to Databricks (called by the cron Worker every 5 minutes). */
  async flush(siteId: string): Promise<FlushResult & { siteId: string }> {
    await this.ensureRunning(siteId);
    const engine = this.getEngine(siteId);
    if (!engine) throw new Error("engine unavailable");
    const { DATABRICKS_HOST: host, DATABRICKS_TOKEN: token } = this.env;
    if (!host || !token) throw new Error("DATABRICKS_HOST and DATABRICKS_TOKEN must be set");
    const sink = new DatabricksFilesSink({ host, token, requestBudget: SUBREQUEST_BUDGET });
    return { siteId, ...(await engine.flush(sink, this.cfg.location)) };
  }

  async triggerScenario(siteId: string, name: string, start: "now" | "next_window"): Promise<{ name: string; startMs: number }> {
    if (!isScenarioName(name)) throw new Error(`unknown scenario ${name}`);
    await this.ensureRunning(siteId);
    const engine = this.getEngine(siteId);
    if (!engine) throw new Error("engine unavailable");
    const inst = engine.scheduleScenario(name, start);
    return { name: inst.name, startMs: inst.startMs };
  }

  /** Head office only: a site reports a compliance signal. */
  async recordSignal(controlId: string, tsMs: number): Promise<void> {
    await this.ensureRunning(HEAD_OFFICE_ID);
    this.getEngine(HEAD_OFFICE_ID)?.recordSignal(controlId, tsMs);
  }

  /** Local mode only: simulate `minutes` ahead of the clock, then flush. */
  async advance(siteId: string, minutes: number): Promise<FlushResult & { simulated: number }> {
    await this.ensureRunning(siteId);
    const engine = this.getEngine(siteId);
    if (!engine) throw new Error("engine unavailable");
    const simulated = engine.simulate(Math.max(0, Math.min(7 * 1440, Math.floor(minutes))));
    await this.deliverSignals();
    const { DATABRICKS_HOST: host, DATABRICKS_TOKEN: token } = this.env;
    const sink = new DatabricksFilesSink({ host: host ?? "http://localhost:8788", token: token ?? "local" });
    let total: FlushResult = { windowsFlushed: 0, filesPut: 0, filesExisting: 0, failed: null, rowsRemaining: 0 };
    for (;;) {
      const r = await engine.flush(sink, this.cfg.location, 50);
      total = { ...r, windowsFlushed: total.windowsFlushed + r.windowsFlushed, filesPut: total.filesPut + r.filesPut, filesExisting: total.filesExisting + r.filesExisting };
      if (!r.windowsFlushed || r.failed) break;
    }
    return { ...total, simulated };
  }

  async status(): Promise<SiteStatus> {
    const engine = this.getEngine();
    const s = engine?.state ?? null;
    const alarm = await this.ctx.storage.getAlarm();
    return {
      siteId: s?.siteId ?? "unknown",
      started: !!s,
      simulatedThrough: s ? isoMs(s.nextMinuteMs) : null,
      outboxRows: this.store.count(),
      skippedMinutes: s?.skippedMinutes ?? 0,
      scenarios: (s?.scenarios ?? []).map(({ name, startMs, done, origin }) => ({ name, startMs, done, origin })),
      nextAlarm: alarm === null ? null : isoMs(alarm),
    };
  }
}
