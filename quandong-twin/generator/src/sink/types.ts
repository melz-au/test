export type PutResult =
  | { ok: true; outcome: "created" | "exists"; attempts: number }
  | { ok: false; status: number; attempts: number; error: string };

/** Destination for landed files. Implementations must never overwrite an existing file. */
export interface Sink {
  put(path: string, body: string): Promise<PutResult>;
  /** Subrequests (HTTP calls) made so far, including retries. */
  readonly requestsMade: number;
}

export interface VolumeLocation {
  catalog: string;
  schema: string;
  volume: string;
}

/** /Volumes/{catalog}/{schema}/{volume}/{folder}/date=YYYY-MM-DD/{site}_{window_start_ms}.jsonl */
export function landingPath(loc: VolumeLocation, folder: string, utcDate: string, siteId: string, windowMs: number): string {
  return `/Volumes/${loc.catalog}/${loc.schema}/${loc.volume}/${folder}/date=${utcDate}/${siteId}_${windowMs}.jsonl`;
}
