import type { SecurityAlertsEvent } from "../contracts/generated.ts";
import type { Rng } from "../model/rng.ts";
import { envelope, type FeedContext } from "./envelope.ts";

export interface AlertSpec {
  ruleId: string;
  ruleName: string;
  severity: SecurityAlertsEvent["severity"];
  technique: string;
  assetId: string;
  srcIp: string | null;
  description: string;
  status: SecurityAlertsEvent["status"];
}

export function alertRow(ctx: FeedContext, tsMs: number, key: string, a: AlertSpec): SecurityAlertsEvent {
  const env = envelope(ctx, "security_alerts", tsMs, key, a.ruleId);
  return {
    ...env,
    alert_id: `SA-${env.event_id.slice(0, 8).toUpperCase()}`,
    rule_id: a.ruleId,
    rule_name: a.ruleName,
    severity: a.severity,
    mitre_attack_ics_technique: a.technique,
    asset_id: a.assetId,
    src_ip: a.srcIp,
    description: a.description,
    status: a.status,
  };
}

/** Background noise from the sensor: low-severity rules that fire a few times a day per site. */
export const NOISE_RULES: readonly Omit<AlertSpec, "assetId" | "srcIp" | "status">[] = [
  { ruleId: "QS-1001", ruleName: "Modbus exception response burst", severity: "low", technique: "T0855", description: "Controller returned a burst of Modbus exception responses (illegal data address)." },
  { ruleId: "QS-1014", ruleName: "Device identification request", severity: "low", technique: "T0888", description: "Read Device Identification (function 43/14) request observed." },
  { ruleId: "QS-1022", ruleName: "Asset clock drift", severity: "low", technique: "T0849", description: "Device clock differs from the network time source by more than 5 seconds." },
  { ruleId: "QS-1040", ruleName: "New TLS certificate observed", severity: "low", technique: "T0869", description: "A previously unseen TLS certificate was presented on an OPC UA session." },
  { ruleId: "QS-1053", ruleName: "Switch port flap", severity: "low", technique: "T0815", description: "Access port changed link state several times within a minute." },
];

export function noiseAlert(rng: Rng, assetIds: readonly string[]): AlertSpec {
  const rule = rng.pick(NOISE_RULES);
  const u = rng.float();
  return {
    ...rule,
    assetId: rng.pick(assetIds),
    srcIp: null,
    status: u < 0.5 ? "closed" : u < 0.8 ? "false_positive" : u < 0.9 ? "acknowledged" : "new",
  };
}
