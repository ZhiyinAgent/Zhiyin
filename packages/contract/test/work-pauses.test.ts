import { describe, expect, it } from "vitest";
import { defaultWorkPauses, isWorkPauses } from "../src/index.js";

describe("when long work stops to ask", () => {
  it("stops first after 50 rounds, 30 minutes, 10 dollars or 70 yuan", () => {
    expect(defaultWorkPauses).toEqual({
      rounds: 50,
      minutes: 30,
      dollars: 10,
      yuan: 70,
    });
  });

  it("takes whole numbers within each limit's range, from five rounds to a thousand", () => {
    expect(isWorkPauses({ rounds: 5, minutes: 5, dollars: 1, yuan: 5 })).toBe(
      true,
    );
    expect(
      isWorkPauses({
        rounds: 1_000,
        minutes: 1_440,
        dollars: 1_000,
        yuan: 7_000,
      }),
    ).toBe(true);
    expect(isWorkPauses({ ...defaultWorkPauses, rounds: 4 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, rounds: 1_001 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, minutes: 4 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, minutes: 1_441 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, dollars: 0 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, dollars: 1_001 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, yuan: 4 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, yuan: 7_001 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, dollars: 2.5 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, rounds: Infinity })).toBe(
      false,
    );
  });

  it("refuses anything missing a limit or carrying another", () => {
    expect(isWorkPauses({ rounds: 50, minutes: 30, dollars: 10 })).toBe(false);
    expect(isWorkPauses({ ...defaultWorkPauses, tokens: 1 })).toBe(false);
    expect(isWorkPauses([50, 30, 10, 70])).toBe(false);
    expect(isWorkPauses(null)).toBe(false);
  });
});
