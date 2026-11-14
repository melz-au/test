/** Deployment configuration shared by the Worker, the Durable Object and the Node scripts. */
import { HEAD_OFFICE_ID, pumpStations, type SiteSpec } from "./model/sites.ts";
import type { VolumeLocation } from "./sink/types.ts";

export interface TwinConfig {
  seed: string;
  runId: string;
  siteCount: number;
  /** Simulated minutes per Durable Object alarm (1 by default; raise it to scale to 40 sites). */
  tickMinutes: number;
  flushWindowMinutes: number;
  maxCatchUpMinutes: number;
  /** Random scenarios per site per day (0 disables). */
  randomScenariosPerSiteDay: number;
  location: VolumeLocation;
}

export interface ConfigVars {
  SIM_SEED?: string;
  GENERATOR_RUN_ID?: string;
  SITE_COUNT?: string;
  TICK_MINUTES?: string;
  FLUSH_WINDOW_MINUTES?: string;
  MAX_CATCHUP_MINUTES?: string;
  RANDOM_SCENARIOS_PER_SITE_DAY?: string;
  DATABRICKS_CATALOG?: string;
  DATABRICKS_SCHEMA?: string;
  DATABRICKS_VOLUME?: string;
}

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(vars: ConfigVars): TwinConfig {
  const seed = vars.SIM_SEED ?? "quandong-mfw-1";
  const cfg: TwinConfig = {
    seed,
    runId: vars.GENERATOR_RUN_ID ?? `mfw-twin-${seed}`,
    siteCount: num(vars.SITE_COUNT, 5),
    tickMinutes: num(vars.TICK_MINUTES, 1),
    flushWindowMinutes: num(vars.FLUSH_WINDOW_MINUTES, 5),
    maxCatchUpMinutes: num(vars.MAX_CATCHUP_MINUTES, 360),
    randomScenariosPerSiteDay: num(vars.RANDOM_SCENARIOS_PER_SITE_DAY, 0.05),
    location: {
      catalog: vars.DATABRICKS_CATALOG ?? "workspace",
      schema: vars.DATABRICKS_SCHEMA ?? "quandong_twin",
      volume: vars.DATABRICKS_VOLUME ?? "landing",
    },
  };
  if (cfg.flushWindowMinutes % cfg.tickMinutes !== 0) {
    throw new Error("FLUSH_WINDOW_MINUTES must be a multiple of TICK_MINUTES");
  }
  return cfg;
}

/** Every simulated site: pump stations plus head office. */
export function allSites(cfg: TwinConfig): SiteSpec[] {
  return [...pumpStations(cfg.siteCount)];
}
export const allSiteIds = (cfg: TwinConfig): string[] => [...allSites(cfg).map((s) => s.id), HEAD_OFFICE_ID];
