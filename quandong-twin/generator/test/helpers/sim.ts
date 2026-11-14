import { SiteEngine, type EngineOptions } from "../../src/engine.ts";
import { siteById } from "../../src/model/sites.ts";
import type { PutResult, Sink, VolumeLocation } from "../../src/sink/types.ts";
import { MemoryStore } from "../../src/store.ts";
import type { AnyEvent, Stream } from "../../src/contracts/generated.ts";

export const LOC: VolumeLocation = { catalog: "workspace", schema: "quandong_twin", volume: "landing" };
/** Wednesday 11 November 2026, 00:00 Adelaide time (daylight saving, UTC+10:30). */
export const WED_MIDNIGHT_ADL = Date.UTC(2026, 10, 10, 13, 30);

export class MemorySink implements Sink {
  requestsMade = 0;
  readonly files = new Map<string, string>();
  failNext = 0;
  async put(path: string, body: string): Promise<PutResult> {
    this.requestsMade++;
    await Promise.resolve();
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, status: 503, attempts: 1, error: "injected" };
    }
    if (this.files.has(path)) return { ok: true, outcome: "exists", attempts: 1 };
    this.files.set(path, body);
    return { ok: true, outcome: "created", attempts: 1 };
  }
}

export function engineFor(siteId: string, store = new MemoryStore(), extra: Partial<EngineOptions> = {}): SiteEngine {
  return new SiteEngine(
    { seed: "test-seed", runId: "test-run", site: siteById(siteId), flushWindowMinutes: 5, maxCatchUpMinutes: 360, ...extra },
    store,
  );
}

export async function flushAll(engine: SiteEngine, sink: Sink): Promise<void> {
  for (;;) {
    const r = await engine.flush(sink, LOC, 100);
    if (r.failed) throw new Error(r.failed.error);
    if (!r.windowsFlushed) return;
  }
}

/** Parse every landed file into events, grouped by stream (folder). */
export function eventsByStream(files: Map<string, string>): Map<Stream, AnyEvent[]> {
  const out = new Map<Stream, AnyEvent[]>();
  for (const [path, body] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const stream = path.split("/").find((_, i, parts) => parts[i - 1] === "landing" || parts[i - 1] === "_ground_truth") as Stream;
    const list = out.get(stream) ?? [];
    for (const line of body.split("\n")) if (line) list.push(JSON.parse(line) as AnyEvent);
    out.set(stream, list);
  }
  out.delete("_ground_truth" as Stream);
  return out;
}

/** Run a site for `minutes`, in steps of `chunk` minutes, flushing as it goes. */
export async function runSite(siteId: string, startMs: number, minutes: number, chunk = minutes, extra: Partial<EngineOptions> = {}) {
  const store = new MemoryStore();
  const engine = engineFor(siteId, store, extra);
  const sink = new MemorySink();
  engine.start(startMs);
  for (let done = 0; done < minutes; done += chunk) {
    engine.simulate(Math.min(chunk, minutes - done));
    await flushAll(engine, sink);
  }
  return { engine, store, sink, events: eventsByStream(sink.files) };
}
