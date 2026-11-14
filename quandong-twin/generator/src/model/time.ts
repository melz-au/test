/**
 * Time helpers. Simulation runs in whole minutes of Coordinated Universal Time (UTC);
 * business rules use Australia/Adelaide local time, which observes daylight saving
 * (UTC+9:30 standard, UTC+10:30 daylight), so the offset is always looked up, never assumed.
 */
import { REFERENCE } from "../contracts/reference.generated.ts";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const floorTo = (ms: number, stepMs: number): number => Math.floor(ms / stepMs) * stepMs;
export const isoMs = (ms: number): string => new Date(ms).toISOString();
export const utcDate = (ms: number): string => isoMs(ms).slice(0, 10);

export interface LocalTime {
  /** Local calendar date, yyyy-MM-dd. */
  date: string;
  hour: number;
  minute: number;
  /** Minutes since local midnight. */
  minuteOfDay: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
  /** Local offset from UTC in minutes. */
  offsetMinutes: number;
}

const formatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: REFERENCE.timezone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// Offsets only change on half-hour boundaries, so cache per 30-minute UTC bucket.
const offsetCache = new Map<number, number>();
const BUCKET_MS = 30 * MINUTE_MS;

function offsetMinutesAt(ms: number): number {
  const bucket = floorTo(ms, BUCKET_MS);
  const cached = offsetCache.get(bucket);
  if (cached !== undefined) return cached;
  const p = Object.fromEntries(formatter.formatToParts(new Date(bucket)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  const offset = Math.round((asUtc - bucket) / MINUTE_MS);
  if (offsetCache.size > 5000) offsetCache.clear();
  offsetCache.set(bucket, offset);
  return offset;
}

export function localTime(ms: number): LocalTime {
  const offsetMinutes = offsetMinutesAt(ms);
  const shifted = new Date(ms + offsetMinutes * MINUTE_MS);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const dow = shifted.getUTCDay();
  return {
    date: shifted.toISOString().slice(0, 10),
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    isoWeekday: dow === 0 ? 7 : dow,
    offsetMinutes,
  };
}

/** UTC instant of a local wall-clock time on a local date (yyyy-MM-dd). */
export function localToUtc(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  // Two passes handle the daylight-saving boundary.
  let guess = naive - offsetMinutesAt(naive) * MINUTE_MS;
  guess = naive - offsetMinutesAt(guess) * MINUTE_MS;
  return guess;
}

export function isBusinessHours(ms: number): boolean {
  const t = localTime(ms);
  const bh = REFERENCE.business_hours;
  return (bh.weekdays as readonly number[]).includes(t.isoWeekday) && t.hour >= bh.start_hour && t.hour < bh.end_hour;
}

export function inChangeWindow(ms: number): boolean {
  const t = localTime(ms);
  const cw = REFERENCE.change_window;
  return t.isoWeekday === cw.weekday && t.hour >= cw.start_hour && t.hour < cw.end_hour;
}
