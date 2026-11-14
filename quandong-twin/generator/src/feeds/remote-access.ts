import type { RemoteAccessEvent } from "../contracts/generated.ts";
import { isoMs } from "../model/time.ts";
import { envelope, type FeedContext } from "./envelope.ts";

export interface SessionSpec {
  sessionId: string;
  username: string;
  userType: RemoteAccessEvent["user_type"];
  sourceIp: string;
  sourceCountry: string;
  mfaMethod: RemoteAccessEvent["mfa_method"];
  targetAssetId: string;
  protocol: RemoteAccessEvent["protocol"];
  startMs: number;
  endMs: number;
}

export function sessionRow(
  ctx: FeedContext,
  tsMs: number,
  s: SessionSpec,
  state: RemoteAccessEvent["session_state"],
  mfaResult: RemoteAccessEvent["mfa_result"],
): RemoteAccessEvent {
  return {
    ...envelope(ctx, "remote_access", tsMs, s.sessionId, state),
    session_id: s.sessionId,
    session_state: state,
    username: s.username,
    user_type: s.userType,
    source_ip: s.sourceIp,
    source_country: s.sourceCountry,
    mfa_method: s.mfaMethod,
    mfa_result: mfaResult,
    start_ts: isoMs(state === "rejected" ? tsMs : s.startMs),
    end_ts: state === "ended" ? isoMs(s.endMs) : null,
    target_asset_id: s.targetAssetId,
    protocol: s.protocol,
  };
}

export const EMPLOYEES = ["j.mcallister", "p.nguyen", "s.oconnor", "r.kaur", "t.walker"] as const;
/** Field-service account of the (fictional) PLC vendor. */
export const VENDOR_USER = "svc.wattlecontrols";
