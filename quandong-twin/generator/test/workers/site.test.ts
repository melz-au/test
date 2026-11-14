import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createScheduledController,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/index.ts";
import type { SiteTwin } from "../../src/site.ts";

const KEY = { "X-Scenario-Key": "test-scenario-key-0123456789" };
const stub = (id: string) => env.SITE_TWIN.get(env.SITE_TWIN.idFromName(id));
const landed = async (): Promise<string[]> =>
  (await (await fetch("http://127.0.0.1:8799/__files")).json<{ files: string[] }>()).files;

describe("SiteTwin Durable Object (Workers runtime)", () => {
  it("serves health without a key and rejects other routes without one", async () => {
    expect((await exports.default.fetch("https://twin/health")).status).toBe(200);
    expect((await exports.default.fetch("https://twin/status")).status).toBe(401);
    expect((await exports.default.fetch("https://twin/status", { headers: { "X-Scenario-Key": "wrong-key-wrong-key" } })).status).toBe(401);
  });

  it("starts a site, sets its alarm and reschedules after the alarm runs", async () => {
    const s = await stub("PS01").ensureRunning("PS01");
    expect(s.started).toBe(true);
    expect(s.nextAlarm).not.toBeNull();
    expect(await runDurableObjectAlarm(stub("PS01"))).toBe(true);
    const alarm = await runInDurableObject(stub("PS01"), (_i: SiteTwin, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
  });

  it("simulates ahead in local mode and lands files through the Files API sink", async () => {
    const res = await exports.default.fetch("https://twin/debug/advance?site=PS02&minutes=30", { method: "POST", headers: KEY });
    expect(res.status).toBe(200);
    const body = await res.json<{ simulated: number; windowsFlushed: number; failed: unknown }>();
    expect(body.simulated).toBe(30);
    expect(body.failed).toBeNull();
    expect(body.windowsFlushed).toBeGreaterThanOrEqual(5);
    const files = (await landed()).filter((f) => f.includes("/PS02_"));
    expect(files.some((f) => f.startsWith("/Volumes/workspace/quandong_twin/landing/process_telemetry/date="))).toBe(true);
  });

  it("keeps its state across eviction", async () => {
    await exports.default.fetch("https://twin/debug/advance?site=PS04&minutes=12", { method: "POST", headers: KEY });
    const before = await stub("PS04").status();
    await evictDurableObject(stub("PS04"));
    const after = await stub("PS04").status();
    expect(after.simulatedThrough).toBe(before.simulatedThrough);
    expect(after.outboxRows).toBe(before.outboxRows);
  });

  it("the cron handler flushes every configured site plus head office", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    const res = await exports.default.fetch("https://twin/status", { headers: KEY });
    const statuses = await res.json<{ sites: { siteId: string; started: boolean }[] }>();
    expect(statuses.sites.map((s) => s.siteId).sort()).toEqual(["HO", "PS01", "PS02", "PS03", "PS04", "PS05"]);
    expect(statuses.sites.every((s) => s.started)).toBe(true);
  });

  it("schedules scenarios through the protected API without revealing the ground-truth ID", async () => {
    const post = (path: string, headers: Record<string, string> = KEY) => exports.default.fetch(`https://twin${path}`, { method: "POST", headers });
    expect((await post("/scenarios/rogue_device?site=PS05", {})).status).toBe(401);
    expect((await post("/scenarios/not_a_scenario?site=PS05")).status).toBe(404);
    expect((await post("/scenarios/rogue_device?site=PS99")).status).toBe(400);
    expect((await post("/scenarios/rogue_device?site=HO")).status).toBe(400);
    const ok = await post("/scenarios/rogue_setpoint?site=PS05");
    expect(ok.status).toBe(202);
    const body = await ok.text();
    expect(JSON.parse(body)).toMatchObject({ scheduled: "rogue_setpoint", site: "PS05" });
    expect(body).not.toContain("GT-");
    expect((await post("/scenarios/rogue_device?site=PS05&start=now")).status).toBe(409);
  });
});
