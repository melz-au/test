/**
 * rogue_device — an unknown device is plugged into a pump station network.
 *
 *  +0       a new asset appears in the inventory (vendor "Unknown")
 *  +1..+3   it scans the site subnet on ports 502 (Modbus), 20000 (DNP3) and 4840 (OPC UA)
 *  +2       the sensor raises a medium "network scan" alert
 *  +5..+14  it sends read-only Modbus requests (device identification, holding registers) to every PLC
 *  +180     the device disappears (unplugged); a "removed" inventory row is emitted
 */
import { inventoryRow } from "../feeds/asset-inventory.ts";
import { flowRow } from "../feeds/network-flows.ts";
import { protocolRow, readPoll } from "../feeds/protocol-events.ts";
import { alertRow } from "../feeds/security-alerts.ts";
import { siteSubnet, type Asset } from "../model/assets.ts";
import { hexToken } from "../model/ids.ts";
import { at, offsetMinutes } from "./helpers.ts";
import type { ScenarioDriver } from "./types.ts";

const SCAN_PORTS = [502, 20000, 4840] as const;
const SCAN_HOSTS = 50; // .1 – .50
const PROTOCOL_BY_PORT = { 502: "Modbus/TCP", 20000: "DNP3", 4840: "OPC UA" } as const;

function rogueAsset(siteId: string, subnet: string, startMs: number): Asset {
  const id = `${siteId}-UNK-01`;
  const h = hexToken(id, "mac", startMs);
  return {
    asset_id: id,
    asset_type: "unknown",
    vendor: "Unknown",
    model: "Unknown",
    firmware_version: null,
    logic_checksum: null,
    ip_address: `${subnet}.200`,
    mac_address: `02:${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}:${h.slice(6, 8)}:7e`,
    purdue_level: 2,
    criticality: "medium",
    first_seen_ms: startMs,
    role: "rogue",
  };
}

export const rogueDevice: ScenarioDriver = {
  name: "rogue_device",
  attackMinutes: 15,
  defaultStart: (nowMs) => nowMs,
  supports: (site) => site.role === "pump_station",
  onMinute(ctx, inst, m) {
    const t = offsetMinutes(inst.startMs, m);
    const subnet = siteSubnet(ctx.site);
    let rogue = ctx.assets.find((a) => a.role === "rogue");
    if (t === 0 && !rogue) {
      rogue = rogueAsset(ctx.site.id, subnet, m);
      ctx.assets.push(rogue);
      const row = ctx.emit("asset_inventory", inventoryRow(ctx.feed, at(m, 5), rogue, "added"));
      ctx.logStep(inst, at(m, 5), 1, "new_asset", "T0864", ["QD-005"], [row], "An unregistered device from an unknown vendor appears on the site network.");
      ctx.signal("CIRMP-ASSET-04", m);
    }
    if (!rogue) return true;

    if (t >= 1 && t <= 3) {
      // Spread the sweep over three minutes: one third of the hosts per minute, all three ports.
      const perMinute = Math.ceil(SCAN_HOSTS / 3);
      const ids: string[] = [];
      for (let host = 1 + (t - 1) * perMinute; host <= Math.min(SCAN_HOSTS, t * perMinute); host++) {
        const ip = `${subnet}.${host}`;
        const asset = ctx.assets.find((a) => a.ip_address === ip);
        for (const port of SCAN_PORTS) {
          const listening = !!asset && ((port === 502 && (asset.asset_type === "plc" || asset.asset_type === "rtu")) || (port === 4840 && asset.asset_type === "hmi"));
          const state = !asset ? "syn_only" : listening ? "established" : "rejected";
          const row = ctx.emit("network_flows", flowRow(ctx.feed, m, {
            src: rogue, dst: asset ?? { ip }, dstPort: port, protocol: listening ? PROTOCOL_BY_PORT[port] : "OTHER",
            direction: "internal", state, bytes: state === "established" ? 180 : state === "rejected" ? 120 : 60,
            packets: state === "syn_only" ? 1 : state === "rejected" ? 2 : 4,
          }));
          ids.push(row.event_id);
        }
      }
      ((inst.data.scan ??= []) as string[]).push(...ids);
      if (t === 3) {
        const evidence = (inst.data.scan as string[]).slice(0, 25).map((event_id) => ({ event_id }));
        ctx.logStep(inst, at(m, 50), 2, "port_scan", "T0846", ["QD-006"], evidence,
          `The device probes ${SCAN_HOSTS} addresses on ports 502, 20000 and 4840.`);
      }
    }
    if (t === 2) {
      ctx.emit("security_alerts", alertRow(ctx.feed, at(m, 40), "rogue-scan", {
        ruleId: "QS-1300", ruleName: "Network scan detected", severity: "medium", technique: "T0846",
        assetId: rogue.asset_id, srcIp: rogue.ip_address, description: "Host contacted many addresses on industrial ports.", status: "new",
      }));
    }
    if (t >= 5 && t < 15) {
      const plcs = ctx.assets.filter((a) => a.asset_type === "plc");
      const evidence = [];
      for (const plc of plcs) {
        const id = ctx.emit("protocol_events", protocolRow(ctx.feed, at(m, 20), "rogue-read", { ...readPoll(rogue, plc, 6, null), function_code: t === 5 ? 43 : 3, register_or_point: t === 5 ? "device-identification" : "40001-40125" }));
        evidence.push(id);
        ctx.emit("network_flows", flowRow(ctx.feed, m, {
          src: rogue, dst: plc, dstPort: 502, protocol: "Modbus/TCP", direction: "internal", bytes: 1400, packets: 24,
        }));
      }
      if (t === 5) {
        ctx.logStep(inst, at(m, 20), 3, "plc_enumeration", "T0888", [], evidence, "The device reads identification and registers from every PLC (read-only).");
      }
    }
    if (t >= 180) {
      ctx.emit("asset_inventory", inventoryRow(ctx.feed, at(m, 0), rogue, "removed"));
      ctx.assets.splice(ctx.assets.indexOf(rogue), 1);
      return true;
    }
    return false;
  },
};
