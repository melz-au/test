/**
 * End-to-end smoke test: two simulated hours at PS03 with rogue_setpoint injected.
 *
 *   npm run smoke                     in-process engine → real Files API sink → fake Files API → ./out/smoke
 *   npm run smoke -- --wrangler http://localhost:8787
 *                                     drive a running `npm run dev` (with `npm run local-files-api`) instead
 *
 * The in-process mode injects 10% HTTP 503s from the fake API to exercise the sink's retries.
 * Exits non-zero if the expected sequence is not in the landed NDJSON.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../generator/src/config.ts";
import { SiteEngine } from "../generator/src/engine.ts";
import { Rng } from "../generator/src/model/rng.ts";
import { siteById } from "../generator/src/model/sites.ts";
import { localToUtc } from "../generator/src/model/time.ts";
import { DatabricksFilesSink } from "../generator/src/sink/databricks.ts";
import { MemoryStore } from "../generator/src/store.ts";
import { checkRogueSetpoint, type Check } from "./lib/check-rogue-setpoint.ts";
import { startFakeFilesApi } from "./lib/fake-files-api.ts";
import { readLanding } from "./lib/read-landing.ts";

const SITE = "PS03";
const args = process.argv.slice(2);
const wranglerUrl = args.includes("--wrangler") ? (args[args.indexOf("--wrangler") + 1] ?? "http://localhost:8787") : null;

async function inProcess(): Promise<Check[]> {
  const root = resolve("out/smoke");
  rmSync(root, { recursive: true, force: true });
  const faults = new Rng("smoke-faults");
  const api = await startFakeFilesApi({ root, port: 0, failRate: 0.1, random: () => faults.float() });
  try {
    const cfg = loadConfig({ RANDOM_SCENARIOS_PER_SITE_DAY: "0" });
    const engine = new SiteEngine(
      { seed: cfg.seed, runId: cfg.runId, site: siteById(SITE), flushWindowMinutes: 5, maxCatchUpMinutes: 360 },
      new MemoryStore(),
    );
    // Wednesday 11 November 2026, 01:40 local → 03:40 local (two simulated hours).
    engine.start(localToUtc("2026-11-11", 1, 40));
    const inst = engine.scheduleScenario("rogue_setpoint", "next_window");
    console.log(`rogue_setpoint scheduled for ${new Date(inst.startMs).toISOString()} (02:00 Australia/Adelaide)`);
    const sink = new DatabricksFilesSink({ host: api.url, token: "smoke", sleep: () => Promise.resolve(), maxAttempts: 6 });
    for (let minute = 0; minute < 120; minute += 5) {
      engine.simulate(5); // as the 60-second alarms would
      const r = await engine.flush(sink, cfg.location); // as the 5-minute cron would
      if (r.failed) throw new Error(`flush failed: ${JSON.stringify(r.failed)}`);
    }
    console.log(`Files API: ${api.stats.created} files created, ${api.stats.faults} injected 503s retried, ${sink.requestsMade} requests`);
  } finally {
    await api.close();
  }
  return checkRogueSetpoint(readLanding(root), SITE);
}

async function viaWrangler(base: string): Promise<Check[]> {
  const key = process.env.SCENARIO_API_KEY ?? "local-dev-scenario-key-change-me";
  const headers = { "X-Scenario-Key": key };
  const res = await fetch(`${base}/scenarios/rogue_setpoint?site=${SITE}`, { method: "POST", headers });
  const body = await res.json<{ starts_at?: string; error?: string }>();
  if (!res.ok || !body.starts_at) throw new Error(`could not schedule: ${body.error ?? res.status}`);
  const status = await (await fetch(`${base}/status`, { headers })).json<{ sites: { siteId: string; simulatedThrough: string }[] }>();
  const through = Date.parse(status.sites.find((s) => s.siteId === SITE)?.simulatedThrough ?? "");
  const minutes = Math.ceil((Date.parse(body.starts_at) - through) / 60_000) + 100;
  console.log(`scenario starts ${body.starts_at}; advancing ${SITE} by ${minutes} simulated minutes`);
  for (let left = minutes; left > 0; left -= 600) {
    const r = await fetch(`${base}/debug/advance?site=${SITE}&minutes=${Math.min(600, left)}`, { method: "POST", headers });
    if (!r.ok) throw new Error(`advance failed: ${r.status} ${await r.text()}`);
  }
  const since = Date.parse(body.starts_at) - 30 * 60_000;
  return checkRogueSetpoint(readLanding(resolve(process.env.OUT_DIR ?? "out"), (p) => Number(/_(\d+)\.jsonl$/.exec(p)?.[1] ?? 0) >= since), SITE);
}

const checks = wranglerUrl ? await viaWrangler(wranglerUrl) : await inProcess();
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}\n      ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
