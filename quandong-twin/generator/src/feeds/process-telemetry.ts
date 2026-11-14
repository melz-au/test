import type { ProcessTelemetryEvent } from "../contracts/generated.ts";
import { pumpController, assetByRole, type Asset } from "../model/assets.ts";
import type { MinuteReading } from "../model/physics.ts";
import type { Rng } from "../model/rng.ts";
import { envelope, type FeedContext } from "./envelope.ts";

const DROPOUT_P = 0.0015;
const UNCERTAIN_P = 0.0005;

interface TagValue {
  tag: string;
  asset: Asset;
  value: number;
  unit: ProcessTelemetryEvent["unit"];
  decimals: number;
}

export function tagsFor(siteId: string, assets: readonly Asset[], r: MinuteReading): TagValue[] {
  const tags: TagValue[] = [];
  r.flowsLps.forEach((flow, i) => {
    const plc = pumpController(assets, i + 1);
    tags.push({ tag: `${siteId}.PUMP${i + 1}.FLOW_LPS`, asset: plc, value: flow, unit: "L/s", decimals: 2 });
    tags.push({ tag: `${siteId}.PUMP${i + 1}.RUN`, asset: plc, value: r.running[i] ? 1 : 0, unit: "state", decimals: 0 });
  });
  const cl2 = assetByRole(assets, "chlorine");
  const rtu = assetByRole(assets, "reservoir");
  tags.push({ tag: `${siteId}.CL2.DOSE_MGL`, asset: cl2, value: r.cl2Mgl, unit: "mg/L", decimals: 3 });
  tags.push({ tag: `${siteId}.CL2.SETPOINT_MGL`, asset: cl2, value: r.setpointMgl, unit: "mg/L", decimals: 2 });
  tags.push({ tag: `${siteId}.RES.LEVEL_PCT`, asset: rtu, value: r.levelPct, unit: "%", decimals: 2 });
  tags.push({ tag: `${siteId}.MAIN.PRESSURE_KPA`, asset: rtu, value: r.pressureKpa, unit: "kPa", decimals: 1 });
  return tags;
}

const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

export function telemetryRows(
  ctx: FeedContext,
  minuteMs: number,
  assets: readonly Asset[],
  reading: MinuteReading,
  rng: Rng,
): ProcessTelemetryEvent[] {
  return tagsFor(ctx.siteId, assets, reading).map((t) => {
    const u = rng.float();
    const quality: ProcessTelemetryEvent["quality"] = u < DROPOUT_P ? "bad" : u < DROPOUT_P + UNCERTAIN_P ? "uncertain" : "good";
    return {
      ...envelope(ctx, "process_telemetry", minuteMs, t.tag),
      tag: t.tag,
      asset_id: t.asset.asset_id,
      value: quality === "bad" ? null : round(t.value, t.decimals),
      unit: t.unit,
      quality,
    };
  });
}
