import { SCHEMA_VERSION, type Envelope, type Stream, type StreamEvents } from "../contracts/generated.ts";
import { REFERENCE } from "../contracts/reference.generated.ts";
import { deterministicUuid } from "../model/ids.ts";
import { isoMs } from "../model/time.ts";

export interface FeedContext {
  seed: string;
  runId: string;
  siteId: string;
}

/** Common envelope. The event ID is derived from (seed, site, stream, timestamp, key). */
export function envelope<S extends Stream>(
  ctx: FeedContext,
  stream: S,
  tsMs: number,
  ...key: (string | number)[]
): Envelope & { feed: S } {
  return {
    event_id: deterministicUuid(ctx.seed, ctx.siteId, stream, tsMs, ...key),
    event_ts: isoMs(tsMs),
    customer_id: REFERENCE.customer.id,
    site_id: ctx.siteId,
    feed: stream,
    schema_version: SCHEMA_VERSION[stream],
    generator_run_id: ctx.runId,
  };
}

/** Collects events for one simulated minute, in emission order. */
export class Emitter {
  readonly events: { [S in Stream]?: StreamEvents[S][] } = {};

  emit<S extends Stream>(stream: S, event: StreamEvents[S]): StreamEvents[S] {
    const list = (this.events[stream] ??= []) as StreamEvents[S][];
    list.push(event);
    return event;
  }

  count(): number {
    return Object.values(this.events).reduce((n, l) => n + l.length, 0);
  }
}
