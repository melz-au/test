/** Read every landed NDJSON file under <root>/Volumes/... into events grouped by stream. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AnyEvent, Stream } from "../../generator/src/contracts/generated.ts";

export function readLanding(root: string, filter: (path: string) => boolean = () => true): Map<Stream, AnyEvent[]> {
  const out = new Map<Stream, AnyEvent[]>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".jsonl") && filter(p)) {
        const parts = p.split("/");
        const i = parts.indexOf("landing") + 1;
        const stream = (parts[i] === "_ground_truth" ? parts[i + 1] : parts[i]) as Stream;
        const list = out.get(stream) ?? [];
        for (const line of readFileSync(p, "utf8").split("\n")) if (line) list.push(JSON.parse(line) as AnyEvent);
        out.set(stream, list);
      }
    }
  };
  walk(root);
  return out;
}
