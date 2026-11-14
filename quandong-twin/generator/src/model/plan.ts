/**
 * Daily plan of routine (non-physics) activity for a site: sensor noise alerts, vendor maintenance,
 * employee remote sessions and occasional operator setpoint adjustments.
 *
 * The plan for a local date is a pure function of (seed, site, date), so it can be recomputed at any
 * time (for example after the Durable Object is evicted) and always gives the same answer.
 */
import { REFERENCE } from "../contracts/reference.generated.ts";
import { EMPLOYEES, VENDOR_USER, type SessionSpec } from "../feeds/remote-access.ts";
import { noiseAlert, type AlertSpec } from "../feeds/security-alerts.ts";
import { assetByRole, baselineAssets, type Asset } from "./assets.ts";
import { deterministicUuid } from "./ids.ts";
import { Rng } from "./rng.ts";
import type { SiteSpec } from "./sites.ts";
import { MINUTE_MS, localTime, localToUtc } from "./time.ts";

export interface DailyPlan {
  date: string;
  noise: { tsMs: number; alert: AlertSpec }[];
  sessions: SessionSpec[];
  setpointChanges: { tsMs: number; value: number; operator: string }[];
}

const DOC_NET_EMPLOYEE = "203.0.113"; // RFC 5737 documentation range
const DOC_NET_VENDOR = "198.51.100"; // RFC 5737 documentation range

export function remoteTarget(assets: readonly Asset[]): Asset {
  return assets.find((a) => a.asset_type === "engineering_workstation") ?? assetByRole(assets, "hmi");
}

export function dailyPlan(seed: string, site: SiteSpec, date: string): DailyPlan {
  const plan: DailyPlan = { date, noise: [], sessions: [], setpointChanges: [] };
  if (site.role !== "pump_station") return plan;
  const rng = new Rng(`${seed}|${site.id}|${date}|plan`);
  const midnight = localToUtc(date, 0);
  const weekday = localTime(midnight + 12 * 60 * MINUTE_MS).isoWeekday;
  const assets = baselineAssets(site);
  const at = (hour: number, minute: number, second = 0): number => localToUtc(date, hour, minute) + second * 1000;

  // 2–5 low-severity sensor alerts at random times.
  const n = rng.int(2, 5);
  for (let i = 0; i < n; i++) {
    const minuteOfDay = rng.int(0, 1439);
    plan.noise.push({
      tsMs: at(Math.floor(minuteOfDay / 60), minuteOfDay % 60, rng.int(0, 59)),
      alert: noiseAlert(rng, assets.map((a) => a.asset_id)),
    });
  }
  plan.noise.sort((a, b) => a.tsMs - b.tsMs);

  const businessDay = (REFERENCE.business_hours.weekdays as readonly number[]).includes(weekday);

  // Weekly vendor maintenance, staggered by site so they do not all overlap.
  const vm = REFERENCE.vendor_maintenance;
  if (weekday === vm.weekday) {
    const start = at(vm.start_hour + (site.index % 4), rng.int(0, 20), rng.int(0, 59));
    plan.sessions.push({
      sessionId: `RA-${deterministicUuid(seed, site.id, date, "vendor").slice(0, 13)}`,
      username: VENDOR_USER,
      userType: "vendor",
      sourceIp: `${DOC_NET_VENDOR}.${20 + (site.index % 10)}`,
      sourceCountry: "AU",
      mfaMethod: "push",
      targetAssetId: remoteTarget(assets).asset_id,
      protocol: "RDP",
      startMs: start,
      endMs: start + (vm.duration_minutes + rng.int(-15, 15)) * MINUTE_MS,
    });
  }

  // Occasional employee session to the HMI during business hours.
  if (businessDay && rng.chance(0.35)) {
    const start = at(rng.int(8, 15), rng.int(0, 59), rng.int(0, 59));
    plan.sessions.push({
      sessionId: `RA-${deterministicUuid(seed, site.id, date, "employee").slice(0, 13)}`,
      username: rng.pick(EMPLOYEES),
      userType: "employee",
      sourceIp: `${DOC_NET_EMPLOYEE}.${rng.int(10, 60)}`,
      sourceCountry: "AU",
      mfaMethod: "totp",
      targetAssetId: assetByRole(assets, "hmi").asset_id,
      protocol: rng.pick(["HTTPS", "SSH"] as const),
      startMs: start,
      endMs: start + rng.int(15, 60) * MINUTE_MS,
    });
  }

  // Operators occasionally trim the chlorine setpoint within the normal band.
  if (businessDay && rng.chance(0.15)) {
    plan.setpointChanges.push({
      tsMs: at(rng.int(8, 16), rng.int(0, 59), rng.int(0, 59)),
      value: Math.round((0.9 + rng.float() * 0.2) * 100) / 100,
      operator: rng.pick(EMPLOYEES),
    });
  }
  return plan;
}
