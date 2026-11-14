/**
 * A small stand-in for the Databricks Files API 2.0, for offline development and tests.
 *
 *   PUT /api/2.0/fs/files/Volumes/<catalog>/<schema>/<volume>/<path>?overwrite=false
 *     204  file created under <root>/Volumes/...
 *     409  file already exists (and overwrite=false)
 *     401  missing bearer token
 *     503  injected fault (failRate), with Retry-After: 0
 */
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface FakeFilesApiOptions {
  root: string;
  port: number;
  /** Probability (0–1) of answering 503 to a PUT, to exercise retries. */
  failRate?: number;
  random?: () => number;
}

export interface FakeFilesApi {
  server: Server;
  url: string;
  stats: { created: number; conflicts: number; faults: number };
  close(): Promise<void>;
}

const PREFIX = "/api/2.0/fs/files";

export function startFakeFilesApi(opts: FakeFilesApiOptions): Promise<FakeFilesApi> {
  const stats = { created: 0, conflicts: 0, faults: 0 };
  const createdPaths: string[] = [];
  const random = opts.random ?? Math.random;
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const reply = (status: number, body?: object, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(body ? JSON.stringify(body) : undefined);
      };
      // Test hook (not part of the real API): list files created so far.
      if (req.method === "GET" && url.pathname === "/__files") return reply(200, { stats, files: createdPaths });
      if (!req.headers.authorization?.startsWith("Bearer ")) return reply(401, { error_code: "UNAUTHENTICATED" });
      if (req.method !== "PUT" || !url.pathname.startsWith(`${PREFIX}/Volumes/`)) return reply(404, { error_code: "NOT_FOUND" });
      const volumePath = normalize(decodeURIComponent(url.pathname.slice(PREFIX.length)));
      if (!volumePath.startsWith("/Volumes/") || volumePath.includes("..")) return reply(400, { error_code: "INVALID_PARAMETER_VALUE" });
      req.setEncoding("utf8");
      let body = "";
      for await (const c of req) body += c as string;
      if (random() < (opts.failRate ?? 0)) {
        stats.faults++;
        return reply(503, { error_code: "TEMPORARILY_UNAVAILABLE" }, { "Retry-After": "0" });
      }
      const abs = join(opts.root, volumePath);
      await mkdir(dirname(abs), { recursive: true });
      try {
        await writeFile(abs, body, { flag: url.searchParams.get("overwrite") === "false" ? "wx" : "w" });
        stats.created++;
        createdPaths.push(volumePath);
        reply(204);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          stats.conflicts++;
          return reply(409, { error_code: "ALREADY_EXISTS", message: `File already exists: ${volumePath}` });
        }
        reply(500, { error_code: "INTERNAL_ERROR", message: String(err) });
      }
    })();
  });
  return new Promise((resolveStart) => {
    server.listen(opts.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      resolveStart({
        server,
        url: `http://127.0.0.1:${port}`,
        stats,
        close: () => new Promise((r) => server.close(() => { r(); })),
      });
    });
  });
}
