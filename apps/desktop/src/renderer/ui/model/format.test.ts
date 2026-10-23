import { describe, expect, it } from "vitest";
import { busyHours } from "./format.js";

/** DeepSeek's busy hours: 09:00-12:00 and 14:00-18:00 Beijing time, Monday to Friday. */
const deepSeek = {
  weekdaysUtc: [1, 2, 3, 4, 5],
  hoursUtc: [
    [1, 4],
    [6, 10],
  ] as const,
};

const october = new Date("2026-10-09T12:00:00Z");
const december = new Date("2026-12-09T12:00:00Z");

describe("busy hours, in the person's own time", () => {
  it("reads as the lab states them in the lab's own time zone", () => {
    expect(busyHours(deepSeek, "Asia/Shanghai", october)).toBe(
      "Monday to Friday, 09:00–12:00 and 14:00–18:00",
    );
  });

  it("follows the person's summer and winter time", () => {
    expect(busyHours(deepSeek, "Europe/Paris", october)).toBe(
      "Monday to Friday, 03:00–06:00 and 08:00–12:00",
    );
    expect(busyHours(deepSeek, "Europe/Paris", december)).toBe(
      "Monday to Friday, 02:00–05:00 and 07:00–11:00",
    );
  });

  it("moves the days when the hours fall on the day before", () => {
    expect(busyHours(deepSeek, "America/Los_Angeles", october)).toBe(
      "Sunday to Thursday, 18:00–21:00 and 23:00–03:00",
    );
  });

  it("names each run of days apart when their hours differ", () => {
    expect(busyHours(deepSeek, "America/Sao_Paulo", october)).toBe(
      "Sunday, 22:00–01:00; Monday to Thursday, 03:00–07:00 and 22:00–01:00; Friday, 03:00–07:00",
    );
  });

  it("keeps the minutes of a zone off the hour", () => {
    expect(busyHours(deepSeek, "Asia/Kolkata", october)).toBe(
      "Monday to Friday, 06:30–09:30 and 11:30–15:30",
    );
  });

  it("lists days apart that do not follow each other", () => {
    expect(
      busyHours({ weekdaysUtc: [1, 3], hoursUtc: [[1, 4]] }, "UTC", october),
    ).toBe("Monday and Wednesday, 01:00–04:00");
  });
});
