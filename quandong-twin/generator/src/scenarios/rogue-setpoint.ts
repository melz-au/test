/**
 * rogue_setpoint — out-of-hours vendor session leads to a malicious chlorine setpoint change.
 *
 *  +0..+2  three MFA push denials for the vendor account from an unusual country   (MFA fatigue)
 *  +3      fourth push approved; vendor RDP session starts at 02:00 local          (out of hours)
 *  +5      the engineering workstation writes CL2.SETPOINT_MGL = 3.8 mg/L to the PLC (Modbus write)
 *  +6      the sensor raises only a MEDIUM alert (it under-rates the change)
 *  +~20    chlorine residual crosses 1.5 mg/L and keeps rising for 20–40 minutes
 *  +45     session ends
 *  +90     an operator notices and restores the setpoint to 1.0 mg/L from the HMI
 */
import { flowRow } from "../feeds/network-flows.ts";
import { pointName, protocolRow } from "../feeds/protocol-events.ts";
import { sessionRow, VENDOR_USER, type SessionSpec } from "../feeds/remote-access.ts";
import { alertRow } from "../feeds/security-alerts.ts";
import { REMOTE_ACCESS_GATEWAY_IP, assetByRole } from "../model/assets.ts";
import { NORMAL_SETPOINT_MGL } from "../model/physics.ts";
import { remoteTarget } from "../model/plan.ts";
import { rngFor } from "../model/rng.ts";
import { MINUTE_MS, floorTo } from "../model/time.ts";
import { at, nextLocal, offsetMinutes } from "./helpers.ts";
import type { ScenarioDriver } from "./types.ts";

export const MALICIOUS_SETPOINT_MGL = 3.8;
const ATTACKER_IP = "192.0.2.77"; // RFC 5737 documentation range
const ATTACKER_COUNTRY = "BR";

export const rogueSetpoint: ScenarioDriver = {
  name: "rogue_setpoint",
  attackMinutes: 90,
  defaultStart: (nowMs) => nextLocal(nowMs, 2, 0),
  supports: (site) => site.role === "pump_station",
  onMinute(ctx, inst, m) {
    const t = offsetMinutes(inst.startMs, m);
    const target = remoteTarget(ctx.assets);
    const plc = assetByRole(ctx.assets, "chlorine");
    const hmi = assetByRole(ctx.assets, "hmi");
    const start = floorTo(inst.startMs, MINUTE_MS);
    const session: SessionSpec = {
      sessionId: `RA-${inst.id.slice(-13)}`,
      username: VENDOR_USER,
      userType: "vendor",
      sourceIp: ATTACKER_IP,
      sourceCountry: ATTACKER_COUNTRY,
      mfaMethod: "push",
      targetAssetId: target.asset_id,
      protocol: "RDP",
      startMs: at(start + 3 * MINUTE_MS, 12),
      endMs: at(start + 45 * MINUTE_MS, 40),
    };

    if (t >= 0 && t <= 2) {
      const denied = ctx.emit(
        "remote_access",
        sessionRow(ctx.feed, at(m, 10 + t * 7), { ...session, sessionId: `${session.sessionId}-D${t + 1}`, startMs: at(m, 10 + t * 7) }, "rejected", "denied"),
      );
      ((inst.data.denials ??= []) as string[]).push(denied.event_id);
      if (t === 2) {
        ctx.logStep(inst, at(m, 24), 1, "mfa_fatigue", "T0859", ["QD-002"], (inst.data.denials as string[]).map((event_id) => ({ event_id })),
          "Three MFA push requests for the vendor account are denied from an unfamiliar country.");
      }
    }
    if (t === 3) {
      const started = ctx.emit("remote_access", sessionRow(ctx.feed, session.startMs, session, "started", "accepted"));
      ctx.logStep(inst, session.startMs, 2, "out_of_hours_vendor_session", "T0822", ["QD-001", "QD-002"], [started],
        "The fourth push is approved and an out-of-hours vendor RDP session starts to the engineering host.");
      ctx.signal("E8-MFA", session.startMs);
      ctx.signal("CIRMP-REM-02", session.startMs);
    }
    if (t >= 3 && t < 45) {
      const rng = rngFor(ctx.seed, ctx.site.id, m, "scenario-rdp");
      ctx.emit("network_flows", flowRow(ctx.feed, m, {
        src: { ip: REMOTE_ACCESS_GATEWAY_IP }, dst: target, dstPort: 3389, protocol: "RDP", direction: "inbound",
        bytes: 400_000 + rng.int(0, 600_000), packets: 1200 + rng.int(0, 900),
      }));
    }
    if (t === 5 && ctx.physics) {
      ctx.emit("network_flows", flowRow(ctx.feed, m, {
        src: target, dst: plc, dstPort: 502, protocol: "Modbus/TCP", direction: "internal", bytes: 420, packets: 8,
      }));
      const write = ctx.emit("protocol_events", protocolRow(ctx.feed, at(m, 31), "rogue-write", {
        target: plc,
        initiator: target,
        protocol: "Modbus/TCP",
        function_code: 6,
        operation: "write",
        register_or_point: pointName(ctx.site.id, "CL2.SETPOINT_MGL"),
        old_value: ctx.physics.setpointMgl,
        new_value: MALICIOUS_SETPOINT_MGL,
        user_context: `ews:${VENDOR_USER}`,
        command_count: 1,
        result: "success",
        logic_checksum_before: null,
        logic_checksum_after: null,
      }));
      ctx.physics.setpointMgl = MALICIOUS_SETPOINT_MGL;
      ctx.logStep(inst, at(m, 31), 3, "setpoint_write", "T0836", ["QD-003"], [write],
        `The engineering host writes the chlorine dosing setpoint to ${MALICIOUS_SETPOINT_MGL} mg/L, well above the 0.5–1.5 mg/L band.`);
    }
    if (t === 6) {
      const alert = ctx.emit("security_alerts", alertRow(ctx.feed, at(m, 2), "rogue-setpoint", {
        ruleId: "QS-2040",
        ruleName: "Modbus write to configuration register",
        severity: "medium",
        technique: "T0836",
        assetId: plc.asset_id,
        srcIp: target.ip_address,
        description: "Write to a holding register flagged as configuration. Value change within device limits.",
        status: "new",
      }));
      ctx.logStep(inst, at(m, 2), 4, "sensor_alert_underrated", "T0836", [], [alert],
        "The sensor raises only a medium-severity alert for the setpoint change.");
    }
    if (t > 5 && !inst.data.outOfBandLogged && ctx.physics && ctx.physics.cl2Mgl > 1.5) {
      const row = ctx.emitted("process_telemetry").find((e) => e.tag.endsWith(".CL2.DOSE_MGL"));
      inst.data.outOfBandLogged = true;
      ctx.logStep(inst, m, 5, "process_manipulation", "T0831", ["QD-004"], row ? [row] : [],
        "Chlorine residual rises above 1.5 mg/L and keeps climbing.");
    }
    if (t === 45) ctx.emit("remote_access", sessionRow(ctx.feed, session.endMs, session, "ended", "accepted"));
    if (t === 90 && ctx.physics) {
      ctx.emit("protocol_events", protocolRow(ctx.feed, at(m, 15), "operator-restore", {
        target: plc,
        initiator: hmi,
        protocol: "Modbus/TCP",
        function_code: 6,
        operation: "write",
        register_or_point: pointName(ctx.site.id, "CL2.SETPOINT_MGL"),
        old_value: ctx.physics.setpointMgl,
        new_value: NORMAL_SETPOINT_MGL,
        user_context: "hmi:oncall.operator",
        command_count: 1,
        result: "success",
        logic_checksum_before: null,
        logic_checksum_after: null,
      }));
      ctx.physics.setpointMgl = NORMAL_SETPOINT_MGL;
      return true;
    }
    return false;
  },
};
