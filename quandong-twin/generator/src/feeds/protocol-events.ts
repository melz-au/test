import type { ProtocolEventsEvent } from "../contracts/generated.ts";
import type { Asset } from "../model/assets.ts";
import { envelope, type FeedContext } from "./envelope.ts";

export type ProtocolSpec = Omit<
  ProtocolEventsEvent,
  keyof ReturnType<typeof envelope> | "asset_id" | "initiator_asset_id" | "initiator_ip" | "firmware_version"
> & { target: Asset; initiator: Asset | { ip: string } };

export function protocolRow(ctx: FeedContext, tsMs: number, key: string, p: ProtocolSpec): ProtocolEventsEvent {
  const initiatorIp = "ip" in p.initiator ? p.initiator.ip : p.initiator.ip_address;
  return {
    ...envelope(ctx, "protocol_events", tsMs, key, p.target.asset_id, initiatorIp, p.operation, p.function_code),
    asset_id: p.target.asset_id,
    initiator_asset_id: "asset_id" in p.initiator ? p.initiator.asset_id : null,
    initiator_ip: initiatorIp,
    protocol: p.protocol,
    function_code: p.function_code,
    operation: p.operation,
    register_or_point: p.register_or_point,
    old_value: p.old_value,
    new_value: p.new_value,
    user_context: p.user_context,
    command_count: p.command_count,
    result: p.result,
    logic_checksum_before: p.logic_checksum_before,
    logic_checksum_after: p.logic_checksum_after,
    firmware_version: p.target.firmware_version,
  };
}

/** Routine read polls from a master (HMI or rogue device), aggregated per minute. */
export function readPoll(
  initiator: Asset | { ip: string },
  target: Asset,
  count: number,
  userContext: string | null,
): ProtocolSpec {
  return {
    target,
    initiator,
    protocol: "Modbus/TCP",
    function_code: 3,
    operation: "read",
    register_or_point: "40001-40040",
    old_value: null,
    new_value: null,
    user_context: userContext,
    command_count: count,
    result: "success",
    logic_checksum_before: null,
    logic_checksum_after: null,
  };
}

/** Modbus holding-register address of each writable point. */
export const REGISTERS: Record<string, string> = {
  "CL2.SETPOINT_MGL": "40021",
};
export const pointName = (siteId: string, point: string): string => `${REGISTERS[point] ?? "4xxxx"} (${siteId}.${point})`;
