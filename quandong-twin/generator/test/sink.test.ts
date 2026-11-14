import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabricksFilesSink } from "../src/sink/databricks.ts";
import { Rng } from "../src/model/rng.ts";
import { startFakeFilesApi, type FakeFilesApi } from "../../scripts/lib/fake-files-api.ts";
import { LOC, MemorySink, WED_MIDNIGHT_ADL, engineFor, flushAll } from "./helpers/sim.ts";

const PATH = "/Volumes/workspace/quandong_twin/landing/network_flows/date=2026-11-10/PS01_1762781400000.jsonl";

interface Call {
  url: string;
  init: RequestInit;
}

function scripted(responses: (number | Error | { status: number; headers: Record<string, string> })[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift() ?? 200;
    if (r instanceof Error) return Promise.reject(r);
    const { status, headers } = typeof r === "number" ? { status: r, headers: {} } : r;
    return Promise.resolve(new Response(status === 204 ? null : JSON.stringify({ error_code: "X" }), { status, headers }));
  };
  const sink = new DatabricksFilesSink({
    host: "https://dbc-test.cloud.databricks.com/",
    token: "dapi-test",
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
  });
  return { sink, calls, sleeps };
}

describe("Databricks Files API sink", () => {
  it("PUTs to the Files API 2.0 volume path with overwrite=false and a bearer token", async () => {
    const { sink, calls } = scripted([204]);
    const r = await sink.put(PATH, '{"a":1}\n');
    expect(r).toEqual({ ok: true, outcome: "created", attempts: 1 });
    // Segments are percent-encoded like the Databricks SDK does (urllib quote, "/" kept), so "=" → %3D.
    expect(calls[0]?.url).toBe(`https://dbc-test.cloud.databricks.com/api/2.0/fs/files${PATH.replace("date=", "date%3D")}?overwrite=false`);
    expect(calls[0]?.init.method).toBe("PUT");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer dapi-test");
    expect(calls[0]?.init.body).toBe('{"a":1}\n');
  });

  it("percent-encodes path segments but keeps the slashes", () => {
    const { sink } = scripted([]);
    expect(sink.urlFor("/Volumes/c/s/v/date=2026-11-10/a b.jsonl")).toContain("/Volumes/c/s/v/date%3D2026-11-10/a%20b.jsonl?overwrite=false");
  });

  it("treats 409 (already exists) as success: file names are idempotent", async () => {
    const { sink } = scripted([409]);
    expect(await sink.put(PATH, "x")).toEqual({ ok: true, outcome: "exists", attempts: 1 });
  });

  it("retries 429 and 5xx with exponential backoff and jitter, then succeeds", async () => {
    const { sink, calls, sleeps } = scripted([429, 503, 500, 204]);
    const r = await sink.put(PATH, "x");
    expect(r).toEqual({ ok: true, outcome: "created", attempts: 4 });
    expect(calls).toHaveLength(4);
    // random() = 0.5 → half of 500, 1000, 2000 ms
    expect(sleeps).toEqual([250, 500, 1000]);
  });

  it("honours Retry-After", async () => {
    const { sink, sleeps } = scripted([{ status: 429, headers: { "Retry-After": "3" } }, 204]);
    await sink.put(PATH, "x");
    expect(sleeps).toEqual([3000]);
  });

  it("retries network errors", async () => {
    const { sink } = scripted([new Error("connection reset"), 204]);
    expect((await sink.put(PATH, "x")).ok).toBe(true);
  });

  it("gives up after maxAttempts and reports the last status", async () => {
    const { sink, calls } = scripted([503, 503, 503, 503, 204]);
    const r = await sink.put(PATH, "x");
    expect(r).toMatchObject({ ok: false, status: 503, attempts: 4 });
    expect(calls).toHaveLength(4);
  });

  it("does not retry other client errors (bad token, missing volume)", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { sink, calls } = scripted([status, 204]);
      expect(await sink.put(PATH, "x")).toMatchObject({ ok: false, status, attempts: 1 });
      expect(calls).toHaveLength(1);
    }
  });

  it("stops at the subrequest budget (Workers Free: 50 per invocation)", async () => {
    const calls: string[] = [];
    const sink = new DatabricksFilesSink({
      host: "https://h.example", token: "t", requestBudget: 3, sleep: () => Promise.resolve(),
      fetch: ((u: string) => { calls.push(u); return Promise.resolve(new Response(null, { status: 503 })); }) as unknown as typeof fetch,
    });
    const r = await sink.put(PATH, "x");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("budget") as unknown });
    expect(calls).toHaveLength(3);
    expect(sink.requestsMade).toBe(3);
  });

  it("rejects hosts without a scheme and non-volume paths", async () => {
    expect(() => new DatabricksFilesSink({ host: "dbc-test.cloud.databricks.com", token: "t" })).toThrow(/https/);
    const { sink } = scripted([]);
    await expect(sink.put("/tmp/x", "x")).rejects.toThrow(/volume/);
  });
});

describe("sink against the fake Files API", () => {
  let api: FakeFilesApi;
  let root: string;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "qt-sink-"));
    const faults = new Rng("faults");
    api = await startFakeFilesApi({ root, port: 0, failRate: 0.25, random: () => faults.float() });
  });
  afterAll(async () => {
    await api.close();
  });

  it("lands every window exactly once despite 25% injected failures, byte-identical to a fault-free run", async () => {
    const engine = engineFor("PS04");
    engine.start(WED_MIDNIGHT_ADL);
    const sink = new DatabricksFilesSink({ host: api.url, token: "t", sleep: () => Promise.resolve(), maxAttempts: 2 });
    for (let i = 0; i < 12; i++) {
      engine.simulate(5);
      // Some flushes fail part-way; rows stay in the outbox and are retried on the next "cron".
      await engine.flush(sink, LOC);
    }
    for (let i = 0; i < 20 && (await engine.flush(sink, LOC)).rowsRemaining > 0; i++);
    expect(api.stats.faults).toBeGreaterThan(0);

    const reference = new MemorySink();
    const clean = engineFor("PS04");
    clean.start(WED_MIDNIGHT_ADL);
    clean.simulate(60);
    await flushAll(clean, reference);
    expect(api.stats.created).toBe(reference.files.size);
    for (const [path, body] of reference.files) expect(readFileSync(join(root, path), "utf8")).toBe(body);
  });

  it("a lost response (file written, client saw an error) is safe to retry", async () => {
    const path = "/Volumes/workspace/quandong_twin/landing/security_alerts/date=2026-11-10/PS09_1.jsonl";
    let first = true;
    const sink = new DatabricksFilesSink({
      host: api.url, token: "t", sleep: () => Promise.resolve(),
      fetch: (async (u: string, init?: RequestInit) => {
        const res = await fetch(u, init);
        if (first) {
          first = false;
          throw new Error("socket hang up after upload");
        }
        return res;
      }) as typeof fetch,
    });
    const r = await sink.put(path, "same bytes\n");
    expect(r).toEqual({ ok: true, outcome: "exists", attempts: 2 });
    expect(readFileSync(join(root, path), "utf8")).toBe("same bytes\n");
  });
});
