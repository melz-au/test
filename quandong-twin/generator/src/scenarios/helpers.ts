import { REFERENCE } from "../contracts/reference.generated.ts";
import { MINUTE_MS, floorTo, localTime, localToUtc } from "../model/time.ts";

export const at = (minuteMs: number, second: number): number => minuteMs + second * 1000;
export const offsetMinutes = (startMs: number, minuteMs: number): number => (minuteMs - floorTo(startMs, MINUTE_MS)) / MINUTE_MS;

/** Next occurrence (strictly after nowMs) of a local wall-clock time. */
export function nextLocal(nowMs: number, hour: number, minute = 0): number {
  const today = localTime(nowMs).date;
  let t = localToUtc(today, hour, minute);
  if (t <= nowMs) t = localToUtc(localTime(nowMs + 24 * 3600_000).date, hour, minute);
  return t;
}

/** First minute at or after nowMs that is outside the change window. */
export function outsideChangeWindow(nowMs: number): number {
  const cw = REFERENCE.change_window;
  const lt = localTime(nowMs);
  if (lt.isoWeekday === cw.weekday && lt.hour >= cw.start_hour && lt.hour < cw.end_hour) {
    return localToUtc(lt.date, cw.end_hour, 5);
  }
  return floorTo(nowMs, MINUTE_MS);
}

export const RULES = REFERENCE.detection_rules;
