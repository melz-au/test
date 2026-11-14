/** Checks that landed output contains the expected rogue_setpoint sequence (used by the smoke test). */
import type {
  AnyEvent,
  NetworkFlowsEvent,
  ProcessTelemetryEvent,
  ProtocolEventsEvent,
  RemoteAccessEvent,
  ScenarioLogEvent,
  SecurityAlertsEvent,
  Stream,
} from "../../generator/src/contracts/generated.ts";
import { localTime } from "../../generator/src/model/time.ts";
import { contractErrors } from "../../generator/test/helpers/contracts.ts";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const ts = (e: { event_ts: string }): number => Date.parse(e.event_ts);
const MIN = 60_000;

export function checkRogueSetpoint(events: Map<Stream, AnyEvent[]>, siteId: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };
  const get = <T extends AnyEvent>(s: Stream): T[] =>
    ((events.get(s) ?? []) as T[]).filter((e) => e.site_id === siteId).sort((a, b) => ts(a) - ts(b));

  let invalid = 0;
  let total = 0;
  for (const [stream, list] of events) {
    for (const e of list) {
      total++;
      if (contractErrors(stream, e).length) invalid++;
    }
  }
  add("every event validates against its contract", invalid === 0 && total > 0, `${total} events, ${invalid} invalid`);

  const ra = get<RemoteAccessEvent>("remote_access").filter((e) => e.user_type === "vendor");
  const denials = ra.filter((e) => e.mfa_result === "denied");
  const firstDenial = denials[0];
  const started = firstDenial ? ra.find((e) => e.session_state === "started" && ts(e) > ts(firstDenial)) : undefined;
  add("≥3 MFA denials then an approval for the vendor account", denials.length >= 3 && !!started && !!firstDenial && ts(started) - ts(firstDenial) <= 15 * MIN,
    `${denials.length} denials, approval ${started ? "found" : "missing"}`);
  const lt = started ? localTime(ts(started)) : null;
  add("vendor session starts out of hours (02:xx Australia/Adelaide)", lt?.hour === 2, lt ? `${lt.date} ${String(lt.hour).padStart(2, "0")}:${String(lt.minute).padStart(2, "0")} local, from ${started?.source_country ?? "?"}` : "no session");

  const rdp = get<NetworkFlowsEvent>("network_flows").filter((f) => f.protocol === "RDP" && started && f.dst_asset_id === started.target_asset_id && ts(f) >= ts(started) - MIN);
  add("RDP traffic to the engineering host during the session", rdp.length >= 10, `${rdp.length} one-minute RDP flows`);

  const write = get<ProtocolEventsEvent>("protocol_events").find((e) => e.operation === "write" && (e.register_or_point ?? "").includes("CL2.SETPOINT_MGL") && (e.new_value ?? 0) > 1.5);
  add("Modbus write raises the chlorine setpoint out of band, from the engineering host, after login",
    !!write && !!started && ts(write) > ts(started) && write.initiator_asset_id === started.target_asset_id,
    write ? `${write.old_value ?? "?"} → ${write.new_value ?? "?"} mg/L by ${write.initiator_asset_id ?? "?"}` : "no write");

  const cl2 = get<ProcessTelemetryEvent>("process_telemetry").filter((e) => e.tag.endsWith(".CL2.DOSE_MGL") && e.value !== null);
  const high = write ? cl2.filter((e) => ts(e) > ts(write) && (e.value ?? 0) > 1.5) : [];
  const toHigh = write && high[0] ? (ts(high[0]) - ts(write)) / MIN : NaN;
  add("chlorine residual rises above 1.5 mg/L within 10–40 minutes", toHigh >= 10 && toHigh <= 40, `${Number.isNaN(toHigh) ? "never" : `${toHigh.toFixed(1)} min`} after the write`);
  add("chlorine stays out of band for more than 10 minutes", high.length > 10, `${high.length} minutes above 1.5 mg/L, peak ${Math.max(0, ...high.map((e) => e.value ?? 0)).toFixed(2)} mg/L`);

  const alerts = get<SecurityAlertsEvent>("security_alerts").filter((a) => write && ts(a) >= ts(write) && ts(a) < ts(write) + 60 * MIN);
  add("the sensor raises only a medium alert", alerts.some((a) => a.severity === "medium") && !alerts.some((a) => a.severity === "high" || a.severity === "critical"),
    alerts.map((a) => `${a.rule_id}/${a.severity}`).join(", ") || "none");

  const log = get<ScenarioLogEvent>("scenario_log");
  const ids = new Set([...events.entries()].filter(([s]) => s !== "scenario_log").flatMap(([, l]) => l.map((e) => e.event_id)));
  const dangling = log.flatMap((s) => s.evidence_event_ids).filter((id) => !ids.has(id));
  add("ground truth logs all 5 steps with evidence that resolves", log.length === 5 && dangling.length === 0, `${log.map((s) => s.step_name).join(" → ")}; ${dangling.length} dangling IDs`);

  const order = [denials[0], started, write, high[0]].map((e) => (e ? ts(e) : NaN));
  add("steps happen in order: MFA fatigue → session → write → process impact", order.every((t, i) => i === 0 || t > (order[i - 1] ?? Infinity)), order.map((t) => (Number.isNaN(t) ? "?" : new Date(t).toISOString().slice(11, 19))).join(" → "));
  return checks;
}
