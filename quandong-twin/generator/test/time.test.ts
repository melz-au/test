import { describe, expect, it } from "vitest";
import { inChangeWindow, isBusinessHours, localTime, localToUtc } from "../src/model/time.ts";

describe("Australia/Adelaide time", () => {
  it("uses daylight saving in summer (UTC+10:30) and standard time in winter (UTC+9:30)", () => {
    expect(localTime(Date.UTC(2026, 0, 15, 0, 0)).offsetMinutes).toBe(630);
    expect(localTime(Date.UTC(2026, 6, 15, 0, 0)).offsetMinutes).toBe(570);
  });

  it("converts local wall-clock times to UTC and back", () => {
    const utc = localToUtc("2026-11-11", 2, 0); // 02:00 ACDT
    expect(new Date(utc).toISOString()).toBe("2026-11-10T15:30:00.000Z");
    const lt = localTime(utc);
    expect([lt.date, lt.hour, lt.minute, lt.isoWeekday]).toEqual(["2026-11-11", 2, 0, 3]);
    expect(localTime(localToUtc("2026-07-01", 9, 15)).hour).toBe(9);
  });

  it("knows business hours and the change window", () => {
    expect(isBusinessHours(localToUtc("2026-11-11", 10, 0))).toBe(true); // Wednesday
    expect(isBusinessHours(localToUtc("2026-11-11", 2, 0))).toBe(false);
    expect(isBusinessHours(localToUtc("2026-11-14", 10, 0))).toBe(false); // Saturday
    expect(inChangeWindow(localToUtc("2026-11-10", 11, 0))).toBe(true); // Tuesday 11:00
    expect(inChangeWindow(localToUtc("2026-11-10", 15, 0))).toBe(false);
    expect(inChangeWindow(localToUtc("2026-11-11", 11, 0))).toBe(false);
  });
});
