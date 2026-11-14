/**
 * Run the fake Databricks Files API for local development (`npm run local-files-api`).
 * Files land in ./out/Volumes/... Set FAIL_RATE=0.2 to inject 503s and watch the sink retry.
 */
import { resolve } from "node:path";
import { startFakeFilesApi } from "./lib/fake-files-api.ts";

const port = Number(process.env.PORT ?? 8788);
const root = resolve(process.env.OUT_DIR ?? "out");
const api = await startFakeFilesApi({ root, port, failRate: Number(process.env.FAIL_RATE ?? 0) });
console.log(`Fake Databricks Files API on ${api.url}, writing to ${root}`);
