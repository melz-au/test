/**
 * Worker entry point.
 *
 *   scheduled (cron, every 5 minutes): asks every site's Durable Object to flush its outbox.
 *   POST /scenarios/{name}?site=PS03[&start=now|next_window]   inject an incident (X-Scenario-Key)
 *   GET  /status                                               per-site status (X-Scenario-Key)
 *   GET  /health                                               liveness
 *   POST /debug/advance?site=PS03&minutes=120                  local mode only: simulate ahead
 */
import { allSiteIds, loadConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { HEAD_OFFICE_ID, siteById } from "./model/sites.ts";
import { DRIVERS } from "./scenarios/index.ts";
import { SCENARIO_NAMES, isScenarioName } from "./scenarios/types.ts";

export { SiteTwin } from "./site.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });

/** Constant-time string comparison, so the key cannot be guessed by timing responses. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function authorised(req: Request, env: Env): boolean {
  const key = env.SCENARIO_API_KEY;
  const given = req.headers.get("X-Scenario-Key");
  return !!key && key.length >= 16 && !!given && safeEqual(given, key);
}

const stub = (env: Env, siteId: string) => env.SITE_TWIN.get(env.SITE_TWIN.idFromName(siteId));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cfg = loadConfig(env);
    if (url.pathname === "/health") return json({ ok: true });
    if (!authorised(req, env)) return json({ error: "missing or wrong X-Scenario-Key" }, 401);

    if (req.method === "GET" && url.pathname === "/status") {
      const statuses = await Promise.all(allSiteIds(cfg).map((id) => stub(env, id).status()));
      return json({ sites: statuses });
    }

    const scenario = /^\/scenarios\/([a-z_]+)$/.exec(url.pathname);
    if (req.method === "POST" && scenario) {
      const name = scenario[1] ?? "";
      if (!isScenarioName(name)) return json({ error: `unknown scenario; use one of ${SCENARIO_NAMES.join(", ")}` }, 404);
      const siteId = url.searchParams.get("site") ?? "";
      if (!allSiteIds(cfg).includes(siteId) || siteId === HEAD_OFFICE_ID) return json({ error: "site must be a configured pump station, e.g. PS03" }, 400);
      if (!DRIVERS[name].supports(siteById(siteId))) return json({ error: `${name} is not supported at ${siteId}` }, 400);
      const start = url.searchParams.get("start") === "now" ? "now" : "next_window";
      try {
        const inst = await stub(env, siteId).triggerScenario(siteId, name, start);
        // The scenario ID is ground truth: it is deliberately not returned.
        return json({ scheduled: name, site: siteId, starts_at: new Date(inst.startMs).toISOString() }, 202);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 409);
      }
    }

    if (env.LOCAL_MODE === "true" && req.method === "POST" && url.pathname === "/debug/advance") {
      const siteId = url.searchParams.get("site") ?? "";
      const minutes = Number(url.searchParams.get("minutes") ?? "60");
      if (!allSiteIds(cfg).includes(siteId)) return json({ error: "unknown site" }, 400);
      return json(await stub(env, siteId).advance(siteId, minutes));
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cfg = loadConfig(env);
    // One RPC per site; each Durable Object makes its own (≤ 40) Files API subrequests.
    const work = Promise.allSettled(allSiteIds(cfg).map((id) => stub(env, id).flush(id))).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") console.error("flush failed", String(r.reason));
        else if (r.value.failed) console.warn("flush incomplete", JSON.stringify(r.value));
        else console.log("flushed", r.value.siteId, r.value.windowsFlushed, "windows", r.value.rowsRemaining, "rows left");
      }
    });
    ctx.waitUntil(work);
    await work;
  },
} satisfies ExportedHandler<Env>;
