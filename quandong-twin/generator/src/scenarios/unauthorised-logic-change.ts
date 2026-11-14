/**
 * unauthorised_logic_change — a PLC program is downloaded outside the change window, from the HMI.
 *
 *  +0   HMI performs a program_download to the pump PLC (function 90); firmware unchanged,
 *       logic checksum changes. The sensor raises only a LOW "controller mode change" alert.
 *  +1   inventory reports the PLC as modified (new logic checksum)
 *  +1…  the modified logic short-cycles the lead pump (odd duty cycle visible in telemetry)
 *  +30  ground-truth step for the observable process effect
 *  next change window: the engineering workstation (or HMI) restores the original program.
 */
import { REFERENCE } from "../contracts/reference.generated.ts";
import { inventoryRow } from "../feeds/asset-inventory.ts";
import { flowRow } from "../feeds/network-flows.ts";
import { protocolRow } from "../feeds/protocol-events.ts";
import { alertRow } from "../feeds/security-alerts.ts";
import { assetByRole, initialLogicChecksum, pumpController } from "../model/assets.ts";
import { hexToken } from "../model/ids.ts";
import { inChangeWindow, localTime } from "../model/time.ts";
import { at, offsetMinutes, outsideChangeWindow } from "./helpers.ts";
import type { ScenarioDriver } from "./types.ts";

export const unauthorisedLogicChange: ScenarioDriver = {
  name: "unauthorised_logic_change",
  attackMinutes: 30,
  defaultStart: (nowMs) => outsideChangeWindow(nowMs),
  supports: (site) => site.role === "pump_station",
  onMinute(ctx, inst, m) {
    const t = offsetMinutes(inst.startMs, m);
    const plc = pumpController(ctx.assets, 1);
    const hmi = assetByRole(ctx.assets, "hmi");
    if (t === 0) {
      const before = plc.logic_checksum;
      const after = hexToken(plc.asset_id, "logic", inst.id);
      ctx.emit("network_flows", flowRow(ctx.feed, m, {
        src: hmi, dst: plc, dstPort: 502, protocol: "Modbus/TCP", direction: "internal", bytes: 212_000, packets: 410,
      }));
      const dl = ctx.emit("protocol_events", protocolRow(ctx.feed, at(m, 17), "logic-download", {
        target: plc,
        initiator: hmi,
        protocol: "Modbus/TCP",
        function_code: 90,
        operation: "program_download",
        register_or_point: null,
        old_value: null,
        new_value: null,
        user_context: "hmi:operator",
        command_count: 1,
        result: "success",
        logic_checksum_before: before,
        logic_checksum_after: after,
      }));
      plc.logic_checksum = after;
      inst.data.originalChecksum = before;
      ctx.emit("security_alerts", alertRow(ctx.feed, at(m, 25), "logic-mode", {
        ruleId: "QS-1102", ruleName: "Controller mode change", severity: "low", technique: "T0858",
        assetId: plc.asset_id, srcIp: hmi.ip_address, description: "Controller switched to program mode and back to run.", status: "new",
      }));
      ctx.logStep(inst, at(m, 17), 1, "program_download", "T0843", ["QD-007"], [dl],
        "The HMI (not the engineering workstation) downloads a new program to the pump PLC outside the change window.");
      ctx.signal("CIRMP-CHG-03", m);
    }
    if (t === 1) {
      ctx.emit("asset_inventory", inventoryRow(ctx.feed, at(m, 3), plc, "modified"));
      if (ctx.physics) ctx.physics.logicTampered = true;
    }
    if (t === 30) {
      const run = ctx.emitted("process_telemetry").filter((e) => e.tag.endsWith(".PUMP1.RUN") || e.tag.endsWith(".PUMP2.RUN"));
      ctx.logStep(inst, m, 2, "pump_short_cycling", "T0831", [], run, "The modified logic short-cycles the lead pump regardless of reservoir level.");
    }
    // Restore at the next change window, 15 minutes after it opens.
    const lt = localTime(m);
    if (t > 30 && inChangeWindow(m) && lt.hour === REFERENCE.change_window.start_hour && lt.minute === 15) {
      const engineer = ctx.assets.find((a) => a.asset_type === "engineering_workstation") ?? hmi;
      const original = (inst.data.originalChecksum as string | undefined) ?? initialLogicChecksum(plc.asset_id);
      ctx.emit("protocol_events", protocolRow(ctx.feed, at(m, 40), "logic-restore", {
        target: plc,
        initiator: engineer,
        protocol: "Modbus/TCP",
        function_code: 90,
        operation: "program_download",
        register_or_point: null,
        old_value: null,
        new_value: null,
        user_context: "ews:controls.engineer",
        command_count: 1,
        result: "success",
        logic_checksum_before: plc.logic_checksum,
        logic_checksum_after: original,
      }));
      plc.logic_checksum = original;
      ctx.emit("asset_inventory", inventoryRow(ctx.feed, at(m, 50), plc, "modified"));
      if (ctx.physics) ctx.physics.logicTampered = false;
      return true;
    }
    return false;
  },
};
