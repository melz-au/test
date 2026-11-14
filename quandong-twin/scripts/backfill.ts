/**
 * Backfill: generate N days of history quickly, using the same deterministic engine as the Worker.
 * Runs in Node (no Workers CPU limits), one simulated day per chunk.
 *
 *   npm run backfill -- --site PS03 --days 7                  write ./out/backfill/Volumes/...
 *   npm run backfill -- --all --days 3                        every configured site plus head office
 *   npm run backfill -- --site PS03 --days 7 --scenario rogue_setpoint@3   inject on day 3 (02:00 local)
 *   npm run backfill -- --upload                              upload ./out/backfill to Databricks
 *
 * Upload reads DATABRICKS_HOST and DATABRICKS_TOKEN from the environment, PUTs every file with
 * overwrite=false (8 in parallel) and is safe to re-run: files already there are skipped.
 *
 * History ends at --end (default: now, rounded down to 5 minutes). Run it BEFORE the first deploy,
 * or with --end set to when the live generator started, so backfilled and live windows never overlap
 * (overlapping windows share a file name and the live file would be skipped as "already exists").
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { allSiteIds, loadConfig } from "../generator/src/config.ts";
import { SiteEngine } from "../generator/src/engine.ts";
import { HEAD_OFFICE_ID, siteById } from "../generator/src/model/sites.ts";
import { DAY_MS, MINUTE_MS, floorTo } from "../generator/src/model/time.ts";
import { isScenarioName } from "../generator/src/scenarios/types.ts";
import { DatabricksFilesSink } from "../generator/src/sink/databricks.ts";
import { MemoryStore } from "../generator/src/store.ts";
import { FileSink } from "./lib/file-sink.ts";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = resolve(opt("out") ?? "out/backfill");

async function upload(): Promise<void> {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  if (!host || !token) throw new Error("set DATABRICKS_HOST and DATABRICKS_TOKEN to upload");
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".jsonl")) files.push(p);
    }
  };
  walk(join(OUT, "Volumes"));
  const sink = new DatabricksFilesSink({ host, token, maxAttempts: 6 });
  let next = 0;
  let created = 0;
  let existing = 0;
  const failed: string[] = [];
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++];
      if (!file) break;
      const path = `/${relative(OUT, file)}`;
      const r = await sink.put(path, readFileSync(file, "utf8"));
      if (!r.ok) failed.push(`${path}: ${r.status} ${r.error}`);
      else if (r.outcome === "created") created++;
      else existing++;
      if ((created + existing) % 200 === 0) console.log(`  ${created + existing}/${files.length}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`uploaded ${created}, already present ${existing}, failed ${failed.length}`);
  if (failed.length) {
    console.error(failed.slice(0, 10).join("\n"));
    process.exit(1);
  }
}

async function generate(): Promise<void> {
  const cfg = loadConfig(process.env);
  const days = Number(opt("days") ?? "7");
  if (!(days > 0 && days <= 90)) throw new Error("--days must be between 1 and 90");
  const end = floorTo(opt("end") ? Date.parse(opt("end") ?? "") : Date.now(), cfg.flushWindowMinutes * MINUTE_MS);
  if (Number.isNaN(end) || end > Date.now()) throw new Error("--end must be a past ISO timestamp");
  const start = end - days * DAY_MS;
  const sites = flag("all") ? allSiteIds(cfg) : [opt("site") ?? "PS03"];
  const [scenarioName, scenarioDay] = (opt("scenario") ?? "").split("@");
  const sink = new FileSink(OUT);
  const ho = new SiteEngine({ seed: cfg.seed, runId: cfg.runId, site: siteById(HEAD_OFFICE_ID), flushWindowMinutes: cfg.flushWindowMinutes, maxCatchUpMinutes: Infinity }, new MemoryStore());
  ho.start(start);

  for (const siteId of sites.filter((s) => s !== HEAD_OFFICE_ID)) {
    const engine = new SiteEngine(
      {
        seed: cfg.seed,
        runId: cfg.runId,
        site: siteById(siteId),
        flushWindowMinutes: cfg.flushWindowMinutes,
        maxCatchUpMinutes: Infinity,
        randomScenarioRatePerMinute: cfg.randomScenariosPerSiteDay / 1440,
        onSignal: (c, t) => ho.recordSignal(c, t),
      },
      new MemoryStore(),
    );
    engine.start(start);
    if (scenarioName && isScenarioName(scenarioName)) {
      const day = Math.max(1, Math.min(days, Number(scenarioDay ?? "1")));
      const inst = engine.scheduleScenario(scenarioName, "next_window");
      // Move it to the requested day (same local time of day as its default start).
      inst.startMs += (day - 1) * DAY_MS;
      console.log(`${siteId}: ${scenarioName} at ${new Date(inst.startMs).toISOString()}`);
    }
    for (let d = 0; d < days; d++) {
      engine.simulate(1440);
      for (;;) {
        const r = await engine.flush(sink, cfg.location, 400);
        if (r.failed) throw new Error(r.failed.error);
        if (!r.windowsFlushed) break;
      }
      console.log(`${siteId}: day ${d + 1}/${days} done`);
    }
  }
  if (sites.includes(HEAD_OFFICE_ID)) {
    ho.simulate(days * 1440);
    for (;;) {
      const r = await ho.flush(sink, cfg.location, 400);
      if (!r.windowsFlushed) break;
    }
    console.log("HO: done");
  }
  console.log(`wrote ${sink.written.length} files under ${OUT} (${new Date(start).toISOString()} → ${new Date(end).toISOString()})`);
}

if (flag("upload")) await upload();
else await generate();
