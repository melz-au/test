/**
 * Databricks Files API sink (Files API 2.0, generally available).
 *
 *   PUT {host}/api/2.0/fs/files{/Volumes/...path}?overwrite=false
 *
 * - overwrite=false is sent explicitly (the API defaults to overwriting). If the file already
 *   exists the API answers 409 Conflict; because file names are deterministic and their content is
 *   identical on every retry, that means an earlier attempt succeeded, so it is reported as success.
 * - 429 and 5xx responses (and network errors) are retried with exponential backoff and full
 *   jitter, honouring Retry-After when present. Other 4xx responses fail immediately.
 * - The caller keeps events in its outbox until every file for a window has been accepted, which
 *   gives at-least-once delivery; deterministic names make redelivery idempotent.
 */
import type { PutResult, Sink } from "./types.ts";

export interface DatabricksSinkOptions {
  /** Workspace URL, e.g. https://dbc-1234abcd-5678.cloud.databricks.com (or the local fake). */
  host: string;
  token: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Stop making requests once this many have been made (Workers Free allows 50 per invocation). */
  requestBudget?: number;
}

const RETRYABLE = (status: number): boolean => status === 429 || status >= 500;

export class DatabricksFilesSink implements Sink {
  private readonly host: string;
  private readonly opts: Required<Omit<DatabricksSinkOptions, "host" | "token">>;
  private readonly token: string;
  requestsMade = 0;

  constructor(options: DatabricksSinkOptions) {
    this.host = options.host.replace(/\/+$/, "");
    if (!/^https?:\/\//.test(this.host)) throw new Error("DATABRICKS_HOST must start with https://");
    this.token = options.token;
    this.opts = {
      maxAttempts: options.maxAttempts ?? 4,
      baseDelayMs: options.baseDelayMs ?? 500,
      maxDelayMs: options.maxDelayMs ?? 8000,
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: options.random ?? Math.random,
      requestBudget: options.requestBudget ?? Number.POSITIVE_INFINITY,
    };
  }

  /** Files API URL for a volume path; each path segment is percent-encoded. */
  urlFor(path: string): string {
    if (!path.startsWith("/Volumes/")) throw new Error(`not a volume path: ${path}`);
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${this.host}/api/2.0/fs/files${encoded}?overwrite=false`;
  }

  get budgetLeft(): number {
    return this.opts.requestBudget - this.requestsMade;
  }

  async put(path: string, body: string): Promise<PutResult> {
    const url = this.urlFor(path);
    let lastStatus = 0;
    let lastError = "";
    let attempts = 0;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      if (this.budgetLeft <= 0) {
        return { ok: false, status: 0, attempts: attempt - 1, error: "subrequest budget exhausted" };
      }
      this.requestsMade++;
      attempts = attempt;
      let retryAfterMs: number | null = null;
      try {
        const res = await this.opts.fetch(url, {
          method: "PUT",
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/octet-stream" },
          body,
        });
        if (res.ok) return { ok: true, outcome: "created", attempts: attempt };
        if (res.status === 409) return { ok: true, outcome: "exists", attempts: attempt };
        lastStatus = res.status;
        lastError = (await res.text().catch(() => "")).slice(0, 300);
        if (!RETRYABLE(res.status)) break;
        const ra = res.headers.get("Retry-After");
        if (ra && /^\d+$/.test(ra)) retryAfterMs = Number(ra) * 1000;
      } catch (err) {
        lastStatus = 0;
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < this.opts.maxAttempts) {
        const backoff = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** (attempt - 1));
        await this.opts.sleep(Math.min(this.opts.maxDelayMs, retryAfterMs ?? Math.floor(this.opts.random() * backoff)));
      }
    }
    return { ok: false, status: lastStatus, attempts, error: lastError || `HTTP ${lastStatus}` };
  }
}
