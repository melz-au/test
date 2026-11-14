import { describe, expect, it } from "vitest";
import { FEEDS, type RemoteAccessEvent, type SecurityAlertsEvent } from "../src/contracts/generated.ts";
import { localTime } from "../src/model/time.ts";
import { MemoryStore } from "../src/store.ts";
import { contractErrors } from "./helpers/contracts.ts";
import { LOC, MemorySink, WED_MIDNIGHT_ADL, engineFor, eventsByStream, flushAll, runSite } from "./helpers/sim.ts";

const DAY = 1440;

describe("site engine", () => {
  it("is deterministic: same seed, site and time give byte-identical files", async () => {
    const a = await runSite("PS03", WED_MIDNIGHT_ADL, 180);
    const b = await runSite("PS03", WED_MIDNIGHT_ADL, 180);
    expect([...a.sink.files.entries()]).toEqual([...b.sink.files.entries()]);
  });

  it("output does not depend on how minutes are chunked", async () => {
    const whole = await runSite("PS01", WED_MIDNIGHT_ADL, 120, 120);
    const minuteByMinute = await runSite("PS01", WED_MIDNIGHT_ADL, 120, 1);
    const ragged = await runSite("PS01", WED_MIDNIGHT_ADL, 120, 7);
    expect([...minuteByMinute.sink.files.entries()]).toEqual([...whole.sink.files.entries()]);
    expect([...ragged.sink.files.entries()]).toEqual([...whole.sink.files.entries()]);
  });

  it("survives eviction: a fresh engine on the same store continues identically", async () => {
    const reference = await runSite("PS02", WED_MIDNIGHT_ADL, 90);
    const store = new MemoryStore();
    const sink = new MemorySink();
    const first = engineFor("PS02", store);
    first.start(WED_MIDNIGHT_ADL);
    first.simulate(37);
    await flushAll(first, sink);
    const second = engineFor("PS02", store); // new instance, no in-memory state
    second.simulate(53);
    await flushAll(second, sink);
    expect([...sink.files.entries()]).toEqual([...reference.sink.files.entries()]);
  });

  it("every event in a simulated day validates against its contract", async () => {
    for (const site of ["PS03", "PS06", "HO"]) {
      const { events } = await runSite(site, WED_MIDNIGHT_ADL, DAY, DAY, { randomScenarioRatePerMinute: 0 });
      let n = 0;
      for (const [stream, list] of events) {
        for (const e of list) {
          expect(contractErrors(stream, e)).toEqual([]);
          n++;
        }
      }
      expect(n).toBeGreaterThan(site === "HO" ? 10 : 20_000);
    }
  });

  it("emits every public feed across a day (compliance from head office only)", async () => {
    const ps = await runSite("PS03", WED_MIDNIGHT_ADL, DAY);
    const ho = await runSite("HO", WED_MIDNIGHT_ADL, DAY);
    for (const f of FEEDS.filter((x) => x !== "compliance_evidence")) expect(ps.events.get(f)?.length, f).toBeGreaterThan(0);
    expect(ps.events.has("compliance_evidence")).toBe(false);
    expect(ho.events.get("compliance_evidence")).toHaveLength(12);
    expect(ps.events.has("scenario_log")).toBe(false);
  });

  it("produces the expected baseline: one telemetry row per tag per minute, 2–5 noise alerts per day", async () => {
    const { events } = await runSite("PS03", WED_MIDNIGHT_ADL, DAY);
    const telemetry = events.get("process_telemetry") ?? [];
    // PS03 has 3 pumps: 2 tags per pump + chlorine dose, chlorine setpoint, level, pressure = 10 tags.
    expect(telemetry).toHaveLength(DAY * 10);
    const tags = new Set(telemetry.map((e) => (e as { tag: string }).tag));
    expect(tags.size).toBe(10);
  });

  it("schedules the weekly vendor session on Wednesday in business hours with MFA passing", async () => {
    const { events } = await runSite("PS03", WED_MIDNIGHT_ADL, DAY);
    const ra = (events.get("remote_access") ?? []) as RemoteAccessEvent[];
    const vendor = ra.filter((e) => e.user_type === "vendor");
    expect(vendor.map((e) => e.session_state)).toEqual(["started", "ended"]);
    for (const e of vendor) {
      expect(e.mfa_result).toBe("accepted");
      const lt = localTime(Date.parse(e.event_ts));
      expect(lt.isoWeekday).toBe(3);
      expect(lt.hour).toBeGreaterThanOrEqual(7);
      expect(lt.hour).toBeLessThan(19);
    }
    const alerts = (events.get("security_alerts") ?? []) as SecurityAlertsEvent[];
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(alerts.length).toBeLessThanOrEqual(5);
    expect(alerts.every((a) => a.severity === "low")).toBe(true);
  });

  it("names files by window and site, and never straddles windows", async () => {
    const { sink } = await runSite("PS01", WED_MIDNIGHT_ADL, 30, 7);
    const paths = [...sink.files.keys()];
    expect(paths).toContain(`/Volumes/workspace/quandong_twin/landing/process_telemetry/date=2026-11-10/PS01_${WED_MIDNIGHT_ADL}.jsonl`);
    expect(paths.filter((p) => p.includes("/process_telemetry/"))).toHaveLength(6);
    for (const [path, body] of sink.files) {
      if (!path.includes("/process_telemetry/")) continue;
      const windowMs = Number(/_(\d+)\.jsonl$/.exec(path)?.[1]);
      for (const line of body.trim().split("\n")) {
        const ts = Date.parse((JSON.parse(line) as { event_ts: string }).event_ts);
        expect(ts).toBeGreaterThanOrEqual(windowMs);
        expect(ts).toBeLessThan(windowMs + 5 * 60_000);
      }
    }
  });

  it("keeps rows in the outbox until every file in the window is accepted (at-least-once)", async () => {
    const store = new MemoryStore();
    const engine = engineFor("PS01", store);
    const sink = new MemorySink();
    engine.start(WED_MIDNIGHT_ADL);
    engine.simulate(10);
    // simulate(10) in one call writes one outbox row per 5-minute window.
    expect(store.count()).toBe(2);
    sink.failNext = 1; // the first PUT fails
    const failed = await engine.flush(sink, LOC);
    expect(failed.failed).not.toBeNull();
    expect(failed.windowsFlushed).toBe(0);
    expect(store.count()).toBe(2);
    const ok = await engine.flush(sink, LOC);
    expect(ok.failed).toBeNull();
    expect(ok.windowsFlushed).toBe(2);
    expect(store.count()).toBe(0);
    // Re-delivering the same windows is idempotent: names and bytes are identical, so "exists" = done.
    const replay = engineFor("PS01");
    replay.start(WED_MIDNIGHT_ADL);
    replay.simulate(10);
    const again = await replay.flush(sink, LOC);
    expect(again.filesPut).toBe(0);
    expect(again.filesExisting).toBeGreaterThan(0);
  });

  it("only flushes complete windows", async () => {
    const engine = engineFor("PS01");
    engine.start(WED_MIDNIGHT_ADL);
    engine.simulate(7);
    const r = await engine.flush(new MemorySink(), LOC);
    expect(r.windowsFlushed).toBe(1);
    expect(r.rowsRemaining).toBe(1);
  });

  it("stays well inside the Durable Object row-write budget", async () => {
    const { store } = await runSite("PS03", WED_MIDNIGHT_ADL, DAY, 1);
    // 1,440 appends + 1,440 deletes + 288 checkpoints (+ start). setAlarm adds 1,440 more in the Durable Object.
    expect(store.rowsWritten).toBeLessThanOrEqual(1440 * 2 + 288 + 1);
  });

  it("skips ahead (rather than catching up for hours) when it falls far behind", () => {
    const engine = engineFor("PS01", new MemoryStore(), { maxCatchUpMinutes: 60 });
    engine.start(WED_MIDNIGHT_ADL);
    const n = engine.runUntil(WED_MIDNIGHT_ADL + 5 * 3600_000);
    expect(n).toBe(60);
    expect(engine.state?.skippedMinutes).toBe(240);
  });

  it("parses landed files back into events", () => {
    const files = new Map([["/Volumes/c/s/landing/network_flows/date=2026-11-10/PS01_1.jsonl", '{"a":1}\n{"a":2}\n']]);
    expect(eventsByStream(files).get("network_flows")).toHaveLength(2);
  });
});
