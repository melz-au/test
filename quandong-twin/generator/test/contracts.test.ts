import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ALL_STREAMS, FIELDS } from "../src/contracts/generated.ts";
import { validatorFor } from "./helpers/contracts.ts";

describe("contracts", () => {
  it("generated files are up to date with the contracts", () => {
    expect(() => execFileSync("node", ["scripts/codegen.ts", "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("every stream has a JSON Schema whose required fields match the contract field order", () => {
    for (const s of ALL_STREAMS) {
      const schema = JSON.parse(readFileSync(`contracts/generated/jsonschema/${s}.schema.json`, "utf8")) as {
        required: string[];
      };
      expect(schema.required).toEqual(FIELDS[s]);
    }
  });

  it("rejects events with a wrong enum value, a missing field or an extra field", () => {
    const validate = validatorFor("security_alerts");
    const good = {
      event_id: "0d1e2f30-4152-8637-8899-aabbccddeeff",
      event_ts: "2026-11-14T02:00:00.000Z",
      customer_id: "MFW",
      site_id: "PS03",
      feed: "security_alerts",
      schema_version: "1.0.0",
      generator_run_id: "test",
      alert_id: "A-1",
      rule_id: "S-100",
      rule_name: "Test",
      severity: "low",
      mitre_attack_ics_technique: "T0836",
      asset_id: "PS03-PLC-01",
      src_ip: null,
      description: "x",
      status: "new",
    };
    expect(validate(good)).toBe(true);
    expect(validate({ ...good, severity: "urgent" })).toBe(false);
    const missing: Partial<typeof good> = { ...good };
    delete missing.status;
    expect(validate(missing)).toBe(false);
    expect(validate({ ...good, extra: 1 })).toBe(false);
    expect(validate({ ...good, event_ts: "2026-11-14 02:00" })).toBe(false);
  });
});
