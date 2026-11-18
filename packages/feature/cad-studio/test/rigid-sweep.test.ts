import { describe, expect, it } from "vitest";
import { rigidSweepOf } from "../src/rigid-sweep.js";

describe("a rigid sweep a build is asked for", () => {
  it("turns the parts that move together about the axis through a point, in degrees", () => {
    expect(
      rigidSweepOf({
        parts: ["Lid", "Pin"],
        through: [0, 3.9, 20],
        along: [1, 0, 0],
        from: 0,
        to: 105,
        steps: 70,
      }),
    ).toEqual({
      ok: true,
      sweep: {
        parts: ["Lid", "Pin"],
        turn: { through: [0, 3.9, 20], along: [1, 0, 0], from: 0, to: 105 },
        steps: 70,
      },
    });
  });

  it("slides them along a direction, in mm, when no point is given", () => {
    expect(
      rigidSweepOf({
        parts: ["Carriage"],
        along: [0, 0, 1],
        from: -5,
        to: 30,
        steps: 35,
      }),
    ).toEqual({
      ok: true,
      sweep: {
        parts: ["Carriage"],
        slide: { along: [0, 0, 1], from: -5, to: 30 },
        steps: 35,
      },
    });
  });

  it("refuses no parts, a point that is not three numbers, a direction of no length, an empty move, too many steps, and a turn past a whole one", () => {
    const turn = {
      parts: ["Lid"],
      through: [0, 0, 0],
      along: [1, 0, 0],
      from: 0,
      to: 90,
      steps: 10,
    };
    expect(rigidSweepOf({ ...turn, parts: [] })).toEqual({
      ok: false,
      reason:
        "sweep's parts names the parts that move together, as the script shows them.",
    });
    expect(rigidSweepOf({ ...turn, through: [0, 0] })).toEqual({
      ok: false,
      reason: "sweep's through is a point on the axis: three numbers.",
    });
    expect(rigidSweepOf({ ...turn, along: [0, 0, 0] })).toEqual({
      ok: false,
      reason: "sweep's along is a direction: three numbers, not all zero.",
    });
    expect(rigidSweepOf({ ...turn, to: 0 })).toEqual({
      ok: false,
      reason: "sweep's from and to are two different numbers.",
    });
    expect(rigidSweepOf({ ...turn, steps: 361 })).toEqual({
      ok: false,
      reason: "sweep's steps is a whole number from 1 to 360.",
    });
    expect(rigidSweepOf({ ...turn, to: 400 })).toEqual({
      ok: false,
      reason: "sweep turns at most a whole turn, 360 degrees, from from to to.",
    });
  });
});

describe("a geared sweep: further groups moving with the first, each at its own rate", () => {
  // A pinion of 15 teeth turned a whole turn about its axis, and the gear of
  // 52 it drives turned the other way at 15/52 of its rate.
  const pinion = {
    parts: ["Pinion"],
    through: [0, 0, 0],
    along: [0, 0, 1],
    from: 0,
    to: 360,
    steps: 60,
  };
  const gear = {
    parts: ["Gear", "Gear shaft"],
    through: [33.6, 0, 0],
    along: [0, 0, 1],
    rate: -15 / 52,
  };

  it("turns each further group about its own axis by its rate times the first group's move", () => {
    expect(rigidSweepOf({ ...pinion, with: [gear] })).toEqual({
      ok: true,
      sweep: {
        parts: ["Pinion"],
        turn: { through: [0, 0, 0], along: [0, 0, 1], from: 0, to: 360 },
        steps: 60,
        with: [
          {
            parts: ["Gear", "Gear shaft"],
            turn: { through: [33.6, 0, 0], along: [0, 0, 1] },
            rate: -15 / 52,
          },
        ],
      },
    });
  });

  it("slides a group given no point, as a rack driven by its pinion, in mm for each degree", () => {
    expect(
      rigidSweepOf({
        ...pinion,
        with: [{ parts: ["Rack"], along: [1, 0, 0], rate: 0.1309 }],
      }),
    ).toMatchObject({
      ok: true,
      sweep: {
        with: [{ parts: ["Rack"], slide: { along: [1, 0, 0] }, rate: 0.1309 }],
      },
    });
  });

  it("refuses a part in two groups", () => {
    expect(
      rigidSweepOf({
        ...pinion,
        with: [{ ...gear, parts: ["Gear", "Pinion"] }],
      }),
    ).toEqual({
      ok: false,
      reason:
        "sweep names Pinion in two groups; a part moves with one group only.",
    });
  });

  it("refuses a rate that is not a finite number other than zero", () => {
    const refusal = {
      ok: false,
      reason:
        "sweep's with rate is how far a group moves for each degree or mm of the first group's move, in degrees when it turns and mm when it slides: a number other than zero, written out, as -0.4 for a gear of 40 teeth driven by one of 16.",
    };
    for (const rate of [0, Number.NaN, Infinity, "-15/52", undefined])
      expect(rigidSweepOf({ ...pinion, with: [{ ...gear, rate }] })).toEqual(
        refusal,
      );
  });

  it("refuses more than five further groups, or none", () => {
    const groups = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...gear,
        parts: [`Gear ${i + 1}`],
      }));
    const refusal = {
      ok: false,
      reason:
        "sweep's with is a list of 1 to 5 groups that move with the parts: each parts, along, through to turn, and rate.",
    };

    expect(rigidSweepOf({ ...pinion, with: groups(5) })).toMatchObject({
      ok: true,
    });
    expect(rigidSweepOf({ ...pinion, with: groups(6) })).toEqual(refusal);
    expect(rigidSweepOf({ ...pinion, with: [] })).toEqual(refusal);
  });

  it("refuses a group's own from, to or steps, which the first group's move sets", () => {
    expect(
      rigidSweepOf({ ...pinion, with: [{ ...gear, from: 0, to: -104 }] }),
    ).toEqual({
      ok: false,
      reason:
        "a with group moves by its rate times the first group's move; from, to and steps are the sweep's alone.",
    });
  });

  it("refuses a group with no parts, a point that is not three numbers, or a direction of no length", () => {
    expect(rigidSweepOf({ ...pinion, with: [{ ...gear, parts: [] }] })).toEqual(
      {
        ok: false,
        reason:
          "each with group's parts names the parts that move together, as the script shows them.",
      },
    );
    expect(
      rigidSweepOf({ ...pinion, with: [{ ...gear, through: [33.6, 0] }] }),
    ).toEqual({
      ok: false,
      reason: "a with group's through is a point on its axis: three numbers.",
    });
    expect(
      rigidSweepOf({ ...pinion, with: [{ ...gear, along: [0, 0, 0] }] }),
    ).toEqual({
      ok: false,
      reason:
        "a with group's along is a direction: three numbers, not all zero.",
    });
  });
});
