import type { ComplianceEvidenceEvent } from "../contracts/generated.ts";
import { REFERENCE } from "../contracts/reference.generated.ts";
import type { Rng } from "../model/rng.ts";
import { DAY_MS } from "../model/time.ts";
import { envelope, type FeedContext } from "./envelope.ts";

interface Control {
  framework: ComplianceEvidenceEvent["framework"];
  id: string;
  name: string;
  /** Normal maturity level for Essential Eight controls. */
  maturity?: number;
}

export const CONTROLS: readonly Control[] = [
  { framework: "Essential Eight", id: "E8-APPCTL", name: "Application control", maturity: 2 },
  { framework: "Essential Eight", id: "E8-PATCH-APP", name: "Patch applications", maturity: 2 },
  { framework: "Essential Eight", id: "E8-MACRO", name: "Configure Microsoft Office macro settings", maturity: 3 },
  { framework: "Essential Eight", id: "E8-HARDEN", name: "User application hardening", maturity: 2 },
  { framework: "Essential Eight", id: "E8-ADMIN", name: "Restrict administrative privileges", maturity: 2 },
  { framework: "Essential Eight", id: "E8-PATCH-OS", name: "Patch operating systems", maturity: 1 },
  { framework: "Essential Eight", id: "E8-MFA", name: "Multi-factor authentication", maturity: 2 },
  { framework: "Essential Eight", id: "E8-BACKUP", name: "Regular backups", maturity: 3 },
  { framework: "CIRMP", id: "CIRMP-CYB-01", name: "Cyber and information security hazards framework maintained" },
  { framework: "CIRMP", id: "CIRMP-REM-02", name: "Third-party remote access governed and monitored" },
  { framework: "CIRMP", id: "CIRMP-CHG-03", name: "OT change management enforced" },
  { framework: "CIRMP", id: "CIRMP-ASSET-04", name: "OT asset register complete and current" },
];

/** Signals raised by the simulation that degrade a control for 7 days. */
export type ComplianceSignals = Record<string, number>;
export const SIGNAL_TTL_MS = 7 * DAY_MS;

const SIGNAL_EFFECT: Record<string, { status: ComplianceEvidenceEvent["status"]; note: string }> = {
  "E8-MFA": { status: "partially_compliant", note: "Repeated MFA push denials followed by an approval were observed for a vendor account." },
  "CIRMP-REM-02": { status: "partially_compliant", note: "A vendor remote access session occurred outside the approved maintenance hours." },
  "CIRMP-CHG-03": { status: "non_compliant", note: "A controller program download occurred outside the approved change window." },
  "CIRMP-ASSET-04": { status: "partially_compliant", note: "An unregistered device was observed on a site OT network." },
};

export function complianceRows(
  ctx: FeedContext,
  tsMs: number,
  localDate: string,
  signals: ComplianceSignals,
  rng: Rng,
): ComplianceEvidenceEvent[] {
  return CONTROLS.map((c) => {
    const signalled = signals[c.id] !== undefined && tsMs - (signals[c.id] ?? 0) < SIGNAL_TTL_MS;
    let status: ComplianceEvidenceEvent["status"] = "compliant";
    let maturity = c.maturity ?? null;
    let notes: string | null = null;
    if (signalled) {
      const effect = SIGNAL_EFFECT[c.id];
      if (effect) ({ status, note: notes } = effect);
      if (maturity !== null) maturity = Math.max(0, maturity - 1);
    } else if (c.id === "E8-PATCH-OS" && rng.chance(0.3)) {
      status = "partially_compliant";
      notes = "Two site HMIs are awaiting the monthly operating system patch.";
    } else if (rng.chance(0.02)) {
      status = "not_assessed";
      notes = "Evidence collection job did not complete.";
    }
    return {
      ...envelope(ctx, "compliance_evidence", tsMs, c.id),
      framework: c.framework,
      control_id: c.id,
      control_name: c.name,
      maturity_level: c.framework === "Essential Eight" ? maturity : null,
      status,
      evidence_ref: `evidence://${REFERENCE.customer.id}/${localDate}/${c.id}`,
      assessment_date: localDate,
      notes,
    };
  });
}
