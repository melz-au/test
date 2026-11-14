/**
 * Durable Object SQLite implementation of the engine store.
 *
 * Billing note (Workers Free: 100,000 rows written per day): each append is one row written, each
 * deleted row is one row written, the checkpoint upsert is one, and every setAlarm() is one.
 * The engine writes one outbox row per alarm (not per event) to keep this small.
 */
import type { OutboxRow, Store } from "./store.ts";

interface Row extends Record<string, SqlStorageValue> {
  start_ms: number;
  end_ms: number;
  payload: string;
  state: string;
}

export class SqliteStore implements Store {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS outbox (
      start_ms INTEGER PRIMARY KEY,
      end_ms   INTEGER NOT NULL,
      payload  TEXT    NOT NULL,
      state    TEXT    NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS checkpoint (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT    NOT NULL
    )`);
  }

  getCheckpoint(): string | null {
    const rows = this.sql.exec<{ state: string }>("SELECT state FROM checkpoint WHERE id = 1").toArray();
    return rows[0]?.state ?? null;
  }

  putCheckpoint(state: string): void {
    this.sql.exec(
      "INSERT INTO checkpoint (id, state) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state",
      state,
    );
  }

  append(row: OutboxRow): void {
    this.sql.exec(
      "INSERT INTO outbox (start_ms, end_ms, payload, state) VALUES (?, ?, ?, ?)",
      row.startMs,
      row.endMs,
      row.payload,
      row.state,
    );
  }

  rowsBefore(beforeMs: number, limit: number): OutboxRow[] {
    return this.sql
      .exec<Row>("SELECT start_ms, end_ms, payload, state FROM outbox WHERE start_ms < ? ORDER BY start_ms LIMIT ?", beforeMs, limit)
      .toArray()
      .map((r) => ({ startMs: r.start_ms, endMs: r.end_ms, payload: r.payload, state: r.state }));
  }

  newest(): OutboxRow | null {
    const r = this.sql.exec<Row>("SELECT start_ms, end_ms, payload, state FROM outbox ORDER BY start_ms DESC LIMIT 1").toArray()[0];
    return r ? { startMs: r.start_ms, endMs: r.end_ms, payload: r.payload, state: r.state } : null;
  }

  deleteRange(fromMs: number, toMs: number): void {
    this.sql.exec("DELETE FROM outbox WHERE start_ms >= ? AND start_ms < ?", fromMs, toMs);
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n;
  }
}
