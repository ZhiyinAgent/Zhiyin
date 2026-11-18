import { describe, expect, it } from "vitest";
import {
  fieldRules,
  keptOf,
  kindsOf,
  lastOf,
  rangeMargin,
  rangeWords,
  readRequirements,
  verdictDetail,
  verdictLines,
  type Checked,
} from "../src/index.js";

const read = (
  requirements: unknown[],
  kinds = kindsOf(["size", "wall", "clearance", "separate"]),
) => readRequirements(JSON.stringify({ requirements }), "spec.json", kinds);

describe("a requirements file", () => {
  it("is read as its requirements, each of a kind the studio measures", () => {
    const requirements = [
      {
        id: "R1",
        says: "Fits the shelf",
        check: "size",
        part: "Body",
        max: [300, null, 200],
      },
      { id: "R2", check: "wall", part: "/Shell_.*/", min: 2 },
    ];
    expect(read(requirements)).toEqual({ ok: true, requirements });
  });

  it("refuses a kind the studio does not measure, naming those it does", () => {
    expect(read([{ id: "R1", check: "draft", part: "Body", min: 1 }])).toEqual({
      ok: false,
      reason: "spec.json: R1: check is one of size, wall, clearance, separate.",
    });
    expect(read([{ id: "R1", check: "toString" }])).toEqual({
      ok: false,
      reason: "spec.json: R1: check is one of size, wall, clearance, separate.",
    });
    expect(read([{ id: "R1", part: "Body" }])).toEqual({
      ok: false,
      reason: "spec.json: R1: check is one of size, wall, clearance, separate.",
    });
  });

  it("takes a studio's own kinds beside the shared ones", () => {
    const kinds = kindsOf(["size"], {
      count: {
        needs: ["part", "count"],
        may: [],
        fields: {
          part: fieldRules.part,
          count: fieldRules.amount("count is how many there are, above 0"),
        },
      },
    });
    expect(
      read([{ id: "C1", check: "count", part: "Leg", count: 4 }], kinds).ok,
    ).toBe(true);
    expect(
      read([{ id: "C1", check: "count", part: "Leg", count: 0 }], kinds),
    ).toEqual({
      ok: false,
      reason: "spec.json: C1: count is how many there are, above 0.",
    });
    expect(
      read([{ id: "W1", check: "wall", part: "Leg", min: 1 }], kinds),
    ).toEqual({
      ok: false,
      reason: "spec.json: W1: check is one of size, count.",
    });
  });

  it("names the requirement and the field to mend, and how", () => {
    expect(
      read([{ id: "R1", check: "clearance", between: ["Lid", "Box"] }]),
    ).toEqual({
      ok: false,
      reason: "spec.json: R1: a clearance check needs min.",
    });
    expect(
      read([
        {
          id: "R1",
          check: "clearance",
          between: ["Lid", "Box"],
          min: 2,
          max: 4,
        },
      ]),
    ).toEqual({
      ok: false,
      reason:
        "spec.json: R1: max is not a field of a clearance check; it takes between, min, bed, height, up.",
    });
    expect(
      read([{ id: "R1", check: "size", part: "Body", min: [10, 10] }]),
    ).toEqual({
      ok: false,
      reason:
        "spec.json: R1: min is three sizes in mm along x, y and z, null for no limit along one.",
    });
    expect(read([{ id: "R1", check: "size", part: "Body" }])).toEqual({
      ok: false,
      reason: "spec.json: R1: a size check gives max, min or both, or range.",
    });
    expect(
      read([
        { id: "R1", check: "wall", part: "A", min: 1 },
        { id: "R1", check: "wall", part: "B", min: 1 },
      ]),
    ).toEqual({
      ok: false,
      reason: "spec.json: two requirements are R1.",
    });
    expect(readRequirements("{", "spec.json", kindsOf(["size"]))).toMatchObject(
      {
        ok: false,
        reason: expect.stringMatching(/^spec\.json: it is not JSON \(.+\)\.$/),
      },
    );
    expect(readRequirements("[]", "spec.json", kindsOf(["size"]))).toEqual({
      ok: false,
      reason:
        'spec.json: it holds { "requirements": [...] }, from 1 to 100 of them.',
    });
  });

  it("takes sizes as ranges: a number the size must be, or [least, most]", () => {
    expect(
      read([
        {
          id: "S1",
          check: "size",
          part: "Body",
          range: [[80, 85], [80, 85], 95],
        },
      ]).ok,
    ).toBe(true);
    expect(
      read([
        { id: "S1", check: "size", part: "Body", range: [[85, 80], null, 95] },
      ]),
    ).toEqual({
      ok: false,
      reason:
        "spec.json: S1: range is three sizes in mm along x, y and z, each a number it must be, [least, most], or null for no limit along one.",
    });
  });

  it("asks for what a kind's fields need of each other", () => {
    const cad = kindsOf(["mass", "balance", "ribs", "bend", "clearance"]);
    expect(read([{ id: "M1", check: "mass", max: 100 }], cad)).toEqual({
      ok: false,
      reason:
        "spec.json: M1: a mass check gives the material, or its density in g/cm³.",
    });
    expect(
      read([{ id: "B1", check: "balance", at: [0, 0, null] }], cad),
    ).toEqual({
      ok: false,
      reason: "spec.json: B1: a balance check gives tolerance with at.",
    });
    expect(read([{ id: "B1", check: "balance" }], cad)).toEqual({
      ok: false,
      reason:
        "spec.json: B1: a balance check gives at with tolerance, footprint: true, or both.",
    });
    expect(
      read(
        [
          {
            id: "B1",
            check: "balance",
            footprint: true,
            materials: { Base: "steel", "/Arm_.*/": 1.2 },
          },
        ],
        cad,
      ).ok,
    ).toBe(true);
    expect(
      read(
        [
          {
            id: "B1",
            check: "balance",
            footprint: true,
            materials: { Base: "gold" },
          },
        ],
        cad,
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("B1: materials maps a part"),
    });
    expect(
      read([{ id: "F1", check: "ribs", part: "Case", wall: 2.5 }], cad),
    ).toEqual({
      ok: false,
      reason: "spec.json: F1: a ribs check gives ratio, height or both.",
    });
    expect(read([{ id: "K1", check: "bend", part: "Bracket" }], cad)).toEqual({
      ok: false,
      reason:
        "spec.json: K1: a bend check gives radius, flange, hole, edge, reliefs: true, rules: true or several.",
    });
    expect(
      read(
        [
          {
            id: "C1",
            check: "clearance",
            between: ["Lid", "Box"],
            min: 0.3,
            height: 1,
          },
        ],
        cad,
      ),
    ).toEqual({
      ok: false,
      reason:
        "spec.json: C1: a clearance check gives bed when it gives height or up.",
    });
  });
});

describe("the kinds of a part's form, making and strength", () => {
  const cad = kindsOf([
    "wall",
    "undercut",
    "void",
    "smooth",
    "stress",
    "strain",
  ]);
  const refused = (requirement: Record<string, unknown>) => {
    const read = readRequirements(
      JSON.stringify({ requirements: [{ id: "R1", ...requirement }] }),
      "spec.json",
      cad,
    );
    return read.ok ? "read" : read.reason;
  };

  it("reads a wall by its thinnest, its thickest, its ratio to nominal or its spread about nominal", () => {
    expect(refused({ check: "wall", part: "Case", max: 4 })).toBe("read");
    expect(
      refused({
        check: "wall",
        part: "Case",
        min: 1.5,
        ratio: 1.3,
        band: 0.5,
        outside: 5,
      }),
    ).toBe("read");
    expect(refused({ check: "wall", part: "Case" })).toBe(
      "spec.json: R1: a wall check gives min, max, ratio, band or several.",
    );
    expect(refused({ check: "wall", part: "Case", min: 1, outside: 5 })).toBe(
      "spec.json: R1: a wall check gives band with outside.",
    );
    expect(refused({ check: "wall", part: "Case", min: 1, nominal: 2 })).toBe(
      "spec.json: R1: a wall check gives ratio or band with nominal.",
    );
    expect(
      refused({ check: "wall", part: "Case", band: 0.5, outside: 120 }),
    ).toBe(
      "spec.json: R1: outside is the most of the part's surface, in %, whose wall may lie outside nominal ± band, from 0 to 100; 0 when left out.",
    );
  });

  it("reads an undercut, a void and a smooth surface with their own fields", () => {
    expect(
      refused({
        check: "undercut",
        part: "Case",
        pull: [0, 0, 1],
        parting: 5,
        sides: true,
        max: 20,
      }),
    ).toBe("read");
    expect(refused({ check: "void", part: "Shell", opening: 3.5 })).toBe(
      "read",
    );
    expect(
      refused({ check: "smooth", part: "Shell", surfaces: ["skin"] }),
    ).toBe("read");
    expect(refused({ check: "smooth", part: "Shell", level: "G3" })).toMatch(
      /^spec\.json: R1: level is "G1"/,
    );
    expect(refused({ check: "smooth", part: "Shell", curvature: 0.2 })).toBe(
      'spec.json: R1: a smooth check gives level "G2" with curvature.',
    );
  });

  it("reads a stress with its load case and figures, and a strain with the push on its arm", () => {
    const shaft = {
      check: "stress",
      part: "Shaft",
      along: [1, 0, 0],
      safety: 2,
      load: 500,
      toward: [0, 0, -1],
      material: "steel",
    };
    expect(refused(shaft)).toBe("read");
    expect(refused({ ...shaft, deflection: 0.1 })).toBe("read");
    expect(refused({ ...shaft, load: undefined, toward: undefined })).toBe(
      "spec.json: R1: a stress check gives load, torque or both.",
    );
    expect(refused({ ...shaft, toward: undefined })).toBe(
      "spec.json: R1: a stress check gives toward with load.",
    );
    expect(refused({ ...shaft, material: undefined })).toBe(
      "spec.json: R1: a stress check gives the material, or its yield strength in MPa.",
    );
    expect(refused({ ...shaft, supports: "fixed", deflection: 0.1 })).toBe(
      "spec.json: R1: a stress check gives deflection with a load on a simple or cantilever part.",
    );
    expect(
      refused({ ...shaft, material: undefined, yield: 40, deflection: 0.1 }),
    ).toBe(
      "spec.json: R1: a stress check gives the material, or its modulus in MPa, with deflection.",
    );
    const arm = {
      check: "strain",
      part: "Latch",
      along: [0, 0, 1],
      toward: [1, 0, 0],
      deflection: 1.2,
      max: 2.5,
    };
    expect(refused(arm)).toBe("read");
    expect(refused({ ...arm, root: [0, 0, null] })).toBe(
      "spec.json: R1: root is the point [x, y, z] in mm where the arm leaves what holds it; left out, the part's lowest along along.",
    );
    expect(refused({ ...arm, max: undefined })).toBe(
      "spec.json: R1: a strain check needs max.",
    );
  });
});

describe("a range", () => {
  it("holds a measure between its ends by the nearer one, and past them below zero", () => {
    expect(rangeMargin(82, [80, 85], 0.01)).toBe(2);
    expect(rangeMargin(90, [80, 85], 0.01)).toBe(-5);
    expect(rangeMargin(78, [80, 85], 0.01)).toBe(-2);
  });

  it("holds a measure equal to a single number within the studio's precision", () => {
    expect(rangeMargin(95.004, 95, 0.01)).toBeCloseTo(0.006);
    expect(rangeMargin(95.5, 95, 0.01)).toBeCloseTo(-0.49);
    expect(rangeWords(95)).toBe("95 mm");
    expect(rangeWords([80, 85])).toBe("80 to 85 mm");
  });
});

describe("the verdicts", () => {
  const checked: Checked[] = [
    {
      id: "S1",
      holds: true,
      measured: "Body is 82 × 82 × 95 mm",
      margin: 2,
      unit: "mm",
    },
    {
      id: "T1",
      holds: false,
      measured: "Handle is 20 mm thick, where at most 10 mm is asked",
      margin: -10,
      unit: "mm",
    },
    { id: "W1", holds: null, why: "Lid is not shown in this build" },
  ];
  const says = { T1: "Handle 8 to 10 mm thick" };

  it("say how many hold, each one's measure and margin, and why one could not be checked", () => {
    expect(verdictLines({ file: "spec.json" }, checked, says, {})).toEqual([
      "Requirements in spec.json: 1 of 2 checked holds, 1 not checked.",
      "- S1 holds: Body is 82 × 82 × 95 mm; 2 mm to spare.",
      "- T1 (Handle 8 to 10 mm thick) fails: Handle is 20 mm thick, where at most 10 mm is asked; 10 mm past the limit.",
      "- W1 not checked: Lid is not shown in this build.",
    ]);
  });

  it("say a margin and a range under one millimetre to three figures, never as 0", () => {
    const last = lastOf(
      keptOf([{ id: "S2", holds: true, margin: 0.0125, unit: "mm" }], {}),
    );
    expect(
      verdictLines(
        { file: "spec.json", since: "the last change" },
        [
          {
            id: "S2",
            holds: true,
            measured: "Body is 95 mm high",
            margin: 0.003,
            unit: "mm",
          },
        ],
        {},
        last,
      ),
    ).toEqual([
      "Requirements in spec.json: 1 of 1 checked holds.",
      "- S2 holds, its margin down from 0.0125 to 0.003 mm since the last change: Body is 95 mm high; 0.003 mm to spare.",
    ]);
    expect(rangeWords([94.997, 100])).toBe("95 to 100 mm");
    expect(rangeWords([0.0125, 0.5])).toBe("0.0125 to 0.5 mm");
  });

  it("say how each margin moved since the last check, under the studio's heading", () => {
    const last = lastOf(
      keptOf([{ id: "S1", holds: true, margin: 3.5, unit: "mm" }], {}),
    );
    expect(
      verdictLines(
        {
          file: "spec.json",
          title: "Spec for mug, 11 oz",
          since: "the last change",
        },
        checked.slice(0, 1),
        {},
        last,
      ),
    ).toEqual([
      "Spec for mug, 11 oz: 1 of 1 checked holds.",
      "- S1 holds, its margin down from 3.5 to 2 mm since the last change: Body is 82 × 82 × 95 mm; 2 mm to spare.",
    ]);
  });

  it("name once a requirement that failed last time and has left the file", () => {
    const first = keptOf(checked, says);
    const without = checked.filter((one) => one.id !== "T1");
    const next = verdictLines(
      { file: "spec.json" },
      without,
      says,
      lastOf(first),
    );
    expect(next).toContain(
      "T1 (Handle 8 to 10 mm thick) failed in the last build, 10 mm past its limit, and is no longer in spec.json.",
    );
    const after = verdictLines(
      { file: "spec.json" },
      without,
      says,
      lastOf(keptOf(without, says)),
    );
    expect(after.join("\n")).not.toContain("T1");
  });

  it("are shown to the person as a list of checks, with a removed failure under it", () => {
    const detail = verdictDetail(
      { file: "spec.json" },
      checked.slice(0, 1),
      {},
      lastOf(keptOf(checked, says)),
    );
    expect(detail).toEqual({
      kind: "checks",
      label: "Requirements in spec.json",
      items: [
        {
          label: "S1",
          holds: true,
          note: "Body is 82 × 82 × 95 mm; 2 mm to spare",
        },
      ],
      note: "T1 (Handle 8 to 10 mm thick) failed in the last build, 10 mm past its limit, and is no longer in spec.json.",
    });
    expect(verdictDetail({ file: "spec.json" }, [], {}, {})).toBeUndefined();
  });

  it("keep nothing of a last check that is not a requirement's record", () => {
    expect(lastOf({ S1: { holds: true }, S2: "broken" })).toEqual({
      S1: { holds: true },
    });
    expect(lastOf("broken")).toEqual({});
  });
});
