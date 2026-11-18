import { describe, expect, it } from "vitest";
import { steppedPositions } from "../src/position-steps.js";

describe("a sweep between a build's positions", () => {
  it("steps each numeric argument evenly between two positions, keeping those listed", () => {
    expect(
      steppedPositions(
        [
          ["0", "open"],
          ["90", "open"],
          ["100", "open"],
        ],
        4,
      ),
    ).toEqual({
      ok: true,
      positions: [
        ["0", "open"],
        ["22.5", "open"],
        ["45", "open"],
        ["67.5", "open"],
        ["90", "open"],
        ["92.5", "open"],
        ["95", "open"],
        ["97.5", "open"],
        ["100", "open"],
      ],
    });
  });

  it("writes a stepped number to six decimals at most", () => {
    expect(steppedPositions([["0"], ["1"]], 3)).toEqual({
      ok: true,
      positions: [["0"], ["0.333333"], ["0.666667"], ["1"]],
    });
  });

  it("refuses arguments it cannot step between, and a sweep of too many runs", () => {
    expect(
      steppedPositions(
        [
          ["0", "open"],
          ["90", "shut"],
        ],
        2,
      ),
    ).toEqual({
      ok: false,
      reason:
        'positions 1 and 2 differ in argument 2 ("open" and "shut"), which is not a number; steps go between numbers.',
    });
    expect(steppedPositions([["0"]], 2)).toEqual({
      ok: false,
      reason:
        "steps cuts the moves between positions into steps; give two positions or more.",
    });
    expect(steppedPositions([["0"], ["1", "2"]], 2)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("have 1 and 2 arguments"),
    });
    expect(steppedPositions([["0"], ["10"], ["20"], ["30"]], 24)).toEqual({
      ok: false,
      reason:
        "4 positions with 24 steps between each two make 73 runs; at most 48: give fewer steps or positions.",
    });
  });
});
