import type { NetworkFlowsEvent } from "../contracts/generated.ts";
import type { Asset } from "../model/assets.ts";
import type { Rng } from "../model/rng.ts";
import { MINUTE_MS, isoMs } from "../model/time.ts";
import { envelope, type FeedContext } from "./envelope.ts";

export interface FlowSpec {
  src: Asset | { ip: string };
  dst: Asset | { ip: string };
  dstPort: number;
  protocol: NetworkFlowsEvent["protocol"];
  bytes: number;
  packets: number;
  direction: NetworkFlowsEvent["direction"];
  state?: NetworkFlowsEvent["connection_state"];
  transport?: NetworkFlowsEvent["transport"];
}

const ipOf = (x: Asset | { ip: string }): string => ("ip" in x ? x.ip : x.ip_address);
const idOf = (x: Asset | { ip: string }): string | null => ("asset_id" in x ? x.asset_id : null);

export function flowRow(ctx: FeedContext, minuteMs: number, f: FlowSpec): NetworkFlowsEvent {
  const src_ip = ipOf(f.src);
  const dst_ip = ipOf(f.dst);
  return {
    ...envelope(ctx, "network_flows", minuteMs, src_ip, dst_ip, f.dstPort, f.protocol),
    window_start: isoMs(minuteMs),
    window_end: isoMs(minuteMs + MINUTE_MS),
    src_asset_id: idOf(f.src),
    dst_asset_id: idOf(f.dst),
    src_ip,
    dst_ip,
    dst_port: f.dstPort,
    transport: f.transport ?? "tcp",
    protocol: f.protocol,
    bytes: Math.max(0, Math.round(f.bytes)),
    packets: Math.max(0, Math.round(f.packets)),
    direction: f.direction,
    connection_state: f.state ?? "established",
  };
}

/** Per-minute aggregate of HMI polling: one request and one response every 2 seconds. */
export function pollingFlow(hmi: Asset, controller: Asset, rng: Rng): FlowSpec {
  const polls = 30;
  return {
    src: hmi,
    dst: controller,
    dstPort: 502,
    protocol: "Modbus/TCP",
    bytes: polls * (12 + 9 + 2 * 20) + rng.int(0, 120),
    packets: polls * 4 + rng.int(0, 4),
    direction: "internal",
  };
}
