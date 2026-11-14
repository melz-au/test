import { describe, expect, it } from "vitest";
import type {
  AnyEvent,
  AssetInventoryEvent,
  ComplianceEvidenceEvent,
  NetworkFlowsEvent,
  ProcessTelemetryEvent,
  ProtocolEventsEvent,
  RemoteAccessEvent,
  ScenarioLogEvent,
  SecurityAlertsEvent,
  Stream,
} from "../src/contracts/generated.ts";
import { localTime, localToUtc } from "../src/model/time.ts";
import { DRIVERS } from "../src/scenarios/index.ts";
import { MemoryStore } from "../src/store.ts";
import { contractErrors } from "./helpers/contracts.ts";
import { MemorySink, WED_MIDNIGHT_ADL, engineFor, eventsByStream, flushAll } from "./helpers/sim.ts";

const MIN = 60_000;
const ts = (e: { event_ts: string }): number => Date.parse(e.event_ts);
const of = <T extends AnyEvent>(events: Map<Stream, AnyEvent[]>, s: Stream): T[] =>
  ((events.get(s) ?? []) as T[]).slice().sort((a, b) => ts(a) - ts(b));

async function runScenario(siteId: string, startMs: number, minutes: number, name: keyof typeof DRIVERS, start: "now" | "next_window" | number = "next_window") {
  const engine = engineFor(siteId, new MemoryStore(), { randomScenarioRatePerMinute: 0 });
  const sink = new MemorySink();
  engine.start(startMs);
  const inst = engine.scheduleScenario(name, start);
  engine.simulate(minutes);
  await flushAll(engine, sink);
  return { engine, inst, sink, events: eventsByStream(sink.files) };
}

describe("rogue_setpoint", () => {
  it("plays out the full kill chain in order, from 02:00 local time", async () => {
    const { inst, events } = await runScenario("PS03", WED_MIDNIGHT_ADL, 4 * 60, "rogue_setpoint");
    expect(localTime(inst.startMs)).toMatchObject({ hour: 2, minute: 0 });

    const ra = of<RemoteAccessEvent>(events, "remote_access").filter((e) => ts(e) >= inst.startMs);
    expect(ra.map((e) => `${e.session_state}/${e.mfa_result}`)).toEqual([
      "rejected/denied", "rejected/denied", "rejected/denied", "started/accepted", "ended/accepted",
    ]);
    expect(ra.every((e) => e.user_type === "vendor" && e.source_country === "BR")).toBe(true);
    const started = ra[3];
    expect(started?.target_asset_id).toBe("PS03-EWS-01");
    expect(localTime(ts(started!)).hour).toBe(2);

    const rdp = of<NetworkFlowsEvent>(events, "network_flows").filter((f) => f.protocol === "RDP" && f.dst_asset_id === "PS03-EWS-01" && ts(f) >= inst.startMs);
    expect(rdp.length).toBeGreaterThan(30);

    const writes = of<ProtocolEventsEvent>(events, "protocol_events").filter((e) => e.operation === "write");
    const rogue = writes.find((w) => w.initiator_asset_id === "PS03-EWS-01");
    expect(rogue).toMatchObject({ asset_id: "PS03-PLC-02", new_value: 3.8, old_value: 1, function_code: 6 });
    expect(ts(rogue!)).toBeGreaterThan(ts(started!));

    // Chlorine rises over 20–40 minutes and stays out of band for well over 10 minutes.
    const cl2 = of<ProcessTelemetryEvent>(events, "process_telemetry").filter((e) => e.tag === "PS03.CL2.DOSE_MGL" && e.value !== null);
    const firstHigh = cl2.find((e) => (e.value ?? 0) > 1.5 && ts(e) > ts(rogue!));
    const minutesToHigh = (ts(firstHigh!) - ts(rogue!)) / MIN;
    expect(minutesToHigh).toBeGreaterThanOrEqual(10);
    expect(minutesToHigh).toBeLessThanOrEqual(40);
    const highMinutes = cl2.filter((e) => (e.value ?? 0) > 1.5).length;
    expect(highMinutes).toBeGreaterThan(30);
    const peak = Math.max(...cl2.map((e) => e.value ?? 0));
    expect(peak).toBeGreaterThan(2);

    // The sensor only ever rates it medium.
    const alerts = of<SecurityAlertsEvent>(events, "security_alerts").filter((a) => ts(a) >= inst.startMs && ts(a) < inst.startMs + 3 * 3600_000);
    expect(alerts.filter((a) => a.rule_id === "QS-2040").map((a) => a.severity)).toEqual(["medium"]);
    expect(alerts.some((a) => a.severity === "high" || a.severity === "critical")).toBe(false);

    // The operator restores the setpoint after 90 minutes.
    expect(writes.at(-1)).toMatchObject({ initiator_asset_id: "PS03-HMI-01", new_value: 1 });
  });

  it("logs ground truth separately, with evidence that points at real events", async () => {
    const { inst, events, sink } = await runScenario("PS03", WED_MIDNIGHT_ADL, 4 * 60, "rogue_setpoint");
    const log = of<ScenarioLogEvent>(events, "scenario_log");
    expect(log.map((s) => s.step_name)).toEqual([
      "mfa_fatigue", "out_of_hours_vendor_session", "setpoint_write", "sensor_alert_underrated", "process_manipulation",
    ]);
    expect(log.every((s) => s.scenario_id === inst.id)).toBe(true);
    for (const s of log) expect(contractErrors("scenario_log", s)).toEqual([]);
    const ids = new Set([...events.entries()].filter(([s]) => s !== "scenario_log").flatMap(([, l]) => l.map((e) => e.event_id)));
    for (const s of log) for (const id of s.evidence_event_ids) expect(ids.has(id)).toBe(true);
    expect(new Set(log.flatMap((s) => s.expected_rule_ids))).toEqual(new Set(["QD-001", "QD-002", "QD-003", "QD-004"]));

    // The scenario ID never appears outside the ground-truth folder.
    for (const [path, body] of sink.files) {
      if (path.includes("/_ground_truth/")) continue;
      expect(body.includes(inst.id)).toBe(false);
      expect(body.includes("ground_truth")).toBe(false);
    }
  });

  it("refuses a second scenario while one is scheduled or in progress", () => {
    const engine = engineFor("PS03");
    engine.start(WED_MIDNIGHT_ADL);
    engine.scheduleScenario("rogue_setpoint", "next_window");
    expect(() => engine.scheduleScenario("rogue_device", "now")).toThrow(/already/);
  });
});

describe("rogue_device", () => {
  it("adds an unknown asset, scans 502/20000/4840 across the subnet, then reads every PLC", async () => {
    const t0 = WED_MIDNIGHT_ADL + 10 * 3600_000;
    const { inst, events } = await runScenario("PS03", t0, 200, "rogue_device", t0 + 5 * MIN);
    const inv = of<AssetInventoryEvent>(events, "asset_inventory").filter((e) => e.asset_id === "PS03-UNK-01");
    expect(inv[0]).toMatchObject({ change_type: "added", vendor: "Unknown", asset_type: "unknown", ip_address: "10.20.3.200" });
    expect(inv.at(-1)?.change_type).toBe("removed");

    const scan = of<NetworkFlowsEvent>(events, "network_flows").filter((f) => f.src_asset_id === "PS03-UNK-01" && ts(f) < inst.startMs + 5 * MIN);
    expect(new Set(scan.map((f) => f.dst_port))).toEqual(new Set([502, 20000, 4840]));
    expect(new Set(scan.map((f) => f.dst_ip)).size).toBe(50);
    expect(scan.filter((f) => f.connection_state === "syn_only").length).toBeGreaterThan(100);
    const span = (Math.max(...scan.map(ts)) - Math.min(...scan.map(ts))) / MIN;
    expect(span).toBeLessThan(5);

    const reads = of<ProtocolEventsEvent>(events, "protocol_events").filter((e) => e.initiator_asset_id === "PS03-UNK-01");
    expect(reads.every((r) => r.operation === "read")).toBe(true);
    expect(new Set(reads.map((r) => r.asset_id))).toEqual(new Set(["PS03-PLC-01", "PS03-PLC-02", "PS03-PLC-03"]));
  });
});

describe("unauthorised_logic_change", () => {
  // Monday 16 November 2026, 12:00 local: the next change window is Tuesday 10:00–14:00.
  const MON_NOON = localToUtc("2026-11-16", 12, 0);

  it("downloads a program from the HMI outside the change window and changes only the checksum", async () => {
    const { inst, events } = await runScenario("PS01", MON_NOON, 120, "unauthorised_logic_change", "now");
    const dl = of<ProtocolEventsEvent>(events, "protocol_events").find((e) => e.operation === "program_download");
    expect(dl).toMatchObject({ asset_id: "PS01-PLC-01", initiator_asset_id: "PS01-HMI-01", function_code: 90, firmware_version: "3.2.1" });
    expect(dl?.logic_checksum_before).not.toBe(dl?.logic_checksum_after);
    const modified = of<AssetInventoryEvent>(events, "asset_inventory").find((e) => e.change_type === "modified");
    expect(modified).toMatchObject({ asset_id: "PS01-PLC-01", firmware_version: "3.2.1", logic_checksum: dl?.logic_checksum_after });
    expect(localTime(inst.startMs).isoWeekday).toBe(1);
  });

  it("makes the lead pump short-cycle, then restores the program in the next change window", async () => {
    const start = MON_NOON;
    const { events } = await runScenario("PS01", start - 4 * 3600_000, 30 * 60, "unauthorised_logic_change", start);
    const run = of<ProcessTelemetryEvent>(events, "process_telemetry").filter((e) => e.tag.endsWith(".RUN") && e.value !== null);
    const transitions = (fromMs: number, toMs: number): number => {
      const byTag = new Map<string, number[]>();
      for (const e of run) if (ts(e) >= fromMs && ts(e) < toMs) byTag.set(e.tag, [...(byTag.get(e.tag) ?? []), e.value ?? 0]);
      let n = 0;
      for (const v of byTag.values()) for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1]) n++;
      return n;
    };
    expect(transitions(start + 5 * MIN, start + 4 * 3600_000)).toBeGreaterThan(5 * transitions(start - 4 * 3600_000, start) + 10);
    const downloads = of<ProtocolEventsEvent>(events, "protocol_events").filter((e) => e.operation === "program_download");
    expect(downloads).toHaveLength(2);
    const restore = downloads[1]!;
    expect(restore.initiator_asset_id).toBe("PS01-EWS-01");
    expect(localTime(ts(restore))).toMatchObject({ isoWeekday: 2, hour: 10 });
    expect(restore.logic_checksum_after).toBe(downloads[0]?.logic_checksum_before);
  });

  it("an on-demand trigger inside the change window is moved to just after it", () => {
    const tuesday11 = localToUtc("2026-11-17", 11, 0);
    expect(localTime(DRIVERS.unauthorised_logic_change.defaultStart(tuesday11))).toMatchObject({ hour: 14, minute: 5 });
  });
});

describe("random scheduling and compliance signals", () => {
  it("injects random scenarios at a low, deterministic rate", async () => {
    const run = async () => {
      const engine = engineFor("PS02", new MemoryStore(), { randomScenarioRatePerMinute: 2 / 1440 });
      const sink = new MemorySink();
      engine.start(WED_MIDNIGHT_ADL);
      engine.simulate(3 * 1440);
      await flushAll(engine, sink);
      return of<ScenarioLogEvent>(eventsByStream(sink.files), "scenario_log").map((s) => `${s.scenario_name}:${s.step}`);
    };
    const a = await run();
    expect(a.length).toBeGreaterThan(0);
    expect(await run()).toEqual(a);
  });

  it("head office degrades the matching controls after a scenario signal", async () => {
    const ho = engineFor("HO");
    ho.start(WED_MIDNIGHT_ADL);
    const site = engineFor("PS03", new MemoryStore(), { onSignal: (c, t) => ho.recordSignal(c, t) });
    site.start(WED_MIDNIGHT_ADL);
    site.scheduleScenario("rogue_setpoint", "next_window");
    site.simulate(180);
    ho.simulate(1440);
    const sink = new MemorySink();
    await flushAll(ho, sink);
    const rows = of<ComplianceEvidenceEvent>(eventsByStream(sink.files), "compliance_evidence");
    expect(rows.find((r) => r.control_id === "E8-MFA")).toMatchObject({ status: "partially_compliant", maturity_level: 1 });
    expect(rows.find((r) => r.control_id === "CIRMP-REM-02")?.status).toBe("partially_compliant");
    expect(rows.find((r) => r.control_id === "CIRMP-CHG-03")?.status).toBe("compliant");
  });
});
