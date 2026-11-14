/**
 * Asset catalogue. Each pump station has 6–10 assets; head office holds the historian and the
 * SCADA (supervisory control and data acquisition) server. All vendors and models are fictional.
 */
import type { AssetInventoryEvent } from "../contracts/generated.ts";
import { hash32 } from "./rng.ts";
import { hexToken } from "./ids.ts";
import type { SiteSpec } from "./sites.ts";

export type AssetType = AssetInventoryEvent["asset_type"];
export type Criticality = AssetInventoryEvent["criticality"];

export interface Asset {
  asset_id: string;
  asset_type: AssetType;
  vendor: string;
  model: string;
  firmware_version: string | null;
  logic_checksum: string | null;
  ip_address: string;
  mac_address: string;
  purdue_level: number;
  criticality: Criticality;
  /** When the asset was first seen (epoch ms). */
  first_seen_ms: number;
  /** What the asset does at this site, used by the simulation. */
  role: string;
}

/** Date the sensor was installed; baseline assets are first seen then. */
export const SENSOR_INSTALLED_MS = Date.UTC(2025, 6, 1);

export const HEAD_OFFICE_SUBNET = "10.10.0";
export const REMOTE_ACCESS_GATEWAY_IP = "10.10.0.5";
export const siteSubnet = (site: SiteSpec): string => `10.20.${site.index}`;

function mac(assetId: string): string {
  const h1 = hash32(`${assetId}|mac1`);
  const h2 = hash32(`${assetId}|mac2`);
  // 02: locally administered, so it can never collide with a real manufacturer prefix.
  const bytes = [0x02, h1 & 0xff, (h1 >>> 8) & 0xff, (h1 >>> 16) & 0xff, h2 & 0xff, (h2 >>> 8) & 0xff];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
}

export const initialLogicChecksum = (assetId: string): string => hexToken(assetId, "logic", "v1");

function make(
  site: SiteSpec,
  code: string,
  n: number,
  host: number,
  type: AssetType,
  vendor: string,
  model: string,
  firmware: string | null,
  purdue: number,
  criticality: Criticality,
  role: string,
  subnet?: string,
): Asset {
  const asset_id = `${site.id}-${code}-${String(n).padStart(2, "0")}`;
  const holdsLogic = type === "plc" || type === "rtu";
  return {
    asset_id,
    asset_type: type,
    vendor,
    model,
    firmware_version: firmware,
    logic_checksum: holdsLogic ? initialLogicChecksum(asset_id) : null,
    ip_address: `${subnet ?? siteSubnet(site)}.${host}`,
    mac_address: mac(asset_id),
    purdue_level: purdue,
    criticality,
    first_seen_ms: SENSOR_INSTALLED_MS,
    role,
  };
}

/** Baseline assets for a site. Order is stable and meaningful (used in tests and IDs). */
export function baselineAssets(site: SiteSpec): Asset[] {
  if (site.role === "head_office") {
    return [
      make(site, "HIS", 1, 10, "historian", "Saltbush Systems", "SS Historian 7", "7.4.2", 3, "medium", "historian", HEAD_OFFICE_SUBNET),
      make(site, "SCD", 1, 20, "scada_server", "Bunyip Automation", "BA SCADA Server 5", "5.1.0", 3, "critical", "scada", HEAD_OFFICE_SUBNET),
    ];
  }
  const assets: Asset[] = [
    make(site, "PLC", 1, 11, "plc", "Wattle Controls", "WC-420", "3.2.1", 1, "high", "pumps:1,2"),
    make(site, "PLC", 2, 12, "plc", "Wattle Controls", "WC-420", "3.2.1", 1, "critical", "chlorine"),
  ];
  if (site.pumps >= 3) assets.push(make(site, "PLC", 3, 13, "plc", "Wattle Controls", "WC-410", "3.1.4", 1, "high", "pumps:3"));
  assets.push(
    make(site, "RTU", 1, 21, "rtu", "Mallee Instruments", "MI-RTU 20", "2.8.0", 1, "high", "reservoir"),
    make(site, "HMI", 1, 31, "hmi", "Bunyip Automation", "BA Panel 15", "6.0.3", 2, "high", "hmi"),
    make(site, "SW", 1, 2, "network_switch", "Coolabah Networks", "CN-8P Industrial", "12.4", 2, "medium", "switch"),
  );
  if (site.hasEngineeringWorkstation) {
    assets.push(make(site, "EWS", 1, 41, "engineering_workstation", "Saltbush Systems", "SS Engineering Station", "W11-24H2", 2, "high", "engineering"));
  }
  return assets;
}

/** Controllers (PLCs and RTU) the HMI polls. */
export const controllers = (assets: readonly Asset[]): Asset[] =>
  assets.filter((a) => a.asset_type === "plc" || a.asset_type === "rtu");

export function assetByRole(assets: readonly Asset[], role: string): Asset {
  const a = assets.find((x) => x.role === role);
  if (!a) throw new Error(`no asset with role ${role}`);
  return a;
}

/** Controller that runs pump n (1-based). */
export function pumpController(assets: readonly Asset[], pump: number): Asset {
  const a = assets.find((x) => x.role.startsWith("pumps:") && x.role.slice(6).split(",").includes(String(pump)));
  if (!a) throw new Error(`no controller for pump ${pump}`);
  return a;
}
