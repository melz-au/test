import type { AssetInventoryEvent } from "../contracts/generated.ts";
import type { Asset } from "../model/assets.ts";
import { isoMs } from "../model/time.ts";
import { envelope, type FeedContext } from "./envelope.ts";

export function inventoryRow(
  ctx: FeedContext,
  tsMs: number,
  asset: Asset,
  changeType: AssetInventoryEvent["change_type"],
): AssetInventoryEvent {
  return {
    ...envelope(ctx, "asset_inventory", tsMs, asset.asset_id, changeType),
    asset_id: asset.asset_id,
    asset_type: asset.asset_type,
    vendor: asset.vendor,
    model: asset.model,
    firmware_version: asset.firmware_version,
    logic_checksum: asset.logic_checksum,
    ip_address: asset.ip_address,
    mac_address: asset.mac_address,
    purdue_level: asset.purdue_level,
    criticality: asset.criticality,
    first_seen: isoMs(asset.first_seen_ms),
    last_seen: isoMs(tsMs),
    change_type: changeType,
  };
}
