import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeFilesApi } from "../../../scripts/lib/fake-files-api.ts";

export default async function setup(): Promise<() => Promise<void>> {
  const api = await startFakeFilesApi({ root: mkdtempSync(join(tmpdir(), "qt-files-")), port: 8799 });
  return () => api.close();
}
