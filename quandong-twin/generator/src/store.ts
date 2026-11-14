/**
 * Storage abstraction for the simulation engine. The Durable Object uses SQLite
 * (sqlite-store.ts); tests, the smoke test and the backfill script use MemoryStore.
 */
export interface OutboxRow {
  /** First simulated minute in the row (epoch ms). */
  startMs: number;
  /** End of the last simulated minute in the row (exclusive). */
  endMs: number;
  /** JSON object: stream name → NDJSON text. */
  payload: string;
  /** JSON-serialised SiteState after the row's last minute. */
  state: string;
}

export interface Store {
  /** Persisted checkpoint (state + bookkeeping), or null for a brand-new site. */
  getCheckpoint(): string | null;
  putCheckpoint(state: string): void;
  append(row: OutboxRow): void;
  /** Rows with startMs < beforeMs, oldest first. */
  rowsBefore(beforeMs: number, limit: number): OutboxRow[];
  /** Newest row, if any (holds the newest state). */
  newest(): OutboxRow | null;
  /** Delete rows with startMs in [fromMs, toMs). */
  deleteRange(fromMs: number, toMs: number): void;
  count(): number;
}

export class MemoryStore implements Store {
  private checkpoint: string | null = null;
  private rows: OutboxRow[] = [];
  /** Counts writes the way Durable Object SQLite bills them (rows written, deletes included). */
  rowsWritten = 0;

  getCheckpoint(): string | null {
    return this.checkpoint;
  }
  putCheckpoint(state: string): void {
    this.checkpoint = state;
    this.rowsWritten++;
  }
  append(row: OutboxRow): void {
    this.rows.push(row);
    this.rowsWritten++;
  }
  rowsBefore(beforeMs: number, limit: number): OutboxRow[] {
    return this.rows.filter((r) => r.startMs < beforeMs).slice(0, limit);
  }
  newest(): OutboxRow | null {
    return this.rows.at(-1) ?? null;
  }
  deleteRange(fromMs: number, toMs: number): void {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.startMs < fromMs || r.startMs >= toMs);
    this.rowsWritten += before - this.rows.length;
  }
  count(): number {
    return this.rows.length;
  }
}
