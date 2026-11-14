/** Node sink that writes landed files under a local directory, never overwriting (like overwrite=false). */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PutResult, Sink } from "../../generator/src/sink/types.ts";

export class FileSink implements Sink {
  requestsMade = 0;
  readonly written: string[] = [];
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async put(path: string, body: string): Promise<PutResult> {
    this.requestsMade++;
    const abs = join(this.root, path);
    await mkdir(dirname(abs), { recursive: true });
    try {
      await writeFile(abs, body, { flag: "wx" });
      this.written.push(path);
      return { ok: true, outcome: "created", attempts: 1 };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return { ok: true, outcome: "exists", attempts: 1 };
      return { ok: false, status: 0, attempts: 1, error: String(err) };
    }
  }
}
